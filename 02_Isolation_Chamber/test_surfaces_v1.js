import { CIRCUIT_DEF } from '../03_Stable_Build/circuit-track.js';
import { createVehicleState, updateVehicle } from '../03_Stable_Build/vehicle-physics.js';
import { buildRoadIndex, roadAt, sampleSpline } from './road-geometry_v1.js';
import { resolveBarrier } from './barriers_v1.js';
import { applySurfaceDrag, surfaceDrag, sustainableSpeed, SURFACE_GRIP } from './surfaces_v1.js';

/**
 * test_surfaces_v1.js — SOLID GROUND S3's Defined Win, in a terminal.
 *
 * INPUT:  a vehicle driven by updateVehicle at 60 Hz, plus the S1 road index.
 * OUTPUT: the vehicle's speed after applySurfaceDrag.
 * PASS:   the equilibrium on every surface matches the derived fixed point exactly,
 *         tarmac is a bit-identical no-op, leaving the road costs measurable time and
 *         distance, and the shortcut's arithmetic is a trade rather than a gift.
 *
 * ── WHY THE DEFINED WIN IS NOT A LAP-TIME COMPARISON ──────────────────────────
 * The plan asked for "a lap on the racing line is faster than a lap cutting every
 * corner across the grass". Measured on this circuit, the straight-line gate-to-gate
 * chord — the hardest possible cut, and what bots.js actually steers — is 100% TARMAC.
 * There is no grass-cutting line to punish. T0 pins that measurement so the next reader
 * does not re-plan around the false premise; it is a track-SHAPE finding for S5.
 *
 * Two further traps ruled a lap comparison out even where it seemed available:
 *  - CONTROLLER QUALITY DOMINATES. A gate-chasing driver sent round the SHORTCUT covered
 *    984 m of a 428 m route and finished 20 s down. That measures my controller, not the
 *    surfaces, and any "cutting is slower" result built on it would be a false pass.
 *  - S2 CAN DO THE WORK INSTEAD. If a cutting lap is slower because it scraped barriers,
 *    that is last session's mechanism getting the credit for this one's.
 * So every assertion below isolates the surface effect: same start, same inputs, same
 * duration, one variable.
 */

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { console.log(`✅ PASS: ${label}`); passed++; }
  else { console.log(`❌ FAIL: ${label}`); failed++; }
}

const DT = 1 / 60;
const ROAD = CIRCUIT_DEF.road;
const index = buildRoadIndex(ROAD);

// server.js:34 — the one stat block every kart in every room actually gets.
const STATS = {
  max_speed: 40.0,
  acceleration: 5.0,
  handling: 1.5,
  stunt_rate: 2.0,
  weight: 1000.0,
  boost_mult: 1.5,
};

function kartAt(x, z, rotY, speed = 0) {
  const v = createVehicleState('P0', STATS);
  v.x = x; v.z = z; v.rotY = rotY; v.speed = speed;
  return v;
}

// A kart placed on a chosen surface, pointed along the road so it stays there.
function kartOnSurface(surface) {
  if (surface === 'TARMAC') {
    const here = sampleSpline(ROAD.mainPoints, 0.80);
    const ahead = sampleSpline(ROAD.mainPoints, 0.805);
    return kartAt(here.x, here.z, Math.atan2(-(ahead.x - here.x), -(ahead.z - here.z)));
  }
  if (surface === 'DIRT') {
    const here = sampleSpline(ROAD.shortcutPoints, 0.40);
    const ahead = sampleSpline(ROAD.shortcutPoints, 0.405);
    return kartAt(here.x, here.z, Math.atan2(-(ahead.x - here.x), -(ahead.z - here.z)));
  }
  // GRASS: out past the dirt path's open side, where S2 genuinely lets a kart go.
  const p = sampleSpline(ROAD.shortcutPoints, 0.40);
  const ahead = sampleSpline(ROAD.shortcutPoints, 0.405);
  const dx = ahead.x - p.x, dz = ahead.z - p.z, L = Math.hypot(dx, dz);
  return kartAt(p.x + (-dz / L) * 14, p.z + (dx / L) * 14, Math.atan2(-dx, -dz));
}

// ── Test 0: pin the measurement that invalidated the plan's Defined Win ───────
(() => {
  const gate = (id) => CIRCUIT_DEF.gates.find((g) => g.id === id);
  const chordSurfaces = (route) => {
    const tally = { TARMAC: 0, DIRT: 0, GRASS: 0 };
    for (let i = 0; i < route.length; i += 1) {
      const a = gate(route[i]).center;
      const b = gate(route[(i + 1) % route.length]).center;
      const steps = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.z - a.z)));
      for (let k = 0; k < steps; k += 1) {
        const f = k / steps;
        tally[roadAt(index, a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f, null).surface] += 1;
      }
    }
    const n = tally.TARMAC + tally.DIRT + tally.GRASS;
    return { tarmac: tally.TARMAC / n, dirt: tally.DIRT / n, grass: tally.GRASS / n };
  };

  const main = chordSurfaces(CIRCUIT_DEF.routes.MAIN);
  assert(main.grass === 0 && main.tarmac === 1,
    `T0a: cutting every MAIN corner dead straight never leaves the tarmac (${(main.tarmac * 100).toFixed(1)}% tarmac, ${(main.grass * 100).toFixed(1)}% grass) — so the plan's grass-cutting lap does not exist on this track (S5)`);

  const sc = chordSurfaces(CIRCUIT_DEF.routes.SHORTCUT);
  assert(sc.dirt > 0.25,
    `T0b: but the SHORTCUT chord is substantially dirt (${(sc.dirt * 100).toFixed(1)}%) — that is where grip has consequence`);
})();

/**
 * rollingRoad — hold a kart on ONE surface and let its speed converge.
 *
 * WHY THE POSITION IS PINNED: my first version of the three tests below simply drove the
 * kart and watched its speed. Every one of them was wrong, and all in the same way — a
 * kart under full throttle with no steering leaves a 16 m dirt path in under a second,
 * so ALL THREE surfaces converged to 17.9 m/s, which is the GRASS fixed point. The
 * TARMAC case reported 17.9 against an expected 40 and looked like a broken formula
 * when it was a fixture that had driven onto the grass. Checking the surface on tick 0
 * only, as I first did, cannot catch that.
 *
 * Pinning position is not a dodge: these tests ask what a surface does to speed, and
 * position is the confound. Distance is accumulated as the integral of speed, which is
 * exactly the ground the kart would have covered. The surface is re-asserted EVERY tick.
 */
function rollingRoad(surface, seconds, startSpeed = 0) {
  const v = kartOnSurface(surface);
  v.speed = startSpeed;
  const anchor = { x: v.x, z: v.z };
  let distance = 0;
  let offSurface = 0;
  let ticksToFull = -1;
  for (let i = 0; i < 60 * seconds; i += 1) {
    Object.assign(v, updateVehicle(v, { throttle: 1 }, DT));
    v.x = anchor.x; v.z = anchor.z; // stay on the surface under test
    const report = applySurfaceDrag(v, index, DT);
    if (report.surface !== surface) offSurface += 1;
    distance += v.speed * DT;
    if (ticksToFull < 0 && v.speed >= STATS.max_speed - 0.05) ticksToFull = i;
  }
  return { speed: v.speed, distance, offSurface, ticksToFull };
}

/**
 * equilibrium — iterate the rolling road until the speed stops changing at all.
 *
 * WHY NOT A FIXED DURATION: the approach to the fixed point is geometric, shrinking by
 * (1 - drag*dt) per tick, so a fixed tick count lands NEAR the asymptote, never on it.
 * My first version ran 60 s and asserted 1e-9: grass came within 1.3e-7 and dirt within
 * 0.007 m/s, both of which are exactly `expected * (1 - drag*dt)^3600`. The formula was
 * right and the test was measuring how long I had waited. Running to bit-stability tests
 * the fixed point itself.
 */
function equilibrium(surface) {
  const v = kartOnSurface(surface);
  const anchor = { x: v.x, z: v.z };
  let offSurface = 0;
  let last = -1;
  let ticks = 0;
  for (; ticks < 60 * 600; ticks += 1) {
    Object.assign(v, updateVehicle(v, { throttle: 1 }, DT));
    v.x = anchor.x; v.z = anchor.z;
    if (applySurfaceDrag(v, index, DT).surface !== surface) offSurface += 1;
    if (v.speed === last) break;
    last = v.speed;
  }
  return { speed: v.speed, offSurface, ticks, converged: ticks < 60 * 600 };
}

// ── Test 1: the equilibrium is the derived fixed point, not a tuned number ────
(() => {
  for (const surface of ['TARMAC', 'DIRT', 'GRASS']) {
    const r = equilibrium(surface);
    assert(r.offSurface === 0,
      `T1${surface[0]}0: the ${surface} fixture stayed on ${surface} for all ${r.ticks} ticks (${r.offSurface} off)`);
    assert(r.converged, `T1${surface[0]}1: ${surface} reached a stable speed (${r.ticks} ticks)`);

    const drag = surfaceDrag(surface, STATS);
    // The exact fixed point of the two-step recurrence: updateVehicle adds a*dt, then
    // this module multiplies by (1 - drag*dt). Solving s = (s + a*dt)(1 - drag*dt) gives
    // s = a(1 - drag*dt)/drag, which is grip*max_speed reduced by the 60 Hz
    // discretisation factor. Asserting the exact fixed point rather than the nominal
    // fraction is the difference between testing the model and testing a hope.
    const expected = drag === 0
      ? STATS.max_speed
      : STATS.acceleration * (1 - drag * DT) / drag;
    assert(Math.abs(r.speed - expected) < 1e-9,
      `T1${surface[0]}: ${surface} settles at the derived fixed point (${r.speed.toFixed(6)} vs ${expected.toFixed(6)} m/s; nominal ${sustainableSpeed(surface, STATS)}, ${r.ticks} ticks)`);
  }
})();

// ── Test 2: TARMAC IS A BIT-IDENTICAL NO-OP ──────────────────────────────────
(() => {
  // The single most important assertion in this file. Every constant in
  // vehicle-physics.js was tuned on a world that was implicitly all tarmac, so if this
  // slice changes a tarmac lap at all it has broken the reference the whole game is
  // balanced against — and it would also mean the racing line got FASTER rather than
  // off-road getting slower, which is a false way to pass a "racing line wins" test.
  const withDrag = kartOnSurface('TARMAC');
  const without = kartOnSurface('TARMAC');
  let sawTarmac = 0;
  for (let i = 0; i < 60 * 20; i += 1) {
    const steer = ((i % 120) - 60) / 120;
    Object.assign(withDrag, updateVehicle(withDrag, { throttle: 1, steer }, DT));
    resolveBarrier(withDrag, index, DT);
    if (applySurfaceDrag(withDrag, index, DT).surface === 'TARMAC') sawTarmac += 1;

    Object.assign(without, updateVehicle(without, { throttle: 1, steer }, DT));
    resolveBarrier(without, index, DT);
  }
  assert(sawTarmac > 60 * 15, `T2a: the run really did spend its time on tarmac (${sawTarmac} of ${60 * 20} ticks)`);
  assert(withDrag.x === without.x && withDrag.z === without.z
    && withDrag.speed === without.speed && withDrag.rotY === without.rotY,
    `T2b: twenty seconds of tarmac driving is BIT-IDENTICAL with and without this module (speed ${withDrag.speed} vs ${without.speed})`);
  assert(surfaceDrag('TARMAC', STATS) === 0, 'T2c: because tarmac drag is exactly zero, not merely small');
})();

// ── Test 3: leaving the road costs time — same input, one variable ────────────
(() => {
  // Two karts, identical stats, identical throttle, identical duration. One is on the
  // dirt path, one is 14 m to the side of it on the grass. No steering, no barriers in
  // reach, no controller to blame: the ONLY difference is the ground.
  const SECONDS = 8;
  const tarmac = rollingRoad('TARMAC', SECONDS);
  const dirt = rollingRoad('DIRT', SECONDS);
  const grass = rollingRoad('GRASS', SECONDS);

  // Guard against the fixture drifting off the surface it claims to test — the trap
  // that made four of S2's tests, and three of this file's, pass for the wrong reason.
  assert(tarmac.offSurface === 0 && dirt.offSurface === 0 && grass.offSurface === 0,
    `T3z: each run stayed on its own surface for every tick (${tarmac.offSurface}/${dirt.offSurface}/${grass.offSurface} off)`);

  assert(grass.distance < dirt.distance && dirt.distance < tarmac.distance,
    `T3a: ground covered in ${SECONDS} s is ordered tarmac > dirt > grass (${tarmac.distance.toFixed(1)} / ${dirt.distance.toFixed(1)} / ${grass.distance.toFixed(1)} m)`);
  assert(grass.speed < dirt.speed * 0.75,
    `T3b: and grass is much slower than dirt, not marginally (${grass.speed.toFixed(1)} vs ${dirt.speed.toFixed(1)} m/s)`);
  // The headline numbers, in the units a player experiences.
  console.log(`   [cost] over ${SECONDS} s: dirt loses ${(tarmac.distance - dirt.distance).toFixed(1)} m to tarmac (${((1 - dirt.distance / tarmac.distance) * 100).toFixed(0)}%), grass loses ${(tarmac.distance - grass.distance).toFixed(1)} m (${((1 - grass.distance / tarmac.distance) * 100).toFixed(0)}%)`);
})();

// ── Test 4: a mistake is recoverable, not race-ending ────────────────────────
(() => {
  // Genre check with a number on it: drop to the grass equilibrium, then return to
  // tarmac and time the recovery. If this were tens of seconds, one error would end a
  // race, which is not what an arcade kart racer does.
  const r = rollingRoad('TARMAC', 30, sustainableSpeed('GRASS', STATS));
  assert(r.offSurface === 0, `T4z: the recovery run stayed on tarmac (${r.offSurface} ticks off)`);
  assert(r.ticksToFull > 0 && r.ticksToFull / 60 < 6,
    `T4a: back on tarmac a kart recovers from the grass speed to full in ${(r.ticksToFull / 60).toFixed(2)} s — a lost position, not a lost race`);
})();

// ── Test 5: the shortcut becomes a trade, computed from measured geometry ─────
(() => {
  // WHY THIS IS ARITHMETIC AND NOT A DRIVEN LAP: a driven comparison measures the
  // driver. The decision a player faces is a ratio between a distance saving and a grip
  // cost, and both are measurable exactly.
  const gate = (id) => CIRCUIT_DEF.gates.find((g) => g.id === id);
  const routeLength = (route) => {
    let total = 0;
    for (let i = 0; i < route.length; i += 1) {
      const a = gate(route[i]).center;
      const b = gate(route[(i + 1) % route.length]).center;
      total += Math.hypot(b.x - a.x, b.z - a.z);
    }
    return total;
  };
  const dirtFraction = (route) => {
    let dirt = 0, n = 0;
    for (let i = 0; i < route.length; i += 1) {
      const a = gate(route[i]).center;
      const b = gate(route[(i + 1) % route.length]).center;
      const steps = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.z - a.z)));
      for (let k = 0; k < steps; k += 1) {
        const f = k / steps;
        if (roadAt(index, a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f, null).surface === 'DIRT') dirt += 1;
        n += 1;
      }
    }
    return dirt / n;
  };

  const mainLen = routeLength(CIRCUIT_DEF.routes.MAIN);
  const scLen = routeLength(CIRCUIT_DEF.routes.SHORTCUT);
  const scDirt = dirtFraction(CIRCUIT_DEF.routes.SHORTCUT);

  // Time at a sustained speed: tarmac stretches at max_speed, dirt stretches at
  // grip*max_speed. This ignores acceleration transients, which is stated rather than
  // hidden — it is a comparison of the steady-state cost of the two routes.
  const mainTime = mainLen / STATS.max_speed;
  const scTime = (scLen * (1 - scDirt)) / STATS.max_speed
    + (scLen * scDirt) / (SURFACE_GRIP.DIRT * STATS.max_speed);
  const breakEvenGrip = scDirt === 0 ? 1 : (scLen * scDirt) / (mainLen - scLen * (1 - scDirt));

  console.log(`   [shortcut] MAIN ${mainLen.toFixed(1)} m -> ${mainTime.toFixed(2)} s | SHORTCUT ${scLen.toFixed(1)} m, ${(scDirt * 100).toFixed(1)}% dirt -> ${scTime.toFixed(2)} s`);
  console.log(`   [shortcut] DIRT grip ${SURFACE_GRIP.DIRT}; break-even grip is ${breakEvenGrip.toFixed(3)} — the shortcut is ${scTime < mainTime ? 'worth taking' : 'a loss'} by ${Math.abs(mainTime - scTime).toFixed(2)} s`);

  assert(scLen < mainLen, `T5a: the shortcut is genuinely shorter (${(100 - scLen / mainLen * 100).toFixed(1)}%)`);
  assert(scDirt > 0.25, `T5b: and genuinely dirt (${(scDirt * 100).toFixed(1)}%)`);
  // The design intent: marginal, on the favourable side. Both bounds matter — a free
  // saving is not a decision, and a pure loss is not a shortcut.
  // 0.3 s on an 11.26 s ideal lap is 2.7%. The bound has to be this tight to mean
  // anything: at DIRT = 0.99 the shortcut is 0.53 s up, which is a 4.7% free gift and
  // not a decision at all — and a 0.6 s window (my first choice) let that through.
  assert(Math.abs(mainTime - scTime) < 0.3,
    `T5c: the two routes are within 0.3 s of each other, so taking it is a DECISION (gap ${Math.abs(mainTime - scTime).toFixed(3)} s)`);
  assert(SURFACE_GRIP.DIRT > breakEvenGrip,
    `T5d: DIRT grip sits on the favourable side of break-even (${SURFACE_GRIP.DIRT} > ${breakEvenGrip.toFixed(3)}), rewarding the narrower unrailed line`);
  // And it must not be free, which is what it was before this slice.
  const freeTime = scLen / STATS.max_speed;
  assert(scTime > freeTime,
    `T5e: it is no longer a free saving (${scTime.toFixed(2)} s with grip vs ${freeTime.toFixed(2)} s without)`);
})();

// ── Test 6: airborne karts touch no ground ───────────────────────────────────
(() => {
  const v = kartOnSurface('GRASS');
  v.speed = 40;
  v.state = 'AIRBORNE';
  v.y = 5;
  const before = v.speed;
  const report = applySurfaceDrag(v, index, DT);
  assert(report.dragged === false && v.speed === before,
    'T6a: an airborne kart over grass is not charged for it');
  // And prove the fixture would otherwise have been charged, so this is not vacuous.
  const grounded = kartOnSurface('GRASS');
  grounded.speed = 40;
  assert(applySurfaceDrag(grounded, index, DT).dragged === true,
    'T6z: the same kart on the ground IS charged — so T6a tests the exemption, not the position');
})();

// ── Test 7: determinism and the stat-block scaling ───────────────────────────
(() => {
  const run = () => {
    const v = kartOnSurface('GRASS');
    for (let i = 0; i < 600; i += 1) {
      Object.assign(v, updateVehicle(v, { throttle: 1, steer: ((i % 40) - 20) / 40 }, DT));
      applySurfaceDrag(v, index, DT);
    }
    return v;
  };
  const a = run(), b = run();
  assert(a.x === b.x && a.z === b.z && a.speed === b.speed,
    'T7a: identical runs are bit-identical (RSK-003 — a desync here would be silent)');

  // The fraction must hold for any stat block, which is the whole reason the drag is
  // derived rather than typed. spec.md section 3 puts max_speed in [20, 60].
  for (const [maxSpeed, accel] of [[20, 2], [40, 5], [60, 8]]) {
    const stats = { ...STATS, max_speed: maxSpeed, acceleration: accel };
    const drag = surfaceDrag('GRASS', stats);
    const fixed = accel * (1 - drag * DT) / drag;
    assert(Math.abs(fixed / maxSpeed - SURFACE_GRIP.GRASS) < 0.01,
      `T7b: a ${maxSpeed} m/s kart still settles at ${(SURFACE_GRIP.GRASS * 100).toFixed(0)}% of ITS ceiling (${(fixed / maxSpeed * 100).toFixed(1)}%)`);
  }
  // A boosting kart raises its own ceiling, and the fraction must follow it rather than
  // pinning every kart to one absolute speed.
  assert(sustainableSpeed('DIRT', { ...STATS, max_speed: 60 }) > sustainableSpeed('DIRT', STATS),
    'T7c: a faster kart is faster on dirt too — the grip is a fraction, not a speed limit');
})();

// ── Test 8: the quiet path allocates nothing, and bad input fails loudly ─────
(() => {
  const v = kartOnSurface('TARMAC');
  const a = applySurfaceDrag(v, index, DT);
  const b = applySurfaceDrag(v, index, DT);
  assert(a === b && Object.isFrozen(a),
    'T8a: a kart on tarmac returns the shared frozen report — no allocation on the common path (R07)');

  const air = kartOnSurface('TARMAC');
  air.state = 'AIRBORNE';
  assert(applySurfaceDrag(air, index, DT) === applySurfaceDrag(air, index, DT),
    'T8b: so does an airborne kart');

  let threw = false;
  try { const bad = kartOnSurface('TARMAC'); bad.x = NaN; applySurfaceDrag(bad, index, DT); }
  catch { threw = true; }
  assert(threw, 'T8c: a NaN position throws rather than silently applying full grip');

  // An unrecognised surface must not silently become a brake.
  assert(surfaceDrag('LAVA', STATS) === 0,
    'T8d: an unknown surface is treated as tarmac, so adding one to roadAt cannot accidentally halve the field');
})();

// ── Test 9: S2 and S3 compose — barriers behave identically with grip active ──
//
// The composition risk is real: S3 changes speed, S2's clamp depends on where the
// integrator put the kart, and the two run back to back every tick.
//
// WHY THIS TRACKS ESCAPES, and the lesson behind it: my first version of this test
// counted any kart sitting past a walled barrier as a breach, and reported 15 of them
// with grip active — which looked like S3 breaking S2. Running the identical detector
// with grip OFF reported 21. The detector was wrong, not the composition: a kart that
// has legitimately left the walls (through the dirt-owned junction ground, which S2's
// own T7 handles with an escape flag) wanders back near a wall from OUTSIDE and counts
// as a breach forever. With escape tracking, both runs report 0 breaches and 1 escape.
// **A failing assertion is not evidence until the same detector has been pointed at the
// unchanged code.**
(() => {
  const run = (withSurfaces) => {
    let seed = 20260807;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const karts = Array.from({ length: 6 }, (_, k) => {
      const here = sampleSpline(ROAD.mainPoints, k / 6);
      const ahead = sampleSpline(ROAD.mainPoints, (k / 6 + 0.002) % 1);
      const v = kartAt(here.x, here.z, Math.atan2(-(ahead.x - here.x), -(ahead.z - here.z)), 40);
      v._bias = rand() * 2 - 1;
      v._escaped = false;
      return v;
    });

    let breaches = 0, worst = 0, escapes = 0, throughSteel = 0, dragTicks = 0;
    for (let tick = 0; tick < 60 * 90; tick += 1) {
      for (const v of karts) {
        const steer = Math.max(-1, Math.min(1, v._bias + (rand() - 0.5) * 1.4));
        Object.assign(v, updateVehicle(v, { throttle: 1, steer }, DT));
        const before = roadAt(index, v.x, v.z, null);
        resolveBarrier(v, index, DT);
        if (withSurfaces && applySurfaceDrag(v, index, DT).dragged) dragTicks += 1;

        const r = roadAt(index, v.x, v.z, null);
        const over = Math.abs(r.lateralOffset) - (r.halfWidth + 1.6 - 2.0);
        if (v._escaped) continue;
        if (over > 4.0) {
          v._escaped = true; escapes += 1;
          if (before.edge === 'WALL') throughSteel += 1;
        } else if (r.edge === 'WALL' && over > 0.05) {
          breaches += 1; worst = Math.max(worst, over);
        }
      }
    }
    return { breaches, worst, escapes, throughSteel, dragTicks, karts };
  };

  const off = run(false);
  const on = run(true);

  assert(on.breaches === 0,
    `T9a: with grip active, barriers still hold (${on.breaches} breaches, worst ${(on.worst * 1000).toFixed(1)} mm)`);
  assert(on.throughSteel === 0, `T9b: and no kart escapes through steel (${on.throughSteel})`);
  assert(on.breaches === off.breaches && on.escapes === off.escapes && on.throughSteel === off.throughSteel,
    `T9c: containment is IDENTICAL with and without grip (breaches ${off.breaches}/${on.breaches}, escapes ${off.escapes}/${on.escapes})`);
  assert(on.karts.every((v) => Number.isFinite(v.x) && Number.isFinite(v.speed)),
    'T9d: no NaN after 90 s of both passes');
  assert(on.dragTicks > 0, `T9e: and the run actually exercised off-road grip (${on.dragTicks} dragged ticks)`);
})();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('SOME TESTS FAILED ❌');
  process.exit(1);
}
console.log('ALL TESTS PASSED ✅');
process.exit(0);

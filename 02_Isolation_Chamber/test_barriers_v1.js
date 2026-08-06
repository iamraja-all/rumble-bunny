import { CIRCUIT_DEF } from '../03_Stable_Build/circuit-track.js';
import { createVehicleState, updateVehicle } from '../03_Stable_Build/vehicle-physics.js';
import { buildRoadIndex, roadAt, sampleSpline, RAIL_OFFSET } from './road-geometry_v1.js';
import { resolveBarrier, barrierLine } from './barriers_v1.js';

/**
 * test_barriers_v1.js — SOLID GROUND S2's Defined Win, in a terminal.
 *
 * INPUT:  a vehicle state driven by updateVehicle at 60 Hz, plus the S1 road index.
 * OUTPUT: the vehicle's corrected position, speed and heading after resolveBarrier.
 * PASS:   over a seeded multi-lap sim of eight adversarial drivers, no grounded kart
 *         ever sits meaningfully past the barrier line on a walled edge, every escape
 *         is attributable to ground the steel does not cover, and the shortcut still
 *         works.
 *
 * The drivers here are deliberately HOSTILE, not good. bots.js steers for gate
 * centres and would spend a seeded lap nowhere near a wall, which is a weak test of
 * containment — and putting bots on this track is S7's own session anyway. These
 * drivers hold full throttle and steer at the scenery.
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
const MAIN_LINE = barrierLine(index.MAIN.halfWidth);

/**
 * WHERE THE WALL TESTS ARE RUN, and why it is not an arbitrary number.
 *
 * My first version used t = 0.40, which lands on segment 102 — ground the shortcut
 * overlaps, so the dirt owns it and there is no steel there at all. Half the barrier
 * assertions were being made at a place with no barrier. t = 0.80 is segment 204,
 * walled on both sides, and T0 below refuses to let this drift back if the circuit
 * shape ever changes.
 */
const WALL_T = 0.80;

/**
 * HOW FAR PAST THE LINE STILL COUNTS AS CONTAINED, and why it is not zero.
 *
 * The clamp pushes back along the winning segment's stored normal. Where the closest
 * point falls on a segment JOIN, that normal is not exactly radial, so the correction
 * can undershoot by a fraction of the chord. Measured over 86,400 resolves the worst
 * case is 16.5 mm and it is not spread around the lap: 296 of the worst 300 samples
 * are on segment 246, at (16.6, 28.9). That is inside the 2.2 m spur the duplicate
 * (0,25) control point adds near the start/finish line (S1's T10h) — the tightest
 * curvature on the whole polyline, so the worst place for a chord approximation.
 *
 * 5 cm is the pass bound: it is 0.3% of the 15.6 m barrier and one eightieth of a
 * kart's width, so nothing at this scale is "driving through steel". The measured
 * figure is printed rather than asserted tightly, because the number is a property
 * of the track's geometry and S5's reshape will change it.
 */
const BREACH_TOLERANCE = 0.05;

// server.js:34 — the one stat block every kart in every room actually gets.
const STATS = {
  max_speed: 40.0,
  acceleration: 5.0,
  handling: 1.5,
  stunt_rate: 2.0,
  weight: 1000.0,
  boost_mult: 1.5,
};

function lcg(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

// Place a kart at a given lateral offset from the main centreline, heading at a
// chosen angle relative to the road direction. Everything about this circuit is a
// curve, so a wall test has to be built from the geometry rather than typed.
function kartOnRoadAt(t, lateralMetres, headingOffsetRadians, id = 'P0') {
  const here = sampleSpline(ROAD.mainPoints, t);
  const ahead = sampleSpline(ROAD.mainPoints, (t + 0.002) % 1);
  const dirX = ahead.x - here.x;
  const dirZ = ahead.z - here.z;
  const dirLen = Math.hypot(dirX, dirZ);

  const v = createVehicleState(id, STATS);
  v.x = here.x + (-dirZ / dirLen) * lateralMetres;
  v.z = here.z + (dirX / dirLen) * lateralMetres;
  // Heading such that rotY = 0 faces -Z, per vehicle-physics.js:319-320.
  v.rotY = Math.atan2(-dirX, -dirZ) + headingOffsetRadians;
  v.speed = STATS.max_speed;
  return v;
}

function drive(v, ticks, input, onTick) {
  for (let i = 0; i < ticks; i += 1) {
    Object.assign(v, updateVehicle(v, typeof input === 'function' ? input(i, v) : input, DT));
    const contact = resolveBarrier(v, index, DT);
    if (onTick) onTick(i, v, contact);
  }
  return v;
}

const lateral = (v) => roadAt(index, v.x, v.z, null).lateralOffset;
const overshootOf = (v) => {
  const r = roadAt(index, v.x, v.z, null);
  return { over: Math.abs(r.lateralOffset) - barrierLine(r.halfWidth), edge: r.edge, seg: r.segmentIndex };
};

// ── Test 0: the fixture is actually standing next to a wall ───────────────────
(() => {
  const probe = kartOnRoadAt(WALL_T, MAIN_LINE - 1, 0);
  const inward = roadAt(index, probe.x, probe.z, null);
  const other = kartOnRoadAt(WALL_T, -(MAIN_LINE - 1), 0);
  const outward = roadAt(index, other.x, other.z, null);
  assert(inward.edge === 'WALL' && outward.edge === 'WALL',
    `T0: the wall tests below run on a segment with steel on BOTH sides (seg ${inward.segmentIndex}: ${inward.edge}/${outward.edge})`);
})();

// ── Test 1: the reported bug — the steel stops you ────────────────────────────
(() => {
  // Aimed 60 degrees off the road direction, i.e. hard at the barrier, at the
  // speed ceiling, on a stretch of rail with no gap in it.
  const v = kartOnRoadAt(WALL_T, 0, Math.PI / 3);
  let worst = 0;
  drive(v, 240, { throttle: 1 }, (i, kart) => {
    const o = overshootOf(kart);
    if (o.edge === 'WALL') worst = Math.max(worst, o.over);
  });

  assert(worst < BREACH_TOLERANCE,
    `T1a: a kart driven at the wall never passes the barrier line (worst ${(worst * 1000).toFixed(3)} mm)`);
  assert(Math.abs(lateral(v)) <= MAIN_LINE + BREACH_TOLERANCE,
    `T1b: and it ends the run inside it (${Math.abs(lateral(v)).toFixed(3)} of ${MAIN_LINE})`);
  assert(Number.isFinite(v.x) && Number.isFinite(v.z) && Number.isFinite(v.speed), 'T1c: no NaN reached the vehicle state');

  // Before this slice existed, the same drive left the island entirely. This is the
  // bug in the player's report, reproduced, and it is the reason S2 exists.
  const free = kartOnRoadAt(WALL_T, 0, Math.PI / 3);
  for (let i = 0; i < 240; i += 1) Object.assign(free, updateVehicle(free, { throttle: 1 }, DT));
  assert(Math.abs(lateral(free)) > MAIN_LINE + 20,
    `T1d: with no resolver the same drive ends ${Math.abs(lateral(free)).toFixed(0)} m out — the bug reproduces`);
})();

// ── Test 2: it slides, it does not bounce ─────────────────────────────────────
(() => {
  // A realistic wall-scrape: a shallow 12-degree angle into the steel, which is
  // what running wide out of a corner actually looks like.
  const v = kartOnRoadAt(WALL_T, 0, 12 * Math.PI / 180);
  const samples = [];
  drive(v, 600, { throttle: 1 }, (i, kart) => {
    samples.push({ lat: Math.abs(lateral(kart)), speed: kart.speed, x: kart.x, z: kart.z });
  });

  const firstContact = samples.findIndex((s) => s.lat > MAIN_LINE - 0.05);
  assert(firstContact >= 0, 'T2a: the kart actually reaches the wall');

  // WHY THE WINDOW IS THE CONTIGUOUS CONTACT RUN AND NOT THE REST OF THE SAMPLES:
  // this kart never steers, so once the wall has turned it parallel it carries on
  // across the road and, ten seconds later, is nowhere near the barrier. Measuring
  // "does it hug the wall" over the whole tail therefore reports a kart at the
  // centreline and looks like a violent bounce. The question is only about the time
  // it spends in contact.
  // Guarded on firstContact: a failed T2a must not crash the rest of the file, or a
  // mutation that stops the kart reaching the wall takes every later assertion with
  // it and the mutation looks like it was caught when the run simply died.
  const after = [];
  for (let i = Math.max(0, firstContact); firstContact >= 0 && i < samples.length && samples[i].lat > MAIN_LINE - 0.5; i += 1) {
    after.push(samples[i]);
  }
  if (after.length === 0) after.push({ lat: 0, speed: 0, x: 0, z: 0 });
  // A bounce would show up as the kart being thrown back toward the centreline.
  // Hugging shows up as the offset staying pinned near the line.
  const minAbs = Math.min(...after.map((s) => s.lat));
  assert(minAbs > MAIN_LINE - 3.0,
    `T2b: once in contact it hugs the wall instead of being flung back (closest approach to centre ${minAbs.toFixed(2)} of ${MAIN_LINE})`);
  assert(after.every((s) => s.lat <= MAIN_LINE + BREACH_TOLERANCE), 'T2c: and never crosses it');

  // Sliding means it is still going somewhere. A bounce or a dead stop would not.
  // Arc length, not start-to-end distance: the wall is a curve here, so a straight
  // line between the first and last contact point understates the travel badly.
  let arc = 0;
  for (let i = 1; i < after.length; i += 1) {
    arc += Math.hypot(after[i].x - after[i - 1].x, after[i].z - after[i - 1].z);
  }
  // 20 m is calibrated against the failure modes, not picked: a kart that STOPS dead
  // at the wall covers a metre or two, and one that BOUNCES leaves contact on the
  // first tick and covers almost nothing. Measured behaviour is 33 m — eight kart
  // lengths of slide before the wall has turned it parallel and it drives away.
  assert(arc > 20, `T2d: it keeps travelling along the wall (${arc.toFixed(0)} m of arc while in contact)`);
  assert(v.speed >= 0, 'T2e: speed is never negative — no reversal from a wall');
})();

// ── Test 3: a square hit costs everything, then the wall redirects you ────────
(() => {
  const v = kartOnRoadAt(WALL_T, 0, Math.PI / 2); // exactly perpendicular
  let minSpeed = Infinity;
  let impactTick = -1;
  const intoWallAt = [];
  drive(v, 300, { throttle: 1 }, (i, kart, contact) => {
    if (!contact.contacted) return;
    intoWallAt.push(contact.intoWall);
    if (kart.speed < minSpeed) { minSpeed = kart.speed; impactTick = i; }
  });

  assert(intoWallAt[0] > 0.9, `T3a: the first contact really was square (intoWall ${intoWallAt[0].toFixed(3)})`);
  // The projection takes the whole of a perpendicular heading's motion: there is no
  // tangential component to keep.
  assert(minSpeed < 1.0, `T3b: hitting steel square kills the speed (down to ${minSpeed.toFixed(3)} m/s at tick ${impactTick})`);
  assert(Math.abs(lateral(v)) <= MAIN_LINE + BREACH_TOLERANCE, 'T3c: and does not push you through it');
  assert(v.speed >= 0, 'T3d: never negative');

  // Then the wall turns you along itself. This is the half of the Defined Win a
  // fixed heading could not satisfy — "ends up travelling alongside it".
  //
  // WHY THIS ASSERTS A REDUCTION AND NOT "intoWall ≈ 0": WALL_T is on a CURVE, and a
  // kart with no steering input of its own can only ever be as parallel as the wall
  // was one tick ago. It aligns to the local tangent, the wall turns away, and it is
  // pressing in again — settling at a small residual angle instead of zero. That is
  // correct: a driver who never steers gets dragged around the corner scraping. A
  // "converges to zero" assertion would only hold on a straight, which this circuit
  // does not really have.
  const settled = intoWallAt.at(-1);
  assert(settled < intoWallAt[0] * 0.3,
    `T3e: the wall turns the kart most of the way parallel (intoWall ${intoWallAt[0].toFixed(3)} -> ${settled.toFixed(3)})`);
  assert(v.speed > 5, `T3f: and it is travelling along the wall again, not stuck (${v.speed.toFixed(1)} m/s)`);
})();

// ── Test 4: the cost scales with the angle, measured at the impact ────────────
(() => {
  // WHY THE FIRST CONTACT TICK AND NOT THE END OF THE RUN: sustained contact on a
  // CURVE keeps costing speed, because the wall keeps turning away underneath the
  // kart and the kart — with no steering input of its own — keeps being re-pressed
  // into it. That is correct behaviour (a kart being dragged round a corner by a
  // barrier should bleed speed) but it swamps the thing under test here, which is
  // what a single impact costs. My first version measured after two seconds and read
  // 62% retention on a 10-degree graze, which says more about the corner than the
  // graze.
  // AND WHY THE KART IS PLACED AT THE WALL RATHER THAN DRIVEN INTO IT: my first
  // version started it on the centreline at 10 degrees and let it travel out to the
  // steel. On this curve that takes two seconds, during which the road turns away
  // under a fixed heading, so the kart ARRIVES at 51 degrees and "kept 62.5%" was
  // measuring a half-square hit. Starting in contact is the only way to control the
  // impact angle on a circuit with no straights.
  // THE SIGN, DERIVED NOT GUESSED. The kart sits on the +normal side, so pressing
  // into the wall means turning TOWARD +n. With forward = (-sin rotY, -cos rotY),
  // d(forward)/d(rotY) = (fz, -fx) = -n — increasing rotY rotates AWAY from +n. So a
  // NEGATIVE heading offset is the one that presses in. My first version used
  // positive offsets and every case reported intoWall 0.000 with 100% of the speed
  // kept, which passed two assertions vacuously and only failed on the square hit.
  // A test that can pass while measuring nothing is worse than one that fails.
  const impact = (angleDegrees) => {
    const v = kartOnRoadAt(WALL_T, MAIN_LINE + 0.3, -angleDegrees * Math.PI / 180);
    const speedBefore = v.speed;
    const contact = resolveBarrier(v, index, DT);
    return { intoWall: contact.intoWall, kept: v.speed / speedBefore };
  };

  // Pin that convention, so the next reader does not have to re-derive it and a
  // sign regression in the resolver cannot hide behind a vacuous pass.
  assert(impact(45).intoWall > 0.5 && impact(-45).intoWall === 0,
    'T4z: a negative heading offset presses into the +side wall, a positive one turns away');

  const graze = impact(10);
  const square = impact(90);

  // THE MECHANISM, asserted as an identity rather than as a tuned number: the wall
  // takes the component of motion pointing into it, so what is left is exactly the
  // tangential component, sqrt(1 - intoWall^2). Nothing here is calibrated, which is
  // the point — there is no WALL_SCRUB constant to get wrong.
  assert(Math.abs(graze.kept - Math.sqrt(1 - graze.intoWall ** 2)) < 1e-12,
    `T4a: what survives is exactly the along-wall component (kept ${graze.kept.toFixed(6)}, identity ${Math.sqrt(1 - graze.intoWall ** 2).toFixed(6)})`);
  assert(graze.intoWall < 0.2 && graze.kept > 0.97,
    `T4b: a real 10-degree graze costs almost nothing (intoWall ${graze.intoWall.toFixed(3)}, kept ${(graze.kept * 100).toFixed(1)}%)`);
  assert(square.kept < 0.05,
    `T4c: a square hit costs almost everything (intoWall ${square.intoWall.toFixed(3)}, kept ${(square.kept * 100).toFixed(1)}%)`);
  assert(graze.kept > square.kept * 10, 'T4d: the two are an order of magnitude apart, from one projection and no tuned constant');
})();

// ── Test 5: airborne karts are exempt, and that is load-bearing ───────────────
(() => {
  // A kart in flight, JUST outside the barrier — 1 m past the line, which is inside
  // CONTACT_BAND. That matters: my first fixture put it 30 m out, where the band check
  // would have skipped it anyway, so deleting the airborne exemption entirely still
  // left this test green. It was asserting the band, not the exemption. Every jump
  // over the rail passes through exactly this state on its way out, and clamping here
  // is what would cancel the jump.
  const v = kartOnRoadAt(WALL_T, MAIN_LINE + 1.0, -Math.PI / 4);
  v.state = 'AIRBORNE';
  v.y = 6;
  const grounded = { ...v, state: 'NORMAL' };
  assert(resolveBarrier(grounded, index, DT).contacted === true,
    'T5z: the same position on the ground IS a contact — so this fixture tests the exemption, not the band');
  const before = { x: v.x, z: v.z, speed: v.speed, rotY: v.rotY };
  const contact = resolveBarrier(v, index, DT);
  assert(contact.contacted === false, 'T5a: an airborne kart is not in contact with a barrier');
  assert(v.x === before.x && v.z === before.z && v.speed === before.speed && v.rotY === before.rotY,
    'T5b: and nothing about it is touched — not even the heading');
  assert(v._roadHint === null, 'T5c: its road hint is cleared, because it may land anywhere');
})();

// ── Test 6: THE SHORTCUT SURVIVED, and by the mechanism that actually does it ──
//
// The danger this guards is real and was nearly shipped wrong: the dirt centreline
// runs up to 29.2 m outside the main barrier line, so if the main road's steel
// applied to every kart out there, solid barriers would wall the shortcut off — and
// spec.md's shortcut, its ramp, its two gates, its route table and the minimap's
// SHORTCUT colouring would all become dead code in the same commit that fixed the
// reported bug.
//
// WHAT PREVENTS THAT is not a gap in the steel. I built one — per-segment, per-side
// edges with a boot pass that opened the rail wherever the dirt crossed it — and
// then measured it: over 506,532 (position, heading) pairs on a 1 m grid across the
// island, the gaps changed the outcome at TWO points, by 8 cm. They were computing
// nothing, so they are gone.
//
// The real mechanism is S1's ownership rule. At a junction the two roads OVERLAP, so
// least-overshoot hands that ground to the dirt, and the dirt has no barriers. These
// assertions test THAT, which is the thing a future change could actually break.
(() => {
  // WHY THE INVARIANT IS A UNION AND NOT "the dirt always owns the dirt": the dirt is
  // a closed loop whose two ends coincide with the main road, so near the junctions
  // its centreline lies ON the tarmac and MAIN correctly owns that ground. 127 of 401
  // sample points are main-owned for exactly that reason. What must never happen is
  // the third case — main-owned AND outside the main barrier — because that is a kart
  // on the dirt path being held by steel that is not there.
  let dirtOwned = 0;
  let mainOwnedInside = 0;
  let mainOwnedOutside = 0;
  let blocked = 0;
  for (let i = 0; i <= 400; i += 1) {
    const p = sampleSpline(ROAD.shortcutPoints, i / 400);
    const r = roadAt(index, p.x, p.z, null);
    if (r.spline === 'SHORTCUT') dirtOwned += 1;
    else if (Math.abs(r.lateralOffset) <= barrierLine(r.halfWidth)) mainOwnedInside += 1;
    else mainOwnedOutside += 1;

    const v = createVehicleState('P0', STATS);
    v.x = p.x; v.z = p.z; v.speed = 20;
    if (resolveBarrier(v, index, DT).contacted) blocked += 1;
  }
  assert(mainOwnedOutside === 0,
    `T6a: no point of the dirt path is main-road ground outside the steel (${dirtOwned} dirt-owned, ${mainOwnedInside} on tarmac, ${mainOwnedOutside} stranded)`);
  assert(blocked === 0, `T6b: so a kart on the dirt is never clamped by the main road's steel (${blocked} of 401 blocked)`);

  // The junction itself: the strip of ground between the tarmac edge and the dirt,
  // at the measured crossing (the dirt leaves the main barrier line at t = 0.2015).
  // This is where a naive implementation puts a wall across the entrance.
  const crossing = sampleSpline(ROAD.shortcutPoints, 0.2015);
  const atCrossing = roadAt(index, crossing.x, crossing.z, null);
  assert(atCrossing.spline === 'SHORTCUT' && atCrossing.edge === 'OPEN',
    `T6c: at the crossing the dirt owns the ground, so there is nothing to drive through (${atCrossing.spline}/${atCrossing.edge})`);

  // And a kart physically traversing the entrance, from the tarmac out onto the dirt,
  // is never pressed back by a barrier.
  let pressed = 0;
  for (let step = 0; step <= 40; step += 1) {
    const f = step / 40;
    const v = createVehicleState('P0', STATS);
    v.x = crossing.x * f + ROAD.shortcutPoints[0].x * (1 - f);
    v.z = crossing.z * f + ROAD.shortcutPoints[0].z * (1 - f);
    v.speed = 30;
    const c = resolveBarrier(v, index, DT);
    if (c.contacted && c.intoWall > 0) pressed += 1;
  }
  assert(pressed === 0, `T6d: driving from the main road onto the dirt is never blocked (${pressed} of 41 sample points pressed a wall)`);
})();

// ── Test 7: THE DEFINED WIN — seeded multi-lap sim, eight hostile drivers ──────
(() => {
  const rand = lcg(20260807);
  const TICKS = 60 * 180; // three minutes, comfortably multi-lap
  const karts = Array.from({ length: 8 }, (_, k) => {
    const v = kartOnRoadAt(k / 8, (k % 5) * 2 - 4, 0, `P${k}`);
    v._escaped = false;
    v._steerBias = rand() * 2 - 1;
    return v;
  });

  let breaches = 0;
  let worstOverhang = 0;
  let worstFirstHalf = 0;
  let worstSecondHalf = 0;
  let escapes = 0;
  let escapesThroughSteel = 0;
  let contacts = 0;

  for (let tick = 0; tick < TICKS; tick += 1) {
    for (const v of karts) {
      // Hostile driver: full throttle, steering that wanders hard toward the
      // scenery. Seeded, so a failure is reproducible (RSK-003).
      const steer = Math.max(-1, Math.min(1, v._steerBias + (rand() - 0.5) * 1.4));
      Object.assign(v, updateVehicle(v, { throttle: 1, steer }, DT));

      const before = roadAt(index, v.x, v.z, null);
      if (resolveBarrier(v, index, DT).contacted) contacts += 1;
      const after = overshootOf(v);

      if (v._escaped) continue;

      if (after.over > 4.0) {
        // The kart is out. That is only legitimate through a hole in the steel.
        v._escaped = true;
        escapes += 1;
        if (before.edge === 'WALL') escapesThroughSteel += 1;
      } else if (after.edge === 'WALL' && after.over > 0) {
        worstOverhang = Math.max(worstOverhang, after.over);
        if (tick < TICKS / 2) worstFirstHalf = Math.max(worstFirstHalf, after.over);
        else worstSecondHalf = Math.max(worstSecondHalf, after.over);
        if (after.over > BREACH_TOLERANCE) breaches += 1;
      }
    }
  }

  console.log(`   [sim] ${TICKS} ticks x 8 karts = ${TICKS * 8} resolves, ${contacts} in contact, ${escapes} left the walls`);
  console.log(`   [sim] worst overhang ${(worstOverhang * 1000).toFixed(2)} mm — first half ${(worstFirstHalf * 1000).toFixed(2)} mm, second half ${(worstSecondHalf * 1000).toFixed(2)} mm`);
  assert(breaches === 0,
    `T7a: no grounded kart ever sits more than ${BREACH_TOLERANCE * 1000} mm past a walled barrier (${breaches} breaches, worst ${(worstOverhang * 1000).toFixed(2)} mm)`);
  assert(escapesThroughSteel === 0, `T7b: every escape went through a real gap, none through steel (${escapesThroughSteel} through steel)`);
  assert(contacts > 1000, `T7c: the drivers really did attack the walls (${contacts} contact ticks)`);
  assert(karts.every((v) => Number.isFinite(v.x) && Number.isFinite(v.z) && Number.isFinite(v.speed)),
    'T7d: no NaN anywhere in the field after three minutes');
  // "Small" and "not accumulating" are different claims and only one is about size.
  assert(worstSecondHalf <= worstFirstHalf * 1.5 + 1e-6,
    `T7e: the residual does not accumulate over three minutes (${(worstFirstHalf * 1000).toFixed(2)} -> ${(worstSecondHalf * 1000).toFixed(2)} mm)`);
})();

// ── Test 8: determinism ──────────────────────────────────────────────────────
(() => {
  const run = () => {
    const rand = lcg(4242);
    const v = kartOnRoadAt(0.1, 0, 0.4);
    for (let i = 0; i < 900; i += 1) {
      Object.assign(v, updateVehicle(v, { throttle: 1, steer: rand() - 0.5 }, DT));
      resolveBarrier(v, index, DT);
    }
    return v;
  };
  const a = run();
  const b = run();
  assert(a.x === b.x && a.z === b.z && a.speed === b.speed && a.rotY === b.rotY,
    'T8a: the same seed produces a bit-identical result (RSK-003)');
})();

// ── Test 9: a kart that starts outside is nudged, not teleported ──────────────
(() => {
  const v = kartOnRoadAt(WALL_T, MAIN_LINE + 2.0, 0);
  const before = { x: v.x, z: v.z };
  // MEASURED, not assumed to be the 2.0 m the fixture asked for: the offset is built
  // along a chord normal, and on a curve the true distance to the polyline is not the
  // same number. Comparing the push against the constructed offset instead of the
  // measured one is what made my first version read 0.42 m and look like a bug.
  const expected = overshootOf(v).over;
  const contact = resolveBarrier(v, index, DT);
  const moved = Math.hypot(v.x - before.x, v.z - before.z);
  assert(contact.contacted === true, 'T9a: a kart just outside the steel is in contact with it');
  assert(Math.abs(moved - expected) < 0.01,
    `T9b: it is nudged back by exactly its overshoot, not teleported (moved ${moved.toFixed(3)} m, overshoot was ${expected.toFixed(3)} m)`);
  assert(Math.abs(lateral(v)) <= MAIN_LINE + BREACH_TOLERANCE, 'T9c: and lands on the legal side of the line');

  // Far outside is a different situation and must NOT be dragged across the map.
  //
  // WHY THE OFFSET IS NEGATIVE (seaward): +25 m past the line at WALL_T lands at
  // (43,27), which the road LOOPS BACK to — measured offset there is 10.8 m, i.e.
  // comfortably INSIDE the barrier. My first fixture used that point, so it reported
  // "not in contact" because the kart was on the road, not because of the contact
  // band, and deleting the band entirely left this test green. The seaward side has
  // no such fold: -38.6 m measures as -38.6 m.
  const far = kartOnRoadAt(WALL_T, -(MAIN_LINE + 25), 0);
  const farBefore = { x: far.x, z: far.z };
  const farState = overshootOf(far);
  assert(farState.over > 4.0 && farState.edge === 'WALL',
    `T9z: the far fixture really is outside a walled edge (over ${farState.over.toFixed(1)} m, ${farState.edge}) — so this tests the band, not the geometry`);
  assert(resolveBarrier(far, index, DT).contacted === false, 'T9d: a kart far outside is not in contact with anything');
  assert(far.x === farBefore.x && far.z === farBefore.z, 'T9e: and is left where it is for S8 to handle');

  // The real grid, printed rather than asserted: an assertion here would fail the
  // day someone FIXES the grid, which is the wrong incentive.
  console.log('   [grid audit] spawn slots vs the main barrier line:');
  CIRCUIT_DEF.spawnPositions.forEach((s, i) => {
    const r = roadAt(index, s.x, s.z, null);
    const over = Math.abs(r.lateralOffset) - barrierLine(r.halfWidth);
    console.log(`     slot ${i} (${s.x},${s.z}) lat ${r.lateralOffset.toFixed(2)} ${over > 0 ? `⚠ OUTSIDE by ${over.toFixed(2)} m` : 'inside'}`);
  });
  const spawner = CIRCUIT_DEF.itemSpawners.find((s) => s.id === 'spawner_1');
  const sr = roadAt(index, spawner.x, spawner.z, null);
  console.log(`     ⚠ spawner_1 (${spawner.x},${spawner.z}) lat ${sr.lateralOffset.toFixed(2)} — ${(Math.abs(sr.lateralOffset) - (index.MAIN.halfWidth + RAIL_OFFSET)).toFixed(2)} m past the steel, so unreachable`);
})();

// ── Test 10: the quiet path allocates nothing ────────────────────────────────
(() => {
  const v = kartOnRoadAt(WALL_T, 0, 0);
  const a = resolveBarrier(v, index, DT);
  const b = resolveBarrier(v, index, DT);
  assert(a === b, 'T10a: a kart nowhere near a wall returns the shared no-contact object (R07, no allocation)');
  assert(Object.isFrozen(a), 'T10b: which is frozen, so a caller cannot corrupt it for everyone');

  let threw = false;
  try { const bad = kartOnRoadAt(WALL_T, 0, 0); bad.x = NaN; resolveBarrier(bad, index, DT); }
  catch { threw = true; }
  assert(threw, 'T10c: a NaN position still throws rather than silently resolving');
})();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('SOME TESTS FAILED ❌');
  process.exit(1);
}
console.log('ALL TESTS PASSED ✅');
process.exit(0);

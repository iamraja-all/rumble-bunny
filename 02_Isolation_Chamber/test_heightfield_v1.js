import { readFileSync } from 'node:fs';
import { CIRCUIT_DEF } from '../03_Stable_Build/circuit-track.js';
import { createVehicleState, updateVehicle, launchVehicle } from '../03_Stable_Build/vehicle-physics.js';
import { buildRoadIndex, roadAt, sampleSpline } from './road-geometry_v1.js';
import { resolveBarrier } from './barriers_v1.js';
import { applySurfaceDrag } from './surfaces_v1.js';
import { COAST, COAST_PROFILE, settleOnTerrain, placeOnTerrain } from './heightfield_v1.js';

/**
 * test_heightfield_v1.js — SOLID GROUND S4's Defined Win, in a terminal.
 *
 * INPUT:  a vehicle driven by updateVehicle at 60 Hz over a heightfield.
 * OUTPUT: the vehicle's y, vy and state after settleOnTerrain.
 * PASS:   a kart follows terrain with no falling through and no jitter, a crest launches
 *         it and a dip does not, a jump taken uphill gets real air and lands cleanly, and
 *         test_vehicle_physics_v1 stays green (run separately by npm test).
 *
 * The mechanism is tested against SYNTHETIC fields — ramps, crests, dips, rolling sine —
 * because that is what makes it general enough for S5 to sculpt with, and because a flat
 * island would prove nothing. The shipped COAST field is then checked on top.
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

// ── Synthetic fields. A field is anything with heightAt(x, z) — no factory needed. ──
// Karts here drive along -Z (rotY = 0), so terrain varies with z.
const flat = { heightAt: () => 0 };
const slope = (grade) => ({ heightAt: (x, z) => -z * grade * -1 * -1 || 0, });
// Written explicitly instead: descending in the direction of travel (-Z) by `grade`.
const downhill = (grade) => ({ heightAt: (x, z) => z * grade });
const uphill = (grade) => ({ heightAt: (x, z) => -z * grade });
// A crest: rises to z = -50 then falls away sharply. The break is what launches a kart.
const crest = (grade) => ({ heightAt: (x, z) => (z > -50 ? -z * grade * 0 : ((-z) - 50) * -grade) });
// Rolling terrain, smooth by construction: no discontinuity anywhere.
const rolling = (amplitude, wavelength) => ({
  heightAt: (x, z) => amplitude * Math.sin((2 * Math.PI * z) / wavelength),
});

function kart(x, z, speed = 0, rotY = 0) {
  const v = createVehicleState('P0', STATS);
  v.x = x; v.z = z; v.rotY = rotY; v.speed = speed;
  v.y = 0;
  return v;
}

/**
 * driveOver — the full contract call order from heightfield_v1's header.
 * Returns per-tick telemetry so the assertions can look at the whole run, not the end.
 */
function driveOver(v, field, ticks, input = { throttle: 1 }, useRoad = false) {
  const log = [];
  for (let i = 0; i < ticks; i += 1) {
    const groundY = field.heightAt(v.x, v.z);          // 1: BEFORE the move
    // `input` may be a function of (tick, vehicle) so a case can react to state — e.g.
    // releasing the throttle once airborne. Passing a function straight to updateVehicle
    // destructures to all-defaults and the kart silently never moves, which is how T5a
    // first failed.
    const controls = typeof input === 'function' ? input(i, v) : input;
    Object.assign(v, updateVehicle(v, controls, DT, groundY)); // 2
    if (useRoad) { resolveBarrier(v, index, DT); applySurfaceDrag(v, index, DT); } // 3, 4
    settleOnTerrain(v, field, DT);                     // 5: LAST
    log.push({
      i, x: v.x, z: v.z, y: v.y, vy: v.vy, speed: v.speed, state: v.state,
      terrain: field.heightAt(v.x, v.z),
    });
  }
  return log;
}

// ── Test 0: the two duplicated constants have not drifted ─────────────────────
// Tripwires, not tests of behaviour. Both duplicates exist only because R02 forbids
// editing 03_Stable_Build to export GRAVITY, and scenery.js is client code. ADR-0017's
// lesson is to ELIMINATE a duplicate rather than guard it — so these assertions and the
// constants they guard are both marked for deletion at promotion.
(() => {
  const physics = readFileSync(new URL('../03_Stable_Build/vehicle-physics.js', import.meta.url), 'utf8');
  assert(/const GRAVITY = 9\.81;/.test(physics),
    'T0a: vehicle-physics.js still uses GRAVITY = 9.81, which this module re-declares');

  const scenery = readFileSync(new URL('../04_Render_Engine/src/scenery.js', import.meta.url), 'utf8');
  const drop = scenery.match(/const CLIFF_DROP = (\d+(?:\.\d+)?)/);
  const flare = scenery.match(/const CLIFF_FLARE = (\d+(?:\.\d+)?)/);
  const sea = scenery.match(/const SEA_LEVEL = (-?\d+(?:\.\d+)?)/);
  assert(drop && Number(drop[1]) === COAST_PROFILE.cliffDrop,
    `T0b: the drawn cliff drop still matches the engine's (${drop?.[1]} vs ${COAST_PROFILE.cliffDrop})`);
  assert(flare && Number(flare[1]) === COAST_PROFILE.cliffFlare,
    `T0c: the drawn cliff flare still matches (${flare?.[1]} vs ${COAST_PROFILE.cliffFlare})`);
  assert(sea && Number(sea[1]) === COAST_PROFILE.seaLevel,
    `T0d: the drawn sea level still matches (${sea?.[1]} vs ${COAST_PROFILE.seaLevel})`);
  assert(COAST_PROFILE.radius === CIRCUIT_DEF.playfield.radius,
    'T0e: and the island radius comes from CIRCUIT_DEF, so it cannot drift at all');
})();

// ── Test 1: THE TRAP — the naive way of using groundY is catastrophic ─────────
(() => {
  // Sampling the height at the kart's NEW position, which is the obvious reading of
  // "pass the ground height", flags a descending kart AIRBORNE every single tick. This
  // reproduces it on a 5% grade, which is nothing — a gentle motorway slope.
  const grade = 0.05;
  const field = downhill(grade);
  const v = kart(0, 0, 40);
  v.y = field.heightAt(0, 0);

  // Where updateVehicle is about to put it: forward is (-sin rotY, -cos rotY), so at
  // rotY = 0 the kart moves along -Z by speed*dt.
  const nextZ = v.z - v.speed * DT;
  const naiveGroundY = field.heightAt(v.x, nextZ);
  const after = updateVehicle(v, { throttle: 1 }, DT, naiveGroundY);
  assert(after.state === 'AIRBORNE',
    `T1a: passing the height at the NEW position makes a kart on a ${grade * 100}% grade go AIRBORNE immediately — the trap is real`);

  // The contract order does not.
  const good = kart(0, 0, 40);
  good.y = field.heightAt(0, 0);
  const log = driveOver(good, field, 300);
  assert(log.every((s) => s.state !== 'AIRBORNE'),
    `T1b: sampling at the OLD position and settling afterwards keeps it grounded for all 300 ticks (${log.filter((s) => s.state === 'AIRBORNE').length} airborne)`);
})();

// ── Test 2: follows a slope with no jitter and no falling through ─────────────
(() => {
  // Grades from gentle to 40%, downhill and uphill, driven from rest under full throttle
  // — which is the real case: a kart accelerating onto a slope, not teleported onto one.
  for (const grade of [0.02, 0.05, 0.10, 0.25, 0.40]) {
    for (const [name, field] of [['down', downhill(grade)], ['up', uphill(grade)]]) {
      const v = kart(0, 0, 0);
      v.y = field.heightAt(0, 0);
      const log = driveOver(v, field, 600);
      const airborne = log.filter((s) => s.state === 'AIRBORNE').length;
      // "No jitter" made precise: y is EXACTLY the terrain height every grounded tick.
      const offGround = log.filter((s) => s.state !== 'AIRBORNE' && Math.abs(s.y - s.terrain) > 1e-12).length;
      const below = log.filter((s) => s.y < s.terrain - 1e-9).length;
      assert(airborne === 0 && offGround === 0 && below === 0,
        `T2-${name}${(grade * 100).toFixed(0)}: a ${(grade * 100).toFixed(0)}% ${name}hill is followed exactly (${airborne} airborne, ${offGround} off-surface, ${below} sunk)`);
    }
  }
})();

// ── Test 3: rolling terrain is followed; only real crests launch ──────────────
(() => {
  // Smooth by construction, so there is no discontinuity to blame. A long wavelength is
  // gentle enough that gravity holds the kart down all the way over; a short one is a
  // genuine crest and must launch it. Both are correct behaviour and the difference is
  // the whole point of a ballistic criterion rather than a slope threshold.
  const gentle = driveOver(kart(0, 0, 0), rolling(4, 400), 900);
  const gentleAir = gentle.filter((s) => s.state === 'AIRBORNE').length;
  assert(gentleAir === 0,
    `T3a: long-wavelength rolling terrain (4 m over 400 m) is followed without leaving the ground (${gentleAir} airborne ticks)`);
  assert(gentle.every((s) => s.state === 'AIRBORNE' || Math.abs(s.y - s.terrain) < 1e-12),
    'T3b: and exactly, not approximately');

  const sharp = driveOver(kart(0, 0, 40), rolling(6, 60), 900);
  const sharpAir = sharp.filter((s) => s.state === 'AIRBORNE').length;
  assert(sharpAir > 0,
    `T3c: a tight crest (6 m over 60 m) at speed DOES throw the kart into the air (${sharpAir} airborne ticks)`);
  // The documented one-tick landing lag: step 2 samples the height at the OLD position,
  // so a kart dropping onto rising ground lands a tick late and can be briefly under it.
  // Bounded by one tick of terrain change, which on this crest (max slope 0.63 at 40 m/s)
  // is 0.42 m. Asserted as a bound with the measured worst printed, not waved away.
  const sink = Math.max(0, ...sharp.map((s) => s.terrain - s.y));
  assert(sink < 1.0,
    `T3d: any sinking is bounded by the documented one-tick landing lag (worst ${sink.toFixed(3)} m, bound 1.0 m)`);
})();

// ── Test 4: a crest launches, a dip does not ─────────────────────────────────
(() => {
  // The asymmetry is the criterion working: ground falling away leaves the kart
  // unsupported, ground rising into it just pushes it up.
  const overCrest = driveOver(kart(0, 0, 40), crest(0.25), 400);
  assert(overCrest.some((s) => s.state === 'AIRBORNE'),
    'T4a: driving over a crest launches the kart');

  const intoDip = driveOver(kart(0, 0, 40), uphill(0.25), 400);
  assert(intoDip.every((s) => s.state !== 'AIRBORNE'),
    'T4b: driving into a rising slope never does — it is supported, not launched');
  assert(intoDip.every((s) => Math.abs(s.y - s.terrain) < 1e-12),
    'T4c: and it tracks the rise exactly');
})();

// ── Test 5: a jump taken uphill gets real air and lands cleanly ───────────────
(() => {
  // Named explicitly in the plan's Defined Win. The kart climbs a ramp, so its vertical
  // rate at the lip is POSITIVE, and launchVehicle carries that rate — which is the whole
  // reason settleOnTerrain tracks _terrainVy instead of launching with vy = 0.
  const grade = 0.30;
  const rampThenFlat = {
    heightAt: (x, z) => (z > -60 ? -z * grade : 60 * grade - ((-z) - 60) * grade),
  };
  // WHY THE THROTTLE IS RELEASED ONCE AIRBORNE, and it is not a dodge: in this engine
  // throttle IS the flip control while airborne (vehicle-physics.js:234 —
  // `v.rotX += (throttle - brake) * stuntMultiplier`). Holding it over a crest therefore
  // starts a front flip, and the landing is then judged on the flip, not on the jump.
  // The interaction is asserted separately below as a finding; this case isolates the
  // question the Defined Win actually asks — does the mechanism land a kart cleanly.
  const coast = (i, kart) => (kart.state === 'AIRBORNE' ? {} : { throttle: 1 });
  const v = kart(0, 0, 0);
  const log = driveOver(v, rampThenFlat, 900, coast);

  const launch = log.find((s) => s.state === 'AIRBORNE');
  assert(launch !== undefined, 'T5a: cresting the ramp puts the kart in the air');
  assert(launch.vy > 0.5,
    `T5b: with UPWARD velocity carried from the climb, not a bare drop (vy ${launch?.vy.toFixed(2)} m/s)`);

  const landedAt = log.findIndex((s, i) => i > 0 && log[i - 1].state === 'AIRBORNE' && s.state !== 'AIRBORNE');
  assert(landedAt > 0, 'T5c: and it comes back down');
  assert(landedAt > 0 && (log[landedAt].state === 'NORMAL' || log[landedAt].state === 'BOOSTING'),
    `T5d: landing cleanly, not CRASHED — level flight keeps pitch and roll inside spec's tolerance (got ${log[landedAt]?.state})`);
  assert(landedAt > 0 && Math.abs(log[landedAt].y - log[landedAt].terrain) < 1e-9,
    'T5e: and it settles exactly onto the ground it landed on');

  // ⚠ THE FINDING, pinned rather than left for a player to discover: the SAME jump with
  // the throttle held down flips the kart and crashes it. That is the stunt system working
  // as designed on ramps, but terrain crests are not ramps — a player holding the throttle
  // over an ordinary hill did not ask to flip. Named for S5 and the play-test.
  const held = kart(0, 0, 0);
  const heldLog = driveOver(held, rampThenFlat, 900, { throttle: 1 });
  const heldLanded = heldLog.findIndex((s, i) => i > 0 && heldLog[i - 1].state === 'AIRBORNE' && s.state !== 'AIRBORNE');
  const heldState = heldLanded > 0 ? heldLog[heldLanded].state : 'never landed';
  assert(heldState === 'CRASHED',
    `T5g: FINDING — the same crest taken with the throttle HELD flips the kart and lands ${heldState}, because throttle is the flip control in the air. Terrain crests will need either a throttle-flip rule change or gentler crests (S5 / play-test).`);

  // A launch pad jump must still work with terrain active — the ramps are the feature
  // the airborne exemption in barriers_v1 and surfaces_v1 exists to protect.
  const padded = kart(0, 0, 40);
  launchVehicle(padded, 20);
  const padLog = driveOver(padded, flat, 400);
  const padLanded = padLog.findIndex((s, i) => i > 0 && padLog[i - 1].state === 'AIRBORNE' && s.state !== 'AIRBORNE');
  assert(padLanded > 0 && padLog.slice(0, padLanded).some((s) => s.y > 5),
    `T5f: a launch-pad jump still flies (peak ${Math.max(...padLog.map((s) => s.y)).toFixed(1)} m) and lands`);
})();

// ── Test 6: THE COAST — the drop that is already in the picture ───────────────
(() => {
  assert(COAST.heightAt(COAST_PROFILE.centerX, COAST_PROFILE.centerZ) === 0,
    'T6a: the island is flat at its centre');
  const rim = COAST_PROFILE.radius;
  assert(COAST.heightAt(COAST_PROFILE.centerX + rim - 1, COAST_PROFILE.centerZ) === 0,
    'T6b: flat right up to the playfield radius, so nothing on the island changes');
  assert(Math.abs(COAST.heightAt(COAST_PROFILE.centerX + rim + COAST_PROFILE.cliffFlare / 2, COAST_PROFILE.centerZ) + COAST_PROFILE.cliffDrop / 2) < 1e-9,
    'T6c: half way down the flare is half the drop');
  assert(COAST.heightAt(COAST_PROFILE.centerX + rim + 50, COAST_PROFILE.centerZ) === -COAST_PROFILE.cliffDrop,
    'T6d: and the sea floor past the flare');

  // Drive off the edge. The cliff is a 2:1 face — steeper than gravity can hold a kart
  // to at speed — so it should launch and fall, which is what "the drop to the coast"
  // means and what the flat plane could never do.
  const start = { x: COAST_PROFILE.centerX, z: COAST_PROFILE.centerZ + rim - 30 };
  const v = kart(start.x, start.z, 40, Math.PI); // rotY = PI faces +Z, outward
  const log = driveOver(v, COAST, 300);
  assert(log.some((s) => s.state === 'AIRBORNE'), 'T6e: driving off the coast launches the kart off the cliff');
  const lowest = Math.min(...log.map((s) => s.y));
  assert(lowest < -1, `T6f: and it actually falls (down to ${lowest.toFixed(1)} m)`);
  assert(log.every((s) => s.y >= s.terrain - 1e-6), 'T6g: without ever sinking through the cliff face');
  assert(log.every((s) => Number.isFinite(s.y) && Number.isFinite(s.vy)), 'T6h: no NaN over the edge');
})();

// ── Test 7: placeOnTerrain, for the respawn race.js does by hand today ───────
(() => {
  const field = uphill(0.3);
  const v = kart(0, -100, 0);
  v.y = 999;
  const y = placeOnTerrain(v, field);
  assert(y === field.heightAt(v.x, v.z) && v.y === y,
    `T7a: a teleported kart is placed exactly on the ground (${y})`);
  assert(v.vy === 0 && v._terrainVy === undefined,
    'T7b: with no vertical velocity, and no remembered slope rate to go stale — the criterion reads the field instead');

  // The reason _terrainVy must be cleared: a respawn was not following a slope, so
  // treating the previous height as a crest would launch every single respawn.
  const log = driveOver(v, field, 120);
  assert(log.every((s) => s.state !== 'AIRBORNE'),
    `T7c: and it drives away grounded, not launched by its own respawn (${log.filter((s) => s.state === 'AIRBORNE').length} airborne)`);

  // What race.js does today, for contrast — it would bury or float the kart.
  const naive = kart(0, -100, 0);
  naive.y = 0;
  assert(Math.abs(naive.y - field.heightAt(naive.x, naive.z)) > 1,
    `T7d: race.js:297's hardcoded y = 0 would misplace it by ${Math.abs(field.heightAt(naive.x, naive.z)).toFixed(1)} m on this slope — the integration owed at promotion`);
})();

// ── Test 8: determinism, validation, and no allocation ───────────────────────
(() => {
  const run = () => {
    const v = kart(0, 0, 0);
    const log = driveOver(v, rolling(5, 120), 600, { throttle: 1, steer: 0.1 });
    return log.at(-1);
  };
  const a = run(), b = run();
  assert(a.x === b.x && a.y === b.y && a.vy === b.vy && a.speed === b.speed,
    'T8a: identical runs are bit-identical (RSK-003 — a desync here would be silent)');

  let threw = false;
  try { COAST.heightAt(NaN, 0); } catch { threw = true; }
  assert(threw, 'T8b: a non-finite query throws rather than returning a plausible height');

  assert(settleOnTerrain(kart(0, 0, 10), flat, DT) === undefined,
    'T8c: settleOnTerrain returns nothing — every value a caller wants is already on the vehicle, so the hot path allocates nothing');
})();

// ── Test 9: the whole stack composes — road, barriers, grip and terrain ──────
(() => {
  // All four Isolation Chamber passes at once, on the real circuit with the real coast,
  // eight hostile drivers. The risk is order-dependence: settleOnTerrain runs after the
  // barrier clamp has moved the kart, and it must not undo containment or NaN anything.
  let seed = 20260807;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const karts = Array.from({ length: 8 }, (_, k) => {
    const here = sampleSpline(ROAD.mainPoints, k / 8);
    const ahead = sampleSpline(ROAD.mainPoints, (k / 8 + 0.002) % 1);
    const v = kart(here.x, here.z, 40, Math.atan2(-(ahead.x - here.x), -(ahead.z - here.z)));
    v._bias = rand() * 2 - 1;
    v._escaped = false;
    return v;
  });

  // WHY THE FIELD HERE IS ROLLING AND NOT THE SHIPPED COAST: the coast is FLAT across the
  // whole island by design, so running this over it produced 0 airborne ticks and tested
  // the composition against a terrain that never did anything — a vacuous pass, which is
  // the trap that has caught something in every one of these four slices. Rolling terrain
  // on the real circuit is the honest stress: karts launch, cross barriers in the air
  // (correctly — resolveBarrier exempts AIRBORNE), land, and must still be contained.
  // Deliberately harsher than any track anyone would build: 3 m hills on an ~88 m
  // wavelength. Following that at 40 m/s needs v^2 * curvature = 1600 * 3/14^2 = 24 m/s^2
  // of downforce, well past g, so karts genuinely leave the ground. My first attempt used
  // 3 m over 283 m, which needs only 2.4 m/s^2 — under gravity, so it correctly never
  // launched and the test passed while proving nothing.
  const field = {
    heightAt: (x, z) => 3 * Math.sin(x / 14) + 3 * Math.cos(z / 17),
  };
  for (const v of karts) v.y = field.heightAt(v.x, v.z);

  let breaches = 0, worst = 0, escapes = 0, throughSteel = 0, airborneTicks = 0, sunk = 0;
  for (let tick = 0; tick < 60 * 90; tick += 1) {
    for (const v of karts) {
      const steer = Math.max(-1, Math.min(1, v._bias + (rand() - 0.5) * 1.4));
      const groundY = field.heightAt(v.x, v.z);
      Object.assign(v, updateVehicle(v, { throttle: 1, steer }, DT, groundY));
      const before = roadAt(index, v.x, v.z, null);
      resolveBarrier(v, index, DT);
      applySurfaceDrag(v, index, DT);
      settleOnTerrain(v, field, DT);
      if (v.state === 'AIRBORNE') airborneTicks += 1;
      if (v.y < field.heightAt(v.x, v.z) - 1.0) sunk += 1;

      const r = roadAt(index, v.x, v.z, null);
      const over = Math.abs(r.lateralOffset) - (r.halfWidth + 1.6 - 2.0);
      if (v._escaped) continue;
      if (over > 4.0) {
        v._escaped = true; escapes += 1;
        if (before.edge === 'WALL' && v.state !== 'AIRBORNE') throughSteel += 1;
      } else if (r.edge === 'WALL' && over > 0.05 && v.state !== 'AIRBORNE') {
        // Grounded only: a kart in the air is legitimately not held by a barrier, which
        // is the exemption that makes every jump on the circuit work.
        breaches += 1; worst = Math.max(worst, over);
      }
    }
  }
  console.log(`   [stack] 90 s x 8 karts over rolling terrain, all four passes: ${escapes} left the walls, ${airborneTicks} airborne ticks`);
  // A few hundred launches out of 43,200 kart-ticks is ample evidence the terrain was
  // doing something; the bound exists to fail if the field is ever softened back into a
  // no-op, not to demand a particular amount of air.
  assert(airborneTicks > 200,
    `T9z: the terrain really was active — karts spent ${airborneTicks} of 43,200 kart-ticks in the air, so this is not a flat-ground vacuous pass`);
  assert(breaches === 0, `T9a: grounded karts are still contained with terrain active (${breaches} breaches, worst ${(worst * 1000).toFixed(1)} mm)`);
  assert(throughSteel === 0, `T9b: and no grounded kart escapes through steel (${throughSteel})`);
  assert(karts.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.speed)),
    'T9c: no NaN in position, height or speed after 90 s of all four passes');
  assert(sunk === 0, `T9d: and no kart ever sinks more than the one-tick lag below the ground (${sunk} ticks deeper than 1 m)`);
})();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('SOME TESTS FAILED ❌');
  process.exit(1);
}
console.log('ALL TESTS PASSED ✅');
process.exit(0);

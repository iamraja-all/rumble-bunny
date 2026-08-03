/**
 * test_traffic_v1.js — the last untested module in 03_Stable_Build.
 *
 * WHY IT MATTERS MORE THAN ITS 45 LINES SUGGEST:
 * traffic.js exists to hold one invariant that the project has already got wrong
 * once. Before it, `server.js` enrolled traffic obstacles through `lobby.join()`,
 * which made them RACERS: ADR-0007's five-minute headless run had `traffic-2` WIN at
 * 142s ahead of every bot, and because they were entrants they also gated race
 * completion, so a race could not finish until the scenery finished. ADR-0010's T10
 * asserts the effect (no traffic in the finish order) but nothing has ever tested
 * this module, so the guarantee rests on traffic.js never writing a race modifier
 * and never being handed to the lobby — properties of THIS file, untested until now.
 *
 * The other reason: `updateTrafficVehicle` caps throttle so traffic stays a slow
 * obstacle. Lose that cap and the "scenery" races the players at full speed, which
 * looks like a balance bug and would be hunted anywhere but here.
 *
 * INPUT:  the real BALANCED_STATS shape and real CIRCUIT_DEF gates.
 * OUTPUT: traffic is exactly three slow, self-driving, non-racing vehicles.
 * PASS:   every assertion green and exit code 0.
 */
import { createTrafficVehicles, updateTrafficVehicle, advanceTrafficProgress } from './traffic.js';
import { CIRCUIT_DEF } from './circuit-track.js';

// Mirrors server.js's BALANCED_STATS. Traffic is built from the same stat block as
// the players (spec.md §3 balance), so a stub with different keys would let a
// missing stat pass here and NaN in production — the exact failure ADR-0012 found
// when RoomManager never passed baseStats to Lobby.
const BALANCED_STATS = {
  max_speed: 40.0,
  acceleration: 5.0,
  handling: 1.5,
  stunt_rate: 2.0,
  weight: 1000.0,
  boost_mult: 1.5,
};

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { console.log(`✅ PASS: ${label}`); passed++; }
  else { console.log(`❌ FAIL: ${label}`); failed++; }
}

// ── Test 1: exactly three traffic vehicles, fully formed ──────────────────────
(() => {
  const traffic = createTrafficVehicles(BALANCED_STATS);
  assert(traffic.length === 3, `T1a: exactly three traffic vehicles (got ${traffic.length})`);
  assert(
    traffic.map((t) => t.id).join(',') === 'T1,T2,T3',
    `T1b: ids are T1,T2,T3 (got ${traffic.map((t) => t.id).join(',')})`
  );
  // The T-prefix is load-bearing: it is what keeps them out of the P0-P7 player
  // namespace the lobby hands out, so a traffic id can never collide with a slot.
  assert(traffic.every((t) => !/^P\d/.test(t.id)), 'T1c: no traffic id occupies a player slot name');

  for (const t of traffic) {
    assert(t.vehicle && t.progress && t.bot && t.previousPos, `T1d: ${t.id} has vehicle, progress, bot and previousPos`);
    assert(t.vehicle.type === 'VEHICLE', `T1e: ${t.id} is a VEHICLE entity`);
    // Every stat must be finite. This is the ADR-0012 lesson as an assertion: an
    // undefined stat block does not throw, it silently produces NaN positions and
    // parks the entity at the origin while everything reports healthy.
    assert(
      Number.isFinite(t.vehicle.x) && Number.isFinite(t.vehicle.y) && Number.isFinite(t.vehicle.z),
      `T1f: ${t.id} spawns at finite coordinates (got ${t.vehicle.x},${t.vehicle.y},${t.vehicle.z})`
    );
  }
})();

// ── Test 2: traffic spawns inside the world it is scenery for ─────────────────
// A traffic car outside the playfield would be scenery nobody can ever see, and on
// the players' side of the boundary check it is the one entity race.js will NOT
// rescue — session-context records traffic as still unbounded.
(() => {
  const traffic = createTrafficVehicles(BALANCED_STATS);
  const { centerX, centerZ, radius } = CIRCUIT_DEF.playfield;
  for (const t of traffic) {
    const dist = Math.hypot(t.vehicle.x - centerX, t.vehicle.z - centerZ);
    assert(dist < radius, `T2: ${t.id} spawns inside the playfield (${dist.toFixed(1)}m of ${radius}m)`);
  }
})();

// ── Test 3: throttle is capped and drift is off — traffic stays an obstacle ────
(() => {
  const traffic = createTrafficVehicles(BALANCED_STATS);
  for (const t of traffic) {
    const input = updateTrafficVehicle(t, 1 / 60);
    assert(input.throttle === 0.3, `T3a: ${t.id} throttle is capped at 0.3 (got ${input.throttle})`);
    assert(input.drift === false, `T3b: ${t.id} never drifts`);
    assert(Number.isFinite(input.steer), `T3c: ${t.id} produces a finite steer (got ${input.steer})`);
  }
})();

// ── Test 4: THE INVARIANT — traffic never writes a race modifier ──────────────
// This is the whole reason the module exists. If an update path ever sets lap,
// checkpoint or race_finished on a traffic vehicle, traffic is a racer again and
// ADR-0007's "traffic-2 won the race" returns.
(() => {
  const traffic = createTrafficVehicles(BALANCED_STATS);
  const RACE_KEYS = ['lap', 'checkpoint', 'route', 'race_finished', 'race_time', 'best_lap'];

  for (const t of traffic) {
    for (let i = 0; i < 120; i++) { // two seconds of updates
      updateTrafficVehicle(t, 1 / 60);
      advanceTrafficProgress(t);
    }
    const leaked = RACE_KEYS.filter((k) => t.vehicle.modifiers[k] !== undefined);
    assert(leaked.length === 0, `T4: ${t.id} wrote no race modifier after 120 ticks (leaked: ${leaked.join(',') || 'none'})`);
  }
})();

// ── Test 5: progress bookkeeping actually advances ────────────────────────────
// advanceTrafficProgress must move previousPos forward every call, or the next
// crossing test measures a stale segment — the same class of bug race.js._respawn
// had to fix by rewriting previousPositions.
(() => {
  const [t] = createTrafficVehicles(BALANCED_STATS);
  t.vehicle.x = 10; t.vehicle.z = -40;
  advanceTrafficProgress(t);
  assert(t.previousPos.x === 10 && t.previousPos.z === -40, `T5a: previousPos follows the vehicle (got ${t.previousPos.x},${t.previousPos.z})`);

  // Teleport it through its own first gate and require the crossing to register.
  const gate = CIRCUIT_DEF.gates.find((g) => g.id === t.progress.nextGateIds[0]);
  const clearedBefore = t.progress.clearedGateCount;
  t.vehicle.x = gate.center.x - gate.normal.x * 2;
  t.vehicle.z = gate.center.z - gate.normal.z * 2;
  advanceTrafficProgress(t);
  t.vehicle.x = gate.center.x + gate.normal.x * 2;
  t.vehicle.z = gate.center.z + gate.normal.z * 2;
  advanceTrafficProgress(t);
  assert(
    t.progress.clearedGateCount === clearedBefore + 1,
    `T5b: traffic keeps its OWN circuit progress (${clearedBefore} -> ${t.progress.clearedGateCount})`
  );
})();

// ── Test 6: the three cars are independent ───────────────────────────────────
// They share a module and a factory; if they shared a progress object, one car
// clearing a gate would advance all three. TRACK_DEF's spawn-timer singleton was
// exactly this bug across rooms (ADR-0012), so it is worth one assertion here.
(() => {
  const traffic = createTrafficVehicles(BALANCED_STATS);
  const [a, b] = traffic;
  // Each car starts partway round the lap, so "independent" means each count moves
  // only for its OWN crossings — not that the others sit at zero. Comparing against
  // a captured baseline rather than a hard 0 keeps this assertion true whatever
  // TRAFFIC_START_GATES is changed to later.
  const aBefore = a.progress.clearedGateCount;
  const bBefore = b.progress.clearedGateCount;

  const gate = CIRCUIT_DEF.gates.find((g) => g.id === a.progress.nextGateIds[0]);
  a.vehicle.x = gate.center.x - gate.normal.x * 2;
  a.vehicle.z = gate.center.z - gate.normal.z * 2;
  advanceTrafficProgress(a);
  a.vehicle.x = gate.center.x + gate.normal.x * 2;
  a.vehicle.z = gate.center.z + gate.normal.z * 2;
  advanceTrafficProgress(a);

  assert(a.progress.clearedGateCount === aBefore + 1, `T6a: T1 cleared exactly one gate (${aBefore} -> ${a.progress.clearedGateCount})`);
  assert(b.progress.clearedGateCount === bBefore, `T6b: T2 did not inherit it (${bBefore} -> ${b.progress.clearedGateCount})`);
  assert(a.progress !== b.progress, 'T6c: each traffic car owns its own progress record');
})();

// ── Test 7: each car is aimed at the gate it was placed in front of ───────────
// The bug this guards is subtle and was live until 2026-08-04: every traffic car
// used a default progress record, so a car parked beside the north gate was still
// hunting gate one and drove backwards across the island to get there.
(() => {
  const traffic = createTrafficVehicles(BALANCED_STATS);
  for (const t of traffic) {
    const targetId = t.progress.nextGateIds[0];
    const gate = CIRCUIT_DEF.gates.find((g) => g.id === targetId);
    const index = CIRCUIT_DEF.routes.MAIN.indexOf(targetId);

    assert(index >= 0, `T7a: ${t.id} targets a gate on the MAIN route (got ${targetId})`);
    assert(
      t.progress.clearedGateCount === index,
      `T7b: ${t.id} owes exactly the gates before its start (want ${index}, got ${t.progress.clearedGateCount})`
    );
    assert(t.progress.route === 'MAIN', `T7c: ${t.id} is committed to MAIN, never the shortcut`);

    // It must be BEHIND its target, or its first act is to cross the gate backwards.
    // Behind means the vector from car to gate centre points along the gate normal.
    const toGateX = gate.center.x - t.vehicle.x;
    const toGateZ = gate.center.z - t.vehicle.z;
    assert(
      toGateX * gate.normal.x + toGateZ * gate.normal.z > 0,
      `T7d: ${t.id} is on the approach side of ${targetId}`
    );

    // And facing it. Forward is (-sin, -cos) because the kart's nose is at -Z
    // (spec.md §1, Right-Handed Y-Up) — see vehicle-physics.js:306, which is the
    // definition, and test_race_v1 T14b which asserts the same convention.
    const fwdX = -Math.sin(t.vehicle.rotY);
    const fwdZ = -Math.cos(t.vehicle.rotY);
    assert(
      fwdX * gate.normal.x + fwdZ * gate.normal.z > 0.99,
      `T7e: ${t.id} faces along the gate normal (dot ${(fwdX * gate.normal.x + fwdZ * gate.normal.z).toFixed(3)})`
    );
  }
})();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('SOME TESTS FAILED ❌');
  process.exit(1);
}
console.log('ALL TESTS PASSED ✅');
process.exit(0);

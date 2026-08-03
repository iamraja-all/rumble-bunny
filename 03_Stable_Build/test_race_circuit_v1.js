/**
 * test_race_circuit_v1.js — the RaceManager ↔ circuit seam, at the LEDGER level.
 *
 * WHY THIS FILE IS NARROW, AND WHY IT IS NOT test_race_v1 AGAIN:
 * the 2026-07-30 plan asked for this file before `test_race_v1.js` existed. By the
 * time it was written (ADR-0010) it had already absorbed most of the plan's sketch —
 * a legal circuit lap, the finish, laps published to the ledger — and
 * `test_circuit-track_v1.js` owns the route/branch/reverse-travel rules at the
 * progress level. Restating either here would be a third copy of the same coverage,
 * which is exactly the over-building PONYTAIL.md exists to stop (Rung 1).
 *
 * What NOTHING covered, verified by grep before writing a line: `modifiers.route`
 * and `modifiers.checkpoint`. Those two are published to all eight clients 60 times
 * a second and are read by the client — `minimap.js` colours a kart by
 * `modifiers.route === 'SHORTCUT'`. So the engine could keep perfect internal
 * progress while broadcasting the wrong route forever, every test still green, and
 * the only symptom would be a minimap that quietly stops telling the truth. That
 * seam is this file's whole job, plus the bot's circuit target lookup.
 *
 * INPUT:  a mock lobby whose vehicle is teleported across real CIRCUIT_DEF gates.
 * OUTPUT: the route/checkpoint modifiers a client actually receives.
 * PASS:   every assertion green and exit code 0.
 */
import { RaceManager } from './race.js';
import { CIRCUIT_DEF, createCircuitProgress } from './circuit-track.js';
import { getBotTarget } from './bots.js';

const DT = 1 / 60;
let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { console.log(`✅ PASS: ${label}`); passed++; }
  else { console.log(`❌ FAIL: ${label}`); failed++; }
}

function makeVehicle(pid) {
  // Same shape as test_race_v1's stub, for the same reason: race.js's respawn path
  // writes heading, speed and state, so a stub missing them would let a typo create
  // a property instead of failing.
  return { id: pid, type: 'VEHICLE', x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0, speed: 0, state: 'NORMAL', modifiers: {} };
}

/**
 * Crossing coordinates are DERIVED from the gate, not typed in.
 *
 * WHY: test_circuit-track_v1 and test_race_v1 each carry a hand-listed table of
 * crossing pairs. A third copy would be a third thing to update when the track
 * moves, and ADR-0009 already recorded what that costs — lobby T2/T6 went stale
 * precisely because a test restated coordinates instead of deriving them. Stepping
 * 2 m either side of the centre along the gate normal is a crossing by construction:
 * the dot product with the normal is positive (correct direction), the midpoint sits
 * exactly on the plane (t = 0.5), and the lateral offset is 0, so it is inside any
 * halfWidth. That holds for every gate on any future track.
 */
function crossPair(gateId, distance = 2) {
  const gate = CIRCUIT_DEF.gates.find((g) => g.id === gateId);
  if (!gate) throw new Error(`test bug: no gate '${gateId}' in CIRCUIT_DEF`);
  return [
    { x: gate.center.x - gate.normal.x * distance, z: gate.center.z - gate.normal.z * distance },
    { x: gate.center.x + gate.normal.x * distance, z: gate.center.z + gate.normal.z * distance },
  ];
}

/** Teleport through one gate: one tick parked before it, one tick past it. */
function driveThrough(race, lobby, vehicle, gateId) {
  const [before, after] = crossPair(gateId);
  vehicle.x = before.x; vehicle.z = before.z;
  race.update(DT, lobby);
  vehicle.x = after.x; vehicle.z = after.z;
  race.update(DT, lobby);
}

function startedRace(pid = 'P0', clientId = 'client-1') {
  const vehicle = makeVehicle(pid);
  const lobby = { players: new Map([[clientId, vehicle]]) };
  const race = new RaceManager();
  race.registerPlayer(clientId);
  race.startCountdown();
  race.update(3.0, lobby); // lights out — drive the real countdown, don't fake the state
  return { race, lobby, vehicle, clientId };
}

// ── Test 1: a MAIN lap publishes route MAIN and a rising checkpoint count ──────
(() => {
  const { race, lobby, vehicle } = startedRace();

  // Route is UNSET until the branch gate decides it, so the first three gates must
  // NOT claim a route. This is the property that makes the minimap honest early.
  driveThrough(race, lobby, vehicle, 'coast-west');
  assert(vehicle.modifiers.route === 'UNSET', `T1a: route stays UNSET before the branch (got ${vehicle.modifiers.route})`);
  assert(vehicle.modifiers.checkpoint === 1, `T1a2: one gate cleared is published (got ${vehicle.modifiers.checkpoint})`);

  driveThrough(race, lobby, vehicle, 'northwest');
  driveThrough(race, lobby, vehicle, 'north');
  assert(vehicle.modifiers.route === 'UNSET', 'T1b: still UNSET after the shared prefix');
  assert(vehicle.modifiers.checkpoint === 3, `T1b2: three gates cleared (got ${vehicle.modifiers.checkpoint})`);

  // east-bend is the crossing that commits the kart to the long way round.
  driveThrough(race, lobby, vehicle, 'east-bend');
  assert(vehicle.modifiers.route === 'MAIN', `T1c: crossing east-bend publishes MAIN (got ${vehicle.modifiers.route})`);

  driveThrough(race, lobby, vehicle, 'harbor-merge');
  driveThrough(race, lobby, vehicle, 'return');
  assert(vehicle.modifiers.checkpoint === 6, `T1d: six gates cleared before the finish (got ${vehicle.modifiers.checkpoint})`);

  driveThrough(race, lobby, vehicle, 'finish');
  assert(vehicle.modifiers.lap === 1, `T1e: the lap is credited (got ${vehicle.modifiers.lap})`);
  // The finish resets progress, so the BROADCAST must go back to square one too —
  // otherwise every client spends lap 2 being told the kart is still on lap 1's route.
  assert(vehicle.modifiers.route === 'UNSET', `T1f: route resets to UNSET after the finish (got ${vehicle.modifiers.route})`);
  assert(vehicle.modifiers.checkpoint === 0, `T1g: checkpoint count resets after the finish (got ${vehicle.modifiers.checkpoint})`);
})();

// ── Test 2: the shortcut publishes SHORTCUT, and is a genuinely shorter lap ────
(() => {
  const { race, lobby, vehicle } = startedRace('P1', 'client-2');

  for (const gateId of ['coast-west', 'northwest', 'north']) driveThrough(race, lobby, vehicle, gateId);
  driveThrough(race, lobby, vehicle, 'shortcut-entry');
  assert(vehicle.modifiers.route === 'SHORTCUT', `T2a: crossing shortcut-entry publishes SHORTCUT (got ${vehicle.modifiers.route})`);

  driveThrough(race, lobby, vehicle, 'shortcut-landing');
  driveThrough(race, lobby, vehicle, 'harbor-merge');
  driveThrough(race, lobby, vehicle, 'return');
  driveThrough(race, lobby, vehicle, 'finish');
  assert(vehicle.modifiers.lap === 1, `T2b: the shortcut route also scores a full lap (got ${vehicle.modifiers.lap})`);
  assert(vehicle.modifiers.route === 'UNSET', 'T2c: route resets after a shortcut lap too');

  // The shortcut has ONE more gate than MAIN but is physically shorter — the point
  // being that gate count is not the reward, the distance is. Recorded so nobody
  // "fixes" the gate counts to match.
  assert(
    CIRCUIT_DEF.routes.SHORTCUT.length === CIRCUIT_DEF.routes.MAIN.length + 1,
    'T2d: the shortcut trades an extra checkpoint for a shorter path'
  );
})();

// ── Test 3: a MAIN kart cannot be credited for a shortcut gate ─────────────────
// Once east-bend has committed the route, shortcut-landing is not in nextGateIds, so
// driving through it must publish nothing. This is the anti-cheat property at the
// ledger level: a player who clips the shortcut's exit late gains no checkpoint.
(() => {
  const { race, lobby, vehicle } = startedRace('P2', 'client-3');
  for (const gateId of ['coast-west', 'northwest', 'north', 'east-bend']) driveThrough(race, lobby, vehicle, gateId);
  const checkpointBefore = vehicle.modifiers.checkpoint;

  driveThrough(race, lobby, vehicle, 'shortcut-landing');
  assert(
    vehicle.modifiers.checkpoint === checkpointBefore,
    `T3a: a committed MAIN kart gains nothing from a shortcut gate (${checkpointBefore} -> ${vehicle.modifiers.checkpoint})`
  );
  assert(vehicle.modifiers.route === 'MAIN', 'T3b: and its published route is unchanged');
})();

// ── Test 4: the bot's circuit target lookup ───────────────────────────────────
// bots.js steers at getBotTarget(raceState). If this returned the wrong gate the
// whole field would drive at the wrong corner, which is how the field ended up
// parked before ADR-0011.
(() => {
  const firstGate = CIRCUIT_DEF.gates.find((g) => g.id === CIRCUIT_DEF.routes.MAIN[0]);
  const target = getBotTarget({ trackProgress: createCircuitProgress() });
  assert(
    target.x === firstGate.center.x && target.z === firstGate.center.z,
    `T4a: a fresh bot targets the first gate centre (got ${target.x},${target.z}, want ${firstGate.center.x},${firstGate.center.z})`
  );

  // And it must FOLLOW progress, not sit on gate one forever.
  const { race, lobby, vehicle, clientId } = startedRace('P3', 'client-4');
  driveThrough(race, lobby, vehicle, 'coast-west');
  const advanced = getBotTarget(race.raceStates.get(clientId));
  const secondGate = CIRCUIT_DEF.gates.find((g) => g.id === CIRCUIT_DEF.routes.MAIN[1]);
  assert(
    advanced.x === secondGate.center.x && advanced.z === secondGate.center.z,
    `T4b: after one gate the target moves to the next (got ${advanced.x},${advanced.z}, want ${secondGate.center.x},${secondGate.center.z})`
  );
})();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('SOME TESTS FAILED ❌');
  process.exit(1);
}
console.log('ALL TESTS PASSED ✅');
process.exit(0);

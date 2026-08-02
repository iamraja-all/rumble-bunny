/**
 * test_race_v1.js — coverage for RaceManager, which had none.
 *
 * WHY THIS FILE EXISTS:
 * race.js is 131 lines that gate every part of gameplay — the WAITING → COUNTDOWN
 * → RACING → COMPLETE machine, whether anyone is allowed to accelerate at all, lap
 * counting, gate ordering, and the finish. The 2026-08-02 audit (ADR-0007) found
 * that no test imported it. It is also the module holding the liveness defect that
 * made a 5-minute headless race never finish.
 *
 * INPUT:  a mock lobby whose vehicles are teleported across real circuit gates,
 *         using the crossing coordinates already proven in test_circuit-track_v1.js.
 * OUTPUT: the state machine, lap accounting and completion condition all behave.
 * PASS:   every assertion green and exit code 0.
 */
import { RaceManager } from './race.js';

// Ponytail Rung 2 — these exact crossing pairs are already proven against the real
// gate geometry in test_circuit-track_v1.js. Deriving a second set by hand would be
// a second source of truth for the same thing, and a chance to get it subtly wrong.
const MAIN_CROSSES = [
  [{ x: -53.12, z: 5.684 }, { x: -56.88, z: 4.316 }],
  [{ x: -64.718, z: -63.02 }, { x: -65.282, z: -66.98 }],
  [{ x: -21.494, z: -103.672 }, { x: -18.506, z: -106.328 }],
  [{ x: 58.256, z: -60.98 }, { x: 61.744, z: -59.02 }],
  [{ x: 60, z: 18 }, { x: 60, z: 22 }],
  [{ x: 21.504, z: 53.682 }, { x: 18.496, z: 56.318 }],
  [{ x: 1.11, z: 26.664 }, { x: -1.11, z: 23.336 }],
];

const DT = 1 / 60;
let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { console.log(`✅ PASS: ${label}`); passed++; }
  else { console.log(`❌ FAIL: ${label}`); failed++; }
}

function makeVehicle(pid) {
  // Mirrors the fields of createVehicleState that race.js is allowed to touch. The
  // heading, speed and state fields are here because the out-of-bounds respawn
  // writes all of them; a stub that omitted them would let a typo in that path
  // silently create properties instead of failing.
  return {
    id: pid,
    x: 0, y: 0, z: 0,
    rotX: 0, rotY: 0, rotZ: 0,
    speed: 0, vy: 0,
    state: 'NORMAL',
    modifiers: {},
  };
}

function makeLobby(pids) {
  const players = new Map();
  pids.forEach((pid, i) => players.set(`client-${i}`, makeVehicle(pid)));
  return { players };
}

/** Put a race straight into RACING without hand-rolling the countdown each time. */
function startRacing(race, lobby) {
  race.startCountdown();
  for (let i = 0; i < 200; i++) race.update(DT, lobby); // 200 * 1/60 = 3.33s > 3.0s
}

/**
 * Teleport one client across each gate in turn. race.js derives `previous` from the
 * position it saw last tick, so each crossing needs two updates: one to register the
 * approach, one to land on the far side.
 */
function driveLap(race, lobby, clientId, crossings = MAIN_CROSSES) {
  const v = lobby.players.get(clientId);
  for (const [prev, next] of crossings) {
    v.x = prev.x; v.z = prev.z;
    race.update(DT, lobby);
    v.x = next.x; v.z = next.z;
    race.update(DT, lobby);
  }
}

console.log('--- RaceManager ---\n');

// ── T1-T3: the state machine and the accelerate gate ────────────────────────
(() => {
  const lobby = makeLobby(['P0']);
  const race = new RaceManager();
  race.registerPlayer('client-0');

  assert(race.state === 'WAITING', 'T1a: starts in WAITING');
  assert(race.canAccelerate() === false, 'T1b: cannot accelerate in WAITING');

  race.startCountdown();
  assert(race.state === 'COUNTDOWN', 'T2a: startCountdown enters COUNTDOWN');
  assert(race.canAccelerate() === false, 'T2b: cannot accelerate during COUNTDOWN');

  // 2.9s — still counting down. The exact boundary matters: this is what makes
  // test_server_v1 T4 sample a locked throttle and report a false failure.
  for (let i = 0; i < Math.round(2.9 * 60); i++) race.update(DT, lobby);
  assert(race.state === 'COUNTDOWN', 'T3a: still COUNTDOWN at 2.9s');

  for (let i = 0; i < Math.round(0.2 * 60); i++) race.update(DT, lobby);
  assert(race.state === 'RACING', 'T3b: RACING once the 3.0s countdown elapses');
  assert(race.canAccelerate() === true, 'T3c: can accelerate in RACING');
  assert(race.raceTime > 0 && race.raceTime < 0.5, 'T3d: raceTime restarts from 0 at lights-out');
})();

// ── T4: a lap in gate order counts exactly once ─────────────────────────────
(() => {
  const lobby = makeLobby(['P0']);
  const race = new RaceManager();
  race.registerPlayer('client-0');
  startRacing(race, lobby);

  driveLap(race, lobby, 'client-0');
  const rs = race.raceStates.get('client-0');
  assert(rs.lap === 1, `T4a: one clean circuit = exactly 1 lap (got ${rs.lap})`);
  assert(lobby.players.get('client-0').modifiers.lap === 1, 'T4b: lap is published to the ledger modifiers');
  assert(rs.finished === false, 'T4c: not finished after 1 of 3 laps');
})();

// ── T5: gates must be taken in order ────────────────────────────────────────
(() => {
  const lobby = makeLobby(['P0']);
  const race = new RaceManager();
  race.registerPlayer('client-0');
  startRacing(race, lobby);

  // Jump straight to the finish gate without clearing anything before it.
  driveLap(race, lobby, 'client-0', [MAIN_CROSSES[6]]);
  const rs = race.raceStates.get('client-0');
  assert(rs.lap === 0, 'T5a: crossing the finish line alone does NOT complete a lap');

  // And the checkpoints before it are still outstanding.
  assert(rs.nextCheckpoint === 0, 'T5b: no checkpoints credited for the shortcut attempt');
})();

// ── T6: three laps finishes the racer and records the order ─────────────────
(() => {
  const lobby = makeLobby(['P0']);
  const race = new RaceManager();
  race.registerPlayer('client-0');
  startRacing(race, lobby);

  for (let lap = 0; lap < 3; lap++) driveLap(race, lobby, 'client-0');

  const rs = race.raceStates.get('client-0');
  assert(rs.lap === 3, `T6a: three circuits = 3 laps (got ${rs.lap})`);
  assert(rs.finished === true, 'T6b: racer is finished after totalLaps');
  assert(race.finishOrder.length === 1 && race.finishOrder[0].pid === 'P0', 'T6c: finishOrder records the winner');
  assert(race.getRaceInfo().finishOrder[0].time > 0, 'T6d: a finish time is recorded');
})();

// ── T7: everyone finishes -> COMPLETE ───────────────────────────────────────
(() => {
  const lobby = makeLobby(['P0', 'P1']);
  const race = new RaceManager();
  race.registerPlayer('client-0');
  race.registerPlayer('client-1');
  startRacing(race, lobby);

  for (let lap = 0; lap < 3; lap++) {
    driveLap(race, lobby, 'client-0');
    driveLap(race, lobby, 'client-1');
  }
  assert(race.state === 'COMPLETE', `T7: race reaches COMPLETE when all entrants finish (got ${race.state})`);
})();

// ── T8: THE LIVENESS BUG. One idle entrant must not hold the room forever. ──
//
// This is the defect ADR-0007 found by simulation: `allFinished` was only ever
// evaluated inside the branch where somebody crosses the line on their final lap.
// Once the last finisher has finished, no further evaluation happens — so a single
// idle bot, a stalled player, or anyone who simply stops driving pins the race in
// RACING permanently. Results never fire and the room needs a server restart.
(() => {
  const lobby = makeLobby(['P0', 'P1']);
  const race = new RaceManager();
  race.dnfGraceSeconds = 2; // keep the test fast; production default is longer
  race.registerPlayer('client-0');
  race.registerPlayer('client-1');
  startRacing(race, lobby);

  // client-0 races properly. client-1 never moves.
  for (let lap = 0; lap < 3; lap++) driveLap(race, lobby, 'client-0');
  assert(race.raceStates.get('client-0').finished === true, 'T8a: the racer who drove is finished');
  assert(race.raceStates.get('client-1').finished === false, 'T8b: the idle entrant is not finished');

  // Let the DNF grace window elapse.
  for (let i = 0; i < Math.round(3 * 60); i++) race.update(DT, lobby);

  assert(race.state === 'COMPLETE', `T8c: race completes despite an idle entrant (got ${race.state})`);
  assert(race.raceStates.get('client-1').dnf === true, 'T8d: the idle entrant is marked DNF, not silently finished');
})();

// ── T9: a disconnect must not pin the race either ───────────────────────────
(() => {
  const lobby = makeLobby(['P0', 'P1']);
  const race = new RaceManager();
  race.registerPlayer('client-0');
  race.registerPlayer('client-1');
  startRacing(race, lobby);

  for (let lap = 0; lap < 3; lap++) driveLap(race, lobby, 'client-0');
  assert(race.state === 'RACING', 'T9a: still racing while client-1 is present and unfinished');

  // client-1 drops.
  race.removePlayer('client-1');
  lobby.players.delete('client-1');
  race.update(DT, lobby);

  assert(race.state === 'COMPLETE', `T9b: race completes as soon as the last unfinished entrant leaves (got ${race.state})`);
})();

// ── T10: traffic obstacles are not competitors ──────────────────────────────
//
// On master, server.js pushed traffic through lobby.join(), so decorative obstacles
// were enrolled as racers, appeared in finishOrder (one WON a 5-minute simulated
// race at 142s) and gated race completion. This branch moved them to room.trafficList,
// outside the lobby entirely. This asserts the separation holds, so a future refactor
// cannot quietly put them back.
(() => {
  const lobby = makeLobby(['P0']);
  const race = new RaceManager();
  race.registerPlayer('client-0');
  startRacing(race, lobby);
  for (let lap = 0; lap < 3; lap++) driveLap(race, lobby, 'client-0');

  assert(race.finishOrder.every(f => !String(f.clientId).startsWith('traffic')),
    'T10a: no traffic entity appears in the finish order');
  assert(race.raceStates.size === 1, 'T10b: only registered players hold race state');
})();

// ── T11-T18: THE OUT-OF-BOUNDS BUG. You could drive off the world. ──────────
//
// Found by driving, not by a test: hold the throttle off the racing line and the
// kart leaves the island and keeps going over open sea at y = 0 forever. No wall,
// no fall, no respawn, no timer. race.js now watches the playfield boundary that
// CIRCUIT_DEF owns and puts a lost kart back at its last cleared gate.
//
// (0, 400) is the "out at sea" point used throughout: 425 m from the playfield
// centre (0, -25) against a 155 m radius, and — checked by hand against
// crossesDirectedGate — neither the trip out nor the trip back crosses any gate,
// so these tests measure the boundary and nothing else.
const AT_SEA = { x: 0, z: 400 };

/** Run `seconds` of simulated time. The mock vehicles do not move by themselves. */
function tick(race, lobby, seconds) {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) race.update(DT, lobby);
}

function place(lobby, clientId, x, z) {
  const v = lobby.players.get(clientId);
  v.x = x;
  v.z = z;
  return v;
}

// ── T11: a kart inside the bounds is never respawned ────────────────────────
(() => {
  const lobby = makeLobby(['P0']);
  const race = new RaceManager();
  race.registerPlayer('client-0');
  startRacing(race, lobby);

  // Deliberately far off the racing line but still on the island: 140 m from the
  // playfield centre, i.e. out on the beach past every guardrail. Going wide is
  // legal here and must cost nothing.
  const v = place(lobby, 'client-0', 0, 115);
  tick(race, lobby, 10);

  assert(v.x === 0 && v.z === 115, `T11a: a kart on the island is never respawned (got ${v.x},${v.z})`);
  assert(v.modifiers.out_of_bounds === 0, 'T11b: no out-of-bounds warning while on the island');
  assert(race.raceStates.get('client-0').outOfBoundsTimer === 0, 'T11c: the grace timer never starts in bounds');
})();

// ── T12: outside the bounds, but the grace period has not elapsed ───────────
(() => {
  const lobby = makeLobby(['P0']);
  const race = new RaceManager();
  race.registerPlayer('client-0');
  startRacing(race, lobby);

  const v = place(lobby, 'client-0', AT_SEA.x, AT_SEA.z);
  tick(race, lobby, 2.4); // production grace is 2.5s

  assert(v.x === AT_SEA.x && v.z === AT_SEA.z, `T12a: not yet respawned before the grace elapses (got ${v.x},${v.z})`);
  assert(v.modifiers.out_of_bounds === 1, 'T12b: the out-of-bounds flag is raised immediately, before the respawn');
})();

// ── T13: the grace elapses -> respawned at the last cleared gate ────────────
(() => {
  const lobby = makeLobby(['P0']);
  const race = new RaceManager();
  race.registerPlayer('client-0');
  startRacing(race, lobby);

  // Clear coast-west and northwest, then drive into the sea.
  driveLap(race, lobby, 'client-0', MAIN_CROSSES.slice(0, 2));
  const v = place(lobby, 'client-0', AT_SEA.x, AT_SEA.z);
  tick(race, lobby, 2.6);

  // northwest gate centre, from CIRCUIT_DEF.
  assert(v.x === -65 && v.z === -65, `T13a: respawned at the last cleared gate (got ${v.x},${v.z})`);
  assert(v.y === 0, 'T13b: respawned onto the flat ground plane');
  assert(v.modifiers.out_of_bounds === 0, 'T13c: the warning clears on respawn');
  assert(race.raceStates.get('client-0').outOfBoundsTimer === 0, 'T13d: the grace timer is reset by the respawn');
})();

// ── T14: THE HEADING. It must point DOWN the track, not backwards. ──────────
//
// Direction-blind assertions have produced three bugs in this codebase, including
// an inverted airborne steer that shipped because T12 in the physics suite only
// checked that rotY changed. So this asserts the literal yaw AND rebuilds the
// forward vector from it and compares that against the gate normal — an inverted
// respawn would give yaw -3.0001 and a forward vector of (+0.141, +0.990), and
// both halves of this test would fail.
(() => {
  const lobby = makeLobby(['P0']);
  const race = new RaceManager();
  race.registerPlayer('client-0');
  startRacing(race, lobby);

  driveLap(race, lobby, 'client-0', MAIN_CROSSES.slice(0, 2));
  const v = place(lobby, 'client-0', AT_SEA.x, AT_SEA.z);
  tick(race, lobby, 2.6);

  // northwest gate normal is (-0.141, -0.99); atan2(-nx, -nz) = 0.1414727864921576.
  assert(Math.abs(v.rotY - 0.1414727864921576) < 1e-9, `T14a: respawn yaw is the gate normal's yaw (got ${v.rotY})`);

  // vehicle-physics.js:18 — forward = (-sin(rotY), -cos(rotY)).
  const fwdX = -Math.sin(v.rotY);
  const fwdZ = -Math.cos(v.rotY);
  assert(Math.abs(fwdX - (-0.141)) < 1e-3 && Math.abs(fwdZ - (-0.99)) < 1e-3,
    `T14b: forward vector equals the gate normal (got ${fwdX.toFixed(4)},${fwdZ.toFixed(4)} want -0.141,-0.99)`);
  assert(fwdX * -0.141 + fwdZ * -0.99 > 0.99, 'T14c: facing along the gate, not through it backwards');
})();

// ── T15: a respawn neither gifts nor steals progress ────────────────────────
(() => {
  const lobby = makeLobby(['P0']);
  const race = new RaceManager();
  race.registerPlayer('client-0');
  startRacing(race, lobby);

  driveLap(race, lobby, 'client-0');                       // one full lap
  driveLap(race, lobby, 'client-0', MAIN_CROSSES.slice(0, 2)); // two gates into lap 2
  const rs = race.raceStates.get('client-0');
  const lapBefore = rs.lap;
  const clearedBefore = rs.trackProgress.clearedGateCount;
  const nextBefore = rs.trackProgress.nextGateIds[0];

  place(lobby, 'client-0', AT_SEA.x, AT_SEA.z);
  tick(race, lobby, 2.6);

  assert(lapBefore === 1 && rs.lap === 1, `T15a: lap count unchanged across a respawn (${lapBefore} -> ${rs.lap})`);
  assert(clearedBefore === 2 && rs.trackProgress.clearedGateCount === 2,
    `T15b: cleared-gate count unchanged (${clearedBefore} -> ${rs.trackProgress.clearedGateCount})`);
  assert(rs.trackProgress.nextGateIds[0] === nextBefore, `T15c: still owes the same next gate (${rs.trackProgress.nextGateIds[0]})`);

  // The teleport must also be invisible to the gate-crossing test: without resetting
  // previousPositions, next tick would sweep a segment from the open sea across the
  // circuit and could credit gates the kart never drove through.
  tick(race, lobby, 1);
  assert(rs.trackProgress.clearedGateCount === 2, 'T15d: the respawn teleport does not credit a gate crossing');
})();

// ── T16: leave and come back inside the grace -> no respawn ─────────────────
(() => {
  const lobby = makeLobby(['P0']);
  const race = new RaceManager();
  race.registerPlayer('client-0');
  startRacing(race, lobby);

  const v = place(lobby, 'client-0', AT_SEA.x, AT_SEA.z);
  tick(race, lobby, 1.5);
  assert(v.modifiers.out_of_bounds === 1, 'T16a: flagged while it is out there');

  place(lobby, 'client-0', 10, 10); // back on the island
  tick(race, lobby, 1.5);           // 3.0s total, well past the 2.5s grace

  assert(v.x === 10 && v.z === 10, `T16b: a kart that came back is not respawned later (got ${v.x},${v.z})`);
  assert(race.raceStates.get('client-0').outOfBoundsTimer === 0, 'T16c: the timer resets on return, it does not decay');
  assert(v.modifiers.out_of_bounds === 0, 'T16d: the warning clears the moment it is back in bounds');
})();

// ── T17/T18: what the kart looks like after a lap-one respawn ───────────────
(() => {
  const lobby = makeLobby(['P0']);
  const race = new RaceManager();
  race.registerPlayer('client-0');
  startRacing(race, lobby);

  const v = place(lobby, 'client-0', AT_SEA.x, AT_SEA.z);
  v.speed = 38;
  v.state = 'BOOSTING';
  v.modifiers.boost_timer = 2.0;
  v.modifiers.stunts = 3;
  tick(race, lobby, 2.6);

  assert(v.speed === 0, `T17a: speed is zeroed on respawn (got ${v.speed})`);
  assert(v.state === 'NORMAL', `T17b: state returns to NORMAL (got ${v.state})`);
  assert(v.modifiers.boost_timer === 0 && v.modifiers.stunts === 0, 'T17c: boost and stunt modifiers are cleared');

  // No gate cleared yet, so the only place it has ever legally been is its grid
  // slot — P0 -> CIRCUIT_DEF.spawnPositions[0], which is (5, 0, 34).
  assert(v.x === 5 && v.z === 34, `T18: with no gates cleared it returns to its grid slot (got ${v.x},${v.z})`);
})();

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);

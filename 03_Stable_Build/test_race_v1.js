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
  return { id: pid, x: 0, y: 0, z: 0, modifiers: {} };
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

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);

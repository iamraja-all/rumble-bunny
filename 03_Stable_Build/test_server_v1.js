import WebSocket from 'ws';
import { parseLedger } from './ledger.js';

/**
 * test_server_v1: end-to-end integration over a real socket.
 * Validates the full slice: handshake -> room -> lobby slot -> countdown ->
 * physics tick -> serialization -> broadcast -> parse.
 *
 * Run with the server already up:  npm run dev:server
 *
 * WHY THIS WAS REWRITTEN (2026-08-02, ADR-0012):
 * it predated dynamic rooms and never sent HOST| or JOIN|, so on this branch the
 * server's handshake never completed, ws.roomCode stayed null, and the client
 * received nothing at all — every assertion below the connection check was
 * meaningless. It also carried two defects the audit named:
 *   - T1 asserted pid === 'P0' from an era when bots pre-filled the slot table.
 *     With rooms, HOST creates an empty room, so P0 is correct again — but it is
 *     now asserted against the room the client actually created.
 *   - T4 sampled speed after 1000ms while race.js locks the throttle for a 3.0s
 *     countdown, so it was structurally guaranteed to read 0.
 *   - "Vehicle moved forward" asserted z < 0 against a spawn z that was already
 *     negative — a FALSE PASS that reported motion for a stationary kart. It now
 *     compares against the first observed position instead of an absolute constant.
 */

const URL = 'ws://localhost:8080';

async function runTests() {
  let allPassed = true;

  const assert = (condition, message) => {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
    } else {
      console.log(`❌ FAIL: ${message}`);
      allPassed = false;
    }
  };

  const ws = new WebSocket(URL);

  // WHY: without this the single most common failure mode — forgetting to start
  // the server — produced a 40-line unhandled-'error' stack dump from inside ws
  // rather than a readable failure. The .catch() below cannot see it, because the
  // error is emitted on the socket, outside the promise chain.
  let connectError = null;
  ws.on('error', (e) => { connectError = e.message; });

  let initReceived = false;
  let pid = null;
  let roomCode = null;
  let framesReceived = 0;
  let raceLines = 0;
  let sawNaN = false;
  let vehicleState = null;
  let baselineZ = null;

  ws.on('message', (data) => {
    const msg = data.toString().trim();

    if (msg.startsWith('INIT|')) {
      const parts = msg.split('|');
      initReceived = true;
      pid = parts[1];
      roomCode = parts[2];
      return;
    }
    if (msg.startsWith('ERROR|')) return;

    if (msg.includes('NaN') || msg.includes('Infinity')) sawNaN = true;

    // The frame is the RACE| metadata line followed by ledger rows.
    const [first, ...rest] = msg.split('\n');
    if (first.startsWith('RACE|')) raceLines++;

    const entities = parseLedger(rest.join('\n'));
    framesReceived++;

    if (pid) {
      const me = entities.find((e) => e.id === pid);
      if (me) {
        if (baselineZ === null) baselineZ = me.z;
        vehicleState = me;
      }
    }
  });

  // ── Handshake ─────────────────────────────────────────────────────────────
  await new Promise((r) => setTimeout(r, 500));
  // WHY readyState and not just the captured error: the 'error' event's timing is
  // not guaranteed within any particular window, so gating on it alone let a dead
  // server fall through and fail slowly on downstream assertions instead of saying
  // the one useful thing. readyState is deterministic.
  if (connectError || ws.readyState !== WebSocket.OPEN) {
    console.log(`❌ FAIL: T0: could not connect to ${URL}${connectError ? ` — ${connectError}` : ''}`);
    console.log('   (is the server running?  npm run dev:server)');
    console.log('\nSOME TESTS FAILED ❌');
    process.exit(1);
  }

  ws.send('HOST|#00ccff');
  await new Promise((r) => setTimeout(r, 500));

  assert(initReceived, 'T1a: server answered the HOST handshake with INIT');
  assert(pid === 'P0', `T1b: the host takes slot P0 of its own new room (got ${pid})`);
  assert(/^[A-Z]{4}$/.test(roomCode || ''), `T1c: INIT carries a 4-letter room code (got ${roomCode})`);

  // ── Start the race and wait past the countdown ────────────────────────────
  ws.send('START');

  // WHY 4500ms and not 1000: race.js counts down for 3.0s and server.js zeroes all
  // input while raceManager.canAccelerate() is false, so any sample before ~3s
  // reads a speed of exactly 0 no matter what the input path does.
  const beforeCountdown = Date.now();
  await new Promise((r) => setTimeout(r, 1000));
  const speedDuringCountdown = vehicleState ? vehicleState.speed : -1;

  const holdThrottle = setInterval(() => ws.send('INPUT|1.0|0|0|0'), 1000 / 60);
  await new Promise((r) => setTimeout(r, 3500));
  clearInterval(holdThrottle);
  await new Promise((r) => setTimeout(r, 100));

  const elapsed = (Date.now() - beforeCountdown) / 1000;

  // ── Assertions ────────────────────────────────────────────────────────────
  assert(framesReceived > 30, `T2a: broadcasts arrive at ~60fps (got ${framesReceived} frames in ~${elapsed.toFixed(1)}s)`);
  assert(raceLines > 30, `T2b: every frame carries a RACE| metadata line (got ${raceLines})`);
  assert(!sawNaN, 'T2c: no NaN or Infinity appeared in any broadcast frame');

  assert(vehicleState !== null, 'T3: the client finds its own vehicle in the ledger');
  assert(speedDuringCountdown === 0, `T3b: throttle is locked during the countdown (speed was ${speedDuringCountdown})`);

  assert(vehicleState && vehicleState.speed > 0,
    `T4a: input reaches the physics loop once racing (speed=${vehicleState ? vehicleState.speed.toFixed(2) : 'n/a'})`);

  // Compare against the FIRST observed position, not an absolute constant. The old
  // assertion (z < 0) passed on the spawn coordinate alone.
  assert(vehicleState && baselineZ !== null && Math.abs(vehicleState.z - baselineZ) > 1.0,
    `T4b: the kart actually moved from where it started (baseline z=${baselineZ}, now z=${vehicleState ? vehicleState.z : 'n/a'})`);

  assert(vehicleState && Number.isFinite(vehicleState.x) && Number.isFinite(vehicleState.z),
    'T4c: the broadcast position is finite');

  ws.close();

  console.log('');
  if (allPassed) {
    console.log('ALL TESTS PASSED ✅');
    process.exit(0);
  } else {
    console.log('SOME TESTS FAILED ❌');
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

/**
 * test_bots_v1.js — coverage for the AI opponents, which had none.
 *
 * WHY THIS FILE EXISTS:
 * bots.js drives 7 of the 8 karts in a default room, and no test imported it. A
 * 120-second headless simulation on this branch's circuit produced: 3 of 8 bots
 * PARKED below 1 m/s, |rotY| as high as 153 radians (roughly 24 full rotations),
 * and ZERO finishers. The AI opponents do not currently race.
 *
 * INPUT:  BotController.generateInput against known vehicle/race state, plus a full
 *         headless race driven by the real physics, race manager and track.
 * OUTPUT: bots steer proportionally, brake for corners, stay bounded in rotation,
 *         do not get pinned by pileups, and actually finish a race.
 * PASS:   every assertion green and exit code 0.
 */
import { BotController, getBotTarget } from './bots.js';
import { Lobby } from './lobby.js';
import { RaceManager } from './race.js';
import { updateVehicle, launchVehicle, applyCarCollisions } from './vehicle-physics.js';
import { getLaunchPadAt } from './track.js';

const STATS = { max_speed: 40.0, acceleration: 5.0, handling: 1.5, stunt_rate: 2.0, weight: 1000.0, boost_mult: 1.5 };
const DT = 1 / 60;

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { console.log(`✅ PASS: ${label}`); passed++; }
  else { console.log(`❌ FAIL: ${label}`); failed++; }
}

const RACING = { state: 'RACING', countdown: 0, raceTime: 10, totalLaps: 3, finishOrder: [] };
const WAITING = { ...RACING, state: 'WAITING' };


console.log('--- BotController ---\n');

// ── T1: bots respect the start lights ───────────────────────────────────────
(() => {
  const bot = new BotController('bot-0', 1);
  const v = { x: 0, y: 0, z: 0, rotY: 0, speed: 0, state: 'NORMAL' };
  const lobby = new Lobby('T1', STATS);
  lobby.join('bot-0');
  const race = new RaceManager();
  race.registerPlayer('bot-0');

  const input = bot.generateInput(v, race.raceStates.get('bot-0'), WAITING);
  assert(input.throttle === 0 && input.brake === 0 && input.steer === 0,
    'T1: no input at all while the race is not RACING');
})();

// ── T2-T4: steering is proportional, correctly signed, and brakes for corners ─
(() => {
  const bot = new BotController('bot-0', 1);
  bot.targetOffset = 0; // pin the personality so the geometry below is exact
  const race = new RaceManager();
  race.registerPlayer('bot-0');
  const rs = race.raceStates.get('bot-0');

  // The bot aims at its current gate, which for a fresh race is the first circuit
  // gate. Place the kart due +Z of that gate so that heading -Z (rotY = 0, because
  // vehicle-physics forward is (-sin, -cos)) points straight at it.
  const gate = getBotTarget(rs);
  const at = (rotY, speed) => ({ x: gate.x, y: 0, z: gate.z + 50, rotY, speed, state: 'NORMAL' });

  const aheadInput = bot.generateInput(at(0, 20), rs, RACING);
  assert(Math.abs(aheadInput.steer) < 0.05, `T2a: near-zero steer when the gate is dead ahead (got ${aheadInput.steer.toFixed(3)})`);
  assert(aheadInput.throttle > 0.9, 'T2b: full throttle on a straight');
  assert(aheadInput.brake === 0, 'T2c: no braking on a straight');

  // A slight heading error must produce a SMALL correction, not full lock. This is
  // the bang-bang defect: the old controller emitted only -1, 0 or +1, so it
  // oscillated across the deadband instead of tracking the line.
  const slightInput = bot.generateInput(at(0.15, 20), rs, RACING);
  assert(Math.abs(slightInput.steer) > 0.01, 'T3a: a small heading error still produces a correction');
  assert(Math.abs(slightInput.steer) < 0.9, `T3b: a small heading error does NOT produce full lock (got ${slightInput.steer.toFixed(3)})`);

  // A hard heading error must brake. brake was previously hardwired to 0, so bots
  // could never slow for a turn and overshot every corner.
  const hardInput = bot.generateInput(at(Math.PI * 0.75, 38), rs, RACING);
  assert(Math.abs(hardInput.steer) > 0.9, 'T4a: a hard heading error produces near-full lock');
  assert(hardInput.brake > 0, `T4b: a hard turn at speed applies the brake (got ${hardInput.brake.toFixed(2)})`);
})();

// ── T5: determinism — same seed, same bot (RSK-003) ─────────────────────────
(() => {
  const a = new BotController('bot-0', 42);
  const b = new BotController('bot-0', 42);
  const c = new BotController('bot-0', 99);
  assert(a.targetOffset === b.targetOffset, 'T5a: the same seed produces the same bot personality');
  assert(a.targetOffset !== c.targetOffset, 'T5b: a different seed produces a different personality');
  assert(Number.isFinite(a.targetOffset), 'T5c: personality values are finite');
})();

// ── T6: THE REAL TEST — can eight bots actually race? ───────────────────────
//
// Baseline before this slice, measured over 120 simulated seconds on this circuit:
//   3 of 8 parked below 1 m/s, |rotY| up to 153 rad, ZERO finishers.
// The parking was NOT a steering bug: disabling applyCarCollisions removed it
// entirely. Bots clump, and the collision resolver set BOTH karts to
// avgSpeed * 0.5 every frame, so a three-way pileup ground them to a standstill.
(() => {
  const SECONDS = 180;
  const lobby = new Lobby('SIM', STATS);
  const race = new RaceManager();
  const bots = new Map();

  for (let i = 0; i < 8; i++) {
    const id = `bot-${i}`;
    lobby.join(id);
    race.registerPlayer(id);
    bots.set(id, new BotController(id, i + 1)); // deterministic seeds
  }
  race.startCountdown();

  let maxAbsRotY = 0;
  // A bot can legitimately dip below 1 m/s for a moment while braking hard into a
  // hairpin. What must never happen is being PINNED there. So track the longest
  // consecutive slow streak per bot rather than sampling a single instant — and
  // only while the race is actually running, because once it is COMPLETE the bots
  // correctly stop accelerating and every kart coasts to a stop.
  const slowStreak = new Map();
  const worstStreak = new Map();

  for (let f = 0; f < SECONDS * 60; f++) {
    const canGo = race.canAccelerate();
    const info = race.getRaceInfo();
    for (const [id, v] of lobby.players.entries()) {
      const input = bots.get(id).generateInput(v, race.raceStates.get(id), info);
      const finalInput = canGo ? input : { throttle: 0, brake: 0, steer: 0, drift: false };
      let nv = updateVehicle(v, finalInput, DT);
      if (nv.state !== 'AIRBORNE' && nv.state !== 'CRASHED') {
        const pad = getLaunchPadAt(nv.x, nv.z);
        if (pad) nv = launchVehicle(nv, pad.power);
      }
      lobby.players.set(id, nv);
      if (nv.state !== 'AIRBORNE') maxAbsRotY = Math.max(maxAbsRotY, Math.abs(nv.rotY));
    }
    race.update(DT, lobby);
    applyCarCollisions(lobby.getAllVehicles());

    if (race.state === 'RACING') {
      for (const [id, v] of lobby.players.entries()) {
        const rs = race.raceStates.get(id);
        const stalled = v.speed < 1.0 && v.state !== 'CRASHED' && !rs.finished;
        const streak = stalled ? (slowStreak.get(id) || 0) + 1 : 0;
        slowStreak.set(id, streak);
        if (streak > (worstStreak.get(id) || 0)) worstStreak.set(id, streak);
      }
    }
  }

  const worstStallSeconds = Math.max(0, ...worstStreak.values()) / 60;
  const totalGates = [...race.raceStates.values()]
    .reduce((n, rs) => n + rs.lap * 9 + rs.trackProgress.clearedGateCount, 0);

  console.log(`     [sim] ${SECONDS}s: worstStall=${worstStallSeconds.toFixed(1)}s  maxAbsRotY=${maxAbsRotY.toFixed(1)}  ` +
              `finishers=${race.finishOrder.length}  gatesCleared=${totalGates}`);

  assert(worstStallSeconds < 5,
    `T6a: no bot is pinned below 1 m/s for more than 5s (worst ${worstStallSeconds.toFixed(1)}s)`);
  // The property that matters is BOUNDED, not exactly wrapped: a kart that has just
  // landed still carries its stunt rotation until the next grounded frame wraps it,
  // and a CRASHED kart skips the steering branch entirely. 4*PI comfortably passes
  // both of those while still catching the unbounded growth this replaced, which
  // reached 142 rad — roughly 23 revolutions — over the same simulation.
  assert(maxAbsRotY < 4 * Math.PI,
    `T6b: grounded yaw stays bounded instead of growing without limit (got ${maxAbsRotY.toFixed(1)})`);
  assert(totalGates >= 40, `T6c: the field makes real progress around the circuit (got ${totalGates} gates)`);
  assert(race.finishOrder.length >= 1, `T6d: at least one bot finishes a 3-lap race in ${SECONDS}s (got ${race.finishOrder.length})`);
})();

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);

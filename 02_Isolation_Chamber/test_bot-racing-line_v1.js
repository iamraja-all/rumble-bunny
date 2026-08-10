import { Lobby } from '../03_Stable_Build/lobby.js';
import { RaceManager } from '../03_Stable_Build/race.js';
import { BotController } from '../03_Stable_Build/bots.js';
import { updateVehicle, launchVehicle, applyCarCollisions, createVehicleState } from '../03_Stable_Build/vehicle-physics.js';
import { getLaunchPadAt } from '../03_Stable_Build/track.js';
import { CIRCUIT_DEF } from '../03_Stable_Build/circuit-track.js';
import { createTrafficVehicles, updateTrafficVehicle, advanceTrafficProgress } from '../03_Stable_Build/traffic.js';
import { buildRoadIndex, roadAt, sampleSpline } from './road-geometry_v1.js';
import { resolveBarrier, barrierLine } from './barriers_v1.js';
import { applySurfaceDrag } from './surfaces_v1.js';
import { COAST, settleOnTerrain } from './heightfield_v1.js';
import { makeRoadAwareBot } from './bot-racing-line_v1.js';

/**
 * test_bot-racing-line_v1.js — SOLID GROUND S7's Defined Win, in a terminal.
 *
 * INPUT:  ADR-0011's seeded 180 s eight-bot simulation, run with and without the wrapper.
 * OUTPUT: finishers, gates cleared, time off the road, karts that fell off the island.
 * PASS:   with S1-S4 active the wrapper keeps or improves the finisher count and gates,
 *         cuts time off the road, drops nobody off the island, and stalls no bot.
 *
 * The plan's wording is "the seeded 180 s sim from ADR-0011 keeps or improves its finisher
 * count with barriers and surfaces active — no bot stuck against a wall."
 */

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { console.log(`✅ PASS: ${label}`); passed++; }
  else { console.log(`❌ FAIL: ${label}`); failed++; }
}

const DT = 1 / 60;
const STATS = { max_speed: 40.0, acceleration: 5.0, handling: 1.5, stunt_rate: 2.0, weight: 1000.0, boost_mult: 1.5 };
const index = buildRoadIndex(CIRCUIT_DEF.road);

/**
 * runSim — ADR-0011's simulation, parameterised by whether S1-S4 and the wrapper are on.
 *
 * WHY IT IS REPRODUCED HERE rather than imported from test_bots_v1.js: that file runs its
 * sim inline as an IIFE with no export, and it is in 03_Stable_Build where R02 forbids
 * edits. **At promotion, this harness and that one should become one exported function** —
 * two copies of a benchmark is exactly the drift RSK-007 is about.
 */
function runSim({ solidGround = false, wrapBot = null, seconds = 180 } = {}) {
  const lobby = new Lobby('SIM', STATS);
  const race = new RaceManager();
  const bots = new Map();
  for (let i = 0; i < 8; i += 1) {
    const id = `bot-${i}`;
    lobby.join(id);
    race.registerPlayer(id);
    const base = new BotController(id, i + 1); // deterministic seeds, as ADR-0011
    bots.set(id, wrapBot ? wrapBot(base, index) : base);
  }
  race.startCountdown();

  const slowStreak = new Map();
  const worstStreak = new Map();
  const fell = new Set();
  const escaped = new Set();
  let offRoad = 0, airborne = 0, atLine = 0, pressing = 0, breaches = 0, speedSum = 0, ticks = 0;

  for (let f = 0; f < seconds * 60; f += 1) {
    const canGo = race.canAccelerate();
    const info = race.getRaceInfo();
    for (const [id, v] of lobby.players.entries()) {
      const input = bots.get(id).generateInput(v, race.raceStates.get(id), info);
      const finalInput = canGo ? input : { throttle: 0, brake: 0, steer: 0, drift: false };
      let nv = updateVehicle(v, finalInput, DT, solidGround ? COAST.heightAt(v.x, v.z) : 0);
      if (nv.state !== 'AIRBORNE' && nv.state !== 'CRASHED') {
        const pad = getLaunchPadAt(nv.x, nv.z);
        if (pad) nv = launchVehicle(nv, pad.power);
      }
      if (solidGround) {
        const contact = resolveBarrier(nv, index, DT);
        if (contact.contacted) atLine += 1;
        if (contact.contacted && contact.intoWall > 0.05) pressing += 1;
        applySurfaceDrag(nv, index, DT);
        settleOnTerrain(nv, COAST, DT);
      }
      lobby.players.set(id, nv);

      ticks += 1;
      speedSum += nv.speed;
      if (nv.state === 'AIRBORNE') airborne += 1;
      if (nv.y < -1) fell.add(id);
      const r = roadAt(index, nv.x, nv.z, null);
      if (r.surface !== 'TARMAC') offRoad += 1;
      const over = Math.abs(r.lateralOffset) - barrierLine(r.halfWidth);
      // Escape tracking, as S2's own T7 does it: a kart that has legitimately left the
      // walls reads as a breach forever from the outside otherwise. Omitting it is a
      // mistake this project has now made four times.
      if (over > 4.0) escaped.add(id);
      if (solidGround && !escaped.has(id) && nv.state !== 'AIRBORNE' && r.edge === 'WALL' && over > 0.05) breaches += 1;
    }
    race.update(DT, lobby);
    applyCarCollisions(lobby.getAllVehicles());
    if (solidGround) for (const v of lobby.getAllVehicles()) resolveBarrier(v, index, DT);

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

  return {
    finishers: race.finishOrder.length,
    gates: [...race.raceStates.values()].reduce((n, rs) => n + rs.lap * 9 + rs.trackProgress.clearedGateCount, 0),
    offRoadPct: offRoad / ticks * 100,
    airbornePct: airborne / ticks * 100,
    atLinePct: atLine / ticks * 100,
    pressingPct: pressing / ticks * 100,
    meanSpeed: speedSum / ticks,
    worstStall: Math.max(0, ...worstStreak.values()) / 60,
    fell: fell.size,
    breaches,
  };
}

// ── Test 1: THE DEFINED WIN — the seeded 180 s sim, with and without the wrapper ──
const before = runSim({ solidGround: true });
const after = runSim({ solidGround: true, wrapBot: makeRoadAwareBot });
const committed = runSim({ solidGround: false });

const show = (name, r) => console.log(`   [${name}] finishers ${r.finishers}  gates ${r.gates}  offRoad ${r.offRoadPct.toFixed(1)}%  atLine ${r.atLinePct.toFixed(1)}%  pressing ${r.pressingPct.toFixed(1)}%  meanSpeed ${r.meanSpeed.toFixed(1)}  fell ${r.fell}/8  stall ${r.worstStall.toFixed(1)}s  breaches ${r.breaches}`);
show('as committed, no S1-S4 ', committed);
show('S1-S4, gate-chasing    ', before);
show('S1-S4 + lane-keeping   ', after);

assert(after.finishers >= before.finishers,
  `T1a: finishers keep or improve against gate-chasing bots (${before.finishers} -> ${after.finishers})`);
assert(after.finishers >= committed.finishers,
  `T1b: and against the committed engine with none of S1-S4 (${committed.finishers} -> ${after.finishers})`);
assert(after.gates >= before.gates,
  `T1c: gates cleared keep or improve (${before.gates} -> ${after.gates})`);
assert(after.gates >= committed.gates,
  `T1d: and beat the committed engine (${committed.gates} -> ${after.gates})`);
// The finding this slice exists for: bots have ALWAYS driven off the road, 62% of every
// race, long before any of S1-S4. That is what is being fixed.
assert(committed.offRoadPct > 50,
  `T1e: FINDING — the committed bots spend most of the race off the road (${committed.offRoadPct.toFixed(1)}%)`);
assert(after.offRoadPct < before.offRoadPct / 2,
  `T1f: the wrapper at least halves time off the road (${before.offRoadPct.toFixed(1)}% -> ${after.offRoadPct.toFixed(1)}%)`);
assert(before.fell >= 5 && after.fell === 0,
  `T1g: and stops bots falling off the island entirely (${before.fell}/8 -> ${after.fell}/8)`);
// "No bot stuck against a wall" — stuck means pinned and not progressing, which is what
// the existing test_bots_v1 T6a measures. 5 s is its bar.
assert(after.worstStall < 5,
  `T1h: no bot is pinned below 1 m/s for more than 5 s (worst ${after.worstStall.toFixed(1)}s)`);
assert(after.breaches === 0 || after.breaches <= before.breaches,
  `T1i: containment is no worse than before the wrapper (${before.breaches} -> ${after.breaches})`);

// ⚠ THE RESIDUAL, ASSERTED SO IT CANNOT BE FORGOTTEN. Bots still run wide enough to touch
// the barrier line most of the lap, because the inner bot's heading term aims at a gate up
// to 92 m away and no amount of lane-keeping gain fixes that — sweeping 1.6 to 6.0 left it
// flat at ~70%. They are not STUCK (see T1h) and only ~14% of ticks actually press into the
// steel, but eight karts riding the guardrail is visible. The proper fix is pure pursuit,
// which is blocked on the road's self-touch making lap position unreliable — see the
// module header and S5's mandate to delete the duplicate control point.
assert(after.atLinePct > 40,
  `T1j: RESIDUAL — bots still touch the barrier line ${after.atLinePct.toFixed(1)}% of the lap; this asserts the known state, and must be REVISITED once S5 makes pure pursuit possible`);

// ── Test 2: the sign is right — a bot off either side steers back ─────────────
(() => {
  const here = sampleSpline(CIRCUIT_DEF.road.mainPoints, 0.80);
  const ahead = sampleSpline(CIRCUIT_DEF.road.mainPoints, 0.805);
  const dx = ahead.x - here.x, dz = ahead.z - here.z, L = Math.hypot(dx, dz);
  const place = (lateral) => {
    const v = createVehicleState('bot-0', STATS);
    v.x = here.x + (-dz / L) * lateral;
    v.z = here.z + (dx / L) * lateral;
    v.rotY = Math.atan2(-dx, -dz);
    v.speed = 20;
    return v;
  };
  const race = new RaceManager();
  race.registerPlayer('bot-0');
  race.startCountdown();
  for (let i = 0; i < 60 * 4; i += 1) race.update(DT, { players: new Map(), getAllVehicles: () => [] });
  const info = { ...race.getRaceInfo(), state: 'RACING' };

  const bare = new BotController('bot-0', 1);
  bare.targetOffset = 0; // a bot whose line is the centre, so the sign is unambiguous
  const bot = makeRoadAwareBot(bare, index);

  const rs = race.raceStates.get('bot-0');
  const latPlus = roadAt(index, place(10).x, place(10).z, null).lateralOffset;
  assert(Math.sign(latPlus) === 1, `T2z: the +10 m fixture really is on the +lateral side (${latPlus.toFixed(1)})`);

  // WHY THE CORRECTION IS ISOLATED BY DIFFERENCE rather than compared as an absolute:
  // my first version compared the wrapper's steer on each side and read +0.00 vs -1.00.
  // It passed, but 0.00 was the gate term at full OPPOSITE lock cancelling the
  // correction — so the number proved nothing about the correction's sign. Subtracting
  // the inner bot's steer at the identical position leaves exactly the term under test.
  const delta = (lateral) => {
    const v = place(lateral);
    const inner = bare.generateInput(v, rs, info).steer;
    const wrapped = bot.generateInput(place(lateral), rs, info).steer;
    return { inner, wrapped, correction: wrapped - inner };
  };
  const dPlus = delta(10);
  const dMinus = delta(-10);
  assert(dPlus.correction > 0.1,
    `T2a: a bot on the +side is pushed POSITIVE, back toward its line (correction ${dPlus.correction.toFixed(3)}, inner ${dPlus.inner.toFixed(2)} -> ${dPlus.wrapped.toFixed(2)})`);
  assert(dMinus.correction < -0.1,
    `T2b: and one on the -side is pushed NEGATIVE (correction ${dMinus.correction.toFixed(3)}, inner ${dMinus.inner.toFixed(2)} -> ${dMinus.wrapped.toFixed(2)})`);
  assert(Math.abs(delta(0).correction) < 0.05,
    `T2c: a bot already on its line is barely touched (correction ${delta(0).correction.toFixed(4)})`);
})();

// ── Test 3: the inner bot's hard-won behaviours are untouched ─────────────────
(() => {
  const bare = new BotController('bot-0', 3);
  const bot = makeRoadAwareBot(bare, index);
  const v = createVehicleState('bot-0', STATS);
  v.x = 5; v.z = 34; v.speed = 20;

  // AIRBORNE: bots.js returns neutral on purpose — steering in the air drives ROLL and
  // landing mid-roll CRASHES, which cost ADR-0011 four finishers when it was missing.
  v.state = 'AIRBORNE';
  const air = bot.generateInput(v, { trackProgress: { route: 'UNSET', nextGateIds: ['coast-west'], clearedGateCount: 0, lapsCompleted: 0 } }, { state: 'RACING' });
  assert(air.steer === 0 && air.throttle === 0 && air.brake === 0,
    'T3a: an airborne bot is still handed neutral input — the barrel-roll guard is intact');

  // Not RACING: no input at all before the lights.
  v.state = 'NORMAL';
  const waiting = bot.generateInput(v, { trackProgress: { route: 'UNSET', nextGateIds: ['coast-west'], clearedGateCount: 0, lapsCompleted: 0 } }, { state: 'WAITING' });
  assert(waiting.steer === 0 && waiting.throttle === 0,
    'T3b: and nothing moves before the race starts');

  assert(bot.inner === bare, 'T3c: the wrapper exposes the inner controller rather than replacing it');
})();

// ── Test 4: personality survives, and is now road-relative ───────────────────
(() => {
  const a = new BotController('bot-a', 1);
  const b = new BotController('bot-b', 2);
  assert(a.targetOffset !== b.targetOffset, 'T4z: the two seeded bots really do have different lines');

  // Same position, same heading, different personality -> different steer. If the wrapper
  // had thrown the personality away, these would be identical and the field would drive
  // as one block.
  const here = sampleSpline(CIRCUIT_DEF.road.mainPoints, 0.80);
  const ahead = sampleSpline(CIRCUIT_DEF.road.mainPoints, 0.805);
  const dx = ahead.x - here.x, dz = ahead.z - here.z, L = Math.hypot(dx, dz);
  const mk = () => {
    const v = createVehicleState('bot-x', STATS);
    v.x = here.x; v.z = here.z; v.rotY = Math.atan2(-dx, -dz); v.speed = 20;
    return v;
  };
  const rs = { trackProgress: { route: 'MAIN', nextGateIds: ['east-bend'], clearedGateCount: 3, lapsCompleted: 0 } };
  const info = { state: 'RACING' };
  const sa = makeRoadAwareBot(a, index).generateInput(mk(), rs, info).steer;
  const sb = makeRoadAwareBot(b, index).generateInput(mk(), rs, info).steer;
  assert(sa !== sb, `T4a: two personalities still hold different lines (${sa.toFixed(3)} vs ${sb.toFixed(3)})`);
})();

// ── Test 6: traffic too — S7 covers both, and they share the controller ──────
(() => {
  // traffic.js:50 hands each obstacle car the SAME BotController, so the wrapper applies
  // unchanged. Measured live before this, the three cars spent 44-56% of the race on
  // grass — which after S3 also means they crawl, turning moving obstacles into parked
  // ones somewhere off the racing line where they obstruct nothing.
  const runTraffic = (wrap) => {
    const cars = createTrafficVehicles(STATS);
    if (wrap) for (const t of cars) t.bot = makeRoadAwareBot(t.bot, index);
    let off = 0, ticks = 0;
    for (let f = 0; f < 60 * 60; f += 1) {
      for (const t of cars) {
        const input = updateTrafficVehicle(t, DT);
        t.vehicle = updateVehicle(t.vehicle, input, DT, COAST.heightAt(t.vehicle.x, t.vehicle.z));
        resolveBarrier(t.vehicle, index, DT);
        applySurfaceDrag(t.vehicle, index, DT);
        settleOnTerrain(t.vehicle, COAST, DT);
        advanceTrafficProgress(t);
        ticks += 1;
        if (roadAt(index, t.vehicle.x, t.vehicle.z, null).surface !== 'TARMAC') off += 1;
      }
    }
    return off / ticks * 100;
  };
  const bare = runTraffic(false);
  const wrapped = runTraffic(true);
  console.log(`   [traffic] 60 s x 3 cars off-road: ${bare.toFixed(1)}% -> ${wrapped.toFixed(1)}%`);
  // WHY THE GUARD IS 5% AND NOT THE 44-56% MEASURED LIVE: this fixture is three cars
  // alone. In a real room they are also being shunted by eight racing karts, and
  // applyCarCollisions pushes them off the road far more than their own steering does.
  // The isolated figure is the one this test can honestly claim.
  assert(bare > 5, `T6z: unwrapped traffic really does wander off the road (${bare.toFixed(1)}%)`);
  assert(wrapped < bare / 2, `T6a: the same wrapper at least halves it for traffic (${bare.toFixed(1)}% -> ${wrapped.toFixed(1)}%)`);
})();

// ── Test 5: determinism ──────────────────────────────────────────────────────
(() => {
  // 40 s, not 20: at 20 s the countdown and acceleration mean gates is still 0 on both
  // runs, so the comparison was partly asserting 0 === 0.
  const one = runSim({ solidGround: true, wrapBot: makeRoadAwareBot, seconds: 40 });
  const two = runSim({ solidGround: true, wrapBot: makeRoadAwareBot, seconds: 40 });
  assert(one.gates > 0 && one.gates === two.gates && one.meanSpeed === two.meanSpeed,
    `T5a: the same seeds produce a bit-identical race (gates ${one.gates}/${two.gates}, meanSpeed ${one.meanSpeed}/${two.meanSpeed}) — RSK-003`);
})();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('SOME TESTS FAILED ❌');
  process.exit(1);
}
console.log('ALL TESTS PASSED ✅');
process.exit(0);

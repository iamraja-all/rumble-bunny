/**
 * test_track_v1.js — coverage for the last untested engine module.
 *
 * INPUT:  launch-pad geometry from CIRCUIT_DEF, and spawner ticks.
 * OUTPUT: pads are detected exactly at their declared footprint; item spawners
 *         respawn on schedule, stay quiet while their item is still on the track,
 *         and DO NOT share state between concurrent rooms.
 * PASS:   every assertion green and exit code 0.
 *
 * The last of these matters more than it looks. Dynamic rooms mean several races
 * run in one process, and the spawn timers were being mutated on the module-level
 * TRACK_DEF singleton — so a pickup in one room silently re-timed the spawners in
 * every other room.
 */
import { getLaunchPadAt, updateSpawners, createTrackState, TRACK_DEF } from './track.js';
import { CIRCUIT_DEF } from './circuit-track.js';

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { console.log(`✅ PASS: ${label}`); passed++; }
  else { console.log(`❌ FAIL: ${label}`); failed++; }
}

console.log('--- track.js ---\n');

// ── T1-T4: launch pad detection ─────────────────────────────────────────────
(() => {
  const pads = CIRCUIT_DEF.launchPads;
  assert(pads.length > 0, `T1a: the circuit declares launch pads (${pads.length})`);

  // Every declared pad must be findable dead centre. A pad the engine cannot see
  // is a ramp the player drives straight through.
  const allFound = pads.every(p => {
    const hit = getLaunchPadAt(p.x, p.z);
    return hit && hit.id === p.id;
  });
  assert(allFound, 'T1b: every declared pad is detected at its own centre');

  const pad = pads[0];
  const halfW = pad.width / 2;
  const halfL = pad.length / 2;

  // Edges are inclusive — the comparison uses >= and <=.
  assert(getLaunchPadAt(pad.x - halfW, pad.z) !== null, 'T2a: the -X edge is inside the pad');
  assert(getLaunchPadAt(pad.x + halfW, pad.z) !== null, 'T2b: the +X edge is inside the pad');
  assert(getLaunchPadAt(pad.x, pad.z - halfL) !== null, 'T2c: the -Z edge is inside the pad');
  assert(getLaunchPadAt(pad.x, pad.z + halfL) !== null, 'T2d: the +Z edge is inside the pad');

  // Just outside must miss, on both axes.
  assert(getLaunchPadAt(pad.x - halfW - 0.01, pad.z) === null, 'T3a: just past the -X edge misses');
  assert(getLaunchPadAt(pad.x, pad.z + halfL + 0.01) === null, 'T3b: just past the +Z edge misses');
  assert(getLaunchPadAt(99999, 99999) === null, 'T3c: far off-track returns null, not a pad');

  assert(getLaunchPadAt(pad.x, pad.z).power > 0, 'T4: a detected pad carries its launch power');
})();

// ── T5-T7: spawner scheduling, against a private track state ────────────────
(() => {
  const state = createTrackState();
  const spawner = CIRCUIT_DEF.itemSpawners[0];

  // Timers start at 0, so the first tick should produce the initial items.
  const first = updateSpawners(1 / 60, [], state);
  assert(first.length === CIRCUIT_DEF.itemSpawners.length,
    `T5a: every spawner produces its item on the first tick (got ${first.length})`);

  const item = first.find(i => i.id === `item_${spawner.id}`);
  assert(!!item, 'T5b: the item id is derived from its spawner');
  assert(item.x === spawner.x && item.z === spawner.z, 'T5c: the item spawns at the spawner position');
  assert(item.type === spawner.type, 'T5d: the item is the type the spawner declares');

  // While that item is still on the track, the spawner must stay quiet — otherwise
  // one spawner carpets the circuit with duplicates.
  const whileActive = updateSpawners(1 / 60, first, state);
  assert(whileActive.length === 0, 'T6a: no respawn while the previous item is still active');

  const stillQuiet = updateSpawners(5.0, first, state);
  assert(stillQuiet.length === 0, 'T6b: still no respawn even after a long tick, while active');

  // Once collected, the respawn timer runs.
  const justAfter = updateSpawners(spawner.respawnTime - 0.1, [], state);
  assert(justAfter.length === 0, `T7a: no respawn before respawnTime (${spawner.respawnTime}s) elapses`);

  const afterWait = updateSpawners(0.2, [], state);
  assert(afterWait.length === CIRCUIT_DEF.itemSpawners.length, 'T7b: respawns once respawnTime elapses');
})();

// ── T8: THE BUG — concurrent rooms must not share spawn timers ──────────────
//
// TRACK_DEF.itemSpawners was a module-level singleton whose `timer` field was
// mutated in place. With RoomManager running several races in one process, a
// pickup in room A re-timed room B's spawners. Two independent states must be
// completely isolated.
(() => {
  const roomA = createTrackState();
  const roomB = createTrackState();

  // Drain both so each has a full timer running.
  const aItems = updateSpawners(1 / 60, [], roomA);
  updateSpawners(1 / 60, [], roomB);

  // Room A keeps its items on the track (timer held), room B's are collected and
  // its clock runs down.
  const respawn = CIRCUIT_DEF.itemSpawners[0].respawnTime;
  updateSpawners(respawn + 1, aItems, roomA); // held: still active
  const bRespawned = updateSpawners(respawn + 1, [], roomB); // collected: should fire

  assert(bRespawned.length > 0, 'T8a: room B respawns on its own schedule');

  // Now room A's items are collected. Its timer was HELD at respawnTime while they
  // were active, so it must still need the full wait — room B's progress must not
  // have advanced it.
  const aImmediately = updateSpawners(0.1, [], roomA);
  assert(aImmediately.length === 0,
    'T8b: room A did NOT inherit room B\'s elapsed timer (states are isolated)');

  const aAfterOwnWait = updateSpawners(respawn, [], roomA);
  assert(aAfterOwnWait.length > 0, 'T8c: room A respawns after its OWN full wait');

  // And the exported definition must not be carrying mutable per-race state at all.
  const defHasTimers = TRACK_DEF.itemSpawners.some(s => Object.prototype.hasOwnProperty.call(s, 'timer'));
  assert(!defHasTimers,
    'T8d: TRACK_DEF carries no mutable timer field — per-race state lives in createTrackState()');
})();

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);

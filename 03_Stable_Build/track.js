import { createItemState } from './items-physics.js';
import { CIRCUIT_DEF } from './circuit-track.js';

/**
 * The immutable track definition. Geometry only — no per-race state.
 *
 * WHY THERE IS NO `timer` FIELD HERE ANY MORE:
 * this object used to carry `timer: 0` on every spawner and updateSpawners mutated
 * it in place. That was survivable when the server ran a single hardcoded room, but
 * RoomManager now runs several races in one process against this one shared object,
 * so collecting a powerup in room A silently re-timed the spawners in room B. It
 * also meant a second race in the same process inherited the first one's leftover
 * timers, which is the reproducibility problem RSK-003 is about. Per-race state now
 * lives in createTrackState().
 */
export const TRACK_DEF = {
  launchPads: CIRCUIT_DEF.launchPads,
  itemSpawners: CIRCUIT_DEF.itemSpawners.map(({ id, x, z, type, respawnTime }) => ({
    id, x, z, type, respawnTime,
  })),
};

/**
 * Fresh, private spawn timers for one race. Call once per room.
 *
 * Big-O: O(S) with S = spawner count, once per room creation — not in the loop.
 */
export function createTrackState() {
  return TRACK_DEF.itemSpawners.map(s => ({ id: s.id, timer: 0 }));
}

/**
 * Big-O: O(P) over launch pads, called per vehicle per frame. P is 4 on this
 * circuit, so a linear scan beats any spatial index (Rung 7).
 */
export function getLaunchPadAt(x, z) {
  for (const pad of TRACK_DEF.launchPads) {
    const halfW = pad.width / 2;
    const halfL = pad.length / 2;
    if (x >= pad.x - halfW && x <= pad.x + halfW &&
        z >= pad.z - halfL && z <= pad.z + halfL) {
      return pad;
    }
  }
  return null;
}

/**
 * Advance one room's item spawners and return whatever spawned this tick.
 *
 * @param trackState per-room timers from createTrackState(). Required — passing the
 *        module definition instead is what caused cross-room interference.
 *
 * Big-O: O(S + M) with S spawners and M active items. The previous version nested
 * activeItems.some() inside the spawner loop, making it O(S*M); the live-id Set is
 * built once per call instead.
 */
export function updateSpawners(dt, activeItems, trackState) {
  if (!trackState) {
    throw new Error('updateSpawners requires a per-room trackState from createTrackState()');
  }

  const newItems = [];
  const liveIds = new Set();
  for (const item of activeItems) liveIds.add(item.id);

  for (let i = 0; i < trackState.length; i++) {
    const timerState = trackState[i];
    const spawner = TRACK_DEF.itemSpawners[i];
    const itemId = `item_${spawner.id}`;

    if (liveIds.has(itemId)) {
      // Its item is still on the track — hold the clock at full, so the wait only
      // starts once somebody actually collects it.
      timerState.timer = spawner.respawnTime;
      continue;
    }

    timerState.timer -= dt;
    if (timerState.timer <= 0) {
      const item = createItemState(itemId, spawner.type);
      item.x = spawner.x;
      item.y = 1.0;
      item.z = spawner.z;
      newItems.push(item);
      timerState.timer = spawner.respawnTime;
    }
  }

  return newItems;
}

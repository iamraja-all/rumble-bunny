import { createItemState } from './items-physics.js';
import { CIRCUIT_DEF } from './circuit-track.js';

export const TRACK_DEF = {
  launchPads: CIRCUIT_DEF.launchPads,
  itemSpawners: CIRCUIT_DEF.itemSpawners.map(s => ({ ...s, timer: 0 }))
};

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

export function updateSpawners(dt, activeItems) {
  const newItems = [];
  
  for (const spawner of TRACK_DEF.itemSpawners) {
    const hasActiveChild = activeItems.some(i => i.id === `item_${spawner.id}`);
    
    if (hasActiveChild) {
      spawner.timer = spawner.respawnTime;
    } else {
      spawner.timer -= dt;
      if (spawner.timer <= 0) {
        const item = createItemState(`item_${spawner.id}`, spawner.type);
        item.x = spawner.x;
        item.y = 1.0;
        item.z = spawner.z;
        newItems.push(item);
        
        spawner.timer = spawner.respawnTime;
      }
    }
  }

  return newItems;
}

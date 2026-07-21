import { createItemState } from './items-physics.js';

/**
 * Headless Track Definition
 * 
 * WHY:
 * Law 1 (Headless First) means the server cannot rely on 3D meshes for collisions.
 * We mathematically define functional zones (Launch Pads, Item Spawners) on the XZ plane.
 * The client renderer will draw visual equivalents at these exact coordinates.
 */

// A simple straight line with a ramp and some item spawners
export const TRACK_DEF = {
  launchPads: [
    // A ramp 50 meters straight ahead from the start line
    { id: 'ramp_1', x: 0, z: -50, width: 20, length: 5, power: 15.0 },
    // Another ramp further down
    { id: 'ramp_2', x: 0, z: -150, width: 20, length: 5, power: 20.0 }
  ],
  itemSpawners: [
    // Spawners placed before the first ramp
    { id: 'spawner_1', x: -5, z: -30, type: 'POWERUP_BOOST', respawnTime: 10.0, timer: 0 },
    { id: 'spawner_2', x: 5, z: -30, type: 'TRAP', respawnTime: 10.0, timer: 0 },
    // Spawners placed before the second ramp
    { id: 'spawner_3', x: 0, z: -100, type: 'POWERUP_BOOST', respawnTime: 10.0, timer: 0 }
  ]
};

/**
 * getLaunchPadAt
 * Checks if an X,Z coordinate is inside a Launch Pad zone.
 * Big-O: O(R) where R is number of ramps. R is small, so effectively O(1).
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
 * updateSpawners
 * Ticks spawn timers and generates new items to be added to the active pool.
 * Big-O: O(S) where S is number of spawners.
 */
export function updateSpawners(dt, activeItems) {
  const newItems = [];
  
  for (const spawner of TRACK_DEF.itemSpawners) {
    // Check if an item spawned by this spawner already exists in activeItems
    const hasActiveChild = activeItems.some(i => i.id === `item_${spawner.id}`);
    
    if (hasActiveChild) {
      // While the item is alive, reset the timer
      spawner.timer = spawner.respawnTime;
    } else {
      // The item is gone (consumed), tick down the respawn timer
      spawner.timer -= dt;
      if (spawner.timer <= 0) {
        // Spawn it
        const item = createItemState(`item_${spawner.id}`, spawner.type);
        item.x = spawner.x;
        item.y = 1.0; // Float slightly above ground
        item.z = spawner.z;
        newItems.push(item);
        
        // Reset timer
        spawner.timer = spawner.respawnTime;
      }
    }
  }

  return newItems;
}

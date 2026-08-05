/**
 * items-physics: Headless mechanics for powerups, traps, and projectiles.
 *
 * WHY:
 * O(N*M) collision check is used (N=vehicles, M=items). Since N <= 8 and M is small
 * (items despawn after use or timeout), raw nested loops are well within budget
 * for 60fps headless execution without spatial partitioning overhead (Rung 7).
 */

// One definition, imported — not a second copy. These two collision systems had
// already drifted apart (vehicle-vehicle contact was using half this value).
import { VEHICLE_RADIUS } from './vehicle-physics.js';

const ITEM_RADIUS = 1.0;
const COLLISION_DIST_SQ = (VEHICLE_RADIUS + ITEM_RADIUS) * (VEHICLE_RADIUS + ITEM_RADIUS);

// WHY the defaults: track.js calls this with just (id, type) and then assigns x/y/z
// itself, which left rotY and speed as `undefined`. Those reached the serializer as
// NaN on every spawned item — invisible, because the non-finite guard wrote them out
// as 0. Static items do not care, but shipping NaN through the wire format is how
// the far worse stat-block bug stayed hidden, so it gets fixed at the source.
export function createItemState(id, type, x = 0, y = 0, z = 0, rotY = 0, speed = 0) {
  return {
    id,
    type,
    x,
    y,
    z,
    rotX: 0,
    rotY,
    rotZ: 0,
    speed,
    state: 'NORMAL',
    modifiers: {}
  };
}

/**
 * Checks if two bounding spheres intersect.
 */
function checkCollision(v, item) {
  const dx = v.x - item.x;
  const dy = v.y - item.y;
  const dz = v.z - item.z;
  const distSq = (dx * dx) + (dy * dy) + (dz * dz);
  return distSq <= COLLISION_DIST_SQ;
}

/**
 * Updates item positions (projectiles) and checks collisions with vehicles.
 * 
 * @param {Array} items - Active items in the arena.
 * @param {Array} vehicles - Active players.
 * @param {Number} dt - Delta time (1/60)
 * @returns {Array} - The array of active items (consumed items are removed).
 */
export function updateItems(items, vehicles, dt) {
  const activeItems = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let consumed = false;

    // 1. Movement logic (for projectiles)
    if (item.type === 'PROJECTILE' && item.speed > 0) {
      // Move along forward vector
      const forwardX = Math.sin(item.rotY);
      const forwardZ = Math.cos(item.rotY);
      item.x += forwardX * item.speed * dt;
      item.z += forwardZ * item.speed * dt;
    }

    // 2. Collision logic against all vehicles
    for (let j = 0; j < vehicles.length; j++) {
      const v = vehicles[j];
      
      // Can't hit crashed/airborne vehicles (invincibility frame / dodge)
      if (v.state === 'CRASHED' || v.state === 'AIRBORNE') continue;
      
      // A dead `if (item.modifiers.owner === v.id)` branch stood here with an EMPTY
      // body. It was unreachable twice over: nothing in the codebase ever assigned
      // `modifiers.owner`, so the comparison could never be true, and the body did
      // nothing even if it had been. It also cost a property lookup and a comparison
      // per item per vehicle per frame inside the 60Hz loop (R07). spec.md §5 gives
      // PROJECTILE no owner immunity — a shell crashes whatever it touches — so there
      // is no behaviour here to preserve. If firer immunity is ever wanted it needs a
      // populated owner field and a real rule, not a placeholder.

      if (checkCollision(v, item)) {
        consumed = true;
        
        // Apply effect
        if (item.type === 'POWERUP_BOOST') {
          // Grant 2s boost
          v.modifiers.boost_timer = (v.modifiers.boost_timer || 0) + 2.0;
          v.state = 'BOOSTING';
        } else if (item.type === 'TRAP' || item.type === 'PROJECTILE') {
          // Crash the vehicle
          v.state = 'CRASHED';
          v._crashTimer = 1.5;
          v.speed *= 0.2; // Severely penalize speed instantly
        }
        
        break; // Item is consumed, stop checking other vehicles
      }
    }

    if (!consumed) {
      activeItems.push(item);
    }
  }

  return activeItems;
}

/**
 * weapon-firing.js — Server-side Weapon Firing System
 * 
 * WHY this module exists:
 * weapons.js defines weapon types and stats, but does not handle:
 * - Player inventory management
 * - Fire command processing
 * - Projectile lifecycle updates
 * - Hit detection for complex weapons
 * - Area-of-effect calculations
 * 
 * This module bridges weapons.js with the server tick loop.
 */

import { 
  WEAPON_MISSILE, WEAPON_MINE, WEAPON_SHOCKWAVE, WEAPON_EMP, 
  WEAPON_SHIELD, WEAPON_BOOST, WEAPON_HOMING_MISSILE,
  WEAPON_STATS, createWeaponProjectile, deployMine, 
  activateShockwave, activateEMP, activateShield, activateBoost 
} from './weapons.js';
import { VEHICLE_RADIUS } from './vehicle-physics.js';

// Unique projectile counter per room
let _projectileCounter = 0;

/**
 * initializePlayerWeapons — Set up weapon inventory for a player
 * Called when player spawns or picks up item box
 * 
 * @param {object} vehicle - Player vehicle state
 * @param {string} weaponType - Weapon type to add
 * @returns {boolean} - Success
 */
export function initializePlayerWeapons(vehicle) {
  if (!vehicle.modifiers.weapons) {
    vehicle.modifiers.weapons = {};
    vehicle.modifiers.weaponSlots = [null, null, null]; // 3 weapon slots
    vehicle.modifiers.currentWeapon = 0;
    vehicle.modifiers.fireCooldown = 0;
  }
}

/**
 * addWeaponToInventory — Add a weapon to player's inventory
 * 
 * @param {object} vehicle - Player vehicle
 * @param {string} weaponType - Weapon type constant
 * @returns {boolean} - True if added, false if inventory full
 */
export function addWeaponToInventory(vehicle, weaponType) {
  initializePlayerWeapons(vehicle);
  
  const slots = vehicle.modifiers.weaponSlots;
  const stats = WEAPON_STATS[weaponType];
  
  // Stackable weapons (mines, shields)
  if (weaponType === WEAPON_MINE) {
    const currentMines = vehicle.modifiers.weapons[WEAPON_MINE] || 0;
    if (currentMines < stats.maxMines) {
      vehicle.modifiers.weapons[WEAPON_MINE] = currentMines + 1;
      return true;
    }
    return false;
  }
  
  if (weaponType === WEAPON_SHIELD) {
    // Don't add if already have shield active
    if (vehicle.modifiers.shield_timer > 0) return false;
    const currentShields = vehicle.modifiers.weapons[WEAPON_SHIELD] || 0;
    vehicle.modifiers.weapons[WEAPON_SHIELD] = currentShields + 1;
    return true;
  }
  
  // Non-stackable weapons - find empty slot
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] === null) {
      slots[i] = weaponType;
      vehicle.modifiers.weapons[weaponType] = 1;
      return true;
    }
  }
  
  // Inventory full - replace current weapon
  const currentSlot = vehicle.modifiers.currentWeapon;
  if (slots[currentSlot] !== null) {
    const oldWeapon = slots[currentSlot];
    vehicle.modifiers.weapons[oldWeapon] = undefined;
  }
  slots[currentSlot] = weaponType;
  vehicle.modifiers.weapons[weaponType] = 1;
  return true;
}

/**
 * fireWeapon — Process fire command from player
 * 
 * @param {object} vehicle - Player vehicle
 * @param {string} weaponType - Weapon to fire (optional, uses current if not specified)
 * @param {Array} allVehicles - All vehicles for targeting
 * @param {number} roomId - Room ID for projectile unique IDs
 * @returns {object|null} - Created projectile/effect data, or null if can't fire
 */
export function fireWeapon(vehicle, weaponType, allVehicles, roomId) {
  initializePlayerWeapons(vehicle);
  
  // Check cooldown
  if (vehicle.modifiers.fireCooldown > 0) return null;
  
  // If no weapon type specified, use current slot
  if (!weaponType) {
    const currentSlot = vehicle.modifiers.currentWeapon;
    weaponType = vehicle.modifiers.weaponSlots[currentSlot];
  }
  
  if (!weaponType || !vehicle.modifiers.weapons[weaponType]) {
    return null; // No weapon available
  }
  
  const stats = WEAPON_STATS[weaponType];
  
  // Different handling per weapon type
  switch (weaponType) {
    case WEAPON_MISSILE:
    case WEAPON_HOMING_MISSILE: {
      // Find target for homing missile
      let target = null;
      if (weaponType === WEAPON_HOMING_MISSILE) {
        target = findNearestEnemy(vehicle, allVehicles, stats.lockonRange);
      }
      
      // Create projectile
      const projId = `proj_${roomId}_${++_projectileCounter}`;
      const projectile = createWeaponProjectile(projId, weaponType, vehicle, target);
      
      // Consume weapon
      consumeWeapon(vehicle, weaponType);
      
      // Set cooldown
      vehicle.modifiers.fireCooldown = stats.fireRate;
      
      return { type: 'PROJECTILE', data: projectile };
    }
    
    case WEAPON_MINE: {
      const mineId = `mine_${roomId}_${++_projectileCounter}`;
      const mine = deployMine(mineId, vehicle);
      
      consumeWeapon(vehicle, weaponType);
      vehicle.modifiers.fireCooldown = stats.fireRate;
      
      return { type: 'MINE', data: mine };
    }
    
    case WEAPON_SHOCKWAVE: {
      const effect = activateShockwave(vehicle);
      vehicle.modifiers.fireCooldown = stats.fireRate;
      return { type: 'SHOCKWAVE', data: effect };
    }
    
    case WEAPON_EMP: {
      const effect = activateEMP(vehicle);
      vehicle.modifiers.fireCooldown = stats.fireRate;
      return { type: 'EMP', data: effect };
    }
    
    case WEAPON_SHIELD: {
      const success = activateShield(vehicle);
      if (success) {
        consumeWeapon(vehicle, weaponType);
        vehicle.modifiers.fireCooldown = stats.fireRate;
        return { type: 'SHIELD_APPLIED', data: { vehicle: vehicle.id } };
      }
      return null; // Already shielded
    }
    
    case WEAPON_BOOST: {
      const success = activateBoost(vehicle);
      if (success) {
        consumeWeapon(vehicle, weaponType);
        vehicle.modifiers.fireCooldown = stats.fireRate;
        return { type: 'BOOST_APPLIED', data: { vehicle: vehicle.id } };
      }
      return null;
    }
    
    default:
      return null;
  }
}

/**
 * consumeWeapon — Remove one instance of weapon from inventory
 */
function consumeWeapon(vehicle, weaponType) {
  const stats = WEAPON_STATS[weaponType];
  
  // Stackable weapons
  if (weaponType === WEAPON_MINE || weaponType === WEAPON_SHIELD) {
    vehicle.modifiers.weapons[weaponType]--;
    if (vehicle.modifiers.weapons[weaponType] <= 0) {
      vehicle.modifiers.weapons[weaponType] = undefined;
      // Remove from slots
      const slots = vehicle.modifiers.weaponSlots;
      for (let i = 0; i < slots.length; i++) {
        if (slots[i] === weaponType) {
          slots[i] = null;
          break;
        }
      }
    }
    return;
  }
  
  // Non-stackable - remove from slot
  const slots = vehicle.modifiers.weaponSlots;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] === weaponType) {
      slots[i] = null;
      vehicle.modifiers.weapons[weaponType] = undefined;
      // Adjust current slot if needed
      if (vehicle.modifiers.currentWeapon === i) {
        vehicle.modifiers.currentWeapon = findNextWeapon(slots);
      }
      break;
    }
  }
}

/**
 * findNextWeapon — Find next available weapon slot
 */
function findNextWeapon(slots) {
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] !== null) return i;
  }
  return 0;
}

/**
 * findNearestEnemy — Find closest enemy vehicle within range
 */
function findNearestEnemy(vehicle, allVehicles, maxRange) {
  let nearest = null;
  let nearestDistSq = maxRange * maxRange;
  
  for (const other of allVehicles) {
    if (other.id === vehicle.id) continue;
    if (other.state === 'CRASHED') continue;
    
    const dx = other.x - vehicle.x;
    const dz = other.z - vehicle.z;
    const distSq = dx * dx + dz * dz;
    
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearest = other;
    }
  }
  
  return nearest;
}

/**
 * updateProjectiles — Update all active projectiles
 * Handles movement, homing, lifetime, collisions
 * 
 * @param {Array} projectiles - Active projectiles
 * @param {Array} vehicles - All vehicles
 * @param {number} dt - Delta time
 * @returns {Array} - Updated projectiles (removed consumed ones)
 */
export function updateProjectiles(projectiles, vehicles, dt) {
  const activeProjectiles = [];
  
  for (const proj of projectiles) {
    let consumed = false;
    
    // Update lifetime
    proj.modifiers.timer -= dt;
    if (proj.modifiers.timer <= 0) {
      continue; // Expired
    }
    
    // Movement
    if (proj.type === 'PROJECTILE' && proj.speed > 0) {
      const stats = WEAPON_STATS[proj.weaponType];
      
      // Homing behavior
      if (proj.weaponType === WEAPON_HOMING_MISSILE && proj.modifiers.targetId) {
        const target = vehicles.find(v => v.id === proj.modifiers.targetId);
        if (target && target.state !== 'CRASHED') {
          // Steer toward target
          const dx = target.x - proj.x;
          const dz = target.z - proj.z;
          const targetAngle = Math.atan2(dx, dz);
          
          // Smooth turn toward target
          let angleDiff = targetAngle - proj.rotY;
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          
          const maxTurn = stats.turnRate * dt;
          angleDiff = Math.max(-maxTurn, Math.min(maxTurn, angleDiff));
          proj.rotY += angleDiff;
          
          // Update velocity direction
          proj.vx = Math.sin(proj.rotY) * proj.speed;
          proj.vz = Math.cos(proj.rotY) * proj.speed;
        }
      }
      
      // Move projectile
      proj.x += proj.vx * dt;
      proj.z += proj.vz * dt;
    }
    
    // Collision detection
    const collisionRadius = proj.modifiers.blastRadius || 0;
    const hitRadius = VEHICLE_RADIUS + collisionRadius;
    const hitRadiusSq = hitRadius * hitRadius;
    
    for (const vehicle of vehicles) {
      // Skip owner for non-AoE weapons
      if (vehicle.id === proj.modifiers.owner && collisionRadius === 0) continue;
      if (vehicle.state === 'AIRBORNE') continue; // Dodge frame
      
      const dx = vehicle.x - proj.x;
      const dz = vehicle.z - proj.z;
      const distSq = dx * dx + dz * dz;
      
      if (distSq <= hitRadiusSq) {
        // HIT!
        consumed = true;
        
        if (collisionRadius > 0) {
          // AoE explosion - affect all nearby
          applyBlastRadius(proj, vehicles, hitRadius);
        } else {
          // Direct hit
          applyWeaponHit(vehicle, proj.modifiers.damage, proj.weaponType, proj.modifiers.owner);
        }
        break;
      }
    }
    
    if (!consumed) {
      activeProjectiles.push(proj);
    }
  }
  
  return activeProjectiles;
}

/**
 * applyBlastRadius — Apply AoE damage/knockback
 */
function applyBlastRadius(projectile, vehicles, radius) {
  const radiusSq = radius * radius;
  
  for (const vehicle of vehicles) {
    if (vehicle.state === 'AIRBORNE') continue;
    
    const dx = vehicle.x - projectile.x;
    const dz = vehicle.z - projectile.z;
    const distSq = dx * dx + dz * dz;
    
    if (distSq <= radiusSq) {
      const damage = projectile.modifiers.damage;
      applyWeaponHit(vehicle, damage, projectile.weaponType, projectile.modifiers.owner);
    }
  }
}

/**
 * applyWeaponHit — Apply weapon effect to vehicle
 */
export function applyWeaponHit(vehicle, damage, weaponType, attackerId) {
  // Check for shield
  if (vehicle.modifiers.shield_timer > 0 && vehicle.modifiers.shield_blocks > 0) {
    vehicle.modifiers.shield_blocks--;
    if (vehicle.modifiers.shield_blocks <= 0) {
      vehicle.modifiers.shield_timer = 0;
    }
    return; // Shield absorbed hit
  }
  
  switch (weaponType) {
    case WEAPON_MISSILE:
    case WEAPON_HOMING_MISSILE:
    case WEAPON_MINE:
      vehicle.state = 'CRASHED';
      vehicle._crashTimer = 1.5 * damage;
      vehicle.speed *= 0.2;
      break;
      
    case WEAPON_SHOCKWAVE:
      // Knockback
      const stats = WEAPON_STATS[WEAPON_SHOCKWAVE];
      const dx = vehicle.x - (projectile?.x || vehicle.x);
      const dz = vehicle.z - (projectile?.z || vehicle.z);
      const dist = Math.sqrt(dx * dx + dz * dz) || 1;
      const force = stats.knockbackForce * (1 - dist / stats.blastRadius);
      vehicle.x += (dx / dist) * force * 0.016;
      vehicle.z += (dz / dist) * force * 0.016;
      vehicle.speed *= 0.5;
      break;
      
    case WEAPON_EMP:
      vehicle.modifiers.emp_disabled = WEAPON_STATS[WEAPON_EMP].disableDuration;
      vehicle.state = 'CRASHED';
      vehicle._crashTimer = 0.5;
      vehicle.speed *= 0.1;
      break;
  }
}

/**
 * applyAreaEffect — Process instant area effects (shockwave, EMP)
 */
export function applyAreaEffect(effect, vehicles) {
  const { type, x, z, radius, owner } = effect;
  
  for (const vehicle of vehicles) {
    if (vehicle.id === owner) continue; // Don't hit self
    if (vehicle.state === 'AIRBORNE') continue;
    
    const dx = vehicle.x - x;
    const dz = vehicle.z - z;
    const distSq = dx * dx + dz * dz;
    
    if (distSq <= radius * radius) {
      if (type === 'SHOCKWAVE') {
        const stats = WEAPON_STATS[WEAPON_SHOCKWAVE];
        const dist = Math.sqrt(distSq) || 1;
        const force = stats.knockbackForce * (1 - dist / radius);
        vehicle.x += (dx / dist) * force * 0.016;
        vehicle.z += (dz / dist) * force * 0.016;
        vehicle.speed *= 0.5;
      } else if (type === 'EMP') {
        vehicle.modifiers.emp_disabled = WEAPON_STATS[WEAPON_EMP].disableDuration;
        vehicle.state = 'CRASHED';
        vehicle._crashTimer = 0.5;
        vehicle.speed *= 0.1;
      }
    }
  }
}

/**
 * cycleWeapon — Switch to next weapon in inventory
 */
export function cycleWeapon(vehicle) {
  initializePlayerWeapons(vehicle);
  const slots = vehicle.modifiers.weaponSlots;
  
  for (let i = 0; i < slots.length; i++) {
    const nextSlot = (vehicle.modifiers.currentWeapon + 1) % slots.length;
    if (slots[nextSlot] !== null) {
      vehicle.modifiers.currentWeapon = nextSlot;
      return slots[nextSlot];
    }
  }
  return null;
}

/**
 * getWeaponInfo — Get current weapon info for HUD
 */
export function getWeaponInfo(vehicle) {
  initializePlayerWeapons(vehicle);
  const currentSlot = vehicle.modifiers.currentWeapon;
  const weaponType = vehicle.modifiers.weaponSlots[currentSlot];
  
  if (!weaponType) return null;
  
  return {
    type: weaponType,
    name: WEAPON_STATS[weaponType].description,
    ammo: vehicle.modifiers.weapons[weaponType] || 1,
    cooldown: vehicle.modifiers.fireCooldown
  };
}

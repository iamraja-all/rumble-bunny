/**
 * weapons.js — Combat Weapon System for Rumble Racing
 * 
 * WHY this module exists:
 * Your current items-physics.js only has basic boost/trap/projectile.
 * Rumble Racing needs a diverse arsenal with different behaviors:
 * - Homing missiles that track targets
 * - Deployable mines
 * - Area-of-effect shockwaves
 * - Defensive shields
 * - EMP bursts that disable controls
 * 
 * This module defines weapon types, firing mechanics, and balance stats.
 */

// Weapon type constants
export const WEAPON_MISSILE = 'MISSILE';
export const WEAPON_MINE = 'MINE';
export const WEAPON_SHOCKWAVE = 'SHOCKWAVE';
export const WEAPON_EMP = 'EMP';
export const WEAPON_SHIELD = 'SHIELD';
export const WEAPON_BOOST = 'BOOST_PACK';
export const WEAPON_HOMING_MISSILE = 'HOMING_MISSILE';

// WHY: Weapon balance constants measured against Rumble Racing, Blur, Mario Kart
export const WEAPON_STATS = Object.freeze({
  [WEAPON_MISSILE]: {
    speed: 45,              // m/s projectile speed
    lifetime: 4.0,          // seconds before self-destruct
    damage: 1.0,            // Crash duration multiplier
    blastRadius: 0,         // Direct hit only
    fireRate: 0.5,          // Seconds between shots
    description: 'Fast straight-shot missile'
  },
  [WEAPON_HOMING_MISSILE]: {
    speed: 35,              // Slower than regular missile
    lifetime: 6.0,          // More time to find target
    damage: 1.0,
    blastRadius: 3.5,       // Small AoE in case of near-miss
    turnRate: 2.5,          // Radians per second turn capability
    lockonRange: 60,        // Max distance to acquire target
    fireRate: 0.8,
    description: 'Locks onto nearest opponent'
  },
  [WEAPON_MINE]: {
    speed: 0,               // Stationary
    lifetime: 15.0,         // Remains for 15 seconds
    damage: 1.2,            // Slightly more damaging than missile
    blastRadius: 5.0,       // Medium explosion radius
    triggerRadius: 2.5,     // Distance to detonate
    maxMines: 3,            // Max mines one player can deploy
    fireRate: 0.3,
    description: 'Deployable proximity mine'
  },
  [WEAPON_SHOCKWAVE]: {
    speed: 0,               // Instant effect
    lifetime: 0,            // Instantaneous
    damage: 0,              // No crash, just knockback
    blastRadius: 12.0,      // Large radius around player
    knockbackForce: 40,     // Force applied to nearby vehicles
    fireRate: 2.0,          // Long cooldown
    description: 'Pushes away all nearby vehicles'
  },
  [WEAPON_EMP]: {
    speed: 0,               // Instant effect
    lifetime: 0,
    damage: 0,
    blastRadius: 25.0,      // Very large radius
    disableDuration: 2.5,   // Seconds of control loss
    fireRate: 3.0,          // Very long cooldown
    description: 'Disables controls for all enemies in range'
  },
  [WEAPON_SHIELD]: {
    speed: 0,
    lifetime: 4.0,          // Shield lasts 4 seconds
    damage: 0,
    blastRadius: 0,
    blocksHits: 1,          // Blocks one hit then breaks
    fireRate: 1.5,
    description: 'Absorbs one incoming attack'
  },
  [WEAPON_BOOST]: {
    speed: 0,
    lifetime: 3.0,          // Boost duration
    damage: 0,
    blastRadius: 0,
    boostMult: 1.4,         // 40% speed increase
    invincible: true,       // Can't be hit while boosting
    fireRate: 1.0,
    description: 'Speed burst with temporary invincibility'
  }
});

// Item box distribution weights (for RNG)
// WHY: Rubber-banding - trailing players get better weapons
export const ITEM_WEIGHTS_BY_POSITION = Object.freeze([
  // Position 1 (leader): Mostly defensive/weak items
  { [WEAPON_SHIELD]: 30, [WEAPON_BOOST]: 25, [WEAPON_MINE]: 20, [WEAPON_MISSILE]: 15, [WEAPON_EMP]: 5, [WEAPON_SHOCKWAVE]: 5 },
  // Position 2
  { [WEAPON_SHIELD]: 20, [WEAPON_BOOST]: 20, [WEAPON_MINE]: 20, [WEAPON_MISSILE]: 20, [WEAPON_HOMING_MISSILE]: 15, [WEAPON_EMP]: 5 },
  // Position 3
  { [WEAPON_SHIELD]: 15, [WEAPON_BOOST]: 15, [WEAPON_MINE]: 20, [WEAPON_MISSILE]: 20, [WEAPON_HOMING_MISSILE]: 20, [WEAPON_SHOCKWAVE]: 10 },
  // Position 4+ (trailing): Best offensive items
  { [WEAPON_SHIELD]: 10, [WEAPON_BOOST]: 10, [WEAPON_MINE]: 15, [WEAPON_MISSILE]: 15, [WEAPON_HOMING_MISSILE]: 30, [WEAPON_SHOCKWAVE]: 15, [WEAPON_EMP]: 5 }
]);

/**
 * createWeaponProjectile — Create a new projectile instance
 * 
 * @param {string} id - Unique projectile ID (e.g., "proj_P0_1")
 * @param {string} type - Weapon type from WEAPON_* constants
 * @param {object} owner - Owner vehicle state
 * @param {object} target - Target vehicle (for homing weapons, optional)
 * @returns {object} - Projectile state object
 */
export function createWeaponProjectile(id, type, owner, target = null) {
  const stats = WEAPON_STATS[type];
  
  // Calculate firing direction (owner's forward vector)
  const forwardX = -Math.sin(owner.rotY);
  const forwardZ = -Math.cos(owner.rotY);
  
  // For homing missiles, store target reference
  let targetId = null;
  if (target && type === WEAPON_HOMING_MISSILE) {
    targetId = target.id;
  }
  
  return {
    id,
    type: 'PROJECTILE',
    weaponType: type,
    x: owner.x + forwardX * 3,  // Spawn slightly in front of owner
    y: owner.y + 0.8,           // Launch from car height
    z: owner.z + forwardZ * 3,
    rotX: 0,
    rotY: owner.rotY,
    rotZ: 0,
    speed: stats.speed,
    vx: forwardX * stats.speed, // Velocity components for homing updates
    vz: forwardZ * stats.speed,
    state: 'ACTIVE',
    modifiers: {
      owner: owner.id,
      targetId,
      timer: stats.lifetime,
      damage: stats.damage,
      blastRadius: stats.blastRadius || 0
    }
  };
}

/**
 * deployMine — Create a stationary mine at vehicle position
 * 
 * @param {string} id - Unique mine ID
 * @param {object} owner - Owner vehicle state
 * @returns {object} - Mine state object
 */
export function deployMine(id, owner) {
  const stats = WEAPON_STATS[WEAPON_MINE];
  
  return {
    id,
    type: 'TRAP',
    weaponType: WEAPON_MINE,
    x: owner.x,
    y: 0.1,  // Slightly above ground
    z: owner.z,
    rotX: 0,
    rotY: owner.rotY,
    rotZ: 0,
    speed: 0,
    state: 'ARMED',
    modifiers: {
      owner: owner.id,
      timer: stats.lifetime,
      damage: stats.damage,
      blastRadius: stats.blastRadius,
      triggerRadius: stats.triggerRadius
    }
  };
}

/**
 * activateShockwave — Return shockwave effect parameters
 * 
 * @param {object} owner - Owner vehicle state
 * @returns {object} - Shockwave effect data
 */
export function activateShockwave(owner) {
  const stats = WEAPON_STATS[WEAPON_SHOCKWAVE];
  
  return {
    type: 'SHOCKWAVE',
    x: owner.x,
    y: owner.y,
    z: owner.z,
    radius: stats.blastRadius,
    knockbackForce: stats.knockbackForce,
    owner: owner.id
  };
}

/**
 * activateEMP — Return EMP effect parameters
 * 
 * @param {object} owner - Owner vehicle state
 * @returns {object} - EMP effect data
 */
export function activateEMP(owner) {
  const stats = WEAPON_STATS[WEAPON_EMP];
  
  return {
    type: 'EMP',
    x: owner.x,
    y: owner.y,
    z: owner.z,
    radius: stats.blastRadius,
    disableDuration: stats.disableDuration,
    owner: owner.id
  };
}

/**
 * activateShield — Apply shield buff to vehicle
 * 
 * @param {object} vehicle - Vehicle to shield
 * @returns {boolean} - Success (false if already shielded)
 */
export function activateShield(vehicle) {
  if (vehicle.modifiers.shield_timer > 0) return false; // Already shielded
  
  const stats = WEAPON_STATS[WEAPON_SHIELD];
  vehicle.modifiers.shield_timer = stats.lifetime;
  vehicle.modifiers.shield_blocks = stats.blocksHits;
  return true;
}

/**
 * activateBoost — Apply boost buff to vehicle
 * 
 * @param {object} vehicle - Vehicle to boost
 * @returns {boolean} - Success
 */
export function activateBoost(vehicle) {
  const stats = WEAPON_STATS[WEAPON_BOOST];
  vehicle.modifiers.boost_timer = stats.lifetime;
  vehicle.modifiers.invincible = stats.invincible;
  vehicle.state = 'BOOSTING';
  return true;
}

/**
 * getRandomWeapon — Get random weapon based on player position (rubber-banding)
 * 
 * @param {number} position - Player race position (1 = leader, 8 = last)
 * @returns {string} - Weapon type constant
 */
export function getRandomWeapon(position) {
  const weights = ITEM_WEIGHTS_BY_POSITION[Math.min(position - 1, ITEM_WEIGHTS_BY_POSITION.length - 1)];
  
  // Weighted random selection
  const entries = Object.entries(weights);
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const [weapon, weight] of entries) {
    random -= weight;
    if (random <= 0) return weapon;
  }
  
  return WEAPON_MISSILE; // Fallback
}

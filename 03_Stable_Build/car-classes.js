/**
 * car-classes.js — Real-Life Vehicle Classes for Rumble Racing
 * 
 * WHY this module exists:
 * Your current game uses generic "kart" stats. Rumble Racing features
 * recognizable real-world cars with distinct personalities:
 * - Heavy muscle cars (high speed, low handling)
 * - Lightweight sports cars (high handling, acceleration)
 * - Balanced rally cars (all-around performance)
 * 
 * Each class has unique visual styling cues (to be implemented in renderer).
 * 
 * Stats are balanced against each other using a "power index" system
 * similar to Forza, Grid, and Need for Speed classification.
 */

// Base stat template (imported by vehicle-physics.js)
// All stats normalized so total "power index" ≈ 100 for balance

export const CAR_CLASSES = Object.freeze({
  // ── MUSCLE CARS (High Speed, Low Handling) ───────────────────────
  MUSTANG_GT: {
    name: 'Ford Mustang GT',
    category: 'MUSCLE',
    max_speed: 42,         // High top speed (m/s) ≈ 151 km/h
    acceleration: 14,      // Moderate acceleration
    handling: 2.8,         // Poor handling (wide turns)
    boost_mult: 1.35,      // Strong boost multiplier
    stunt_rate: 1.8,       // Slower rotation (heavy car)
    weight_class: 'HEAVY',
    description: 'American muscle — raw power, challenging control',
    visualCues: {
      bodyStyle: 'long_hood',
      rearWing: 'none',
      exhaustType: 'dual_round',
      primaryColor: '#C41E3A',  // Ford Red
      stripeColor: '#FFFFFF'
    }
  },
  
  CAMARO_ZL1: {
    name: 'Chevrolet Camaro ZL1',
    category: 'MUSCLE',
    max_speed: 43,
    acceleration: 13.5,
    handling: 2.6,
    boost_mult: 1.38,
    stunt_rate: 1.7,
    weight_class: 'HEAVY',
    description: 'Supercharged brute — fastest straight line, toughest cornering',
    visualCues: {
      bodyStyle: 'aggressive_front',
      rearWing: 'small_lip',
      exhaustType: 'quad_square',
      primaryColor: '#000000',  // Black
      stripeColor: '#FFD700'
    }
  },
  
  CHALLENGER_SRT: {
    name: 'Dodge Challenger SRT',
    category: 'MUSCLE',
    max_speed: 44,         // Highest top speed in class
    acceleration: 12.5,    // Slowest acceleration (heavy)
    handling: 2.4,         // Worst handling
    boost_mult: 1.4,       // Best boost compensation
    stunt_rate: 1.6,
    weight_class: 'HEAVY',
    description: 'Drag strip king — unbeatable speed, requires skill',
    visualCues: {
      bodyStyle: 'retro_classic',
      rearWing: 'integrated',
      exhaustType: 'dual_oval',
      primaryColor: '#FF8C00',  // Dodge Orange
      stripeColor: '#000000'
    }
  },
  
  // ── SPORTS CARS (High Handling, Moderate Speed) ───────────────────
  PORSCHE_911: {
    name: 'Porsche 911 Carrera',
    category: 'SPORTS',
    max_speed: 40,
    acceleration: 16,      // Quick acceleration
    handling: 4.2,         // Excellent handling
    boost_mult: 1.25,
    stunt_rate: 2.4,       // Fast rotation (lightweight)
    weight_class: 'LIGHT',
    description: 'German precision — corners like on rails',
    visualCues: {
      bodyStyle: 'sleek_curved',
      rearWing: 'active_deployable',
      exhaustType: 'center_dual',
      primaryColor: '#8B0000',  // Guards Red
      stripeColor: null
    }
  },
  
  SUPRA_MK5: {
    name: 'Toyota Supra MK5',
    category: 'SPORTS',
    max_speed: 39,
    acceleration: 17,      // Best acceleration in class
    handling: 4.0,
    boost_mult: 1.28,
    stunt_rate: 2.5,
    weight_class: 'LIGHT',
    description: 'JDM legend — explosive acceleration, tuner favorite',
    visualCues: {
      bodyStyle: 'angular_aggressive',
      rearWing: 'large_fixed',
      exhaustType: 'center_quad',
      primaryColor: '#FF0000',  // Renaissance Red
      stripeColor: '#FFFFFF'
    }
  },
  
  NSX_TYPE_S: {
    name: 'Acura NSX Type S',
    category: 'SPORTS',
    max_speed: 41,
    acceleration: 16.5,
    handling: 4.3,         // Best handling in game
    boost_mult: 1.22,
    stunt_rate: 2.6,       // Fastest rotation
    weight_class: 'LIGHT',
    description: 'Hybrid supercar — technical mastery, perfect balance',
    visualCues: {
      bodyStyle: 'low_wedge',
      rearWing: 'integrated_ducktail',
      exhaustType: 'quad_round',
      primaryColor: '#0033A0',  // Acura Blue
      stripeColor: null
    }
  },
  
  // ── RALLY CARS (Balanced, All-Terrain) ────────────────────────────
  SUBARU_WRX_STI: {
    name: 'Subaru WRX STI',
    category: 'RALLY',
    max_speed: 38,
    acceleration: 15,
    handling: 3.6,
    boost_mult: 1.3,
    stunt_rate: 2.1,
    weight_class: 'MEDIUM',
    description: 'Rally champion — balanced performance, AWD grip',
    visualCues: {
      bodyStyle: 'sedan_sport',
      rearWing: 'large_high_mounted',
      exhaustType: 'single_large',
      primaryColor: '#005BBB',  // Subaru Blue
      stripeColor: '#FFD700'
    }
  },
  
  LANCER_EVO_X: {
    name: 'Mitsubishi Lancer Evo X',
    category: 'RALLY',
    max_speed: 37.5,
    acceleration: 15.5,
    handling: 3.7,
    boost_mult: 1.32,
    stunt_rate: 2.2,
    weight_class: 'MEDIUM',
    description: 'Rival to Subaru — slightly faster accel, similar grip',
    visualCues: {
      bodyStyle: 'aggressive_sedan',
      rearWing: 'carbon_fiber_large',
      exhaustType: 'twin_center',
      primaryColor: '#E60012',  // Rally Red
      stripeColor: '#000000'
    }
  },
  
  FOCUS_RS: {
    name: 'Ford Focus RS',
    category: 'RALLY',
    max_speed: 36,
    acceleration: 14.5,
    handling: 3.8,         // Best handling in rally class
    boost_mult: 1.35,
    stunt_rate: 2.3,
    weight_class: 'MEDIUM',
    description: 'Hot hatch hero — drift-ready, playful handling',
    visualCues: {
      bodyStyle: 'hatchback_compact',
      rearWing: 'moderate_lip',
      exhaustType: 'dual_tip',
      primaryColor: '#003478',  // Race Red
      stripeColor: '#FFFFFF'
    }
  },
  
  // ── OFF-ROAD / TRUCK CLASS (Tank-like, High Durability) ──────────
  // NOTE: Future expansion — currently same physics but higher mass
  FORD_RAPTOR: {
    name: 'Ford F-150 Raptor',
    category: 'OFFROAD',
    max_speed: 35,
    acceleration: 13,
    handling: 3.0,
    boost_mult: 1.4,       // Huge boost to compensate weight
    stunt_rate: 1.5,       // Slowest rotation (very heavy)
    weight_class: 'SUPER_HEAVY',
    description: 'Desert truck — absorbs impacts, dominates collisions',
    visualCues: {
      bodyStyle: 'truck_bed',
      rearWing: 'none',
      exhaustType: 'side_exit',
      primaryColor: '#2C3E50',  // Stealth Gray
      stripeColor: '#FF4500'
    }
  },
  
  JEEP_WRANGLER: {
    name: 'Jeep Wrangler Rubicon',
    category: 'OFFROAD',
    max_speed: 34,
    acceleration: 12,
    handling: 2.8,
    boost_mult: 1.45,
    stunt_rate: 1.4,
    weight_class: 'SUPER_HEAVY',
    description: 'Rock crawler — slowest but nearly unstoppable',
    visualCues: {
      bodyStyle: 'boxy_utility',
      rearWing: 'none',
      exhaustType: 'rear_single',
      primaryColor: '#006400',  // Army Green
      stripeColor: null
    }
  }
});

// Default car if none selected (balanced choice for new players)
export const DEFAULT_CAR_CLASS = 'SUBARU_WRX_STI';

/**
 * getCarStats — Retrieve stats for a specific car class
 * 
 * @param {string} className - Key from CAR_CLASSES (e.g., 'PORSCHE_911')
 * @returns {object} - Stats object compatible with vehicle-physics.js
 */
export function getCarStats(className) {
  const carClass = CAR_CLASSES[className] || CAR_CLASSES[DEFAULT_CAR_CLASS];
  
  return {
    max_speed: carClass.max_speed,
    acceleration: carClass.acceleration,
    handling: carClass.handling,
    boost_mult: carClass.boost_mult,
    stunt_rate: carClass.stunt_rate,
    // Additional metadata for UI/renderer
    displayName: carClass.name,
    category: carClass.category,
    weightClass: carClass.weight_class,
    visualCues: carClass.visualCues
  };
}

/**
 * getCarsByCategory — Filter cars by category for selection menu
 * 
 * @param {string} category - 'MUSCLE', 'SPORTS', 'RALLY', or 'OFFROAD'
 * @returns {Array} - Array of car class keys matching category
 */
export function getCarsByCategory(category) {
  return Object.entries(CAR_CLASSES)
    .filter(([, car]) => car.category === category)
    .map(([key]) => key);
}

/**
 * getAllCarKeys — Get all available car class identifiers
 * 
 * @returns {Array<string>} - Array of car class keys
 */
export function getAllCarKeys() {
  return Object.keys(CAR_CLASSES);
}

/**
 * compareCars — Compare two cars side-by-side (for UI)
 * 
 * @param {string} car1Key - First car class key
 * @param {string} car2Key - Second car class key
 * @returns {object} - Comparison object with stat differences
 */
export function compareCars(car1Key, car2Key) {
  const car1 = CAR_CLASSES[car1Key] || CAR_CLASSES[DEFAULT_CAR_CLASS];
  const car2 = CAR_CLASSES[car2Key] || CAR_CLASSES[DEFAULT_CAR_CLASS];
  
  return {
    car1: {
      name: car1.name,
      stats: { car1 }
    },
    car2: {
      name: car2.name,
      stats: { car2 }
    },
    differences: {
      speed: car1.max_speed - car2.max_speed,
      acceleration: car1.acceleration - car2.acceleration,
      handling: car1.handling - car2.handling,
      boost: car1.boost_mult - car2.boost_mult
    }
  };
}

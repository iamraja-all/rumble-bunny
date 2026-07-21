import { createItemState, updateItems } from './items-physics.js';
import { createVehicleState } from './vehicle-physics.js';

/**
 * test_items_v1: Test runner for headless items logic.
 */

const BALANCED_STATS = {
  max_speed: 40.0,
  acceleration: 5.0,
  handling: 1.5,
  stunt_rate: 2.0,
  weight: 1000.0,
  boost_mult: 1.5,
};

const DT = 1 / 60;

function runTests() {
  let allPassed = true;

  const assert = (condition, message) => {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
    } else {
      console.log(`❌ FAIL: ${message}`);
      allPassed = false;
    }
  };

  // ── Test 1: Item Creation ───────────────────────────────────────────
  (() => {
    const item = createItemState('I0', 'TRAP', 10, 0, 10, 0, 0);
    assert(item.id === 'I0', 'T1: Item ID matches');
    assert(item.type === 'TRAP', 'T1: Item type is TRAP');
    assert(item.x === 10 && item.y === 0 && item.z === 10, 'T1: Item position set');
  })();

  // ── Test 2: Powerup Boost increases vehicle boost timer ─────────────
  (() => {
    const v = createVehicleState('P0', BALANCED_STATS);
    v.x = 0; v.y = 0; v.z = 0; v.speed = 10;
    
    // Spawn boost item right in front of vehicle
    const item = createItemState('I0', 'POWERUP_BOOST', 0, 0, 1.0, 0, 0);
    
    const remainingItems = updateItems([item], [v], DT);
    
    assert(remainingItems.length === 0, 'T2: Item is consumed and removed');
    assert(v.state === 'BOOSTING', `T2: Vehicle enters BOOSTING state (got ${v.state})`);
    assert(v.modifiers.boost_timer === 2.0, 'T2: Boost timer set to 2.0s');
  })();

  // ── Test 3: Trap causes CRASHED state ───────────────────────────────
  (() => {
    const v = createVehicleState('P0', BALANCED_STATS);
    v.x = 0; v.y = 0; v.z = 0; v.speed = 20;
    
    const trap = createItemState('I0', 'TRAP', 0, 0, 1.5, 0, 0);
    
    const remainingItems = updateItems([trap], [v], DT);
    
    assert(remainingItems.length === 0, 'T3: Trap is consumed');
    assert(v.state === 'CRASHED', `T3: Vehicle state is CRASHED (got ${v.state})`);
    assert(v.modifiers.crash_timer === 1.5, 'T3: Crash timer is 1.5s');
    assert(v.speed === 4, `T3: Speed is reduced (got ${v.speed})`);
  })();

  // ── Test 4: Projectile travels and hits target ──────────────────────
  (() => {
    const v = createVehicleState('P0', BALANCED_STATS);
    v.x = 0; v.y = 0; v.z = -50; // Far ahead
    v.speed = 10;
    
    // Fire projectile from origin along -Z
    const rotY = Math.PI; // pointing to -Z
    const speed = 60; // faster than vehicle
    let items = [createItemState('I0', 'PROJECTILE', 0, 0, 0, rotY, speed)];
    
    // Simulate 40 frames (~0.66 seconds)
    // Projectile travels ~40 units, hasn't hit yet
    for (let i = 0; i < 40; i++) {
      items = updateItems(items, [v], DT);
    }
    
    assert(items.length === 1, 'T4: Projectile not yet consumed');
    assert(items[0].z < -30, 'T4: Projectile moved forward');
    assert(v.state === 'NORMAL', 'T4: Vehicle still normal');
    
    // Simulate 30 more frames (it should hit)
    for (let i = 0; i < 30; i++) {
      items = updateItems(items, [v], DT);
    }
    
    assert(items.length === 0, 'T4: Projectile hit and consumed');
    assert(v.state === 'CRASHED', 'T4: Target vehicle crashed');
  })();

  // ── Test 5: Airborne vehicles dodge items ───────────────────────────
  (() => {
    const v = createVehicleState('P0', BALANCED_STATS);
    v.x = 0; v.y = 5; v.z = 0; // High in air
    v.state = 'AIRBORNE';
    
    const trap = createItemState('I0', 'TRAP', 0, 0, 0, 0, 0); // Directly underneath
    
    const remainingItems = updateItems([trap], [v], DT);
    
    assert(remainingItems.length === 1, 'T5: Trap is NOT consumed');
    assert(v.state === 'AIRBORNE', 'T5: Vehicle dodges trap and remains AIRBORNE');
  })();

  // ── RESULTS ─────────────────────────────────────────────────────────
  console.log('');
  if (allPassed) {
    console.log('ALL TESTS PASSED ✅');
    process.exit(0);
  } else {
    console.log('SOME TESTS FAILED ❌');
    process.exit(1);
  }
}

runTests();

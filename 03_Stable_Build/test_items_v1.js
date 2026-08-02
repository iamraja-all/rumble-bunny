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

  // ── Test 5: State-based immunity (AIRBORNE / CRASHED) ───────────────
  //
  // WHY THIS TEST WAS REWRITTEN (2026-08-02, ADR-0009):
  // It used to place the vehicle at y=5 with the trap at y=0 and assert no hit.
  // That passed, but it proved nothing: the collision threshold is
  // (VEHICLE_RADIUS + ITEM_RADIUS)^2 = 9 and the actual squared distance was 25, so
  // checkCollision rejected it on pure distance and the `state === 'AIRBORNE'` guard
  // at items-physics.js:69 was never reached. Deleting that guard entirely left the
  // test green. It was a false pass — one of two the 2026-08-02 audit found.
  //
  // The fix is to sit the vehicle INSIDE the collision sphere (y=1 -> distSq=1 < 9)
  // so distance can no longer do the rejecting, and to include a NORMAL-state control
  // at the identical position that MUST be hit. The control is what makes this test
  // impossible to pass vacuously: if the guard is removed, T5c starts failing.
  (() => {
    const trapAt = () => createItemState('I0', 'TRAP', 0, 0, 0, 0, 0);

    // Control: same geometry, NORMAL state — the hit must land.
    const control = createVehicleState('P0', BALANCED_STATS);
    control.x = 0; control.y = 1; control.z = 0;
    control.state = 'NORMAL';
    const controlItems = updateItems([trapAt()], [control], DT);
    assert(controlItems.length === 0, 'T5a: control — a NORMAL vehicle at this exact position IS hit');
    assert(control.state === 'CRASHED', 'T5b: control — the trap crashes it');

    // AIRBORNE: identical position, so only the state guard can save it.
    const airborne = createVehicleState('P1', BALANCED_STATS);
    airborne.x = 0; airborne.y = 1; airborne.z = 0;
    airborne.state = 'AIRBORNE';
    const airborneItems = updateItems([trapAt()], [airborne], DT);
    assert(airborneItems.length === 1, 'T5c: AIRBORNE — trap is NOT consumed (guard, not distance)');
    assert(airborne.state === 'AIRBORNE', 'T5d: AIRBORNE — vehicle keeps its state');

    // CRASHED: the same guard's other half, which had zero coverage.
    const crashed = createVehicleState('P2', BALANCED_STATS);
    crashed.x = 0; crashed.y = 1; crashed.z = 0;
    crashed.state = 'CRASHED';
    const crashedItems = updateItems([trapAt()], [crashed], DT);
    assert(crashedItems.length === 1, 'T5e: CRASHED — trap is NOT consumed (no chain-stunlock)');
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

import { createVehicleState, updateVehicle, launchVehicle } from './vehicle-physics.js';

/**
 * test_vehicle_physics_v1: Test runner for headless vehicle physics.
 *
 * WHY:
 * Each test scenario validates one specific physics behavior in isolation.
 * Terminal output is binary pass/fail per R04 Defined Win.
 *
 * Big-O: O(T) where T is the number of test cases — each test runs a
 * fixed number of physics frames.
 */

// ── Shared test vehicle stats (mid-range balanced kart) ──────────────
const BALANCED_STATS = {
  max_speed: 40.0,
  acceleration: 5.0,
  handling: 1.5,
  stunt_rate: 2.0,
  weight: 1000.0,
  boost_mult: 1.5,
};

const DT = 1 / 60; // 60fps fixed timestep

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

  const approxEqual = (a, b, epsilon = 0.001) => Math.abs(a - b) < epsilon;

  // ── Test 1: Vehicle creation with correct defaults ──────────────────
  (() => {
    const v = createVehicleState('P0', BALANCED_STATS);

    assert(v.id === 'P0', 'T1: ID is P0');
    assert(v.type === 'VEHICLE', 'T1: Type is VEHICLE');
    assert(v.x === 0 && v.y === 0 && v.z === 0, 'T1: Position starts at origin');
    assert(v.speed === 0, 'T1: Speed starts at 0');
    assert(v.state === 'NORMAL', 'T1: State starts as NORMAL');
    assert(v.stats.max_speed === 40.0, 'T1: Stats are stored correctly');
  })();

  // ── Test 2: Throttle increases speed ────────────────────────────────
  (() => {
    let v = createVehicleState('P0', BALANCED_STATS);
    const input = { throttle: 1.0, brake: 0, steer: 0, drift: false };

    // Simulate 60 frames (1 second) of full throttle
    for (let i = 0; i < 60; i++) {
      v = updateVehicle(v, input, DT);
    }

    assert(v.speed > 0, 'T2: Speed increases with throttle');
    assert(v.speed <= BALANCED_STATS.max_speed, 'T2: Speed does not exceed max_speed');
    assert(v.z < 0, 'T2: Vehicle moves in -Z direction (forward) at yaw=0');
  })();

  // ── Test 3: Speed capped at max_speed ───────────────────────────────
  (() => {
    let v = createVehicleState('P0', BALANCED_STATS);
    const input = { throttle: 1.0, brake: 0, steer: 0, drift: false };

    // Simulate 600 frames (10 seconds) — way past reaching max speed
    for (let i = 0; i < 600; i++) {
      v = updateVehicle(v, input, DT);
    }

    assert(
      approxEqual(v.speed, BALANCED_STATS.max_speed, 0.5),
      `T3: Speed caps at max_speed (got ${v.speed.toFixed(2)}, expected ~${BALANCED_STATS.max_speed})`
    );
  })();

  // ── Test 4: Brake decelerates vehicle ───────────────────────────────
  (() => {
    let v = createVehicleState('P0', BALANCED_STATS);

    // First accelerate for 1 second
    for (let i = 0; i < 60; i++) {
      v = updateVehicle(v, { throttle: 1.0, brake: 0, steer: 0, drift: false }, DT);
    }
    const speedBeforeBrake = v.speed;

    // Now brake for 0.5 seconds
    for (let i = 0; i < 30; i++) {
      v = updateVehicle(v, { throttle: 0, brake: 1.0, steer: 0, drift: false }, DT);
    }

    assert(v.speed < speedBeforeBrake, `T4: Brake reduces speed (${v.speed.toFixed(2)} < ${speedBeforeBrake.toFixed(2)})`);
    assert(v.speed >= 0, 'T4: Speed never goes negative');
  })();

  // ── Test 5: Steering changes yaw (rotY) ────────────────────────────
  (() => {
    let v = createVehicleState('P0', BALANCED_STATS);

    // Accelerate first (steering needs speed)
    for (let i = 0; i < 60; i++) {
      v = updateVehicle(v, { throttle: 1.0, brake: 0, steer: 0, drift: false }, DT);
    }
    const yawBeforeSteer = v.rotY;

    // Steer right for 1 second
    for (let i = 0; i < 60; i++) {
      v = updateVehicle(v, { throttle: 1.0, brake: 0, steer: 1.0, drift: false }, DT);
    }

    assert(v.rotY !== yawBeforeSteer, 'T5: Steering changes rotY');
    assert(v.rotY > yawBeforeSteer, 'T5: Positive steer increases yaw (turns right)');
  })();

  // ── Test 6: Drift mode increases steering rate ──────────────────────
  (() => {
    let vNormal = createVehicleState('P0', BALANCED_STATS);
    let vDrift = createVehicleState('P1', BALANCED_STATS);

    // Accelerate both to same speed (needs to be > 30% of max_speed to drift)
    for (let i = 0; i < 180; i++) {
      vNormal = updateVehicle(vNormal, { throttle: 1.0, brake: 0, steer: 0, drift: false }, DT);
      vDrift = updateVehicle(vDrift, { throttle: 1.0, brake: 0, steer: 0, drift: false }, DT);
    }

    // Steer both right for 30 frames — one with drift, one without
    for (let i = 0; i < 30; i++) {
      vNormal = updateVehicle(vNormal, { throttle: 1.0, brake: 0, steer: 1.0, drift: false }, DT);
      vDrift = updateVehicle(vDrift, { throttle: 1.0, brake: 0, steer: 1.0, drift: true }, DT);
    }

    assert(
      Math.abs(vDrift.rotY) > Math.abs(vNormal.rotY),
      `T6: Drift steering turns more than normal (drift=${vDrift.rotY.toFixed(3)} > normal=${vNormal.rotY.toFixed(3)})`
    );
  })();

  // ── Test 7: Airborne state when above ground ────────────────────────
  (() => {
    let v = createVehicleState('P0', BALANCED_STATS);
    v = launchVehicle(v, 15); // launch upward at 15 m/s

    v = updateVehicle(v, { throttle: 0, brake: 0, steer: 0, drift: false }, DT);

    assert(v.y > 0, `T7: Vehicle is above ground (y=${v.y.toFixed(3)})`);
    assert(v.state === 'AIRBORNE', `T7: State is AIRBORNE (got ${v.state})`);
  })();

  // ── Test 8: Gravity brings vehicle back to ground ───────────────────
  (() => {
    let v = createVehicleState('P0', BALANCED_STATS);
    v = launchVehicle(v, 10); // moderate launch

    // Simulate until landed (max 300 frames = 5 seconds)
    let landed = false;
    for (let i = 0; i < 300; i++) {
      v = updateVehicle(v, { throttle: 0, brake: 0, steer: 0, drift: false }, DT);
      if (v.y <= 0 && v.state !== 'AIRBORNE') {
        landed = true;
        break;
      }
    }

    assert(landed, 'T8: Vehicle lands back on ground after launch');
    assert(v.y === 0, `T8: Vehicle Y snaps to ground (y=${v.y})`);
  })();

  // ── Test 9: Successful stunt landing awards boost ───────────────────
  (() => {
    let v = createVehicleState('P0', BALANCED_STATS);
    v = launchVehicle(v, 15); // Need enough air time to complete a flip

    // Simulate airborne rotation (pitch forward)
    for (let i = 0; i < 300; i++) {
      v = updateVehicle(v, { throttle: 1.0, brake: 0, steer: 0, drift: false }, DT); // Throttle pitches forward
      if (v.state !== 'AIRBORNE') break;
    }

    assert(v.state === 'BOOSTING', `T9: Successful landing with stunts gives BOOSTING (got ${v.state})`);
    assert(
      v.modifiers.boost_timer > 0,
      `T9: Boost timer > 0 (got ${v.modifiers.boost_timer.toFixed(2)})`
    );
    assert(v.modifiers.stunts === 0, 'T9: Stunt counter resets after landing');
  })();

  // ── Test 10: Failed stunt landing causes CRASHED ────────────────────
  (() => {
    let v = createVehicleState('P0', BALANCED_STATS);
    v = launchVehicle(v, 10);
    v.rotX = Math.PI / 2; // 90 degrees pitch — way outside 30° tolerance

    // Run one frame to get airborne, then simulate until ground
    v = updateVehicle(v, { throttle: 0, brake: 0, steer: 0, drift: false }, DT);

    // Keep the bad pitch angle while falling
    for (let i = 0; i < 300; i++) {
      // Re-apply bad pitch each frame to simulate a failed flip
      v.rotX = Math.PI / 2;
      v = updateVehicle(v, { throttle: 0, brake: 0, steer: 0, drift: false }, DT);
      if (v.state === 'CRASHED') break;
    }

    assert(v.state === 'CRASHED', `T10: Bad landing angle causes CRASHED (got ${v.state})`);
    assert(v.modifiers.crash_timer > 0, 'T10: Crash timer is set');
  })();

  // ── Test 11: Crash recovery timer expires and returns to NORMAL ─────
  (() => {
    let v = createVehicleState('P0', BALANCED_STATS);
    v.state = 'CRASHED';
    v.modifiers.crash_timer = 1.5;

    // Simulate 2 seconds (120 frames) — recovery is 1.5s
    for (let i = 0; i < 120; i++) {
      v = updateVehicle(v, { throttle: 1.0, brake: 0, steer: 1.0, drift: false }, DT);
    }

    assert(v.state === 'NORMAL', `T11: Vehicle recovers from CRASHED after timer (got ${v.state})`);
    assert(v.modifiers.crash_timer === 0, 'T11: Crash timer is zero after recovery');
  })();

  // ── Test 12: Steering while airborne spins the vehicle (stunt) ──────
  (() => {
    let v = createVehicleState('P0', BALANCED_STATS);
    v.speed = 20;
    v = launchVehicle(v, 15);
    v = updateVehicle(v, { throttle: 0, brake: 0, steer: 0, drift: false }, DT);
    const yawAtLaunch = v.rotY;

    // Steer while airborne for 30 frames
    for (let i = 0; i < 30; i++) {
      v = updateVehicle(v, { throttle: 0, brake: 0, steer: 1.0, drift: false }, DT);
    }

    assert(v.rotY !== yawAtLaunch, 'T12: Steering spins the vehicle while airborne');
  })();

  // ── Test 13: No throttle while airborne ─────────────────────────────
  (() => {
    let v = createVehicleState('P0', BALANCED_STATS);
    v.speed = 20;
    v = launchVehicle(v, 15);
    v = updateVehicle(v, { throttle: 0, brake: 0, steer: 0, drift: false }, DT);
    const speedAtLaunch = v.speed;

    // Full throttle while airborne for 30 frames
    for (let i = 0; i < 30; i++) {
      v = updateVehicle(v, { throttle: 1.0, brake: 0, steer: 0, drift: false }, DT);
    }

    assert(v.speed === speedAtLaunch, `T13: Throttle has no effect while airborne (speed unchanged at ${speedAtLaunch.toFixed(2)})`);
  })();

  // ── Test 14: Boosting raises speed ceiling ──────────────────────────
  (() => {
    let v = createVehicleState('P0', BALANCED_STATS);
    v.state = 'BOOSTING';
    v.modifiers.boost_timer = 3.0;
    v.speed = BALANCED_STATS.max_speed; // Start at normal max speed

    // Full throttle for 2.5 seconds (150 frames) so boost does not expire
    for (let i = 0; i < 150; i++) {
      v = updateVehicle(v, { throttle: 1.0, brake: 0, steer: 0, drift: false }, DT);
    }

    const boostedMax = BALANCED_STATS.max_speed * BALANCED_STATS.boost_mult;
    assert(
      v.speed > BALANCED_STATS.max_speed,
      `T14: Boosting allows speed above normal max (${v.speed.toFixed(2)} > ${BALANCED_STATS.max_speed})`
    );
    assert(
      v.speed <= boostedMax + 0.5,
      `T14: Boosted speed stays within boosted ceiling (${v.speed.toFixed(2)} <= ${boostedMax})`
    );
  })();

  // ── Test 15: Friction decelerates when no input ─────────────────────
  (() => {
    let v = createVehicleState('P0', BALANCED_STATS);

    // Accelerate for 1 second
    for (let i = 0; i < 60; i++) {
      v = updateVehicle(v, { throttle: 1.0, brake: 0, steer: 0, drift: false }, DT);
    }
    const peakSpeed = v.speed;

    // Coast with no input for 1 second
    for (let i = 0; i < 60; i++) {
      v = updateVehicle(v, { throttle: 0, brake: 0, steer: 0, drift: false }, DT);
    }

    assert(
      v.speed < peakSpeed,
      `T15: Friction slows vehicle when coasting (${v.speed.toFixed(2)} < ${peakSpeed.toFixed(2)})`
    );
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

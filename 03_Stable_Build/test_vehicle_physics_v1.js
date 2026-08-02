import { createVehicleState, updateVehicle, launchVehicle, applyCarCollisions, VEHICLE_RADIUS } from './vehicle-physics.js';

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
    const speedBeforeSteer = v.speed;

    // Steer right for 1 second
    for (let i = 0; i < 60; i++) {
      v = updateVehicle(v, { throttle: 1.0, brake: 0, steer: 1.0, drift: false }, DT);
    }

    const yawDelta = v.rotY - yawBeforeSteer;

    // WHY THIS ASSERTION WAS INVERTED (fixed 2026-08-02, ADR-0009):
    // This test asserted `v.rotY > yawBeforeSteer` and had been failing for days.
    // The test was wrong, not the engine. domain/spec.md section 1 fixes the world
    // as Right-Handed, Y-Up: point your right thumb along +Y and your fingers curl
    // counter-clockwise as seen from above, which is the direction of positive rotY
    // — and counter-clockwise from above is a LEFT turn. So steer = +1, meaning
    // RIGHT, must DECREASE rotY. vehicle-physics.js:191-194 does exactly that and
    // says so. The engine is authoritative here because its reasoning is the one
    // that matches the spec.
    assert(yawDelta < 0, 'T5: Positive steer decreases yaw (clockwise = right turn)');

    // R04 wants an exact expected output, not just a direction. The model is
    // rotY -= handling * steer * speedFactor * dt, and speedFactor is capped at 1.0,
    // so 60 frames of full-lock steering cannot exceed this ceiling. Asserting the
    // bound catches a handling-stat or dt regression that a bare sign check misses.
    const maxYawPerSecond = BALANCED_STATS.handling * 60 * DT;
    assert(
      Math.abs(yawDelta) <= maxYawPerSecond + 1e-9,
      `T5: yaw change stays within the model ceiling of ${maxYawPerSecond.toFixed(3)} rad`
    );
    // And a lower bound derived from the model rather than guessed. Throttle is held
    // at 1.0 with no drift, so speed rises monotonically through the steering second;
    // every frame's speedFactor is therefore at least the one we started with, and
    // the summed yaw cannot come in under the value computed at the starting speed.
    const startSpeedFactor = Math.min(speedBeforeSteer / BALANCED_STATS.max_speed, 1.0);
    const minYaw = BALANCED_STATS.handling * startSpeedFactor * 60 * DT;
    assert(
      Math.abs(yawDelta) >= minYaw - 1e-9,
      `T5: yaw change is at least the ${minYaw.toFixed(3)} rad the starting speed guarantees`
    );
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

    // THE ASSERTION THAT WAS MISSING (added 2026-08-02 after a player reported it):
    // `rotY !== yawAtLaunch` is direction-blind, so it stayed green while the
    // airborne branch used `+=` against the grounded branch's `-=`. Steering
    // inverted the instant a kart left the ground — press right in the air, spin
    // left. A control that reverses mid-jump is unplayable, and no test noticed.
    assert(v.rotY < yawAtLaunch,
      `T12b: airborne steer RIGHT decreases yaw, same as on the ground (got ${(v.rotY - yawAtLaunch).toFixed(3)})`);

    // And the invariant behind it, stated directly: the same stick input must turn
    // the car the same way whether or not it is touching the track.
    let ground = createVehicleState('P1', BALANCED_STATS);
    ground.speed = 20;
    const groundYaw0 = ground.rotY;
    for (let i = 0; i < 30; i++) {
      ground = updateVehicle(ground, { throttle: 0.4, brake: 0, steer: 1.0, drift: false }, DT);
    }
    const groundDelta = ground.rotY - groundYaw0;
    const airDelta = v.rotY - yawAtLaunch;
    assert(Math.sign(groundDelta) === Math.sign(airDelta),
      `T12c: grounded and airborne steering agree in direction (ground ${groundDelta.toFixed(3)}, air ${airDelta.toFixed(3)})`);
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

  // ── Test 12: car-on-car collisions conserve momentum and respect weight ──
  //
  // WHY THIS EXISTS: applyCarCollisions used to assign BOTH karts avgSpeed * 0.5,
  // which destroyed 75% of the pair's average speed on every frame of contact and
  // ignored weight entirely, though spec.md:54 says weight "affects collision
  // impulse transfer". A 1500kg kart at 40 m/s hitting a stationary 800kg one left
  // both at 10 — the rammer punished, the victim handed free speed. Worse, in a
  // three-way bot pileup the repeated halving ground everyone to a standstill; a
  // 180-second simulation left 5 of 8 bots parked below 1 m/s.
  (() => {
    const heavy = createVehicleState('P0', { ...BALANCED_STATS, weight: 1500 });
    const light = createVehicleState('P1', { ...BALANCED_STATS, weight: 800 });

    // Head-on-to-rear: heavy is behind at 40 m/s, light is stationary just ahead.
    // rotY = 0 means heading -Z, so "ahead" is a smaller z.
    heavy.x = 0; heavy.z = 0; heavy.rotY = 0; heavy.speed = 40;
    light.x = 0; light.z = -3; light.rotY = 0; light.speed = 0;

    const pBefore = 1500 * 40 + 800 * 0;
    applyCarCollisions([heavy, light]);
    const pAfter = 1500 * heavy.speed + 800 * light.speed;

    assert(Math.abs(pAfter - pBefore) < 1e-6,
      `T12a: collision conserves momentum (${pBefore.toFixed(0)} -> ${pAfter.toFixed(0)})`);
    assert(light.speed > heavy.speed,
      `T12b: the lighter kart is knocked ahead of the heavier one (light=${light.speed.toFixed(1)}, heavy=${heavy.speed.toFixed(1)})`);
    assert(heavy.speed > 15,
      `T12c: the rammer is NOT punished down to a crawl (kept ${heavy.speed.toFixed(1)} of 40)`);
    assert(heavy.speed >= 0 && light.speed >= 0, 'T12d: no kart is reversed by a shunt');

    // Weight must actually matter — the same impact with equal masses must not
    // produce the same split as the 1500-vs-800 case above.
    const a = createVehicleState('P2', { ...BALANCED_STATS, weight: 1000 });
    const b = createVehicleState('P3', { ...BALANCED_STATS, weight: 1000 });
    a.x = 0; a.z = 0; a.rotY = 0; a.speed = 40;
    b.x = 0; b.z = -3; b.rotY = 0; b.speed = 0;
    applyCarCollisions([a, b]);
    assert(Math.abs(a.speed - heavy.speed) > 0.5,
      'T12e: weight changes the outcome (equal masses split differently from 1500 vs 800)');

    // Contact distance must match the spec, not half of it.
    assert(VEHICLE_RADIUS === 2.0, 'T12f: vehicle bounding radius is the spec.md value of 2.0');
    const far1 = createVehicleState('P4', BALANCED_STATS);
    const far2 = createVehicleState('P5', BALANCED_STATS);
    far1.x = 0; far1.z = 0; far1.speed = 30; far1.rotY = 0;
    far2.x = 0; far2.z = -3.5; far2.speed = 0; far2.rotY = 0;
    applyCarCollisions([far1, far2]);
    assert(far2.speed > 0,
      'T12g: karts 3.5m apart DO collide (combined radius is 4.0, not the old 2.0)');

    // Already separating: no further momentum exchange.
    const s1 = createVehicleState('P6', BALANCED_STATS);
    const s2 = createVehicleState('P7', BALANCED_STATS);
    s1.x = 0; s1.z = 0; s1.rotY = Math.PI; s1.speed = 20;  // facing +Z, away from s2
    s2.x = 0; s2.z = -3; s2.rotY = 0; s2.speed = 20;       // facing -Z, away from s1
    applyCarCollisions([s1, s2]);
    assert(s1.speed === 20 && s2.speed === 20,
      'T12h: karts already moving apart do not keep trading speed');
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

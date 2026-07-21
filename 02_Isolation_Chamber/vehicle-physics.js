/**
 * vehicle-physics.js — Headless Vehicle Physics Update
 *
 * WHY this module exists:
 * Every kart in the game needs deterministic physics that runs identically
 * on server and client. This module takes a vehicle state + control inputs
 * and produces the next-frame state. No rendering, no UI — pure math.
 *
 * WHY this approach (forward-Euler integration):
 * Forward-Euler is the simplest integrator that works at 60fps fixed timestep.
 * It is O(1) per vehicle per frame — no iteration, no solver. More accurate
 * integrators (Verlet, RK4) are unnecessary at 16ms steps for arcade kart
 * physics and would violate the ponytail ladder (Rung 7 vs Rung 6).
 *
 * Coordinate System: Right-Handed, Y-Up.
 *   X = right, Y = up (gravity = -Y), Z = toward camera.
 *   Yaw (rotY) = steering rotation around Y axis.
 *   Forward vector = (-sin(rotY), 0, -cos(rotY)) in this system.
 *
 * Big-O Complexity: O(1) per call — fixed number of arithmetic operations
 * per vehicle per frame. No loops. Safe for 60fps Game Loop.
 */

// WHY: Gravity constant matches Earth-like feel scaled for arcade kart speed.
// 9.81 m/s² is realistic; we use it directly since vehicle weight is in the
// stat block and this keeps the math transparent for Teach Back (R13).
const GRAVITY = 9.81;

// WHY: Ground plane at Y=0 is the simplest collision surface for headless
// testing. Real tracks will provide a height function later — this module
// accepts a ground-height parameter so it's already decoupled.
const DEFAULT_GROUND_Y = 0;

// WHY: Friction decelerates the vehicle when no throttle is applied.
// 0.98 per frame at 60fps ≈ losing ~70% speed per second, which feels
// like natural rolling resistance in arcade racers.
const FRICTION = 0.98;

// WHY: Drift multiplier reduces forward grip and increases lateral slide feel.
// The actual drift physics is simplified to a yaw-rate boost + speed penalty.
// 0.995 gives a gradual loss of speed while drifting.
const DRIFT_STEER_MULT = 1.6;
const DRIFT_SPEED_PENALTY = 0.995;

// WHY: Crash recovery time gives a penalty for failed stunt landings.
// 1.5 seconds at 60fps = 90 frames of being unable to accelerate.
const CRASH_RECOVERY_TIME = 1.5;

/**
 * createVehicleState — Factory for a new vehicle state object.
 *
 * WHY a factory instead of a class:
 * Classes encourage inheritance hierarchies and hidden state. A plain object
 * with known fields is easier to serialize to the ledger format, easier to
 * diff for netcode, and passes the ponytail Rung 6 check (one function).
 *
 * @param {string} id - Vehicle identifier (e.g. "P0")
 * @param {object} stats - Vehicle balance stats from spec.md Section 3
 * @returns {object} - Initial vehicle state
 */
export function createVehicleState(id, stats) {
  return {
    id,
    type: 'VEHICLE',
    x: 0,
    y: 0,
    z: 0,
    rotX: 0,    // pitch
    rotY: 0,    // yaw (heading)
    rotZ: 0,    // roll
    speed: 0,
    state: 'NORMAL',
    modifiers: {
      boost_timer: 0,
      crash_timer: 0,
      stunts: 0,
      takeoff_rotX: 0,
      takeoff_rotY: 0,
      takeoff_rotZ: 0,
    },
    // WHY: velocity components stored separately from speed for airborne
    // trajectory — speed is the scalar forward velocity on ground, but
    // in air we need a full velocity vector for gravity integration.
    vy: 0,
    // Stats are immutable per vehicle — stored here for self-contained updates
    stats: { ...stats },
  };
}

/**
 * updateVehicle — Advance one vehicle by one physics frame.
 *
 * WHY this is a pure function (state in, state out):
 * Deterministic netcode requires that the same inputs always produce the
 * same outputs. No external mutable state, no randomness (Gap 6), no
 * dynamic allocation inside the call.
 *
 * Big-O: O(1) — fixed arithmetic, no loops, no allocations.
 *
 * @param {object} vehicle - Current vehicle state (from createVehicleState)
 * @param {object} input - Control inputs for this frame:
 *   { throttle: 0..1, brake: 0..1, steer: -1..1, drift: bool }
 * @param {number} dt - Delta time in seconds (typically 1/60)
 * @param {number} [groundY=0] - Ground height at the vehicle's XZ position
 * @returns {object} - New vehicle state (original is not mutated)
 */
export function updateVehicle(vehicle, input, dt, groundY = DEFAULT_GROUND_Y) {
  // WHY: Shallow copy creates the next-frame state without mutating the
  // previous frame. Modifiers and stats are copied separately because
  // they are nested one level deep (ledger modifiers are flat key:value).
  const v = {
    ...vehicle,
    modifiers: { ...vehicle.modifiers },
    stats: vehicle.stats,  // stats are read-only, safe to share reference
  };

  const { throttle = 0, brake = 0, steer = 0, drift = false } = input;
  const s = v.stats;

  // ── CRASH RECOVERY ──────────────────────────────────────────────────
  // WHY: Crashed vehicles can't accelerate or steer until the recovery
  // timer expires. This is the penalty for a failed stunt landing.
  if (v.state === 'CRASHED') {
    v.modifiers.crash_timer -= dt;
    if (v.modifiers.crash_timer <= 0) {
      v.state = 'NORMAL';
      v.modifiers.crash_timer = 0;
    }
    // WHY: Even while crashed, gravity still applies if airborne somehow,
    // and friction still decelerates. Skip steering/throttle only.
    v.speed *= FRICTION;
    return applyMovement(v, dt, groundY);
  }

  // ── BOOST TIMER COUNTDOWN ───────────────────────────────────────────
  // WHY: Boost is a time-limited reward from successful stunts. It raises
  // the speed ceiling but doesn't last forever.
  if (v.modifiers.boost_timer > 0) {
    v.modifiers.boost_timer = Math.max(0, v.modifiers.boost_timer - dt);
    if (v.modifiers.boost_timer > 0 && v.state !== 'AIRBORNE') {
      v.state = 'BOOSTING';
    } else if (v.modifiers.boost_timer <= 0 && v.state === 'BOOSTING') {
      v.state = 'NORMAL';
    }
  }

  // ── SPEED CEILING ───────────────────────────────────────────────────
  // WHY: The effective max speed depends on whether the vehicle is boosting.
  // boost_mult is a stat-block multiplier (spec Section 3).
  const effectiveMaxSpeed = v.state === 'BOOSTING'
    ? s.max_speed * s.boost_mult
    : s.max_speed;

  // ── THROTTLE & BRAKE ────────────────────────────────────────────────
  // WHY: Only apply throttle/brake when on the ground. Airborne vehicles
  // can't accelerate (no traction). This is physically intuitive and
  // matches both Beach Buggy and Rumble Racing feel.
  if (v.state !== 'AIRBORNE') {
    // Accelerate: stats.acceleration * throttle input (0..1)
    v.speed += s.acceleration * throttle * dt;

    // Brake: decelerates at 2x acceleration rate for snappy arcade feel
    v.speed -= s.acceleration * 2 * brake * dt;

    // Clamp speed: no reverse (min 0), no exceeding ceiling
    v.speed = Math.max(0, Math.min(v.speed, effectiveMaxSpeed));

    // Friction when no throttle applied
    if (throttle === 0 && brake === 0) {
      v.speed *= FRICTION;
    }
  }

  // ── STEERING ────────────────────────────────────────────────────────
  // WHY: Steering only works on the ground. Yaw rate is proportional to
  // handling stat and current speed (can't turn while stationary).
  // Speed factor is normalized to max_speed so handling feels consistent.
  if (v.state !== 'AIRBORNE' && v.state !== 'CRASHED') {
    const speedFactor = Math.min(v.speed / s.max_speed, 1.0);
    let steerRate = s.handling * steer * speedFactor * dt;

    // ── DRIFT STATE ─────────────────────────────────────────────────
    if (drift && v.speed > s.max_speed * 0.3) {
      v.state = v.state === 'BOOSTING' ? 'BOOSTING' : 'DRIFT';
      steerRate *= DRIFT_STEER_MULT;
      v.speed *= DRIFT_SPEED_PENALTY;
    } else if (v.state === 'DRIFT') {
      v.state = 'NORMAL';
    }

    v.rotY += steerRate;
  } else if (v.state === 'AIRBORNE') {
    // ── STUNT DETECTION (AIRBORNE ONLY) ─────────────────────────────
    // In air, steering input translates to stunt rotation (flips/spins)
    const stuntMultiplier = s.stunt_rate * dt * 2.0; // Base turning speed in air
    
    // For testing, throttle/brake controls pitch (flips), steer controls yaw (spins/rolls)
    v.rotX += (throttle - brake) * stuntMultiplier;
    v.rotY += steer * stuntMultiplier;

    // Check for completed 360-degree rotations (2π radians)
    // We compare current absolute rotation against the rotation when we took off
    const deltaX = Math.abs(v.rotX - v.modifiers.takeoff_rotX);
    const deltaY = Math.abs(v.rotY - v.modifiers.takeoff_rotY);
    const deltaZ = Math.abs(v.rotZ - v.modifiers.takeoff_rotZ);

    const TWO_PI = 2 * Math.PI;
    const totalRotations = Math.floor(deltaX / TWO_PI) + Math.floor(deltaY / TWO_PI) + Math.floor(deltaZ / TWO_PI);
    
    // Only increment stunt counter if we crossed a new 2π threshold
    if (totalRotations > v.modifiers.stunts) {
      v.modifiers.stunts = totalRotations;
    }
  }

  return applyMovement(v, dt, groundY);
}

/**
 * applyMovement — Translate position from speed + heading, apply gravity.
 *
 * WHY separated from updateVehicle:
 * Movement integration is shared between normal updates and crash-recovery
 * updates. Extracting it avoids code duplication (ponytail Rung 2).
 *
 * Big-O: O(1) — three trig calls + arithmetic.
 *
 * @param {object} v - Vehicle state (mutated in place for perf — caller
 *   already created a shallow copy)
 * @param {number} dt - Delta time in seconds
 * @param {number} groundY - Ground height at vehicle's XZ
 * @returns {object} - The same vehicle object with updated position
 */
function applyMovement(v, dt, groundY) {
  // WHY: Forward vector in Right-Handed Y-Up:
  //   forward.x = -sin(yaw)
  //   forward.z = -cos(yaw)
  // This matches OpenGL/WebGL convention where Z+ is toward camera
  // and a yaw of 0 means facing into -Z (into the screen).
  const forwardX = -Math.sin(v.rotY);
  const forwardZ = -Math.cos(v.rotY);

  // Translate position along forward vector by current speed
  v.x += forwardX * v.speed * dt;
  v.z += forwardZ * v.speed * dt;

  // ── GRAVITY & VERTICAL MOVEMENT ─────────────────────────────────────
  // WHY: Gravity always acts. On ground, vy is clamped to 0 and y is
  // snapped to groundY. In air, vy accumulates downward and y integrates.
  v.vy -= GRAVITY * dt;
  v.y += v.vy * dt;

  // ── GROUND COLLISION ────────────────────────────────────────────────
  if (v.y <= groundY) {
    v.y = groundY;
    v.vy = 0;

    // WHY: If we were airborne and just hit the ground, this is a landing.
    // Landing check determines whether the stunt was successful or crashed.
    if (v.state === 'AIRBORNE') {
      v.state = checkLanding(v);
    }
  } else if (v.state !== 'AIRBORNE' && v.state !== 'CRASHED') {
    // WHY: If the vehicle is above ground and wasn't already airborne,
    // it just left a ramp or edge. Transition to AIRBORNE and record takeoff.
    v.state = 'AIRBORNE';
    v.modifiers.takeoff_rotX = v.rotX;
    v.modifiers.takeoff_rotY = v.rotY;
    v.modifiers.takeoff_rotZ = v.rotZ;
    v.modifiers.stunts = 0; // Reset stunts on new takeoff
  }

  return v;
}

/**
 * checkLanding — Determine if an airborne-to-ground transition is a
 * successful stunt landing or a crash.
 *
 * WHY this logic matches spec.md Section 4.3:
 * Landing pitch (rotX) and roll (rotZ) must be within ±π/6 (30°) of
 * the track normal (which is straight up = 0 for a flat ground plane).
 * Outside that tolerance = CRASHED with a recovery timer.
 *
 * Big-O: O(1)
 *
 * @param {object} v - Vehicle state at moment of ground contact
 * @returns {string} - New state: 'NORMAL' or 'CRASHED'
 */
function checkLanding(v) {
  const TOLERANCE = Math.PI / 6; // 30 degrees

  // WHY: Normalize rotations to [-π, π] range before checking tolerance.
  // Without normalization, accumulated stunt rotations (e.g. 4π from two
  // full flips) would always fail the check even if the final orientation
  // is perfectly level.
  const normPitch = normalizeAngle(v.rotX);
  const normRoll = normalizeAngle(v.rotZ);

  if (Math.abs(normPitch) <= TOLERANCE && Math.abs(normRoll) <= TOLERANCE) {
    // Successful landing — award boost from accumulated stunts
    if (v.modifiers.stunts > 0) {
      v.modifiers.boost_timer = v.modifiers.stunts * 0.75;
    }
    v.modifiers.stunts = 0;
    v.rotX = 0; // Snap to level on successful landing
    v.rotZ = 0;
    return v.modifiers.boost_timer > 0 ? 'BOOSTING' : 'NORMAL';
  } else {
    // Failed landing — crash penalty
    v.modifiers.crash_timer = CRASH_RECOVERY_TIME;
    v.modifiers.stunts = 0;
    v.modifiers.boost_timer = 0;
    v.rotX = 0;
    v.rotZ = 0;
    return 'CRASHED';
  }
}

/**
 * normalizeAngle — Wrap an angle to the [-π, π] range.
 *
 * WHY: Stunt rotations accumulate multiple full revolutions (e.g. 6π
 * for 3 flips). For landing checks we only care about the final
 * orientation relative to level, not how many times it spun.
 *
 * Big-O: O(1)
 *
 * @param {number} angle - Angle in radians
 * @returns {number} - Equivalent angle in [-π, π]
 */
function normalizeAngle(angle) {
  // WHY: Modular arithmetic approach instead of a while-loop.
  // A while-loop that subtracts 2π repeatedly would be O(n) where n is
  // the number of full rotations — forbidden inside a 60fps path.
  let a = angle % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * launchVehicle — Apply an upward impulse to make a vehicle airborne.
 *
 * WHY this is a separate utility:
 * Ramps, bumps, and boost pads all need to launch vehicles. Rather than
 * duplicating the vy assignment in each caller, this is a single shared
 * function (ponytail Rung 6 — one line would do, but the WHY comment
 * requirement from R08 means a named function is clearer).
 *
 * Big-O: O(1)
 *
 * @param {object} vehicle - Vehicle state (mutated)
 * @param {number} upwardSpeed - Vertical velocity in m/s
 * @returns {object} - Same vehicle with vy set
 */
export function launchVehicle(vehicle, upwardSpeed) {
  vehicle.vy = upwardSpeed;
  vehicle.state = 'AIRBORNE';
  vehicle.modifiers.takeoff_rotX = vehicle.rotX;
  vehicle.modifiers.takeoff_rotY = vehicle.rotY;
  vehicle.modifiers.takeoff_rotZ = vehicle.rotZ;
  vehicle.modifiers.stunts = 0;
  return vehicle;
}

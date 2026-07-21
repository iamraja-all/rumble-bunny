import { CHECKPOINTS, FINISH_LINE } from './race.js';

/**
 * Headless Bot AI
 * 
 * WHY:
 * Calculates simulated inputs for non-human players.
 * Since the physics and race systems are completely headless and deterministic,
 * bots just generate { throttle, brake, steer, drift } inputs like a real player.
 */

export class BotController {
  constructor(clientId) {
    this.clientId = clientId;
    this.reactionDelay = Math.random() * 0.2; // some bots react slightly slower
    this.targetOffset = (Math.random() - 0.5) * 10; // aim for different parts of the gate
    this.driftPropensity = Math.random(); // some bots like to drift
  }

  /**
   * generateInput
   * Calculates the steering needed to hit the next checkpoint.
   */
  generateInput(vehicle, raceState, raceInfo) {
    const input = { throttle: 0, brake: 0, steer: 0, drift: false };

    // Don't drive if race is over or hasn't started
    if (raceInfo.state !== 'RACING') {
      return input;
    }

    // Always floor it (we are bots, we don't brake!)
    input.throttle = 1.0;

    // Determine target gate
    let targetZ = 0;
    if (raceState.nextCheckpoint < CHECKPOINTS.length) {
      targetZ = CHECKPOINTS[raceState.nextCheckpoint].z;
    } else {
      targetZ = FINISH_LINE.z;
    }

    // Calculate angle to target
    // The track is a straight line along the Z axis, going negative.
    // So the target is at (0 + offset, targetZ).
    const dx = this.targetOffset - vehicle.x;
    const dz = targetZ - vehicle.z;
    
    // Math.atan2(dx, dz) gives the angle in radians.
    // However, our vehicle rotation system uses standard Euler angles where 
    // facing -Z is a rotation of 0.
    // Let's calculate the desired yaw.
    const desiredYaw = Math.atan2(-dx, -dz);

    // Calculate difference between current yaw and desired yaw
    let diff = desiredYaw - vehicle.rotY;

    // Normalize angle difference to [-PI, PI]
    while (diff <= -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;

    // Steer towards target
    if (diff > 0.1) {
      input.steer = -1.0; // Steer left (increases rotY in our system)
    } else if (diff < -0.1) {
      input.steer = 1.0;  // Steer right (decreases rotY in our system)
    } else {
      input.steer = 0.0;
    }

    // Bots drift on sharp turns (if their propensity is high)
    if (Math.abs(diff) > 0.5 && this.driftPropensity > 0.5) {
      input.drift = true;
    }

    return input;
  }
}

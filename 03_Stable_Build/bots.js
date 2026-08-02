import { getCurrentGate } from './circuit-track.js';

export function getBotTarget(raceState) {
  const gate = getCurrentGate(raceState.trackProgress);
  return gate.center;
}

export class BotController {
  constructor(clientId) {
    this.clientId = clientId;
    this.reactionDelay = Math.random() * 0.2;
    this.targetOffset = (Math.random() - 0.5) * 10;
    this.driftPropensity = Math.random();
  }

  generateInput(vehicle, raceState, raceInfo) {
    const input = { throttle: 0, brake: 0, steer: 0, drift: false };

    if (raceInfo.state !== 'RACING') {
      return input;
    }

    input.throttle = 1.0;

    const target = getBotTarget(raceState);
    const targetX = target.x + this.targetOffset;
    const targetZ = target.z; // we keep offset purely on X for simplicity, or we can use normal

    const dx = targetX - vehicle.x;
    const dz = targetZ - vehicle.z;
    
    const desiredYaw = Math.atan2(-dx, -dz);
    let diff = desiredYaw - vehicle.rotY;

    while (diff <= -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;

    if (diff > 0.1) {
      input.steer = -1.0;
    } else if (diff < -0.1) {
      input.steer = 1.0;
    } else {
      input.steer = 0.0;
    }

    if (Math.abs(diff) > 0.5 && this.driftPropensity > 0.5) {
      input.drift = true;
    }

    return input;
  }
}

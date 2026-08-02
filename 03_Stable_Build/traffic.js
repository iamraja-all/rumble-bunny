import { createVehicleState } from './vehicle-physics.js';
import { BotController } from './bots.js';
import { createCircuitProgress, advanceCircuitProgress } from './circuit-track.js';

export function createTrafficVehicles(baseStats) {
  const traffic = [];
  
  for (let i = 1; i <= 3; i++) {
    const id = `T${i}`;
    const vehicle = createVehicleState(id, baseStats);
    
    // Spread them out, e.g. starting at Z = -50, -110, -170
    // But since the new track is a loop, we can just put them somewhere
    vehicle.x = (i % 2 === 0) ? -4 : 4;
    vehicle.y = 0;
    vehicle.z = -50 - (i * 60);

    const bot = new BotController(id);
    const progress = createCircuitProgress();

    traffic.push({ id, vehicle, progress, bot, previousPos: { x: vehicle.x, z: vehicle.z } });
  }

  return traffic;
}

export function updateTrafficVehicle(t, dt) {
  // Traffic doesn't need raceInfo since they are always driving
  const dummyRaceState = { trackProgress: t.progress, nextCheckpoint: t.progress.clearedGateCount };
  const dummyRaceInfo = { state: 'RACING' };

  let input = t.bot.generateInput(t.vehicle, dummyRaceState, dummyRaceInfo);
  // Cap throttle to make them slow obstacles
  input.throttle = 0.3;
  input.drift = false;

  return input;
}

export function advanceTrafficProgress(t) {
  const currentPos = { x: t.vehicle.x, z: t.vehicle.z };
  const { progress } = advanceCircuitProgress(t.progress, t.previousPos, currentPos);
  t.progress = progress;
  t.previousPos = currentPos;
}

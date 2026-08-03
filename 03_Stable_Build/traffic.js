import { createVehicleState } from './vehicle-physics.js';
import { BotController } from './bots.js';
import { CIRCUIT_DEF, createCircuitProgressAt, advanceCircuitProgress } from './circuit-track.js';

/**
 * Where traffic joins the circuit — three gates spread around the MAIN route.
 *
 * WHY THIS REPLACED `z = -50 - i * 60`: that line was written for the straight drag
 * strip and its own comment said as much ("since the new track is a loop, we can
 * just put them somewhere"). On the coastal circuit it put T3 at z = -230, which is
 * 205 m from the playfield centre (0, -25) — fifty metres OUTSIDE the 155 m island.
 * `validateCircuitDefinition` already refuses to boot if a gate or a player spawn
 * lands out there, but traffic is not a registered racer, so `_enforcePlayfield`
 * never rescues it: that car sat off the edge of the world for the entire race,
 * every race, and was still broadcast to all eight clients. Found by
 * test_traffic_v1.js T2 on its first run.
 *
 * Anchoring to gates instead of raw coordinates also means traffic follows the track
 * if the track ever moves, and the cars are spread around the lap so a player meets
 * them at three different places rather than as one cluster beside the grid.
 */
const TRAFFIC_START_GATES = ['coast-west', 'north', 'harbor-merge'];

// Metres upstream of its gate, and metres off the racing line. Both stay well
// inside the narrowest gate half-width (9 m) so a car is always on tarmac.
const TRAFFIC_UPSTREAM = 12;
const TRAFFIC_LATERAL = 6;

export function createTrafficVehicles(baseStats) {
  const traffic = [];

  for (let i = 1; i <= 3; i++) {
    const id = `T${i}`;
    const vehicle = createVehicleState(id, baseStats);

    const gateId = TRAFFIC_START_GATES[i - 1];
    const gate = CIRCUIT_DEF.gates.find((g) => g.id === gateId);

    // Sit back from the gate along its normal (so the car is on the approach, not
    // straddling the line) and step sideways along the gate's tangent, alternating
    // sides so two cars never share a lane.
    const side = i % 2 === 0 ? -1 : 1;
    vehicle.x = gate.center.x - gate.normal.x * TRAFFIC_UPSTREAM + -gate.normal.z * TRAFFIC_LATERAL * side;
    vehicle.z = gate.center.z - gate.normal.z * TRAFFIC_UPSTREAM + gate.normal.x * TRAFFIC_LATERAL * side;
    vehicle.y = 0;
    // Face the gate it is driving at. Same formula race.js._respawn uses, so there
    // is one definition of "pointing along a gate normal" in the engine — a car
    // spawned at the default rotY = 0 would set off perpendicular to the road.
    vehicle.rotY = Math.atan2(-gate.normal.x, -gate.normal.z);

    const bot = new BotController(id);
    const progress = createCircuitProgressAt(gateId);

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

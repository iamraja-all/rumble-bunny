import { createVehicleState } from './vehicle-physics.js';
import { serializeLedger, parseLedger } from './ledger.js';
import { CIRCUIT_DEF } from './circuit-track.js';

const MAX_PLAYERS = CIRCUIT_DEF.spawnPositions.length;
const START_POSITIONS = CIRCUIT_DEF.spawnPositions;

export class Lobby {
  constructor(roomName, baseStats) {
    this.roomName = roomName;
    this.baseStats = baseStats;
    this.players = new Map();
    this.playerSlots = new Array(MAX_PLAYERS).fill(null);
  }

  join(clientId) {
    if (this.players.has(clientId)) {
      return null;
    }

    const slotIndex = this.playerSlots.indexOf(null);
    if (slotIndex === -1) {
      return null;
    }

    const pid = `P${slotIndex}`;
    const vehicle = createVehicleState(pid, this.baseStats);

    const startPos = START_POSITIONS[slotIndex];
    vehicle.x = startPos.x;
    vehicle.y = startPos.y || 0;
    vehicle.z = startPos.z;

    // We also need to set the initial rotation so they face down the track
    if (startPos.rotY !== undefined) {
      vehicle.rotY = startPos.rotY;
    }

    this.playerSlots[slotIndex] = clientId;
    this.players.set(clientId, vehicle);

    return pid;
  }

  leave(clientId) {
    if (!this.players.has(clientId)) {
      return false;
    }

    const slotIndex = this.playerSlots.indexOf(clientId);
    if (slotIndex !== -1) {
      this.playerSlots[slotIndex] = null;
    }

    this.players.delete(clientId);
    return true;
  }

  getVehicle(clientId) {
    return this.players.get(clientId);
  }

  getAllVehicles() {
    const vehicles = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const clientId = this.playerSlots[i];
      if (clientId) {
        vehicles.push(this.players.get(clientId));
      }
    }
    return vehicles;
  }

  getLedgerFrame() {
    return serializeLedger(this.getAllVehicles());
  }
}

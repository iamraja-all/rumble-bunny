import { createVehicleState } from './vehicle-physics.js';
import { serializeLedger, parseLedger } from './ledger.js';

/**
 * Lobby: Manages up to 8 players, their vehicle states, and ledger sync.
 *
 * WHY:
 * The Lobby serves as the room container for the multiplayer game session.
 * It tracks who has joined, handles generating their start positions,
 * and produces the flat ledger state for the network.
 * 
 * Big-O: O(1) for join/leave/tick. O(N) where N <= 8 for serialize/parse state.
 */

const MAX_PLAYERS = 8;
const START_POSITIONS = [
  { x: -10, y: 0, z: 0 },
  { x: 10,  y: 0, z: 0 },
  { x: -10, y: 0, z: -20 },
  { x: 10,  y: 0, z: -20 },
  { x: -10, y: 0, z: -40 },
  { x: 10,  y: 0, z: -40 },
  { x: -10, y: 0, z: -60 },
  { x: 10,  y: 0, z: -60 },
];

export class Lobby {
  constructor(roomName, baseStats) {
    this.roomName = roomName;
    this.baseStats = baseStats;
    this.players = new Map(); // ClientId (string) -> Vehicle Object
    this.playerSlots = new Array(MAX_PLAYERS).fill(null); // Array of ClientId
  }

  /**
   * Joins a player to the lobby.
   * @param {string} clientId - Unique network ID for the player.
   * @returns {string|null} - The assigned PID (e.g. 'P0'), or null if lobby is full or already joined.
   */
  join(clientId) {
    if (this.players.has(clientId)) {
      return null;
    }

    const slotIndex = this.playerSlots.indexOf(null);
    if (slotIndex === -1) {
      return null; // Lobby full
    }

    const pid = `P${slotIndex}`;
    const vehicle = createVehicleState(pid, this.baseStats);

    const startPos = START_POSITIONS[slotIndex];
    vehicle.x = startPos.x;
    vehicle.y = startPos.y;
    vehicle.z = startPos.z;

    this.playerSlots[slotIndex] = clientId;
    this.players.set(clientId, vehicle);

    return pid;
  }

  /**
   * Removes a player from the lobby.
   * @param {string} clientId - Unique network ID for the player.
   * @returns {boolean} - True if successfully removed.
   */
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

  /**
   * Returns the player's vehicle state object.
   */
  getVehicle(clientId) {
    return this.players.get(clientId);
  }

  /**
   * Retrieves all active vehicles in deterministic (slot) order.
   */
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

  /**
   * Generates the flat, pipe-delimited AI Whisperer format ledger string
   * representing the current room state.
   */
  getLedgerFrame() {
    return serializeLedger(this.getAllVehicles());
  }
}

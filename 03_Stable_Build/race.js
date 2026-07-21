/**
 * Race System — Headless Lap/Checkpoint/Finish Logic
 *
 * WHY:
 * Turns the sandbox into a structured race. This module runs entirely on
 * the server (Law 1: Headless First). The client only reads race state
 * from the ledger modifiers — it never computes laps or checkpoints.
 *
 * TRACK LAYOUT (straight-line oval):
 * Start/Finish line at Z=0, track runs into -Z, turnaround at Z=-200,
 * comes back along X=+40, turnaround at Z=0, repeat.
 *
 * For simplicity in this first version we use a linear track:
 * checkpoints are Z-gates that must be crossed in order.
 * Crossing the final checkpoint + the finish line = 1 lap.
 *
 * Big-O: O(P * C) per frame where P=players, C=checkpoints. Both are small.
 */

const TOTAL_LAPS = 3;

// Checkpoints are Z-gates spanning the full track width.
// Vehicles must cross them in order to count a lap.
const CHECKPOINTS = [
  { id: 'cp0', z: -40, width: 40 },   // Before ramp 1
  { id: 'cp1', z: -80, width: 40 },   // Mid track
  { id: 'cp2', z: -130, width: 40 },  // Before ramp 2
  { id: 'cp3', z: -180, width: 40 },  // End of track (turnaround zone)
];

// Finish line gate
const FINISH_LINE = { z: -5, width: 40 };

/**
 * createRaceState — Per-player race tracking data.
 * Stored on the vehicle's modifiers so it serializes automatically.
 */
export function createRaceState() {
  return {
    lap: 0,
    nextCheckpoint: 0,
    finished: false,
    finishTime: 0,
    bestLapTime: Infinity,
    lapStartTime: 0,
  };
}

/**
 * RaceManager — Manages race lifecycle for all players.
 */
export class RaceManager {
  constructor() {
    this.state = 'COUNTDOWN';  // COUNTDOWN -> RACING -> COMPLETE
    this.countdown = 3.0;      // 3-second countdown
    this.raceTime = 0;
    this.raceStates = new Map(); // clientId -> raceState
    this.totalLaps = TOTAL_LAPS;
    this.finishOrder = [];
  }

  registerPlayer(clientId) {
    this.raceStates.set(clientId, createRaceState());
  }

  removePlayer(clientId) {
    this.raceStates.delete(clientId);
  }

  /**
   * update — Called once per server tick.
   * Returns an object with race metadata to broadcast.
   */
  update(dt, lobby) {
    // ── COUNTDOWN ──
    if (this.state === 'COUNTDOWN') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.state = 'RACING';
        this.raceTime = 0;
        // Initialize lap start time for all players
        for (const rs of this.raceStates.values()) {
          rs.lapStartTime = 0;
        }
      }
      return;
    }

    // ── RACING ──
    if (this.state === 'RACING') {
      this.raceTime += dt;

      for (const [clientId, vehicle] of lobby.players.entries()) {
        let rs = this.raceStates.get(clientId);
        if (!rs) {
          rs = createRaceState();
          this.raceStates.set(clientId, rs);
        }

        if (rs.finished) continue;

        const vx = vehicle.x;
        const vz = vehicle.z;

        // Check next required checkpoint
        if (rs.nextCheckpoint < CHECKPOINTS.length) {
          const cp = CHECKPOINTS[rs.nextCheckpoint];
          const halfW = cp.width / 2;
          // Gate crossing: vehicle Z crosses the checkpoint Z line
          // We check if vehicle is within ±2 units of the gate Z (crossing zone)
          if (vz <= cp.z + 2 && vz >= cp.z - 2 &&
              vx >= -halfW && vx <= halfW) {
            rs.nextCheckpoint++;
          }
        }

        // All checkpoints cleared — check finish line
        if (rs.nextCheckpoint >= CHECKPOINTS.length) {
          const halfW = FINISH_LINE.width / 2;
          if (vz <= FINISH_LINE.z + 2 && vz >= FINISH_LINE.z - 2 &&
              vx >= -halfW && vx <= halfW) {
            // Lap complete!
            rs.lap++;
            rs.nextCheckpoint = 0;

            // Track best lap time
            const lapTime = this.raceTime - rs.lapStartTime;
            if (lapTime < rs.bestLapTime) {
              rs.bestLapTime = lapTime;
            }
            rs.lapStartTime = this.raceTime;

            // Check if race finished
            if (rs.lap >= this.totalLaps) {
              rs.finished = true;
              rs.finishTime = this.raceTime;
              this.finishOrder.push({
                clientId,
                pid: vehicle.id,
                time: this.raceTime,
              });

              // Check if all players finished
              const allFinished = [...this.raceStates.values()].every(r => r.finished);
              if (allFinished && this.raceStates.size > 0) {
                this.state = 'COMPLETE';
              }
            }
          }
        }

        // Write race data into vehicle modifiers so it serializes to ledger
        vehicle.modifiers.lap = rs.lap;
        vehicle.modifiers.checkpoint = rs.nextCheckpoint;
        vehicle.modifiers.race_finished = rs.finished ? 1 : 0;
        vehicle.modifiers.race_time = Math.round(this.raceTime * 10) / 10;
        vehicle.modifiers.best_lap = rs.bestLapTime === Infinity ? 0 : Math.round(rs.bestLapTime * 10) / 10;
      }
    }
  }

  /**
   * canAccelerate — Returns false during countdown (locks players in place).
   */
  canAccelerate() {
    return this.state === 'RACING' || this.state === 'COMPLETE';
  }

  getRaceInfo() {
    return {
      state: this.state,
      countdown: Math.ceil(this.countdown),
      raceTime: this.raceTime,
      totalLaps: this.totalLaps,
      finishOrder: this.finishOrder,
    };
  }
}

export { CHECKPOINTS, FINISH_LINE, TOTAL_LAPS };

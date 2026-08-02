import { advanceCircuitProgress, createCircuitProgress } from './circuit-track.js';

const TOTAL_LAPS = 3;

export function createRaceState() {
  return {
    lap: 0,
    nextCheckpoint: 0,
    route: 'UNSET',
    trackProgress: createCircuitProgress(),
    finished: false,
    finishTime: 0,
    bestLapTime: Infinity,
    lapStartTime: 0,
  };
}

export class RaceManager {
  constructor() {
    this.state = 'WAITING';
    this.countdown = 3.0;
    this.raceTime = 0;
    this.raceStates = new Map();
    this.previousPositions = new Map();
    this.totalLaps = TOTAL_LAPS;
    this.finishOrder = [];
  }

  startCountdown() {
    if (this.state === 'WAITING') {
      this.state = 'COUNTDOWN';
    }
  }

  registerPlayer(clientId) {
    this.raceStates.set(clientId, createRaceState());
    this.previousPositions.delete(clientId);
  }

  removePlayer(clientId) {
    this.raceStates.delete(clientId);
    this.previousPositions.delete(clientId);
  }

  update(dt, lobby) {
    if (this.state === 'COUNTDOWN') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.state = 'RACING';
        this.raceTime = 0;
        for (const rs of this.raceStates.values()) {
          rs.lapStartTime = 0;
        }
      }
      return;
    }

    if (this.state === 'RACING') {
      this.raceTime += dt;

      for (const [clientId, vehicle] of lobby.players.entries()) {
        let rs = this.raceStates.get(clientId);
        if (!rs) {
          rs = createRaceState();
          this.raceStates.set(clientId, rs);
        }

        if (rs.finished) continue;

        const currentPos = { x: vehicle.x, z: vehicle.z };
        const previousPos = this.previousPositions.get(clientId) || currentPos;
        this.previousPositions.set(clientId, currentPos);

        const { progress, crossedGateId, lapCompleted } = advanceCircuitProgress(rs.trackProgress, previousPos, currentPos);
        rs.trackProgress = progress;
        rs.route = progress.route;

        if (crossedGateId) {
          rs.nextCheckpoint = progress.clearedGateCount;
        }

        if (lapCompleted) {
          rs.lap++;
          const lapTime = this.raceTime - rs.lapStartTime;
          if (lapTime < rs.bestLapTime) {
            rs.bestLapTime = lapTime;
          }
          rs.lapStartTime = this.raceTime;

          if (rs.lap >= this.totalLaps) {
            rs.finished = true;
            rs.finishTime = this.raceTime;
            this.finishOrder.push({
              clientId,
              pid: vehicle.id,
              time: this.raceTime,
            });

            const allFinished = [...this.raceStates.values()].every(r => r.finished);
            if (allFinished && this.raceStates.size > 0) {
              this.state = 'COMPLETE';
            }
          }
        }

        vehicle.modifiers.lap = rs.lap;
        vehicle.modifiers.checkpoint = rs.nextCheckpoint;
        vehicle.modifiers.route = rs.route;
        vehicle.modifiers.race_finished = rs.finished ? 1 : 0;
        vehicle.modifiers.race_time = Math.round(this.raceTime * 10) / 10;
        vehicle.modifiers.best_lap = rs.bestLapTime === Infinity ? 0 : Math.round(rs.bestLapTime * 10) / 10;
      }
    }
  }

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

export { TOTAL_LAPS };

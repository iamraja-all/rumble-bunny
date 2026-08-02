import { advanceCircuitProgress, createCircuitProgress } from './circuit-track.js';

const TOTAL_LAPS = 3;

// WHY a grace window instead of waiting for everyone: a race that requires every
// entrant to finish can be held open forever by one person who stops driving. Real
// racing games close the results a fixed time after the winner crosses, and so do
// we. Counted from the FIRST finish, not the last, so the window cannot be extended
// by stragglers trickling in.
const DNF_GRACE_SECONDS = 45;

export function createRaceState() {
  return {
    lap: 0,
    nextCheckpoint: 0,
    route: 'UNSET',
    trackProgress: createCircuitProgress(),
    finished: false,
    dnf: false,
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
    // Instance field rather than a bare constant so a test can shorten the window
    // without sitting through 45 simulated seconds. See _settleCompletion.
    this.dnfGraceSeconds = DNF_GRACE_SECONDS;
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
          }
        }

        vehicle.modifiers.lap = rs.lap;
        vehicle.modifiers.checkpoint = rs.nextCheckpoint;
        vehicle.modifiers.route = rs.route;
        vehicle.modifiers.race_finished = rs.finished ? 1 : 0;
        vehicle.modifiers.race_time = Math.round(this.raceTime * 10) / 10;
        vehicle.modifiers.best_lap = rs.bestLapTime === Infinity ? 0 : Math.round(rs.bestLapTime * 10) / 10;
      }

      this._settleCompletion();
    }
  }

  /**
   * Decide whether the race is over. Runs EVERY tick while RACING.
   *
   * WHY IT IS NO LONGER INSIDE THE FINISH BRANCH:
   * this check used to live inside `if (rs.lap >= totalLaps)`, so it was only ever
   * evaluated at the instant somebody crossed the line on their final lap. Once the
   * last finisher had finished, nothing re-evaluated it — so one idle bot, one
   * stalled player, or one disconnect pinned the race in RACING permanently. A
   * 300-second simulation confirmed it: eight entrants finished and the state was
   * still RACING, and removing every unfinished entrant did not release it either.
   * Results never fired and the room needed a server restart. Evaluating on every
   * tick is what makes completion a property of the current state rather than a
   * side effect of an event that may never happen again.
   *
   * Big-O: O(P) per tick with P <= 8, no allocation. Deliberately a plain loop with
   * an early break rather than [...this.raceStates.values()].every(), which
   * allocated a fresh array on every frame inside the 60Hz path (R07).
   */
  _settleCompletion() {
    if (this.raceStates.size === 0) return;

    let allFinished = true;
    for (const rs of this.raceStates.values()) {
      if (!rs.finished) {
        allFinished = false;
        break;
      }
    }

    // Nobody home yet, or genuinely still racing — but if the grace window since the
    // FIRST finish has expired, the stragglers are recorded DNF rather than left to
    // hold the room. They are marked dnf, not silently "finished", so the results
    // screen can tell the difference between finishing last and never finishing.
    if (!allFinished && this.finishOrder.length > 0) {
      if (this.raceTime - this.finishOrder[0].time >= this.dnfGraceSeconds) {
        for (const rs of this.raceStates.values()) {
          if (!rs.finished) {
            rs.finished = true;
            rs.dnf = true;
            rs.finishTime = this.raceTime;
          }
        }
        allFinished = true;
      }
    }

    if (allFinished) {
      this.state = 'COMPLETE';
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

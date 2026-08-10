import { advanceCircuitProgress, createCircuitProgress, getLastClearedGate, CIRCUIT_DEF } from './circuit-track.js';
import { checkVehicleCollisions } from './combat-system.js';
import { updateItems } from './items-physics.js';
import { updateSpawners, createTrackState } from './track.js';
import { fireWeapon, updateProjectiles } from './weapon-firing.js';

const TOTAL_LAPS = 3;

// ── OUT-OF-BOUNDS RECOVERY ───────────────────────────────────────────────────
//
// WHY THIS EXISTS AT ALL (found by driving, 2026-08-02): hold the throttle off the
// racing line and the kart leaves the island and keeps going over open water
// forever. vehicle-physics puts the ground at a flat y = 0 everywhere, so past the
// cliff lip there is no floor to fall through, no wall to hit and nothing to stop
// you. Guardrails only line the main road, so once you are off it nothing holds
// you in. The player's race simply never recovers.
//
// WHY IT IS SOLVED HERE AND NOT WITH GEOMETRY: a physical barrier needs collision
// shapes vehicle-physics.js does not have, and a heightfield to fall into is a
// bigger change than the bug deserves. race.js already tracks per-player circuit
// progress, which is exactly the state a respawn needs — where the kart legally
// got to. Rung 2 of the ladder: the data is already here.
//
// WHY 2.5 SECONDS OF GRACE AND NOT AN INSTANT SNAP-BACK:
//   - It must never punish a wide line. It cannot: the boundary is the cliff lip,
//     55.1 m beyond the outermost guardrail at the TIGHTEST point of the lap, so
//     every drift, spin and off-road shortcut is still comfortably in bounds. The
//     timer only starts once the kart is over open sea, where there is no
//     legitimate racing to do.
//   - It must still tolerate briefly clipping the edge at speed. Max speed is
//     40 m/s, 60 m/s boosted; 2.5 s is 100-150 m of room to turn round and come
//     back, far more than the ~55 m a kart can overshoot before the boundary
//     notices it.
//   - It must not strand the player. The longest launch pad gives 2*20/9.81 =
//     4.1 s of airtime, so a huge jump that clears the coast is caught roughly
//     mid-flight rather than after a long, silent glide to nowhere.
// Below ~1 s a hard landing near the rim would yo-yo the player; above ~3 s the
// kart is far enough out that the respawn stops reading as a penalty and starts
// reading as a teleport bug.
const OUT_OF_BOUNDS_GRACE_SECONDS = 2.5;

// Hoisted and pre-squared at module load so the per-tick test is a subtraction,
// two multiplies and a compare — no property chain walk, no Math.hypot, no sqrt.
// See _enforcePlayfield for the Big-O argument.
const PLAYFIELD = CIRCUIT_DEF.playfield;
const PLAYFIELD_RADIUS_SQ = PLAYFIELD.radius * PLAYFIELD.radius;

/**
 * Which grid slot a kart belongs to, from its ledger id (P0..P7).
 *
 * WHY DERIVED FROM THE ID RATHER THAN STORED: lobby.js assigns pid `P${slotIndex}`
 * and positions the kart at spawnPositions[slotIndex] — the mapping already exists
 * and is already load-bearing. Recording it a second time in race state would be a
 * copy that can go stale. Falls back to slot 0 for anything unparseable, because a
 * respawn is a recovery path and must not throw inside the 60Hz loop.
 */
function gridSlotOf(vehicleId) {
  const slot = Number.parseInt(String(vehicleId ?? '').slice(1), 10);
  return Number.isInteger(slot) && slot >= 0 && slot < CIRCUIT_DEF.spawnPositions.length ? slot : 0;
}

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
    // Seconds this kart has been CONTINUOUSLY outside the playfield. Zeroed the
    // instant it is back in bounds, so a car that clips the edge and recovers
    // never accumulates towards a respawn.
    outOfBoundsTimer: 0,
    // Combat & weapon state
    weapons: [], // Array of weapon types available to use
    weaponCooldowns: {}, // Map of weapon type -> remaining cooldown time
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
    this.activeItems = []; // Active items/projectiles on the track
    this.trackState = createTrackState(); // Per-room item spawner timers
    // Final standings — EVERY entrant, finishers and DNFs alike. Null until the race
    // completes, then built exactly once (see _settleCompletion).
    //
    // WHY THIS EXISTS SEPARATELY FROM finishOrder: finishOrder is what it says, the
    // order people crossed the line, and nothing else belongs in it. But a results
    // screen driven by finishOrder alone shows a five-row leaderboard at the end of an
    // eight-car race and silently omits everyone who did not finish — including,
    // usually, the player reading it. ADR-0010 deliberately recorded `dnf: true`
    // rather than marking stragglers finished, precisely "so a results screen can
    // distinguish finishing last from never finishing", and then nothing ever
    // consumed it. This is the consumer.
    this.standings = null;
    // Instance field rather than a bare constant so a test can shorten the window
    // without sitting through 45 simulated seconds. See _settleCompletion.
    this.dnfGraceSeconds = DNF_GRACE_SECONDS;
    // Same reasoning, and it also lets a future game mode be stricter or looser
    // about leaving the island without editing the module. See _enforcePlayfield.
    this.outOfBoundsGraceSeconds = OUT_OF_BOUNDS_GRACE_SECONDS;
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

      // STEP 1: Collect all vehicles into an array for collision detection
      const vehicleArray = [];
      for (const [clientId, vehicle] of lobby.players.entries()) {
        const rs = this.raceStates.get(clientId);
        if (!rs || rs.finished) continue;
        vehicleArray.push(vehicle);
      }

      // STEP 2: Check and resolve vehicle-to-vehicle collisions
      // WHY: This is the CORE rumble racing mechanic - cars must bump!
      const collisionResult = checkVehicleCollisions(vehicleArray, dt);
      
      // STEP 2.5: Update item spawners and projectiles
      const newItems = updateSpawners(dt, this.activeItems, this.trackState);
      this.activeItems = this.activeItems.concat(newItems);
      
      // Update projectile positions and check collisions
      this.activeItems = updateItems(this.activeItems, vehicleArray, dt);
      
      // Update weapon projectiles (separate from items)
      const updatedProjectiles = updateProjectiles(this.activeItems, vehicleArray, dt);
      // Merge back any remaining projectiles
      this.activeItems = this.activeItems.filter(item => !item.type.startsWith('PROJECTILE_') || updatedProjectiles.includes(item));
      
      // STEP 3: Process remaining race logic (lap counting, OOB, etc.)
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

        // AFTER progress, BEFORE the modifiers are published: a kart that gets
        // respawned this tick must be broadcast at its new position in the same
        // frame, not one frame late at a coordinate it is no longer at.
        this._enforcePlayfield(dt, clientId, vehicle, rs);

        vehicle.modifiers.lap = rs.lap;
        vehicle.modifiers.checkpoint = rs.nextCheckpoint;
        vehicle.modifiers.route = rs.route;
        // `race_finished` and `race_time` used to be published here and are gone.
        // Neither was read by anything, anywhere — not one line of client code and not
        // one line of engine code. `race_time` duplicated the `RACE|` metadata line the
        // HUD already reads, and `race_finished` duplicated `raceInfo.state` plus the
        // final standings. Two keys per kart per frame for eight karts at 60Hz, for
        // nobody. Found by auditing published modifiers against consumed ones; see
        // ADR-0022 for the measured saving.
        vehicle.modifiers.best_lap = rs.bestLapTime === Infinity ? 0 : Math.round(rs.bestLapTime * 10) / 10;
        // One flag, not the raw countdown: the HUD only needs to know whether to
        // shout OUT OF BOUNDS, and the ledger is a 60Hz broadcast to eight people
        // — every extra key costs bandwidth on every frame for every player. It
        // reads 0 again on the tick the kart is respawned, because by then it is
        // back in bounds and the warning would be a lie.
        vehicle.modifiers.out_of_bounds = rs.outOfBoundsTimer > 0 ? 1 : 0;
      }

      this._settleCompletion(lobby);
    }
  }

  /**
   * Keep one kart inside the world. Runs EVERY tick while RACING, per player.
   *
   * WHY A RADIAL TEST AND NOT A ROAD TEST: the honest question is "is this kart
   * still on the island", and the island is a circle — so the honest test is one
   * distance comparison against its centre. Asking "how far is it from the road"
   * would mean scanning the road point arrays, which is O(N) per player per frame,
   * O(P*N) for the room, inside a 60Hz loop, to answer a question nobody asked:
   * being off the road is legal here. That is the R07 trap this deliberately
   * avoids. It is also the wrong RULE, not just the slow one — the 55 m shoulder
   * is part of the track experience.
   *
   * Compared squared, so there is no sqrt. Big-O: O(1) per player, O(P) per tick
   * with P <= 8 — two subtractions, two multiplies and one compare, no allocation.
   */
  _enforcePlayfield(dt, clientId, vehicle, rs) {
    const dx = vehicle.x - PLAYFIELD.centerX;
    const dz = vehicle.z - PLAYFIELD.centerZ;

    if (dx * dx + dz * dz <= PLAYFIELD_RADIUS_SQ) {
      // Back on land. WHY reset rather than decay: the rule is CONTINUOUSLY out of
      // bounds. A kart that crosses the lip, turns round and gets back is a good
      // save and owes nothing; decaying the timer would quietly punish a player
      // for a mistake they already fixed.
      rs.outOfBoundsTimer = 0;
      return;
    }

    rs.outOfBoundsTimer += dt;
    if (rs.outOfBoundsTimer < this.outOfBoundsGraceSeconds) {
      return;
    }

    this._respawn(clientId, vehicle, rs);
  }

  /**
   * Put a lost kart back on the circuit where it last legally was.
   *
   * WHY THE LAST CLEARED GATE AND NOT THE NEAREST ROAD POINT: the nearest point
   * can be on a part of the lap the kart has not earned yet — drive across the
   * middle of the island and the nearest tarmac is further round the circuit than
   * you have legitimately reached. The last cleared gate is the furthest point the
   * kart has PROVEN it got to, so a respawn can never be a shortcut. It cannot be
   * a punishment either: nothing here touches rs.lap, rs.nextCheckpoint or
   * rs.trackProgress, so the kart resumes owing exactly the gates it owed before.
   *
   * WHY THE HEADING IS atan2(-nx, -nz): a gate's normal points the way the circuit
   * runs — crossesDirectedGate only counts a crossing when the movement has a
   * positive dot with it. A kart's forward vector in this Right-Handed Y-Up world
   * is (-sin(rotY), -cos(rotY)) (vehicle-physics.js:18). Setting forward = normal
   * gives sin(rotY) = -nx and cos(rotY) = -nz, hence atan2(-nx, -nz). Getting the
   * sign wrong here would face the kart backwards down the track and would be the
   * third sign bug in this coordinate system (the inverted airborne steer shipped),
   * so T14 asserts the resulting forward vector against the normal itself rather
   * than just checking that the yaw changed. atan2 already returns [-pi, pi], which
   * is exactly what normalizeAngle would produce, so no extra wrap is needed.
   *
   * Big-O: O(G) for the gate lookup, G = 9 — but this runs on a respawn EVENT, at
   * most once per 2.5 s per player, not on the per-tick path.
   */
  _respawn(clientId, vehicle, rs) {
    const gate = getLastClearedGate(rs.trackProgress);

    let x;
    let z;
    let rotY;
    if (gate) {
      x = gate.center.x;
      z = gate.center.z;
      rotY = Math.atan2(-gate.normal.x, -gate.normal.z);
    } else {
      // Nothing cleared yet, so there is no "back where you were" — the grid is the
      // only place the kart has ever legally been. Reusing lobby.js's own mapping
      // (pid P{slot} -> spawnPositions[slot], heading straight off the line) so a
      // lap-one respawn produces exactly the state the race started in, rather than
      // inventing a second definition of "on the grid".
      const spawn = CIRCUIT_DEF.spawnPositions[gridSlotOf(vehicle.id)];
      x = spawn.x;
      z = spawn.z;
      rotY = spawn.rotY ?? 0;
    }

    vehicle.x = x;
    vehicle.z = z;
    // The drivable surface is flat at y = 0 and vehicle-physics has no heightfield,
    // so this is the ground, not an assumption about terrain.
    vehicle.y = 0;
    vehicle.rotY = rotY;
    // Level it out. Landing pitch/roll decide crash vs clean landing, and a kart
    // dropped in mid-flip would be judged for a stunt it is no longer attempting.
    vehicle.rotX = 0;
    vehicle.rotZ = 0;
    vehicle.vy = 0;

    // WHY THE SPEED GOES TO ZERO: arriving at 60 m/s pointed down an unfamiliar
    // piece of track is not a recovery, it is a second accident — and it would let
    // a player carry a boost they earned before driving into the sea.
    vehicle.speed = 0;
    vehicle.state = 'NORMAL';
    vehicle.modifiers.boost_timer = 0;
    vehicle._crashTimer = 0;
    vehicle.modifiers.stunts = 0;
    vehicle._takeoffRotX = 0;
    vehicle._takeoffRotY = 0;
    vehicle._takeoffRotZ = 0;

    rs.outOfBoundsTimer = 0;

    // WHY THIS LINE IS NOT OPTIONAL: gate crossing is tested against the SEGMENT
    // from last tick's position to this one. Without this, the next tick would test
    // the line from a point out at sea to the respawn point — a segment hundreds of
    // metres long, cutting straight across the circuit — and could credit gates the
    // kart never drove through. The teleport has to be invisible to the crossing
    // test, and that means the kart's history starts again from where it lands.
    this.previousPositions.set(clientId, { x, z });
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
  /**
   * Final standings for the results screen: every entrant, ordered the way a person
   * reads a race result — finishers by the time they crossed, then everyone who did
   * not finish, ranked by how far they actually got.
   *
   * WHY DNFs ARE RANKED AT ALL rather than dumped in registration order: on this
   * circuit a kart that completed two laps and one that never left the grid are both
   * "DNF", and showing them in an arbitrary order tells the player nothing. Laps then
   * cleared gates is the same progress measure the race itself uses, so the ordering
   * agrees with the position the player saw on the HUD a second earlier.
   *
   * Big-O: O(P log P) over P <= 8 entrants, run ONCE when the race completes — never
   * in the 60Hz path (R07).
   */
  _buildStandings(lobby) {
    const rows = [];
    for (const [clientId, rs] of this.raceStates.entries()) {
      const vehicle = lobby?.players?.get(clientId);
      rows.push({
        // Fall back to clientId only if the vehicle is already gone; a row with no
        // name at all would be worse than an ugly one.
        pid: vehicle ? vehicle.id : clientId,
        dnf: !!rs.dnf,
        // A DNF has no meaningful finish time — it holds the moment the grace window
        // expired, which is identical for every straggler and would read as a real
        // result. The client shows "DNF" instead.
        time: rs.dnf ? 0 : rs.finishTime,
        lap: rs.lap,
        gates: rs.trackProgress?.clearedGateCount ?? 0,
      });
    }

    rows.sort((a, b) => {
      if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
      if (!a.dnf) return a.time - b.time;
      if (b.lap !== a.lap) return b.lap - a.lap;
      return b.gates - a.gates;
    });

    return rows;
  }

  _settleCompletion(lobby) {
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
      // Build the standings on the TRANSITION only. _settleCompletion runs every tick
      // and the broadcast loop keeps running after the race ends, so recomputing here
      // unguarded would sort the field 60 times a second for as long as the room
      // lives (R07).
      if (this.state !== 'COMPLETE') {
        this.standings = this._buildStandings(lobby);
      }
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
      standings: this.standings,
    };
  }
}

export { TOTAL_LAPS };

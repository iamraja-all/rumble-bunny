import { roadAt } from './road-geometry_v1.js';
import { VEHICLE_RADIUS } from '../03_Stable_Build/vehicle-physics.js';

/**
 * bot-racing-line_v1 — SOLID GROUND S7: the bots learn where the road is.
 *
 * ── WHAT THE MEASUREMENTS SHOWED, AND WHAT THEY OVERTURNED ────────────────────
 *
 * The plan predicted real barriers would leave bots "grinding along walls through every
 * corner", and from a live race I reported that as a regression. Both were wrong. ADR-0011's
 * seeded 180 s sim, run in each state:
 *
 *   as committed (no S1-S4) : 1 finisher, 172 gates, 62% of the race OFF THE ROAD, 0 fell
 *   with S1-S4 active       : 5 finishers, 167 gates, 25.6% off the road, 7 of 8 FELL
 *
 * Barriers HELPED the bots — 1 finisher to 5 — by physically preventing two thirds of the
 * wandering. My "regression" came from comparing a 150 s live race against a stale
 * five-finisher figure that a later commit had already reduced to one.
 *
 * The real findings are the other two columns:
 *   1. **The bots have ALWAYS driven off the road, 62% of every race.** bots.js aims at gate
 *      centres up to 92 m apart with a random +-5 m offset applied in WORLD X, and nothing
 *      kept them on tarmac. It never showed because grass cost nothing and the world was flat.
 *   2. **Seven of eight now fall off the island**, because past the playfield is a 26 m cliff
 *      instead of more flat plane. Terrain did not cause the wandering; it made it fatal.
 *
 * So this is not a regression fix. It is the thing the other four slices made visible.
 *
 * ── A MECHANISM I BUILT AND THREW AWAY ────────────────────────────────────────
 *
 * My first attempt was pure pursuit: aim at a point on the centreline a lookahead distance
 * further round the lap, walking the polyline forward from the bot's nearest segment. It
 * measured WORSE than doing nothing — 101 gates with barriers, and **23 gates without them**
 * against a baseline of 172.
 *
 * The cause is the defect S1 recorded in its T10h. **The road TOUCHES ITSELF at the
 * start/finish line** — the duplicate (0,25) control point puts four polyline segments at
 * distance exactly zero from the timing line — so "nearest segment" is ambiguous there.
 * Probing one bot showed its index jumping 218 -> 242 -> 233 in half a second, which made
 * the lookahead target teleport around the spur instead of advancing. The bot sat at full
 * lock steering at a point beside itself.
 *
 * **Lesson: do not derive a position ALONG the lap from the nearest segment.** The nearest
 * segment gives a reliable DISTANCE (that is all S2 and S3 ever ask of it) and an unreliable
 * INDEX. Gate progress is what knows where you are round a lap, and bots.js already had it.
 *
 * ── WHAT THIS DOES INSTEAD ────────────────────────────────────────────────────
 *
 * Two terms, and it needs no lap position at all:
 *   1. keep the inner bot's gate heading — that is what already delivered 172 gates;
 *   2. add a lane-keeping term on the bot's SIGNED LATERAL OFFSET, which roadAt gives
 *      unambiguously, pulling it toward its own line on the road.
 * The seeded personality becomes WHERE that line sits between the two edges, instead of a
 * world-X offset that pushes a bot toward the outside of some corners and off the road
 * entirely where the circuit runs north-south.
 *
 * WHY IT WRAPS BotController RATHER THAN REPLACING IT: everything else in bots.js is
 * hard-won — the proportional gain that stopped the oscillation, the braking that stopped
 * the hairpin stall, the AIRBORNE guard that stopped the barrel-roll crashes, and the
 * seeded personality that makes the field reproducible (ADR-0011). Only the line was
 * missing. Rewriting the rest would re-litigate four fixed bugs.
 *
 * ⚠ R02: bots.js is in 03_Stable_Build and cannot be edited. **At promotion, fold the
 * lane-keeping term into bots.js and delete this wrapper.**
 *
 * Big-O: O(1) per bot per tick — one windowed roadAt on top of what bots.js already did.
 * No allocation beyond the input object bots.js already returns.
 */

/**
 * How hard a bot corrects back toward its line, per unit of normalised lateral error.
 *
 * The error is expressed as a FRACTION of the road's half width, so the gain means the
 * same thing on the 28 m main road and the 16 m dirt path, and would still mean it if S5
 * changes either. At 1.6, a bot one full half-width off its line asks for full lock, and
 * corrects proportionally inside that — which is the same proportional-not-bang-bang
 * reasoning ADR-0011 applied to the gate term after bang-bang made bots oscillate.
 *
 * Swept across 0.4-3.2 in the test, which prints the whole curve rather than asserting one
 * blessed number, because this is the kind of value S5's reshape will move.
 */
const CENTERING_GAIN = 2.4;

/**
 * makeRoadAwareBot — wrap a BotController so it also holds a line on the road.
 *
 * Satisfies the same `generateInput(vehicle, raceState, raceInfo)` contract the server and
 * ADR-0011's sim already call, so nothing downstream changes.
 *
 * @param {object} inner - a BotController from 03_Stable_Build/bots.js
 * @param {object} index - the road index from buildRoadIndex()
 */
export function makeRoadAwareBot(inner, index, options = {}) {
  // Both knobs are injectable ONLY so the test can sweep them and print the curve; the
  // defaults are the shipped values. No caller passes them in production.
  const gain = options.gain ?? CENTERING_GAIN;
  const lineMetres = options.lineMetres;
  return {
    inner,
    generateInput(vehicle, raceState, raceInfo) {
      // The inner bot keeps ownership of the gate heading, throttle, brake, drift, the
      // AIRBORNE guard and the not-RACING guard. Its behaviours are untouched.
      const input = inner.generateInput(vehicle, raceState, raceInfo);

      // WHY AIRBORNE IS LEFT ALONE: bots.js returns neutral input in the air on purpose —
      // steering there drives ROLL, and touching down mid-roll crashes (ADR-0011). Adding
      // a lane-keeping term would re-introduce exactly that bug.
      if (raceInfo.state !== 'RACING' || vehicle.state === 'AIRBORNE') {
        return input;
      }

      const road = roadAt(index, vehicle.x, vehicle.z, vehicle._botHint);
      vehicle._botHint = road.hint;

      // The seeded personality, reinterpreted. bots.js picks targetOffset in [-5,+5] and
      // adds it to the gate's world X. As a fraction of the road's half width it means the
      // same thing everywhere on the circuit: this bot's line sits here between the edges.
      // Reach stops short by one kart radius so the line itself is never against the steel.
      // WHY targetOffset IS USED AS METRES AND NOT AS A FRACTION OF THE ROAD: my first
      // version divided by 5 and scaled by the full reach, mapping bots.js's +-5 m spread
      // onto +-12 m — so every bot deliberately AIMED 2 m from the paint and spent 54.8% of
      // the race pressed against a barrier. The faithful reading keeps the magnitude bots.js
      // chose and only fixes its DIRECTION, from world X to across the road.
      const reach = road.halfWidth - VEHICLE_RADIUS;
      const chosen = lineMetres === undefined ? (inner.targetOffset ?? 0) : lineMetres;
      const desired = Math.max(-reach, Math.min(reach, chosen));

      // Signed lateral error, normalised by half width. roadAt's sign is the side the
      // renderer's +1 guardrail is on, so "left of my line" means the same thing here as
      // it does in barriers_v1.
      const error = (road.lateralOffset - desired) / road.halfWidth;

      // Sign: vehicle-physics does `rotY -= steerRate`, so a POSITIVE steer turns toward
      // negative lateral offset. A bot at positive error must therefore steer positive.
      // Derived, not guessed — and the test asserts it by placing a bot off each side.
      const correction = Math.max(-1, Math.min(1, error * gain));

      input.steer = Math.max(-1, Math.min(1, input.steer + correction));

      return input;
    },
  };
}

export { CENTERING_GAIN };

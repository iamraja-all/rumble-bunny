import { getCurrentGate } from './circuit-track.js';
import { normalizeAngle } from './vehicle-physics.js';

export function getBotTarget(raceState) {
  const gate = getCurrentGate(raceState.trackProgress);
  return gate.center;
}

/**
 * mulberry32 — a 5-line seeded PRNG, written from scratch per R06's no-dependency
 * mandate.
 *
 * WHY IT REPLACED Math.random(): bot personalities were the ONLY unseeded
 * randomness in the whole engine core — physics, items, race, ledger, track and
 * lobby are all clean. Because targetOffset and driftPropensity steer the field,
 * every server start produced a different race from identical code: no replay, no
 * reproducible balance test, and no way to reproduce a reported desync from a bug
 * report. That is exactly the failure RSK-003 names.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, so a bot with no explicit seed is still deterministic from its id. */
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Proportional gain on the heading error. 2.0 means the bot reaches full lock at
// half a radian of error and tracks smoothly below that.
const STEER_GAIN = 2.0;

// Above this heading error the corner is too sharp to take at speed.
const BRAKE_THRESHOLD = 0.6;
const BRAKE_GAIN = 1.2;

// Do not brake when already slow — it just stalls the bot.
const BRAKE_MIN_SPEED_FRAC = 0.4;

// Drift only in the band where it actually helps: hard enough to be a real corner,
// not so hard that the bot is turning around.
const DRIFT_MIN = 0.5;
const DRIFT_MAX = 1.2;

export class BotController {
  constructor(clientId, seed) {
    this.clientId = clientId;
    const rand = mulberry32(seed === undefined ? hashString(clientId) : seed);
    this.targetOffset = (rand() - 0.5) * 10;
    this.driftPropensity = rand();
    // `reactionDelay` used to be computed here and read nowhere. Removed.
  }

  /**
   * Produce one frame of input. Same {throttle, brake, steer, drift} contract a
   * human sends, so there is exactly one physics path for every kart.
   *
   * Big-O: O(1) — one gate lookup and fixed arithmetic. Runs per bot per frame.
   */
  generateInput(vehicle, raceState, raceInfo) {
    const input = { throttle: 0, brake: 0, steer: 0, drift: false };

    if (raceInfo.state !== 'RACING') {
      return input;
    }

    const target = getBotTarget(raceState);
    const dx = target.x + this.targetOffset - vehicle.x;
    const dz = target.z - vehicle.z;

    // Forward is (-sin(rotY), -cos(rotY)) in this Right-Handed Y-Up world, so the
    // heading that points at the target is atan2(-dx, -dz).
    const desiredYaw = Math.atan2(-dx, -dz);

    // WHY normalizeAngle instead of the two while-loops this replaced: those looped
    // ceil(|diff| / PI) times, and because nothing wrapped rotY it kept climbing all
    // session — measured at 13 iterations per bot per frame and still growing. The
    // modular version is O(1), and vehicle-physics.js already had it (Rung 2).
    const diff = normalizeAngle(desiredYaw - vehicle.rotY);
    const absDiff = Math.abs(diff);

    // WHY PROPORTIONAL AND NOT BANG-BANG: steer used to be only -1, 0 or +1 with a
    // 0.1 rad deadband, so a bot could not hold a line — it slammed full lock,
    // overshot past the deadband, slammed the other way, and oscillated. A
    // 180-second simulation showed the result: |rotY| of 142 radians and zero
    // finishers. Sign is negative because vehicle-physics does `rotY -= steerRate`,
    // so increasing rotY (diff > 0) needs a negative steer.
    input.steer = Math.max(-1, Math.min(1, -diff * STEER_GAIN));

    // WHY BRAKING EXISTS NOW: brake was hardwired to 0, so a bot approaching a
    // hairpin at max_speed physically could not slow for it. It overshot, turned
    // around, overshot again — the stall loop.
    const maxSpeed = (vehicle.stats && vehicle.stats.max_speed) || 40;
    if (absDiff > BRAKE_THRESHOLD && vehicle.speed / maxSpeed > BRAKE_MIN_SPEED_FRAC) {
      input.brake = Math.min(1, (absDiff - BRAKE_THRESHOLD) * BRAKE_GAIN);
      input.throttle = 0; // braking and flooring it at once just cancels out
    } else {
      input.throttle = 1.0;
    }

    if (absDiff > DRIFT_MIN && absDiff < DRIFT_MAX && this.driftPropensity > 0.5) {
      input.drift = true;
    }

    return input;
  }
}

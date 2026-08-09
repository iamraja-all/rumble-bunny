import { roadAt } from './road-geometry_v1.js';

/**
 * surfaces_v1 — SOLID GROUND S3: the ground under you decides what you keep.
 *
 * WHY THIS EXISTS: `vehicle-physics.js:40` has ONE friction constant for the entire
 * world, and it only applies when the throttle is released. So tarmac, dirt and grass
 * are the same substance, and the only thing that has ever cost a kart speed is
 * lifting off. S1 gave the engine a road; S2 gave it edges; this gives the ground a
 * texture.
 *
 * ── WHAT THE MEASUREMENTS CHANGED ABOUT THIS SLICE ────────────────────────────
 *
 * The plan's Defined Win for S3 was: *"a seeded headless lap driven on the racing line
 * is measurably faster than the same lap cutting every corner across the grass."*
 * That cannot be satisfied on this circuit, and the reason is worth writing down
 * because the next reader will otherwise re-plan around the same false premise.
 *
 * The MAIN road is 28 m wide and its corners are gentle. Sampling the straight-line
 * gate-to-gate chord — cutting every corner as hard as the geometry allows, which is
 * also exactly what `bots.js` steers — puts the kart on TARMAC for **100% of the lap**.
 * Not one metre of grass. There is no "cutting across the grass" line to punish,
 * because the shortest available line is on the road. The plan was written before S1
 * existed, so nothing could measure where the road was; its §1 claim that "the fastest
 * line is a straight line across the grass" is true of a narrow track and false of
 * this one. **That the racing line does not geometrically exist here is a track-SHAPE
 * finding, and belongs to S5.**
 *
 * What surfaces do change on this circuit, measured rather than assumed:
 *   - the SHORTCUT's gate-to-gate chord is **30.8% DIRT**, so the dirt path is where a
 *     grip difference has real consequence;
 *   - the shortcut is only **5.0% shorter** (427.7 m vs 450.4 m gate-to-gate), so the
 *     saving is thin enough that a modest dirt penalty turns it into a real decision
 *     instead of a free one;
 *   - GRASS is reachable, but only where S2 leaves it reachable — off the sides of the
 *     dirt path, whose edges are OPEN because `scenery.js` builds no rails there. So
 *     grass punishes sliding off the shortcut, which is precisely the gamble the
 *     shortcut is supposed to be.
 *
 * So this slice delivers per-surface grip as asked, and its Defined Win is stated
 * against what the track can actually do: the mechanism is exact on every surface,
 * tarmac is a provable no-op, leaving the road costs measurable time, and the
 * shortcut's arithmetic becomes a trade rather than a gift.
 *
 * Big-O: O(1) per kart per tick on top of one windowed `roadAt`. No allocation on the
 * tarmac path, no iteration, no `Math.random()` (RSK-003).
 */

/**
 * HOW MUCH OF ITS TOP SPEED EACH SURFACE LETS A KART HOLD.
 *
 * WHY THIS IS EXPRESSED AS A FRACTION AND NOT AS A DRAG COEFFICIENT: the number a
 * reader needs to reason about is "how fast can I go on grass", and that is what this
 * says. The drag is DERIVED from it below, so the fraction stays true for any stat
 * block — a heavier car, a faster car, or a kart under a 1.5x boost all settle at the
 * same fraction of their own ceiling instead of at some absolute speed that happened to
 * suit one stat line. `spec.md` §3 gives max_speed a [20, 60] range, so an absolute
 * number would have been wrong for most of it.
 *
 * WHY TARMAC IS 1.0 AND NOT 0.99: it must be an EXACT no-op. Every constant in
 * `vehicle-physics.js` was tuned on a flat world that was implicitly all tarmac, so
 * tarmac is the reference surface, not one choice among three. A tarmac lap after this
 * slice has to be bit-identical to a tarmac lap before it, and T2 asserts exactly that.
 *
 * WHY THESE TWO NUMBERS EXIST AT ALL, when S2 ended up needing none: a wall removes the
 * component of your motion that pointed into it, which is a geometric identity — there
 * was a right answer to derive. Grip is a material property. There is no identity that
 * says how much slower grass is than tarmac; that is a decision about the game. Forcing
 * an elegant derivation here would be inventing physics to avoid admitting a design
 * choice, so the choices are named, justified, and left where the owner can find them.
 *
 * DIRT = 0.88 — solved for, not felt. The shortcut is 427.7 m against the main route's
 *   450.4 m (5.0% shorter) and 30.8% of it is dirt, so equal steady-state lap times
 *   happen at grip = scLen*d / (mainLen - scLen*(1-d)) = 131.7 / 154.5 = **0.852**.
 *   Below that the shortcut is a pure loss and nobody takes it; far above it the
 *   shortcut is free and nobody thinks about it. 0.88 puts it **0.12 s up on an 11.26 s
 *   ideal lap — about 1%** — which is the right reward for a line that is narrower
 *   (16 m vs 28 m), unrailed on both sides, and has a jump in it.
 *   ⚠ **This number is a function of the current track geometry.** When S5 reshapes the
 *   circuit the break-even moves, and T5d is written to FAIL when it does, so the value
 *   gets re-derived instead of silently becoming wrong. My first choice was 0.85, which
 *   the test showed sits 0.001 BELOW break-even — a shortcut that loses by 0.01 s.
 *   Picking it by eye was wrong; the arithmetic was available.
 * GRASS = 0.45 — a clear penalty that is still recoverable. A kart drops to 18 of
 *   40 m/s and needs ~4.4 s of tarmac to recover, so a mistake costs a position rather
 *   than the race. This one is a genre feel call and no test can settle it; it is
 *   flagged for the play-test.
 */
export const SURFACE_GRIP = Object.freeze({
  TARMAC: 1.0,
  DIRT: 0.88,
  GRASS: 0.45,
});

/**
 * sustainableSpeed — the speed a surface lets a kart hold at full throttle.
 *
 * Exported because it is the honest way to describe what this module does, and because
 * the test asserts the equilibrium against it rather than against a magic number.
 */
export function sustainableSpeed(surface, stats) {
  const grip = SURFACE_GRIP[surface];
  return (grip === undefined ? 1 : grip) * stats.max_speed;
}

/**
 * surfaceDrag — the per-second decay that produces that equilibrium.
 *
 * DERIVED, NOT TUNED. `updateVehicle` adds `acceleration * dt` per tick while the
 * throttle is down. If this module removes `speed * drag * dt` per tick, the two
 * balance at `speed = acceleration / drag`. Setting that balance point to
 * `grip * max_speed` and solving gives the line below. So the only inputs are the
 * kart's own stat block and the one fraction above.
 *
 * (The true fixed point is a(1 - drag*dt)/drag, i.e. lower than the target by the
 * factor (1 - drag*dt) — 0.5% at 60 Hz on grass. The test asserts the exact fixed
 * point rather than pretending the approximation is exact.)
 *
 * Returns 0 for tarmac, which is what makes tarmac a no-op rather than a small tax.
 */
export function surfaceDrag(surface, stats) {
  const grip = SURFACE_GRIP[surface];
  // An unknown surface is treated as tarmac. WHY NOT THROW: roadAt only ever returns
  // the three names above, so an unknown value means a future surface was added and
  // this table was not updated — and a silently-full-grip new surface is a balance bug
  // somebody will notice, while a thrown error inside the 60 Hz loop kills the room.
  if (grip === undefined || grip >= 1) {
    return 0;
  }
  return stats.acceleration / (grip * stats.max_speed);
}

/**
 * applySurfaceDrag — charge one vehicle for the ground it is standing on.
 *
 * Call AFTER the movement integration and AFTER `resolveBarrier`, for the same reason
 * `applyCarCollisions` is called there: it acts on where the kart actually ended up,
 * and a kart that a barrier has just clamped is standing somewhere different from where
 * the integrator put it.
 *
 * MUTATES the vehicle, matching `resolveBarrier` and `applyCarCollisions` rather than
 * `updateVehicle`'s copy-and-return — a second copy per kart per tick is 480
 * allocations a second inside the 60 Hz loop (R07).
 *
 * WHY IT QUERIES THE ROAD ITSELF INSTEAD OF TAKING THE SURFACE FROM resolveBarrier's
 * REPORT: that report is a single frozen shared object on the quiet path, deliberately,
 * so that a kart nowhere near a wall costs no allocation — and it cannot carry a
 * per-kart surface without giving that up. The alternative was to fuse barriers and
 * surfaces into one pass, which welds two independently-testable slices together. So
 * this pays for a second lookup, and the lookup is windowed by the `_roadHint` that
 * `resolveBarrier` already maintains, which is why it costs 0.4 microseconds. Measured
 * rather than assumed: the duplication is free, and if it had not been, the passes
 * would have been fused.
 *
 * @param {object} vehicle - a vehicle state, positioned for this tick
 * @param {object} index - the road index from buildRoadIndex()
 * @param {number} dt - seconds this tick
 * @returns {object} { surface, dragged, speedLost } — returned rather than swallowed
 *   because a dust-plume effect, a tyre-noise cue and S7's bots all need to know what a
 *   kart is driving on, and because this project has three times shipped a value no
 *   consumer ever read. A return a caller may ignore costs nothing; a modifier on the
 *   wire costs 60 Hz x 8 clients.
 */
export function applySurfaceDrag(vehicle, index, dt) {
  // WHY AIRBORNE IS EXEMPT: there is no ground under a kart in the air. The same
  // exemption in `resolveBarrier` is what makes the jumps and the shortcut work, and
  // charging grip mid-flight would tax a kart for the terrain it happens to be over.
  if (vehicle.state === 'AIRBORNE') {
    return AIRBORNE_REPORT;
  }

  // Non-finite input fails loudly here for the same reason it does in roadAt: ADR-0012
  // lost a whole field of karts to a NaN that propagated silently for weeks.
  const road = roadAt(index, vehicle.x, vehicle.z, vehicle._roadHint);
  vehicle._roadHint = road.hint;

  const drag = surfaceDrag(road.surface, vehicle.stats);
  if (drag === 0) {
    return TARMAC_REPORT;
  }

  const before = vehicle.speed;
  // Clamped at zero so a pathologically large dt cannot reverse a kart. Arcade karts
  // do not go backwards in this engine — the same guard applyCarCollisions uses.
  const keep = 1 - drag * dt;
  vehicle.speed = keep > 0 ? before * keep : 0;

  return { surface: road.surface, dragged: true, speedLost: before - vehicle.speed };
}

// Frozen shared reports for the two cases that carry no per-kart numbers, so the common
// path — a kart on tarmac, which is most karts on most ticks — allocates nothing.
const TARMAC_REPORT = Object.freeze({ surface: 'TARMAC', dragged: false, speedLost: 0 });
const AIRBORNE_REPORT = Object.freeze({ surface: null, dragged: false, speedLost: 0 });

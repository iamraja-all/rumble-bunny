import { CIRCUIT_DEF } from '../03_Stable_Build/circuit-track.js';
import { launchVehicle } from '../03_Stable_Build/vehicle-physics.js';

/**
 * heightfield_v1 — SOLID GROUND S4: the ground gets a third dimension.
 *
 * WHY THIS EXISTS, in the renderer's own words. `scenery.js:168-170` explains why the
 * coast is a cylinder skirt instead of real terrain: *"Real terrain would need a
 * heightfield the physics does not have — vehicle-physics assumes a flat ground plane."*
 * And `race.js:297-299` hardcodes `vehicle.y = 0` on every respawn under the comment
 * *"The drivable surface is flat at y = 0 and vehicle-physics has no heightfield, so this
 * is the ground, not an assumption about terrain."* Two files deferred to a heightfield
 * that did not exist. This is it.
 *
 * ── THE TRAP THAT IS THE ACTUAL WORK ──────────────────────────────────────────
 *
 * `updateVehicle(vehicle, input, dt, groundY)` has accepted a ground height since it was
 * written, and the plan calls S4 cheap because of that. Passing a varying groundY
 * naively does not work, and the failure is severe rather than cosmetic.
 *
 * `applyMovement` (vehicle-physics.js:333) decides grounded-versus-airborne with a single
 * comparison: `y <= groundY` snaps the kart down, and anything else makes it AIRBORNE.
 * A kart descending ANY slope is above the ground at its new position, so it would be
 * flagged AIRBORNE every tick — and AIRBORNE means no throttle, no steering, and stunt
 * rotation accumulating. Driving downhill would take the car away from the player.
 *
 * The numbers: at 40 m/s a kart covers 0.667 m per tick, while gravity from rest drops it
 * ½·g·dt² = 1.36 mm. So the naive rule launches a kart on any slope steeper than **0.2%**.
 * Every hill on the circuit would be a permanent, uncontrollable jump.
 *
 * ── THE CRITERION, DERIVED FROM GRAVITY AND NOTHING ELSE ──────────────────────
 *
 * A kart on a slope is SUPPORTED by that slope, however steep — it simply accelerates
 * along it. What throws a car into the air is the terrain CURVING away faster than
 * gravity can pull the car down. So the test is about curvature, not slope:
 *
 *   sample the ground at the kart's position, one tick back along its path, and two;
 *   prevRate = (h₋₁ − h₋₂)/dt   is the vertical rate it was following;
 *   nowRate  = (h₀  − h₋₁)/dt   is the rate the ground demands now;
 *   following the ground therefore needs vertical acceleration (nowRate − prevRate)/dt.
 *   If that is more negative than −g, no amount of gravity can hold the kart down and it
 *   is airborne — carrying prevRate, which is why a jump taken uphill gets real air.
 *
 * A constant slope needs zero vertical acceleration, so it is followed at ANY steepness.
 * Accelerating up or down one needs slope·acceleration, which is 0.25 m/s² on a 5% grade
 * — nowhere near g. Only a genuine crest exceeds it. The one input is g.
 *
 * ⚠ WHY THE RATES ARE SAMPLED FROM THE FIELD AND NOT REMEMBERED ON THE VEHICLE. My first
 * version stored the rate in `_terrainVy` and compared the terrain against a ballistic
 * projection of it. That is equivalent while a kart drives continuously, and WRONG the
 * moment anything interrupts: a kart that has just LANDED has a remembered rate of zero
 * while standing on a slope, so the test says "the ground fell away" and relaunches it —
 * land, launch, land, launch, forever. The test caught it as 300 airborne ticks out of 300
 * on a 5% grade, and it is exactly the "jitter on slopes" the plan's Defined Win warns
 * about. Reading three samples out of the field instead costs two extra heightAt calls
 * and cannot go stale, because there is nothing to keep in sync. Fewer fields, not more.
 *
 * Big-O: O(1) per kart per tick. No allocation on the grounded path, no iteration, no
 * `Math.random()` (RSK-003).
 */

/**
 * GRAVITY — must match `vehicle-physics.js:30`, which does not export it.
 *
 * ⚠ A SECOND OWNER OF ONE NUMBER, which is the RSK-007 failure mode, and it exists only
 * because R02 forbids editing 03_Stable_Build to add an export. The test carries a
 * tripwire that reads vehicle-physics.js and fails if the two ever diverge. **At
 * promotion, export GRAVITY from vehicle-physics.js, import it here, and delete both the
 * constant and the tripwire** — ADR-0017's lesson is to eliminate a duplicate rather than
 * to guard it, and this one is guarded only because it cannot yet be eliminated.
 */
const GRAVITY = 9.81;

/**
 * THE COAST PROFILE — reproduced from what the renderer already draws, not invented.
 *
 * `scenery.js:82-84` builds the island as a flat disc at y = 0 out to the playfield
 * radius, then a skirt that drops CLIFF_DROP metres while flaring CLIFF_FLARE metres
 * outward, so the face is a 2:1 slope rather than a pipe. Those three numbers are the
 * terrain a player can already see, so they are the terrain the engine must agree with.
 *
 * ⚠ SAME SECOND-OWNER PROBLEM, same reason, same tripwire, same promotion obligation:
 * these live in `04_Render_Engine/src/scenery.js` today. When this module is promoted,
 * the profile belongs beside `CIRCUIT_DEF.playfield` in `circuit-track.js` — which is
 * exactly where `playfield` itself ended up once gameplay needed it, and for exactly the
 * same reason — and scenery.js should read it from there.
 *
 * WHY NO BANKED CORNERS OR INVENTED HILLS, when the plan names them as S4's content:
 * banking has a principled derivation — the superelevation that balances a corner at
 * racing speed, atan(v²/(r·g)) — so it looked like it could be computed rather than
 * chosen. Computed, it is unusable: this circuit's corners at the 40 m/s ceiling want
 * **about 73 degrees** of bank, which is a velodrome wall, not a race track. Any usable
 * figure is therefore some FRACTION of ideal, and that fraction is a taste call about how
 * the track should feel. That makes it S5's, alongside the two shape mandates S3 already
 * raised. The mechanism below accepts any heightfield, and the test drives it over ramps,
 * crests, dips and rolling terrain to prove it — so S5 can sculpt freely without
 * revisiting this file.
 */
export const COAST_PROFILE = Object.freeze({
  centerX: CIRCUIT_DEF.playfield.centerX,
  centerZ: CIRCUIT_DEF.playfield.centerZ,
  radius: CIRCUIT_DEF.playfield.radius,
  cliffDrop: 26,   // scenery.js:83 CLIFF_DROP
  cliffFlare: 13,  // scenery.js:84 CLIFF_FLARE
  seaLevel: -5,    // scenery.js:82 SEA_LEVEL — the water plane, for reference
});

/**
 * COAST — the shipped heightfield: a flat island with a cliff falling to the sea floor.
 *
 * Exposed as an object with a `heightAt` method rather than a bare function because every
 * consumer below takes a "field", which is what lets the test drive the same mechanism
 * over synthetic ramps and crests. Ponytail Rung 1: no factory, no configuration — a
 * synthetic field in a test is an object literal with one method.
 *
 * Big-O: O(1), one hypot and one lerp.
 */
export const COAST = Object.freeze({
  heightAt(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      // Same reasoning as roadAt: ADR-0012 lost a whole field of karts to a NaN that
      // propagated silently for weeks. A non-finite query is already a bug upstream.
      throw new Error(`heightAt: non-finite query position (${x}, ${z})`);
    }
    const d = Math.hypot(x - COAST_PROFILE.centerX, z - COAST_PROFILE.centerZ);
    if (d <= COAST_PROFILE.radius) {
      return 0;
    }
    const into = d - COAST_PROFILE.radius;
    if (into >= COAST_PROFILE.cliffFlare) {
      return -COAST_PROFILE.cliffDrop;
    }
    return -COAST_PROFILE.cliffDrop * (into / COAST_PROFILE.cliffFlare);
  },
});

/**
 * settleOnTerrain — put a kart on the ground it has just driven onto, or let it fly.
 *
 * ── CALL ORDER, WHICH IS PART OF THE CONTRACT ────────────────────────────────
 *   1. groundY = field.heightAt(v.x, v.z)        <- BEFORE the move, at the OLD position
 *   2. updateVehicle(v, input, dt, groundY)
 *   3. resolveBarrier(v, index, dt)              <- may move the kart sideways
 *   4. applySurfaceDrag(v, index, dt)
 *   5. settleOnTerrain(v, field, dt)             <- LAST, once x and z are final
 *
 * WHY groundY IS SAMPLED AT THE OLD POSITION: it is what keeps step 2 from mislabelling a
 * descending kart as AIRBORNE. A grounded kart's `y` already equals the height there, so
 * `applyMovement`'s gravity nudges it a millimetre below, `y <= groundY` holds, and it
 * stays grounded. The elevation change is then applied here, where the final position is
 * known and the ballistic test can be made properly. Sampling the NEW position instead
 * would reintroduce the 0.2%-slope launch bug described at the top of this file.
 *
 * WHY THE POSITION IS NOT PREDICTED: the obvious alternative is to guess where the kart
 * will end up and pass the height there. `updateVehicle` applies steering and throttle
 * before it moves, and `resolveBarrier` can move the kart again afterwards, so any
 * prediction is wrong by up to a barrier clamp. Correcting after the fact needs no guess.
 *
 * MUTATES the vehicle, like `resolveBarrier`, `applySurfaceDrag` and
 * `applyCarCollisions` — a copy per kart per tick is 480 allocations a second (R07).
 *
 * RETURNS NOTHING, deliberately, and this is a correction to my own first draft. It
 * originally returned `{ height, grounded, launched, climbRate }` by analogy with
 * `resolveBarrier`'s contact report — but that analogy is wrong. A wall contact is not
 * otherwise discoverable: "did I scrape something this tick" exists nowhere in the
 * vehicle state. Every field of THIS report is a copy of state the caller already holds:
 * `height` is `vehicle.y`, `climbRate` is `vehicle._terrainVy`, `grounded` and `launched`
 * are `vehicle.state !== 'AIRBORNE'`. So the object was duplication that also allocated
 * on the hot path, 480 times a second. Ponytail Rung 1 applied to my own output.
 */
export function settleOnTerrain(vehicle, field, dt) {
  const height = field.heightAt(vehicle.x, vehicle.z);

  // A kart in flight is not on any surface. Its landing is decided by step 2 on a later
  // tick, against the height under its position at that moment.
  //
  // ⚠ HONEST LIMIT: because step 2 samples the OLD position, a landing is detected up to
  // one tick late — at most 0.667 m of horizontal travel at the speed ceiling, so a kart
  // dropping onto a steep upslope can be briefly a few centimetres under it before the
  // next tick lands it. Stated rather than hidden; fixing it would mean predicting the
  // move, which is the alternative rejected above for being wrong more often.
  if (vehicle.state === 'AIRBORNE') {
    return;
  }

  // Retrace the path the kart just travelled. Forward is (-sin rotY, -cos rotY) —
  // vehicle-physics.js:319, kept derived from there rather than re-guessed, because two
  // places disagreeing about this sign is what the airborne-steering inversion bug was.
  const step = vehicle.speed * dt;
  const backX = -Math.sin(vehicle.rotY) * step;
  const backZ = -Math.cos(vehicle.rotY) * step;
  const oneBack = field.heightAt(vehicle.x - backX, vehicle.z - backZ);
  const twoBack = field.heightAt(vehicle.x - backX * 2, vehicle.z - backZ * 2);

  // ⚠ The retrace assumes the kart travelled in a straight line over the tick, which it
  // did — but `resolveBarrier` may since have clamped it sideways, so on a wall scrape the
  // sampled path is off by the clamp. That is at most a barrier overshoot (millimetres,
  // ADR-0027) and it only perturbs a curvature estimate, never the kart's position.
  const prevRate = (oneBack - twoBack) / dt;
  const nowRate = (height - oneBack) / dt;

  // Vertical acceleration required to stay glued to the ground. Gravity can supply at
  // most g downward; anything beyond that means the ground has left the kart behind.
  if ((nowRate - prevRate) / dt < -GRAVITY) {
    // Airborne, carrying the rate it already had — which is why a ramp taken uphill
    // throws the kart up rather than merely dropping it off the lip. launchVehicle is
    // reused rather than reimplemented (ponytail Rung 2): it owns the AIRBORNE
    // transition, the takeoff rotations the stunt detector compares against, and the
    // stunt reset. It happily takes a negative rate for a downhill crest.
    launchVehicle(vehicle, prevRate);
    return;
  }

  // Following the ground: sit on it exactly. Nothing is remembered between ticks.
  vehicle.y = height;
  vehicle.vy = 0;
}

/**
 * placeOnTerrain — put a kart on the ground at a position it has been teleported to.
 *
 * WHY THIS IS SEPARATE from settleOnTerrain: a respawn is not a drive. `race.js:297`
 * currently sets `vehicle.y = 0` by hand, and once terrain exists that lands a kart
 * inside a hillside or hovering over a dip. It also must not run the curvature test — a
 * teleported kart has no path behind it to retrace, and `race.js` zeroes its speed
 * anyway, which makes the retrace degenerate.
 *
 * ⚠ INTEGRATION OBLIGATION AT PROMOTION: `race.js:_respawn` must call this instead of
 * assigning y = 0, and so must `lobby.js` when it places the starting grid. Both are in
 * 03_Stable_Build and therefore out of this slice's reach (R02).
 */
export function placeOnTerrain(vehicle, field) {
  vehicle.y = field.heightAt(vehicle.x, vehicle.z);
  vehicle.vy = 0;
  return vehicle.y;
}

import { roadAt, RAIL_OFFSET } from './road-geometry_v1.js';
import { VEHICLE_RADIUS, normalizeAngle } from '../03_Stable_Build/vehicle-physics.js';

/**
 * barriers_v1 — SOLID GROUND S2: steel that stops you.
 *
 * THE REPORTED BUG, in the player's words: *"it goes beyond the track boundaries
 * that blocks by steel."* S1 gave the engine the road; this gives the road an edge.
 * A kart that crosses a walled edge is clamped back to the barrier line and keeps
 * sliding along it, losing only the part of its motion that was heading into the
 * wall.
 *
 * WHY CLAMP-AND-SLIDE AND NOT A BOUNCE: a reflective barrier at 40 m/s throws the
 * kart back across the racing line and into the field behind it — worse than the
 * hole it replaces, and nothing like the wall-scrape in Rumble Racing. Clamping the
 * normal component while leaving the tangential one alone is also almost free here:
 * `applyMovement` integrates position along the heading, so correcting only the
 * across-road component leaves the along-road component already integrated. The
 * slide is a consequence of the model, not extra code.
 *
 * WHY THE HEADING IS NEVER ROTATED: it would fight the player's steering, and a
 * kart pinned against a wall with the wheel still turned into it SHOULD grind to a
 * halt — that is what the wall is for. Aim along the wall and you keep your speed.
 * Whether the grind rate feels right is a play-test call, not something a test can
 * settle (see the tunables below).
 *
 * WHY THIS REUSES ADR-0011's SHAPE: `applyCarCollisions` already resolves contact
 * by correcting position directly and then adjusting the scalar speed, and it skips
 * AIRBORNE vehicles. Barriers do the same three things for the same reasons, rather
 * than introducing a second collision style in the same engine.
 *
 * Big-O: O(1) per kart per tick on top of `roadAt`'s windowed O(W). No allocation,
 * no iteration, no `Math.random()` (RSK-003 — desync would be silent).
 */

// ── Tunables ────────────────────────────────────────────────────────────────
//
// WHERE A KART CENTRE STOPS. The steel stands at `halfWidth + RAIL_OFFSET`
// (15.6 m on the main road). A kart is a bounding sphere of VEHICLE_RADIUS, so its
// centre stops one radius short and its body just touches the rail: 14 + 1.6 - 2 =
// 13.6 m. That puts a pinned kart's outer flank over the 1.6 m run-off strip and
// its centre still on tarmac, which is what leaning on a barrier looks like.
//
// WHY VEHICLE_RADIUS AND NOT A NEW "KART HALF WIDTH": 2.0 m overstates a kart's
// real half width — spec.md:95 defines it as a bounding SPHERE and
// applyCarCollisions already resolves kart-to-kart contact with it. A second, more
// accurate width would be a second source of truth for how big a kart is, and this
// engine has paid for that mistake twice (items vs vehicles, ISLAND_RADIUS vs
// CircleGeometry). If the barriers read too tight in play, this is the knob.
export function barrierLine(halfWidth) {
  return halfWidth + RAIL_OFFSET - VEHICLE_RADIUS;
}

// HOW FAR PAST THE LINE STILL COUNTS AS TOUCHING THE WALL.
//
// WHY A BAND IS NEEDED AT ALL: "outside a walled edge" is not the same as "in
// contact with that wall". A kart can be legitimately far outside — it jumped the
// rail off a launch pad, it drove out through a shortcut gap, or it started there
// (grid slot 7 does; see the note at the bottom). Clamping those would teleport a
// kart across the map. Anything beyond the band is not this barrier's business;
// the playfield respawn in race.js is the backstop for a genuine escape, and
// re-tuning that relationship is S8.
//
// WHY 4 m: the speed ceiling is max_speed 40 x boost_mult 1.5 = 60 m/s
// (server.js:35,40), so one 60 Hz tick moves a kart at most 1.0 m, and that is the
// worst case for a purely perpendicular approach. Four times the worst single-tick
// penetration means a crossing can never step over the band in one frame, which is
// the only way containment could be skipped.
const CONTACT_BAND = 4.0;

// HOW FAST A WALL TURNS A KART PARALLEL TO ITSELF, in radians per second at a fully
// perpendicular heading, scaled by the into-wall component so a graze barely nudges.
//
// WHY THIS EXISTS AT ALL — my first version of this module did NOT rotate the kart,
// on the argument that steering belongs to the player. Its own Defined Win test
// killed that: with the heading fixed, a kart pinned at 12 degrees never becomes
// parallel, so the into-wall component never reaches zero, so the speed loss
// compounds every tick it stays in contact. A four-second scrape left 2.7 of 40 m/s.
// That is not a barrier, it is glue — and "ends up travelling alongside it" is
// exactly what the plan asked for and exactly what a fixed heading cannot do.
//
// A wall redirects what hits it. Turning the kart is what makes the whole mechanism
// SELF-LIMITING: as the heading aligns, intoWall falls to zero, the speed projection
// below stops taking anything, and the kart simply runs along the steel.
//
// WHY 6.0: a square hit becomes parallel in about a quarter second, which reads as a
// hard scrape rather than a snap. It also has to out-turn the player holding the
// stick into the wall — steering peaks at handling 1.5 rad/s (vehicle-physics.js:201),
// so at 6.0 the wall wins a head-on argument and you cannot drive through steel by
// insisting. A graze at 10 degrees gets 6.0 x 0.17 = 1.0 rad/s, a gentle correction.
const ALIGN_RATE = 6.0;

/**
 * resolveBarrier — keep one vehicle on its side of the steel.
 *
 * Call AFTER the movement integration for this tick (the same place
 * `applyCarCollisions` is called), because it corrects where the integrator
 * already put the kart.
 *
 * MUTATES the vehicle, matching `applyCarCollisions`'s contract rather than
 * `updateVehicle`'s copy-and-return one — the caller is correcting a state it has
 * already created for this frame, and a second copy per kart per tick is 480
 * allocations a second inside the 60 Hz loop (R07).
 *
 * @param {object} vehicle - a vehicle state, positioned for this tick
 * @param {object} index - the road index from buildRoadIndex()
 * @param {number} dt - seconds this tick, for the speed bleed
 * @returns {object} contact report: { contacted, overshoot, intoWall, edge, spline }
 *   Returned rather than swallowed because a HUD scrape effect, a wall-hit sound and
 *   S3's surface work all need to know a barrier was touched — and because this
 *   project has now shipped THREE fields that no consumer ever read (dnf,
 *   out_of_bounds, best_lap). A return value that a caller may ignore costs nothing;
 *   a modifier on the wire costs 60 Hz x 8 clients.
 */
export function resolveBarrier(vehicle, index, dt) {
  // WHY AIRBORNE IS EXEMPT — and this is load-bearing, not a shortcut: the steel is
  // waist-high, the launch pads exist to clear it, and the dirt path runs up to
  // 29.2 m outside the main barrier line. Clamping a kart in flight would cancel
  // every jump and make the shortcut unreachable in the air as well as on the
  // ground. `applyCarCollisions` skips AIRBORNE for the same reason.
  if (vehicle.state === 'AIRBORNE') {
    vehicle._roadHint = null; // the kart may land anywhere; a stale hint would lie
    return NO_CONTACT;
  }

  const road = roadAt(index, vehicle.x, vehicle.z, vehicle._roadHint);
  vehicle._roadHint = road.hint;

  if (road.edge !== 'WALL') {
    return NO_CONTACT;
  }

  const line = barrierLine(road.halfWidth);
  const distance = Math.abs(road.lateralOffset);
  const overshoot = distance - line;

  // Inside the barrier, or so far outside that this wall is not what is holding
  // the kart. Both are "nothing to do" and the second is explained on CONTACT_BAND.
  if (overshoot <= 0 || overshoot > CONTACT_BAND) {
    return NO_CONTACT;
  }

  // ── CLAMP ─────────────────────────────────────────────────────────────────
  // Push straight back across the road by the overshoot. The outward direction is
  // the winning segment's stored unit normal, signed by which side the kart is on —
  // the same normal `scenery.js` offsets its rails along, which is why the wall the
  // kart stops at is the wall the player can see.
  const segment = index[road.spline].segments[road.segmentIndex];
  const outward = road.lateralOffset >= 0 ? 1 : -1;
  vehicle.x -= segment.nx * outward * overshoot;
  vehicle.z -= segment.nz * outward * overshoot;

  // How much of the kart's heading was pointed into the wall. Forward vector is
  // (-sin rotY, -cos rotY) — vehicle-physics.js:319, and it must stay derived from
  // there rather than re-guessed, because the airborne-steering inversion bug was
  // exactly two places disagreeing about this sign.
  const forwardX = -Math.sin(vehicle.rotY);
  const forwardZ = -Math.cos(vehicle.rotY);
  const intoWall = (forwardX * segment.nx + forwardZ * segment.nz) * outward;

  // A kart already turning away from the wall keeps everything it has — that is the
  // difference between a barrier and a brake. Only pressing in costs anything.
  if (intoWall <= 0) {
    return { contacted: true, overshoot, intoWall: 0, edge: road.edge, spline: road.spline };
  }

  // The unit tangent of the wall, oriented along the direction the kart is actually
  // travelling. Derived from the stored normal rather than re-normalising: with
  // n = (-dz/L, dx/L), the tangent (dx/L, dz/L) is exactly (n.z, -n.x).
  const alongSign = forwardX * segment.nz + forwardZ * -segment.nx >= 0 ? 1 : -1;
  const tangentX = segment.nz * alongSign;
  const tangentZ = -segment.nx * alongSign;

  // ── SPEED: THE WALL TAKES THE PART OF YOUR MOTION THAT POINTED INTO IT ─────
  // Not a tuned friction — a projection. The clamp above already deleted the
  // across-road part of the kart's displacement, so deleting the matching part of
  // its speed is the same event described once. A square hit therefore stops the
  // kart dead (the tangential component of a perpendicular heading is zero) and a
  // 12-degree graze costs 2%, with no constant to tune and nothing to compound: once
  // the alignment below finishes, intoWall is zero and this line stops charging.
  //
  // WHY NO RESTITUTION TERM (yet): applyCarCollisions uses 0.3 for kart-to-kart, but
  // that is a bounce between two movable bodies. A wall that hands momentum BACK
  // throws the kart across the racing line, which is the failure mode the plan
  // explicitly ruled out. If play says the stop is too abrupt, a restitution blend
  // here is the knob — that is a feel call, not something a test can settle.
  vehicle.speed *= forwardX * tangentX + forwardZ * tangentZ;

  // ── HEADING: THE WALL TURNS YOU PARALLEL TO ITSELF ────────────────────────
  // Rotate toward the wall's tangent, never past it, at a rate proportional to how
  // hard the kart is pressing in. See ALIGN_RATE for why this is not optional.
  const targetRotY = Math.atan2(-tangentX, -tangentZ);
  const delta = normalizeAngle(targetRotY - vehicle.rotY);
  const maxStep = ALIGN_RATE * intoWall * dt;
  vehicle.rotY = normalizeAngle(
    vehicle.rotY + (delta > maxStep ? maxStep : delta < -maxStep ? -maxStep : delta),
  );

  return {
    contacted: true,
    overshoot,
    intoWall: intoWall > 0 ? intoWall : 0,
    edge: road.edge,
    spline: road.spline,
  };
}

// One frozen object for the common case, so the 60 Hz path allocates nothing when
// nobody is touching a wall — which is almost every kart on almost every tick.
const NO_CONTACT = Object.freeze({
  contacted: false,
  overshoot: 0,
  intoWall: 0,
  edge: null,
  spline: null,
});

/**
 * TWO PRE-EXISTING DEFECTS THIS SLICE EXPOSED BUT DOES NOT FIX. Both were harmless
 * while the barriers were a picture and become visible the moment they are not.
 *
 * 1. GRID SLOT 7 STARTS THROUGH THE RAIL. `CIRCUIT_DEF.spawnPositions[7]` is
 *    (19, 19), which is 16.90 m from the main centreline — 2.9 m past the paint and
 *    1.3 m OUTSIDE the steel. In an eight-player race the last kart on the grid
 *    begins embedded in a guardrail, on grass. `validateCircuitDefinition` does not
 *    catch it because it only checks spawns against the playfield circle, not
 *    against the road. With this resolver the kart is nudged 3.3 m onto the tarmac
 *    on its first grounded tick, which is a graceful outcome but still a race
 *    starting from the wrong place. Slot 6 is also within a centimetre of the line.
 *    Moving the grid is a track-shape edit (S5) and an owner call.
 *
 * 2. `spawner_1` IS BEHIND THE STEEL. The POWERUP_BOOST at (-47, -18) sits 16.72 m
 *    out, 1.1 m beyond the rail. Once the barrier is solid that item can no longer
 *    be collected on the main road. Items are not vehicles and this resolver never
 *    touches them, so nothing here hides it — the powerup simply becomes
 *    unreachable. Also S5/owner territory.
 */

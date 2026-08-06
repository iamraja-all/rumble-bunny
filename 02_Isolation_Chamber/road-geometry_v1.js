/**
 * road-geometry_v1 — SOLID GROUND S1: the road as headless truth.
 *
 * WHY THIS EXISTS: until now the engine did not know a road existed. Collisions
 * were kart-vs-kart and item-vs-kart only; `CIRCUIT_DEF.road.mainWidth` and
 * `shortcutWidth` had ZERO engine consumers — they were read exclusively by
 * 04_Render_Engine/src/circuit-visuals.js and scenery.js. The tarmac, the steel
 * and the grass were paint on an infinite flat plane, which is why a kart drives
 * straight through a guardrail it can see: there is no guardrail, only a picture
 * of one. This module is the missing fact — given any XZ, how far from the
 * centreline are you, and what are you standing on.
 *
 * It answers questions ONLY. It does not move, stop, slow or respawn anything;
 * that is S2 (barriers) and S3 (surfaces). R01 — the truth prints in a terminal
 * before anything renders or resolves.
 *
 * NO IMPORTS BY DESIGN (R06): the spline math is written from scratch because
 * three.js is a client dependency and the engine may not import it. The cost of
 * that rule is this file; the test pays it back by proving the from-scratch
 * sampler agrees with THREE.CatmullRomCurve3 to 1e-9, so when the renderer is
 * switched over to consume this sampler (next slice) the drawn road does not
 * move. That is the RSK-007 lesson applied before the fact rather than after:
 * one owner of the curve, proven equal to the four owners it replaces.
 */

// ── Tunables ────────────────────────────────────────────────────────────────
//
// WHY 32 SAMPLES PER SPAN: the main circuit's spans are 40-90 m long, so 32
// samples puts a polyline vertex every 1.3-2.8 m. Chord error against the true
// spline at that spacing is under a centimetre on the tightest corner here —
// far below the 14 m half-width any answer is compared against — while keeping
// the whole index at 256 + 128 vertices, small enough that a cold full scan is
// still cheap enough to run on respawn.
const SAMPLES_PER_SPAN = 32;

// WHY A ±12 SEGMENT WINDOW: R07 forbids an O(n) scan inside the 60 Hz loop. A
// kart at the 60 m/s ceiling covers 1 m per tick, or well under one polyline
// segment, so the nearest segment moves by at most one index per tick. Twelve is
// ~24 m of slack in both directions, which absorbs a hard sideways slide, a
// launch-pad flight and a landing without ever losing the track. The window is
// verified against a full scan in the test rather than assumed sufficient.
const SEARCH_WINDOW = 12;

// WHY UNIFORM CATMULL-ROM AT TENSION 0.5: not a preference — it is what the four
// existing client curves already use (`new THREE.CatmullRomCurve3(pts, true,
// 'catmullrom', 0.5)` in circuit-visuals.js:9, scenery.js:305, scenery.js:458).
// The engine must agree with the picture, so the picture picks the parameters.
const TENSION = 0.5;

// WHY AN EPSILON DEDUPE: `CIRCUIT_DEF.road.mainPoints` repeats its first point as
// its last, so a control point can coincide with its neighbour. A zero-length
// polyline segment would divide by zero in the projection below. Nothing in the
// current data actually collapses (see the note on the duplicate point at the
// bottom of this file), so this is a guard against the data changing, not a
// workaround for today's numbers.
const MIN_SEGMENT_LENGTH = 1e-6;

/**
 * sampleSpline — one point on a CLOSED uniform Catmull-Rom spline.
 *
 * Replicates THREE.CatmullRomCurve3.getPoint() for curveType 'catmullrom' with
 * closed = true, in the XZ plane. The cubic is the same one three.js builds:
 *   p(s) = c0 + c1*s + c2*s^2 + c3*s^3
 * with c1 = tension*(p2-p0) and c2/c3 fixed by requiring p(0)=p1 and p(1)=p2.
 *
 * WHY THE INDEX WRAP IS WRITTEN THIS WAY: three.js maps t through
 * `intPoint += intPoint > 0 ? 0 : (floor(|intPoint|/l)+1)*l`, which for a closed
 * curve is just "wrap the four control indices modulo l". Writing the modulo
 * directly is the same arithmetic without the branch, and the test pins the two
 * against each other so the equivalence is checked, not claimed.
 *
 * Big-O: O(1). Called O(P x SAMPLES_PER_SPAN) times at boot and never in the loop.
 *
 * @param {Array<{x:number,z:number}>} points - control points, closed loop
 * @param {number} t - [0,1) around the loop
 * @returns {{x:number,z:number}}
 */
export function sampleSpline(points, t) {
  const l = points.length;
  const p = l * t;
  const span = Math.floor(p);
  const s = p - span;

  const p0 = points[(span - 1 + l) % l];
  const p1 = points[span % l];
  const p2 = points[(span + 1) % l];
  const p3 = points[(span + 2) % l];

  return {
    x: cubic(p0.x, p1.x, p2.x, p3.x, s),
    z: cubic(p0.z, p1.z, p2.z, p3.z, s),
  };
}

function cubic(v0, v1, v2, v3, s) {
  const t0 = TENSION * (v2 - v0);
  const t1 = TENSION * (v3 - v1);
  const c2 = -3 * v1 + 3 * v2 - 2 * t0 - t1;
  const c3 = 2 * v1 - 2 * v2 + t0 + t1;
  return v1 + t0 * s + c2 * s * s + c3 * s * s * s;
}

/**
 * buildRoadIndex — flatten a road definition into searchable polylines, once.
 *
 * WHY THE INDEX IS RETURNED RATHER THAN CACHED IN A MODULE VARIABLE: ADR-0012
 * found `TRACK_DEF`'s spawn timers shared across every room because a mutable
 * singleton looked like configuration. An index is read-only, so sharing one is
 * safe — but the same shape must be constructible from synthetic data for the
 * test to check a straight line's answers by hand, and a hidden singleton makes
 * that impossible. The caller holds it.
 *
 * WHY BOTH ROUTES ARE CLOSED LOOPS: the shortcut is drawn with closed = true in
 * both circuit-visuals.js and scenery.js, so the dirt path is geometrically a
 * small closed loop that overlaps the main circuit near its ends. Modelling it
 * as an open path here would put the engine's dirt somewhere the player cannot
 * see it. The picture is the spec until the picture changes.
 *
 * Big-O: O(P x SAMPLES_PER_SPAN) = 8x32 + 4x32 = 384 samples, once at boot.
 *
 * @param {object} roadDef - CIRCUIT_DEF.road, or a synthetic equivalent
 * @returns {object} opaque index for roadAt()
 */
export function buildRoadIndex(roadDef) {
  if (!roadDef) {
    throw new Error('buildRoadIndex: a road definition is required');
  }

  return {
    MAIN: buildPolyline(roadDef.mainPoints, roadDef.mainWidth, 'TARMAC', 'WALL'),
    // WHY THE SHORTCUT'S EDGE IS 'OPEN': scenery.js:100 calls buildGuardrails
    // exactly once, for mainPoints. There is no steel beside the dirt path, so
    // the engine must not invent any — S2 resolves WALL edges by clamping, and
    // clamping a kart against a barrier the player cannot see is worse than the
    // hole this whole slice exists to close.
    SHORTCUT: buildPolyline(roadDef.shortcutPoints, roadDef.shortcutWidth, 'DIRT', 'OPEN'),
  };
}

function buildPolyline(controlPoints, width, surface, edge) {
  if (!Array.isArray(controlPoints) || controlPoints.length < 2) {
    throw new Error('buildRoadIndex: a road needs at least two control points');
  }
  if (!(width > 0) || !Number.isFinite(width)) {
    throw new Error('buildRoadIndex: a road needs a positive finite width');
  }

  const spanCount = controlPoints.length;
  const vertices = [];
  for (let span = 0; span < spanCount; span += 1) {
    for (let step = 0; step < SAMPLES_PER_SPAN; step += 1) {
      const t = (span + step / SAMPLES_PER_SPAN) / spanCount;
      const point = sampleSpline(controlPoints, t);
      // Drop a vertex that lands on top of its predecessor — see
      // MIN_SEGMENT_LENGTH. Comparing against the accepted list rather than the
      // raw sample keeps the loop closed when several samples collapse.
      const previous = vertices[vertices.length - 1];
      if (!previous || Math.hypot(point.x - previous.x, point.z - previous.z) > MIN_SEGMENT_LENGTH) {
        vertices.push(point);
      }
    }
  }

  // Segments are stored as flat pre-computed fields rather than objects holding
  // vectors (R07): the hot loop reads ax/az/dx/dz/lengthSq and nothing else, and
  // it must not allocate. Everything divisible is divided here, at boot.
  const segments = [];
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq <= MIN_SEGMENT_LENGTH * MIN_SEGMENT_LENGTH) {
      continue;
    }
    const length = Math.sqrt(lengthSq);
    segments.push({
      ax: a.x,
      az: a.z,
      dx,
      dz,
      lengthSq,
      // Unit normal, left-hand side of travel. WHY THIS SIGN: scenery.js:325
      // builds its guardrails with `nx = -tan.z, nz = tan.x` and offsets by
      // `side * offset * n`, so side +1 IS this direction. A positive
      // lateralOffset therefore means "the side the +1 rail is on", which is the
      // only reason S2 will be able to pick the right barrier to clamp against.
      nx: -dz / length,
      nz: dx / length,
    });
  }

  if (segments.length < 2) {
    throw new Error('buildRoadIndex: road collapsed to fewer than two segments');
  }

  return { segments, halfWidth: width / 2, surface, edge };
}

/**
 * roadAt — where is this XZ point relative to the road?
 *
 * @param {object} index - from buildRoadIndex()
 * @param {number} x
 * @param {number} z
 * @param {?object} hint - the `hint` from this caller's previous answer, or null
 * @returns {{spline:string, segmentIndex:number, lateralOffset:number,
 *            halfWidth:number, surface:string, edge:string, hint:object}}
 *   lateralOffset is SIGNED metres from the centreline (see the normal above);
 *   its magnitude is the true distance to the centreline polyline.
 *   surface is 'GRASS' whenever |lateralOffset| exceeds halfWidth — being off
 *   the road is a property of the query point, not of the road it missed.
 *
 * WHY A HINT OBJECT AND NOT `trackProgress`: the SOLID GROUND plan proposed
 * windowing the search by the kart's existing `trackProgress`, but that record
 * (circuit-track.js:216) holds `clearedGateCount` and `nextGateIds` — gate
 * counts, not arc position. It cannot say which of 384 polyline segments a kart
 * is beside, and on an UNSET route it does not even know which spline. So the
 * hint is a pair of segment indices the caller stores and hands back, following
 * the `_`-prefixed engine-internal convention ADR-0022 established for state
 * that must not reach the wire.
 *
 * WHY BOTH SPLINES ARE ALWAYS QUERIED: a kart is physically on the dirt path
 * whether or not its route says SHORTCUT — it can be knocked onto it, land on it
 * off the ramp, or drive it while its route still reads UNSET. Trusting the
 * route here would report tarmac grip on dirt.
 *
 * Big-O: O(W) per spline with W = 2 x SEARCH_WINDOW + 1 = 25, so 50 distance
 * tests per query when hinted; 60 Hz x 8 karts x 50 = 24,000/s. Unhinted it
 * falls back to O(S) = 384 per spline, which happens on spawn and respawn only —
 * events, not ticks. A naive unwindowed loop would be 184,320 tests/s.
 */
export function roadAt(index, x, z, hint = null) {
  // WHY THIS THROWS INSTEAD OF COERCING: ADR-0012 lost a whole field of karts to
  // a NaN that propagated silently for weeks (RoomManager never passed baseStats,
  // so every position became NaN and nothing complained). A non-finite query is
  // already a bug upstream; the cheapest place to see it is here, loudly.
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    throw new Error(`roadAt: non-finite query position (${x}, ${z})`);
  }

  const main = nearest(index.MAIN, x, z, hint?.main);
  const shortcut = nearest(index.SHORTCUT, x, z, hint?.shortcut);
  const nextHint = { main: main.segmentIndex, shortcut: shortcut.segmentIndex };

  // WHY "LEAST OVERSHOOT" DECIDES, NOT "NEAREST CENTRELINE": the two splines
  // overlap where the shortcut rejoins the circuit, and their widths differ
  // (28 m vs 16 m). Nearest centreline would hand a kart travelling down the
  // middle of the 28 m main road to the narrow dirt spline whenever the dirt
  // centreline happened to pass closer, reporting DIRT grip on tarmac. Overshoot
  // (|lateral| - halfWidth) compares like with like: negative means "inside this
  // road", and the road you are furthest inside is the road you are on.
  const mainOvershoot = Math.abs(main.lateralOffset) - index.MAIN.halfWidth;
  const shortcutOvershoot = Math.abs(shortcut.lateralOffset) - index.SHORTCUT.halfWidth;

  // Ties go to MAIN deliberately: it is the route every kart is on by default,
  // and a deterministic tie-break is required by RSK-003 — no Math.random(), and
  // no dependence on which spline was evaluated first.
  const onMain = mainOvershoot <= shortcutOvershoot;
  const winner = onMain ? main : shortcut;
  const road = onMain ? index.MAIN : index.SHORTCUT;
  const overshoot = onMain ? mainOvershoot : shortcutOvershoot;

  return {
    spline: onMain ? 'MAIN' : 'SHORTCUT',
    segmentIndex: winner.segmentIndex,
    lateralOffset: winner.lateralOffset,
    halfWidth: road.halfWidth,
    surface: overshoot <= 0 ? road.surface : 'GRASS',
    edge: road.edge,
    hint: nextHint,
  };
}

/**
 * nearest — closest polyline segment to (x, z), searched in a window when hinted.
 *
 * Standard point-to-segment projection: clamp the parameter to [0,1] so the
 * closest point is inside the segment, then measure. The clamp is what makes a
 * polyline of chords behave like a curve at the joins instead of reporting
 * distance to an infinite line.
 *
 * Big-O: O(W) hinted, O(S) cold. No allocation inside the loop (R07) — the
 * winning values are carried in scalars and packed into one object at the end.
 */
function nearest(road, x, z, hintIndex) {
  const segments = road.segments;
  const count = segments.length;
  const hinted = Number.isInteger(hintIndex) && hintIndex >= 0 && hintIndex < count;
  const span = hinted ? SEARCH_WINDOW * 2 + 1 : count;
  const start = hinted ? hintIndex - SEARCH_WINDOW : 0;

  let bestIndex = -1;
  let bestDistSq = Infinity;
  let bestSign = 1;

  for (let step = 0; step < span; step += 1) {
    // Modulo wrap in both directions — the road is a closed loop, so the window
    // around segment 0 must reach the segments before the start line.
    const i = (((start + step) % count) + count) % count;
    const s = segments[i];

    const toX = x - s.ax;
    const toZ = z - s.az;
    let t = (toX * s.dx + toZ * s.dz) / s.lengthSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;

    const closestX = s.ax + s.dx * t;
    const closestZ = s.az + s.dz * t;
    const offX = x - closestX;
    const offZ = z - closestZ;
    const distSq = offX * offX + offZ * offZ;

    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIndex = i;
      // Which side of the road, from the winning segment's normal. Taken here
      // rather than recomputed after the loop because `offX/offZ` are already in
      // hand and re-deriving them costs another projection.
      bestSign = offX * s.nx + offZ * s.nz >= 0 ? 1 : -1;
    }
  }

  return {
    segmentIndex: bestIndex,
    // Magnitude is the true distance to the centreline; the sign says which side.
    lateralOffset: bestSign * Math.sqrt(bestDistSq),
  };
}

/**
 * FOUND WHILE BUILDING THIS, NOT FIXED HERE — the duplicate control point.
 *
 * `CIRCUIT_DEF.road.mainPoints` lists (0,25) both first and last, with the
 * comment "Duplicate first point to close loop smoothly for catmull rom"
 * (circuit-visuals.js:7). With closed = true that comment is wrong: three.js
 * already wraps, so the duplicate is an eighth control point, and the span from
 * points[7] to points[0] is a cubic that leaves (0,25) and returns to it —
 * bulging about 2.2 m sideways at its midpoint. There is a small S-kink in the
 * road across the start/finish line, in the picture and now in the engine.
 *
 * Deliberately left alone. Removing the duplicate changes the shape of the drawn
 * road at the one place every lap is timed, which is a visible change to four
 * client curves and belongs to S5 (track shape, an owner call) — not to a slice
 * whose entire promise is that the engine and the picture finally agree.
 */

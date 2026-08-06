import * as THREE from '../04_Render_Engine/node_modules/three/build/three.module.js';
import { CIRCUIT_DEF } from '../03_Stable_Build/circuit-track.js';
import { buildRoadIndex, roadAt, sampleSpline } from './road-geometry_v1.js';

/**
 * test_road-geometry_v1.js — SOLID GROUND S1's Defined Win, in a terminal.
 *
 * WHY THREE IS IMPORTED HERE AND NOT IN THE MODULE: R06 keeps three.js out of the
 * engine, and road-geometry_v1.js imports nothing at all. The TEST is allowed to
 * use it because three is already an installed client dependency (ponytail Rung 5)
 * and because the single most valuable assertion in this file is "the engine's
 * from-scratch spline is the same curve the renderer already draws". Proving that
 * here is what makes switching the four client curves over to this sampler a
 * no-visual-change edit instead of an act of faith — the RSK-007 failure mode
 * (two owners of one fact) caught before it is created rather than after.
 *
 * INPUT:  CIRCUIT_DEF.road, plus hand-placed and swept XZ probe points.
 * OUTPUT: roadAt() answers — signed lateral offset, half width, surface, spline.
 * PASS:   every assertion green and exit code 0.
 */

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { console.log(`✅ PASS: ${label}`); passed++; }
  else { console.log(`❌ FAIL: ${label}`); failed++; }
}

const ROAD = CIRCUIT_DEF.road;
const index = buildRoadIndex(ROAD);

// The renderer's curve, built exactly as circuit-visuals.js:9 and scenery.js:305
// build it, so "the same curve" means the same constructor arguments too.
function threeCurve(points) {
  return new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p.x, 0, p.z)), true, 'catmullrom', 0.5,
  );
}

const mainCurve = threeCurve(ROAD.mainPoints);
const shortcutCurve = threeCurve(ROAD.shortcutPoints);

// A seeded LCG, not Math.random(): RSK-003 and the CODEX.md forbidden-output list
// both rule out non-deterministic engine tests. A failure has to be reproducible.
function lcg(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

// ── Test 1: the engine's spline IS the renderer's spline ──────────────────────
(() => {
  let maxMain = 0;
  let maxShortcut = 0;
  const STEPS = 977; // prime, so samples land between polyline vertices too

  for (let i = 0; i <= STEPS; i += 1) {
    const t = i / STEPS;

    const mine = sampleSpline(ROAD.mainPoints, t);
    const theirs = mainCurve.getPoint(t);
    maxMain = Math.max(maxMain, Math.abs(mine.x - theirs.x), Math.abs(mine.z - theirs.z));

    const mineShort = sampleSpline(ROAD.shortcutPoints, t);
    const theirsShort = shortcutCurve.getPoint(t);
    maxShortcut = Math.max(
      maxShortcut,
      Math.abs(mineShort.x - theirsShort.x),
      Math.abs(mineShort.z - theirsShort.z),
    );
  }

  assert(maxMain < 1e-12, `T1a: main spline matches THREE.CatmullRomCurve3 (max err ${maxMain})`);
  assert(maxShortcut < 1e-12, `T1b: shortcut spline matches THREE (max err ${maxShortcut})`);

  // t = 0 and t = 1 are the wrap seam — the one place a closed-curve index bug
  // hides, because every other span is reachable without modulo arithmetic.
  const seam0 = sampleSpline(ROAD.mainPoints, 0);
  const seam1 = sampleSpline(ROAD.mainPoints, 1);
  assert(
    Math.abs(seam0.x - seam1.x) < 1e-12 && Math.abs(seam0.z - seam1.z) < 1e-12,
    't=0 and t=1 are the same point (T1c: the loop closes)',
  );
})();

// ── Test 2: on the centreline, the answer is zero ─────────────────────────────
(() => {
  // Sampled at span midpoints so the query lands BETWEEN polyline vertices,
  // where chord error is at its worst. The tolerance is the sag of a 2.8 m chord
  // on this circuit's tightest corner, not a number chosen to make it pass.
  let worst = 0;
  let worstAt = null;
  for (let i = 0; i < 512; i += 1) {
    const t = (i + 0.5) / 512;
    const p = sampleSpline(ROAD.mainPoints, t);
    const r = roadAt(index, p.x, p.z);
    if (Math.abs(r.lateralOffset) > worst) {
      worst = Math.abs(r.lateralOffset);
      worstAt = t;
    }
  }
  assert(worst < 0.1, `T2a: centreline reads ~0 lateral offset (worst ${worst.toFixed(4)} m at t=${worstAt?.toFixed(3)})`);

  const start = roadAt(index, ROAD.mainPoints[0].x, ROAD.mainPoints[0].z);
  assert(start.surface === 'TARMAC', 'T2b: the start line is on tarmac');
  assert(start.halfWidth === 14, `T2c: main half width is 14 m (got ${start.halfWidth})`);
  assert(start.spline === 'MAIN', 'T2d: the start line belongs to the main road');
})();

// ── Test 3: the painted edge reads as the painted edge ────────────────────────
(() => {
  // Walk out from the centreline along the renderer's own normal (scenery.js:325:
  // nx = -tan.z, nz = tan.x) so the geometry under test is the geometry drawn.
  const t = 0.32; // mid-span on the western sweep, away from the wrap seam
  const p = mainCurve.getPointAt(t);
  const tan = mainCurve.getTangentAt(t);
  const nx = -tan.z;
  const nz = tan.x;
  const len = Math.hypot(nx, nz) || 1;

  const at = (distance) => roadAt(
    index,
    p.x + (nx / len) * distance,
    p.z + (nz / len) * distance,
  );

  const edge = at(14);
  assert(Math.abs(Math.abs(edge.lateralOffset) - 14) < 0.15,
    `T3a: a point on the painted edge reads +-halfWidth (got ${edge.lateralOffset.toFixed(3)})`);
  assert(edge.surface === 'TARMAC', 'T3b: the painted edge is still road, not grass');

  assert(at(16).surface === 'GRASS', 'T3c: two metres past the edge is grass');
  assert(at(-16).surface === 'GRASS', 'T3d: grass on the other side too');
  assert(at(16).halfWidth === 14, 'T3e: halfWidth still describes the road you left');

  // The sign is the whole basis of "which barrier do I clamp against" in S2.
  assert(at(10).lateralOffset > 0, 'T4a: the renderer +1 side is positive lateral offset');
  assert(at(-10).lateralOffset < 0, 'T4b: the other side is negative');
  assert(Math.sign(at(10).lateralOffset) !== Math.sign(at(-10).lateralOffset),
    'T4c: the two sides never share a sign');
})();

// ── Test 5: the dirt path resolves against the dirt path ──────────────────────
(() => {
  // Midway along the shortcut, far from both merge ends where the two roads
  // legitimately coincide.
  const p = sampleSpline(ROAD.shortcutPoints, 0.18);
  const r = roadAt(index, p.x, p.z);
  assert(r.spline === 'SHORTCUT', `T5a: a point on the shortcut resolves to SHORTCUT (got ${r.spline})`);
  assert(r.surface === 'DIRT', `T5b: the shortcut is dirt (got ${r.surface})`);
  assert(r.halfWidth === 8, `T5c: shortcut half width is 8 m (got ${r.halfWidth})`);
  assert(r.edge === 'OPEN', 'T5d: the shortcut has no guardrails, so its edge is OPEN');
  assert(Math.abs(r.lateralOffset) < 0.1, 'T5e: and it is on the dirt centreline');
})();

// ── Test 6: the narrow road never steals the wide one ─────────────────────────
(() => {
  // The failure this guards: "nearest centreline" would hand a kart in the middle
  // of the 28 m tarmac to the 16 m dirt spline wherever the dirt passes closer.
  let stolen = 0;
  for (let i = 0; i < 512; i += 1) {
    const p = sampleSpline(ROAD.mainPoints, i / 512);
    if (roadAt(index, p.x, p.z).spline !== 'MAIN') stolen += 1;
  }
  assert(stolen === 0, `T6a: every point on the main centreline resolves to MAIN (${stolen} stolen)`);

  // The shortcut's endpoints ARE main-route gate centres, so both roads are
  // underfoot; the wider one must win because you are further inside it.
  const merge = ROAD.shortcutPoints[3];
  const atMerge = roadAt(index, merge.x, merge.z);
  assert(atMerge.spline === 'MAIN', 'T6b: where the roads coincide, the main road wins');
  assert(atMerge.edge === 'WALL', 'T6c: main-road segments report a WALL edge for S2');

  // THE POINT WHERE THE TWO CANDIDATE RULES ACTUALLY DISAGREE. T6a does not
  // catch it: on the main centreline the main centreline is always the nearer
  // one, so "nearest centreline" and "least overshoot" give the same answer and
  // the rule looks guarded when it is not. (47, 15) is inside the harbour corner,
  // 13.9 m from the tarmac centreline — so ON the 28 m road — but only 8.2 m from
  // the dirt centreline, which is OUTSIDE the 16 m dirt path. Nearest centreline
  // hands it to the shortcut and reports GRASS on tarmac. 920 such points exist
  // on this circuit; this is the one with the widest margin.
  const inside = roadAt(index, 47, 15);
  assert(inside.spline === 'MAIN',
    `T6d: a kart on the tarmac but closer to the dirt centreline is still on the tarmac (got ${inside.spline})`);
  assert(inside.surface === 'TARMAC', `T6e: and it has tarmac grip, not grass (got ${inside.surface})`);
  assert(inside.halfWidth === 14, 'T6f: with the main road half width');
})();

// ── Test 7: the windowed search returns the full scan's answer ────────────────
(() => {
  // R07 required a window instead of a 384-segment scan. This is the proof that
  // the optimisation is invisible in the answers, driven along the centreline at
  // ~1 m per step, which is a kart at the 60 m/s speed ceiling.
  let hint = null;
  let mismatches = 0;
  let offRoad = 0;
  let ties = 0;
  const STEPS = 600;

  for (let i = 0; i < STEPS; i += 1) {
    const p = sampleSpline(ROAD.mainPoints, i / STEPS);
    const hinted = roadAt(index, p.x, p.z, hint);
    const cold = roadAt(index, p.x, p.z, null);

    // WHY THE ANSWER IS COMPARED AND `segmentIndex` IS NOT: the road TOUCHES
    // ITSELF at the start/finish line — the duplicate control point in
    // mainPoints puts four polyline segments at distance exactly 0 from (0,25)
    // (verified: segments 0, 223, 224, 255). Two searches can pick different
    // members of a four-way tie and both be right, because `lateralOffset` IS
    // the distance to the nearest centreline and it agrees. Asserting index
    // equality would be asserting a uniqueness this circuit does not have.
    if (hinted.lateralOffset !== cold.lateralOffset
      || hinted.spline !== cold.spline
      || hinted.surface !== cold.surface
      || hinted.halfWidth !== cold.halfWidth) mismatches += 1;
    if (hinted.segmentIndex !== cold.segmentIndex) ties += 1;
    if (hinted.surface !== 'TARMAC') offRoad += 1;
    hint = hinted.hint;
  }

  assert(mismatches === 0, `T7a: hinted answers are identical to cold answers over a lap (${mismatches} differ)`);
  assert(offRoad === 0, `T7b: a lap driven down the centreline never leaves the tarmac (${offRoad} frames off)`);
  assert(ties <= 1, `T7d: at most one point on the lap is a segment tie (got ${ties})`);

  // Same check on scattered probes rather than a smooth sweep, since a window is
  // only ever as good as the continuity assumption behind it.
  const rand = lcg(20260806);
  let scatterMismatch = 0;
  for (let i = 0; i < 400; i += 1) {
    const x = (rand() - 0.5) * 300;
    const z = (rand() - 0.5) * 300 - 25;
    const cold = roadAt(index, x, z, null);
    const again = roadAt(index, x, z, cold.hint);
    if (again.segmentIndex !== cold.segmentIndex || again.lateralOffset !== cold.lateralOffset) {
      scatterMismatch += 1;
    }
  }
  assert(scatterMismatch === 0, `T7c: a correct hint never changes a cold answer (${scatterMismatch} differ)`);
})();

// ── Test 8: a stale hint is the caller's problem, and it is a real one ────────
(() => {
  // NOT a bug being hidden — a constraint being pinned. race.js teleports an
  // out-of-bounds kart to a cleared gate, which can be most of a lap away. If it
  // keeps the old hint the window looks in the wrong place. The assertion below
  // exists so that whoever wires this into server.js discovers the rule from a
  // failing test rather than from a kart clipping through a wall.
  const near = sampleSpline(ROAD.mainPoints, 0.05);
  const far = sampleSpline(ROAD.mainPoints, 0.55);

  const nearFix = roadAt(index, near.x, near.z, null);
  const teleported = roadAt(index, far.x, far.z, nearFix.hint);
  const honest = roadAt(index, far.x, far.z, null);

  assert(teleported.segmentIndex !== honest.segmentIndex,
    'T8a: a stale hint after a teleport DOES give a wrong segment (callers must clear it)');
  assert(honest.surface === 'TARMAC' && Math.abs(honest.lateralOffset) < 0.1,
    'T8b: and clearing the hint gets the right answer back');
})();

// ── Test 9: bad input fails loudly ───────────────────────────────────────────
(() => {
  const throws = (fn, label) => {
    try { fn(); assert(false, `${label} (did not throw)`); }
    catch { assert(true, label); }
  };

  throws(() => roadAt(index, NaN, 0), 'T9a: a NaN x throws instead of returning segment 0');
  throws(() => roadAt(index, 0, Infinity), 'T9b: a non-finite z throws');
  throws(() => buildRoadIndex(null), 'T9c: a missing road definition throws');
  throws(() => buildRoadIndex({ mainPoints: [{ x: 0, z: 0 }], mainWidth: 1 }),
    'T9d: a road with one control point throws');
  throws(() => buildRoadIndex({ ...ROAD, mainWidth: 0 }), 'T9e: a zero-width road throws');

  // A degenerate definition must not survive as a silently empty index.
  throws(() => buildRoadIndex({
    mainPoints: [{ x: 5, z: 5 }, { x: 5, z: 5 }, { x: 5, z: 5 }],
    mainWidth: 10,
    shortcutPoints: ROAD.shortcutPoints,
    shortcutWidth: 8,
  }), 'T9f: a road whose points all coincide throws rather than collapsing');
})();

// ── Test 10: the index itself is sane and the answers are deterministic ───────
(() => {
  assert(index.MAIN.segments.length > 200,
    `T10a: the main polyline is dense enough to contain a kart (${index.MAIN.segments.length} segments)`);
  assert(index.MAIN.segments.every((s) => s.lengthSq > 0), 'T10b: no zero-length segments survive the build');
  assert(index.MAIN.segments.every((s) => Math.abs(Math.hypot(s.nx, s.nz) - 1) < 1e-12),
    'T10c: every stored normal is a unit vector');

  // The self-touch at the start/finish line, pinned as a fact rather than left
  // as a surprise for whoever builds S2's barriers. `mainPoints` repeats (0,25)
  // as its eighth control point, so the closed spline leaves the start line and
  // comes back to it, and four polyline segments meet there at distance zero.
  // S2 must therefore not assume "one nearest segment ⇒ one barrier side" at
  // the timing line. Deleting the duplicate is an S5 shape decision (it moves
  // the drawn road), so this asserts the world as it is.
  const touching = index.MAIN.segments.filter((s) => {
    const toX = 0 - s.ax;
    const toZ = 25 - s.az;
    let t = (toX * s.dx + toZ * s.dz) / s.lengthSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(0 - (s.ax + s.dx * t), 25 - (s.az + s.dz * t)) < 1e-9;
  }).length;
  assert(touching === 4, `T10h: the road touches itself at the start line (${touching} segments at distance 0)`);

  const a = roadAt(index, 12.5, -33.25, null);
  const b = roadAt(index, 12.5, -33.25, null);
  assert(a.lateralOffset === b.lateralOffset && a.segmentIndex === b.segmentIndex,
    'T10d: the same query twice is bit-identical (RSK-003)');

  // A synthetic straight road, where the right answer can be worked out by hand
  // without trusting the spline at all.
  const straight = buildRoadIndex({
    mainPoints: [{ x: -100, z: 0 }, { x: 100, z: 0 }],
    mainWidth: 20,
    shortcutPoints: [{ x: -100, z: 500 }, { x: 100, z: 500 }],
    shortcutWidth: 10,
  });
  const off = roadAt(straight, 0, 6);
  assert(Math.abs(Math.abs(off.lateralOffset) - 6) < 1e-9,
    `T10e: 6 m off a straight road reads 6 m (got ${off.lateralOffset})`);
  assert(off.surface === 'TARMAC', 'T10f: 6 m off the centre of a 20 m road is still road');
  assert(roadAt(straight, 0, 11).surface === 'GRASS', 'T10g: 11 m off it is not');
})();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('SOME TESTS FAILED ❌');
  process.exit(1);
}
console.log('ALL TESTS PASSED ✅');
process.exit(0);

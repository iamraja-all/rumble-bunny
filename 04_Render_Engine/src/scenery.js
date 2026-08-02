import * as THREE from 'three';
import { CIRCUIT_DEF } from '../../03_Stable_Build/circuit-track.js';

/**
 * scenery.js — the world the circuit sits in.
 *
 * WHY THIS FILE EXISTS:
 * up to now the "coastal stunt circuit" was a grey ribbon floating on an infinite
 * flat green plane. The track geometry was right and the racing worked, but there
 * was nothing to race THROUGH — no coast, no elevation, no barriers, nothing
 * trackside. That is the single biggest gap between this and the arcade racers it
 * is modelled on: those tracks read as places.
 *
 * Everything here is generated in code from CIRCUIT_DEF. Zero downloaded assets,
 * so R06 stays clean and there is no licensing question about any of it.
 *
 * PERF (R07): all of this is built ONCE at scene setup, never per frame. Repeated
 * props use InstancedMesh so a hundred palms cost one draw call, not a hundred —
 * the mistake the kart builder made and that ADR-0006 had to unpick.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE ISLAND WAS RESIZED AND RE-CENTRED (2026-08-02)
 *
 * The first version put a 240 m circular island at the ORIGIN and called it "a
 * generous shoulder". Measured against the actual circuit it was not a shoulder,
 * it was a field, and the coast was invisible from the car:
 *
 *   - Sampling the Catmull-Rom road curves (not the control points — the curve
 *     overshoots them) gives a track hull, including guardrails and gate pillars,
 *     of x[-83.1, 83.3] z[-120.6, 70.6]. That is a loop whose CENTRE is (0, -25),
 *     not (0, 0), and whose worst-case radius about that centre is 99.9 m.
 *   - With the island at the origin the nearest cliff lip was 116 m away at the
 *     north hairpin and over 200 m away on the start/finish straight.
 *   - The chase camera's eye sits 3.4 m above a car at y = 0. Everything below
 *     the grazing ray over the cliff lip is occluded, so the sea can only occupy
 *     atan(eye / shoulder) of vertical frame. At a 116 m shoulder that is 1.68°,
 *     about 24 px of a 900 px frame — and the nearest visible water landed 425 m
 *     out, past the old fog near plane of 300, so those 24 px were haze-coloured,
 *     not blue. From the start/finish straight the water was 766 m out: gone
 *     entirely. The verification screenshot was not unlucky. There was no coast
 *     to photograph from anywhere on the lap.
 *
 * The fix is arithmetic, not art direction:
 *   centre (0, -25), radius 155  → 55.1 m of land beyond the outermost guardrail
 *   at the tightest point of the lap, 71–106 m beyond the racing line itself.
 *   That puts the water band at 1.83°–2.74° (27–40 px) all the way round, with
 *   the nearest visible water at 175–263 m — comfortably inside the fog near
 *   plane, so it renders as actual blue water rather than haze.
 *
 * A rim that FOLLOWED the loop instead of circling it was tried on paper first:
 * offsetting the track hull by 55 m and smoothing it produces radii of 137–155 m.
 * An 18 m wobble is not worth a bespoke polygon, a custom skirt mesh and a
 * non-circular ground plane, so this stays a circle (ponytail rung 7).
 *
 * Sea level is the other half of it. The height of the water band on screen is
 * fixed by the shoulder, NOT by the drop — but a shallower sea puts that same
 * band of pixels at a nearer, less-fogged point on the water plane. Dropping
 * from -9 to -5 moves the nearest visible water from 200 m to 136 m and roughly
 * doubles the crisply blue part of the band. -5 m is still a real cliff to fly
 * off a ramp into.
 */

// ── ISLAND FOOTPRINT — the single source of truth ────────────────────────────
// Exported because renderer.js builds the grass surface from it. It used to
// hard-code CircleGeometry(240) alongside a separate ISLAND_RADIUS = 240 here,
// which is a seam waiting to happen the first time one of the two is edited.
const ISLAND_CENTER_X = 0;
const ISLAND_CENTER_Z = -25;   // the circuit's bounding-box centre, not the origin
const ISLAND_RADIUS = 155;     // 55.1 m clear of the outermost guardrail
const SAND_WIDTH = 18;         // beach starts 37 m beyond the outermost guardrail
const SEA_LEVEL = -5;
const CLIFF_DROP = 26;         // skirt runs from y=0 down to -26, well under the sea
const CLIFF_FLARE = 13;        // bottom radius overhang, so the face is not a pipe
const RIM_SEGMENTS = 96;       // shared by grass, sand and skirt so the edges align

export const ISLAND = Object.freeze({
  x: ISLAND_CENTER_X,
  z: ISLAND_CENTER_Z,
  radius: ISLAND_RADIUS,
  sandInner: ISLAND_RADIUS - SAND_WIDTH,
  seaLevel: SEA_LEVEL,
  rimSegments: RIM_SEGMENTS,
});

export function buildScenery(scene) {
  buildOcean(scene);
  buildIslandAndCliffs(scene);
  buildSeaStacks(scene);
  buildGuardrails(scene, CIRCUIT_DEF.road.mainPoints, CIRCUIT_DEF.road.mainWidth);
  buildPalms(scene);
  buildRocks(scene);
}

/**
 * A big calm sea, sitting below the island so the cliff edge reads as a drop.
 */
function buildOcean(scene) {
  const geo = new THREE.PlaneGeometry(8000, 8000);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1f6d94,
    roughness: 0.18,
    metalness: 0.55,
  });
  const sea = new THREE.Mesh(geo, mat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(ISLAND_CENTER_X, SEA_LEVEL, ISLAND_CENTER_Z);
  scene.add(sea);

  // A paler shallow ring hugging the island.
  //
  // WHY IT IS NOW 240 m WIDE AND NOT 55: the cliff lip occludes everything below
  // the grazing ray, so from a car the first visible water is `shoulder * (eye -
  // seaLevel) / eye` away — at the tightest point that is 136 m from the camera,
  // i.e. about 81 m PAST the lip, at a radius of ~236 m. The old ring stopped at
  // radius + 55 = 210 m, so the entire shallow band was hidden behind the cliff
  // it was meant to trim. It has to reach past where the eye can first see water
  // or it may as well not exist.
  //
  // WHY A VERTEX-COLOUR GRADIENT AND NOT A SECOND FLAT RING: a hard colour ring
  // 240 m wide reads as a painted circle on the sea. Lerping the vertex colour
  // from shore turquoise to exactly the deep-sea colour means the outer edge is
  // invisible — no alpha blending, no shader, still one mesh and one draw call.
  const inner = ISLAND_RADIUS - 6;
  const outer = ISLAND_RADIUS + 240;
  const shallowGeo = new THREE.RingGeometry(inner, outer, RIM_SEGMENTS, 12);
  const pos = shallowGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const shore = new THREE.Color(0x6fd0d2);
  const deep = new THREE.Color(0x1f6d94);
  const c = new THREE.Color();
  const FADE = 110; // metres over which shore colour reaches deep-sea colour
  for (let i = 0; i < pos.count; i++) {
    // RingGeometry is built in XY before it is laid flat, so radius is hypot(x, y).
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    let t = Math.min(1, Math.max(0, (r - inner) / FADE));
    t = t * t * (3 - 2 * t); // smoothstep — no visible banding at either end
    c.copy(shore).lerp(deep, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  shallowGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const shallowMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.22,
    metalness: 0.4,
  });
  const shallow = new THREE.Mesh(shallowGeo, shallowMat);
  shallow.rotation.x = -Math.PI / 2;
  shallow.position.set(ISLAND_CENTER_X, SEA_LEVEL + 0.35, ISLAND_CENTER_Z);
  scene.add(shallow);
}

/**
 * The island: grass surface, sandy rim, and the cliff face that drops to water.
 *
 * WHY a cylinder skirt rather than sculpted terrain: it is one mesh and gives the
 * whole horizon a hard coastal edge. Real terrain would need a heightfield the
 * physics does not have — vehicle-physics assumes a flat ground plane (groundY),
 * so raising the land would put the karts through the floor. Cliffs at the RIM
 * keep the drivable surface flat at y=0, which is the constraint.
 *
 * WHY THE GRASS LIVES HERE NOW: renderer.js used to own it as a bare
 * CircleGeometry(240) at the origin, duplicating a radius this file also declared
 * and ignoring the island centre entirely. One owner, one footprint, no seam.
 */
function buildIslandAndCliffs(scene) {
  // Procedural grass. Deterministic hashing rather than Math.random() so two
  // clients comparing screenshots see the same island (same rule as the palms).
  const grassCanvas = document.createElement('canvas');
  grassCanvas.width = 512;
  grassCanvas.height = 512;
  const gctx = grassCanvas.getContext('2d');
  gctx.fillStyle = '#2d5a27';
  gctx.fillRect(0, 0, 512, 512);
  let h = 0x9e3779b9;
  const rnd = () => {
    h = (h ^ (h << 13)) >>> 0;
    h = (h ^ (h >>> 17)) >>> 0;
    h = (h ^ (h << 5)) >>> 0;
    return h / 0xffffffff;
  };
  for (let i = 0; i < 10000; i++) {
    gctx.fillStyle = rnd() > 0.5 ? '#24491f' : '#366e2f';
    gctx.fillRect(rnd() * 512, rnd() * 512, 2, 2);
  }
  const grassTex = new THREE.CanvasTexture(grassCanvas);
  grassTex.wrapS = THREE.RepeatWrapping;
  grassTex.wrapT = THREE.RepeatWrapping;
  // WHY COMPUTED AND NOT 50: CircleGeometry maps uv across its bounding square,
  // so the tile size on the ground is diameter / repeat. The old pairing (240 m
  // radius, repeat 50) gave one tile per 9.6 m; keeping that constant means the
  // grass does not visibly change scale just because the island shrank.
  const repeat = Math.round((ISLAND_RADIUS * 2) / 9.6);
  grassTex.repeat.set(repeat, repeat);

  const grass = new THREE.Mesh(
    new THREE.CircleGeometry(ISLAND_RADIUS, RIM_SEGMENTS),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1.0, metalness: 0.0 })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(ISLAND_CENTER_X, 0, ISLAND_CENTER_Z);
  grass.receiveShadow = true;
  scene.add(grass);

  // A sandy rim between the grass and the cliff edge. Same segment count and
  // same outer radius as the grass disc, so the two polygons share an edge
  // exactly instead of leaving a hairline of background between them.
  const sand = new THREE.Mesh(
    new THREE.RingGeometry(ISLAND_RADIUS - SAND_WIDTH, ISLAND_RADIUS, RIM_SEGMENTS),
    new THREE.MeshStandardMaterial({ color: 0xd9c79a, roughness: 1.0 })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(ISLAND_CENTER_X, 0.05, ISLAND_CENTER_Z);
  sand.receiveShadow = true;
  scene.add(sand);

  // Cliff skirt: from just OVER the island edge down past the waterline.
  // The +0.35 on the top radius makes the rock overhang the grass disc by a
  // few centimetres rather than meeting it exactly — a polygon edge that meets
  // exactly can still show a lit sliver of sky when viewed along the rim.
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a7f6d, roughness: 0.95, metalness: 0.0 });
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(ISLAND_RADIUS + 0.35, ISLAND_RADIUS + CLIFF_FLARE, CLIFF_DROP, RIM_SEGMENTS, 1, true),
    rockMat
  );
  skirt.position.set(ISLAND_CENTER_X, -CLIFF_DROP / 2, ISLAND_CENTER_Z);
  skirt.receiveShadow = true;
  scene.add(skirt);
}

/**
 * Sea stacks — rock columns standing in the water beyond the cliff.
 *
 * WHY THESE EARN THEIR PLACE: they are the only part of the coast that appears
 * ABOVE the horizon line. The water itself is capped at 1.83°–2.74° of frame by
 * the eye height, but a 26 m stack 200 m out sits +5.0° above the eye, and even
 * the nearest 10 m one clears the cliff-lip grazing ray by 6 m. They turn "the
 * grass stops here" into an unmistakable coastline from any point on the lap,
 * for one InstancedMesh.
 *
 * They sit at radius 175–300 m; the cliff meets the water at 157.5 m, so nothing
 * here can intersect the island or the drivable surface.
 */
function buildSeaStacks(scene) {
  const COUNT = 28;
  // Tapered hexagonal column — narrower at the top, flat-shaded, reads as rock.
  const geo = new THREE.CylinderGeometry(0.45, 1, 1, 6, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0x6f685d, roughness: 1.0, flatShading: true });
  const stacks = new THREE.InstancedMesh(geo, mat, COUNT);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const MIN_R = 175;
  const MAX_R = 300;
  for (let i = 0; i < COUNT; i++) {
    const a = i * 2.39996; // golden angle — even, non-gridded scatter
    // Area-uniform radius over the band, from a golden-ratio low-discrepancy
    // sequence. Deterministic: no Math.random(), so every client sees the same sea.
    const u = (i * 0.61803398875) % 1;
    const r = Math.sqrt(MIN_R * MIN_R + u * (MAX_R * MAX_R - MIN_R * MIN_R));
    const height = 12 + ((i * 7) % 11) * 1.7;   // 12 .. 29 m
    const width = 3.2 + ((i * 5) % 7) * 0.95;   // 3.2 .. 8.9 m
    p.set(
      ISLAND_CENTER_X + Math.cos(a) * r,
      // Base buried a few metres under the water so the column rises out of it.
      SEA_LEVEL - 4 + height / 2,
      ISLAND_CENTER_Z + Math.sin(a) * r
    );
    s.set(width, height, width * (0.7 + ((i * 3) % 5) * 0.15));
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
    m.compose(p, q, s);
    stacks.setMatrixAt(i, m);
  }
  stacks.instanceMatrix.needsUpdate = true;
  stacks.castShadow = true;
  scene.add(stacks);
}

/**
 * Armco running both sides of the main racing line.
 *
 * WHY THIS MATTERS MORE THAN IT SOUNDS: a strip of tarmac on grass reads as a
 * path. The same strip with a rail and posts down each side reads as a RACETRACK.
 * It is the cheapest single cue in the whole scene.
 *
 * The rails are offset perpendicular to the road curve, so they follow every bend
 * rather than being hand-placed and drifting out of sync the moment the circuit
 * changes (the mistake the minimap made with its hardcoded bounds).
 */
function buildGuardrails(scene, points, width) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(p => new THREE.Vector3(p.x, 0, p.z)), true, 'catmullrom', 0.5
  );

  const SAMPLES = 260;
  const offset = width / 2 + 1.6;

  const railMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.55, roughness: 0.45 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6a6f75, metalness: 0.4, roughness: 0.7 });
  const postGeo = new THREE.BoxGeometry(0.22, 1.25, 0.22);

  const postMatrix = new THREE.Matrix4();
  const postsPerSide = Math.floor(SAMPLES / 4);
  const posts = new THREE.InstancedMesh(postGeo, postMat, postsPerSide * 2);
  let postIndex = 0;

  for (const side of [1, -1]) {
    const railPts = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      // Perpendicular to the tangent in the XZ plane.
      const nx = -tan.z;
      const nz = tan.x;
      const len = Math.hypot(nx, nz) || 1;
      const x = p.x + side * offset * (nx / len);
      const z = p.z + side * offset * (nz / len);
      railPts.push(new THREE.Vector3(x, 1.05, z));

      if (i % 4 === 0 && postIndex < posts.count) {
        postMatrix.makeTranslation(x, 0.62, z);
        posts.setMatrixAt(postIndex++, postMatrix);
      }
    }
    const railCurve = new THREE.CatmullRomCurve3(railPts, true);
    const rail = new THREE.Mesh(new THREE.TubeGeometry(railCurve, 300, 0.19, 5, true), railMat);
    rail.castShadow = true;
    scene.add(rail);
  }

  posts.count = postIndex;
  posts.instanceMatrix.needsUpdate = true;
  posts.castShadow = true;
  scene.add(posts);
}

/**
 * Palms scattered on the island, kept clear of the racing line.
 * Two InstancedMeshes total — trunks and crowns — so the whole grove is 2 draw calls.
 */
function buildPalms(scene) {
  const COUNT = 150;
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.42, 7, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4f32, roughness: 0.95 });
  const crownGeo = new THREE.ConeGeometry(3.1, 2.2, 7);
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x2f7d3a, roughness: 0.85, flatShading: true });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, COUNT);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, COUNT);

  const m = new THREE.Matrix4();
  let n = 0;
  // WHY THE BAND CHANGED: the old placement started at radius 55 from the ORIGIN
  // and stopped at ISLAND_RADIUS - 42. Re-centred on (0, -25) with a 155 m island
  // that formula would have crammed every palm into the middle of the loop and
  // left the entire coastal shoulder — the 55 m of land the player actually looks
  // across at the sea — completely bare. Palms now fill the island from just
  // inside the loop out onto the top of the beach.
  const MIN_R = 12;
  const MAX_R = ISLAND_RADIUS - SAND_WIDTH + 8; // a few palms on the sand
  for (let i = 0; i < COUNT * 8 && n < COUNT; i++) {
    // Deterministic placement — no Math.random(), so the island looks identical on
    // every client. Two players comparing screenshots should see the same island.
    const a = i * 2.39996; // golden angle, gives an even non-gridded scatter
    const u = (i * 0.61803398875) % 1;
    // sqrt keeps the density per square metre even instead of bunching at the centre.
    const r = Math.sqrt(MIN_R * MIN_R + u * (MAX_R * MAX_R - MIN_R * MIN_R));
    const x = ISLAND_CENTER_X + Math.cos(a) * r;
    const z = ISLAND_CENTER_Z + Math.sin(a) * r;
    if (isNearRoad(x, z, 18)) continue;

    const s = 0.75 + ((i % 13) / 13) * 0.7;
    m.makeScale(s, s, s);
    m.setPosition(x, 3.5 * s, z);
    trunks.setMatrixAt(n, m);
    m.makeScale(s, s, s);
    m.setPosition(x, 7.4 * s, z);
    crowns.setMatrixAt(n, m);
    n++;
  }
  trunks.count = n;
  crowns.count = n;
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  trunks.castShadow = true;
  crowns.castShadow = true;
  scene.add(trunks);
  scene.add(crowns);
}

/** Rock outcrops for silhouette interest, same instancing rule. */
function buildRocks(scene) {
  const COUNT = 80;
  const geo = new THREE.IcosahedronGeometry(3.4, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x7d766b, roughness: 1.0, flatShading: true });
  const rocks = new THREE.InstancedMesh(geo, mat, COUNT);
  const m = new THREE.Matrix4();
  let n = 0;
  const MIN_R = 20;
  const MAX_R = ISLAND_RADIUS - 3; // out onto the beach, right up to the cliff lip
  for (let i = 0; i < COUNT * 8 && n < COUNT; i++) {
    const a = i * 2.39996;
    const u = (i * 0.7548776662) % 1; // a different low-discrepancy constant to the palms
    const r = Math.sqrt(MIN_R * MIN_R + u * (MAX_R * MAX_R - MIN_R * MIN_R));
    const x = ISLAND_CENTER_X + Math.cos(a) * r;
    const z = ISLAND_CENTER_Z + Math.sin(a) * r;
    if (isNearRoad(x, z, 14)) continue;
    const s = 0.5 + ((i % 9) / 9) * 1.4;
    m.makeScale(s, s * 0.65, s);
    m.setPosition(x, s * 0.9, z);
    rocks.setMatrixAt(n++, m);
  }
  rocks.count = n;
  rocks.instanceMatrix.needsUpdate = true;
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  scene.add(rocks);
}

/**
 * Keep props off the racing line and off the shortcut.
 *
 * WHY THIS IS NOW SAMPLED FROM THE CURVE: it used to measure against the twelve
 * CONTROL points of the two roads. Between (-65,-65) and (-20,-105) there is 60 m
 * of tarmac with no control point anywhere near it, so a "clearance 26" test
 * happily dropped palms in the middle of the road. That never showed while every
 * prop lived 55 m+ from the origin and the track was elsewhere; with the island
 * shrunk to hug the circuit, props are placed right alongside the tarmac and the
 * gap would have been obvious. Clearance is also measured from the road EDGE now,
 * not the centreline, which is what the caller actually means.
 *
 * Cost: 400 samples built once, scanned ~1200 times at scene setup. Never per frame.
 */
let roadSamples = null;
function getRoadSamples() {
  if (roadSamples) return roadSamples;
  roadSamples = [];
  const roads = [
    [CIRCUIT_DEF.road.mainPoints, CIRCUIT_DEF.road.mainWidth],
    [CIRCUIT_DEF.road.shortcutPoints, CIRCUIT_DEF.road.shortcutWidth],
  ];
  for (const [points, width] of roads) {
    const curve = new THREE.CatmullRomCurve3(
      points.map(p => new THREE.Vector3(p.x, 0, p.z)), true, 'catmullrom', 0.5
    );
    const SAMPLES = 200;
    for (let i = 0; i < SAMPLES; i++) {
      const p = curve.getPointAt(i / SAMPLES);
      roadSamples.push({ x: p.x, z: p.z, half: width / 2 });
    }
  }
  return roadSamples;
}

function isNearRoad(x, z, clearance) {
  for (const p of getRoadSamples()) {
    const dx = p.x - x;
    const dz = p.z - z;
    const limit = p.half + clearance;
    if (dx * dx + dz * dz < limit * limit) return true;
  }
  return false;
}

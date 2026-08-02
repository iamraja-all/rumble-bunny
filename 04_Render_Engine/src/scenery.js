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
 */

// The island is sized to comfortably contain the circuit with a margin. The track
// spans roughly x[-80,80], z[-120,80], so 240 of radius leaves a generous shoulder.
const ISLAND_RADIUS = 240;
const SEA_LEVEL = -9;

export function buildScenery(scene) {
  buildOcean(scene);
  buildIslandAndCliffs(scene);
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
  sea.position.y = SEA_LEVEL;
  scene.add(sea);

  // A paler shallow ring hugging the island. Two flat colours plus the cliff is
  // enough to read as "coast" without a shader or a normal map.
  const shallowGeo = new THREE.RingGeometry(ISLAND_RADIUS - 6, ISLAND_RADIUS + 55, 64);
  const shallowMat = new THREE.MeshStandardMaterial({
    color: 0x53b6c4,
    roughness: 0.25,
    metalness: 0.35,
    transparent: true,
    opacity: 0.85,
  });
  const shallow = new THREE.Mesh(shallowGeo, shallowMat);
  shallow.rotation.x = -Math.PI / 2;
  shallow.position.y = SEA_LEVEL + 0.4;
  scene.add(shallow);
}

/**
 * The island top and the cliff face that drops to the water.
 *
 * WHY a cylinder rather than sculpted terrain: an open-ended cylinder skirt is one
 * mesh and gives the whole horizon a hard coastal edge. Real terrain would need a
 * heightfield the physics does not have — vehicle-physics assumes a flat ground
 * plane (groundY), so raising the land would put the karts through the floor.
 * Cliffs at the RIM keep the drivable surface flat, which is the constraint.
 */
function buildIslandAndCliffs(scene) {
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a7f6d, roughness: 0.95, metalness: 0.0 });

  // Cliff skirt: from the island surface down past the waterline.
  const skirtGeo = new THREE.CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS + 14, 26, 72, 1, true);
  const skirt = new THREE.Mesh(skirtGeo, rockMat);
  skirt.position.y = -13;
  skirt.receiveShadow = true;
  scene.add(skirt);

  // A sandy rim between the grass and the cliff edge.
  const sandGeo = new THREE.RingGeometry(ISLAND_RADIUS - 34, ISLAND_RADIUS, 72);
  const sandMat = new THREE.MeshStandardMaterial({ color: 0xd9c79a, roughness: 1.0 });
  const sand = new THREE.Mesh(sandGeo, sandMat);
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = 0.05;
  sand.receiveShadow = true;
  scene.add(sand);
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
  const COUNT = 140;
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.42, 7, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4f32, roughness: 0.95 });
  const crownGeo = new THREE.ConeGeometry(3.1, 2.2, 7);
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x2f7d3a, roughness: 0.85, flatShading: true });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, COUNT);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, COUNT);

  const m = new THREE.Matrix4();
  let n = 0;
  // Deterministic placement — no Math.random(), so the island looks identical on
  // every client. Two players comparing screenshots should see the same island.
  for (let i = 0; i < COUNT * 6 && n < COUNT; i++) {
    const a = i * 2.39996; // golden angle, gives an even non-gridded scatter
    const r = 55 + (i % 97) * 1.75;
    if (r > ISLAND_RADIUS - 42) continue;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (isNearRoad(x, z, 26)) continue;

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
  const COUNT = 70;
  const geo = new THREE.IcosahedronGeometry(3.4, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x7d766b, roughness: 1.0, flatShading: true });
  const rocks = new THREE.InstancedMesh(geo, mat, COUNT);
  const m = new THREE.Matrix4();
  let n = 0;
  for (let i = 0; i < COUNT * 6 && n < COUNT; i++) {
    const a = i * 1.61803 * Math.PI;
    const r = 70 + (i % 61) * 2.4;
    if (r > ISLAND_RADIUS - 18) continue;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (isNearRoad(x, z, 22)) continue;
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

/** Keep props off the racing line and off the shortcut. */
function isNearRoad(x, z, clearance) {
  const all = [...CIRCUIT_DEF.road.mainPoints, ...CIRCUIT_DEF.road.shortcutPoints];
  for (const p of all) {
    const dx = p.x - x;
    const dz = p.z - z;
    if (dx * dx + dz * dz < clearance * clearance) return true;
  }
  return false;
}

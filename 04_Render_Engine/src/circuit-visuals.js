import * as THREE from 'three';
import { CIRCUIT_DEF } from '../../03_Stable_Build/circuit-track.js';

export function buildCircuitMesh(scene) {
  // Road surface
  const drawRoad = (points, width, color) => {
    // Duplicate first point to close loop smoothly for catmull rom
    const curvePoints = points.map(p => new THREE.Vector3(p.x, 0, p.z));
    const curve = new THREE.CatmullRomCurve3(curvePoints, true, 'catmullrom', 0.5);
    const geometry = new THREE.TubeGeometry(curve, 200, width / 2, 8, true);
    geometry.scale(1, 0.05, 1); // Flatten it into a road

    // Procedural Asphalt Texture
    const roadCanvas = document.createElement('canvas');
    roadCanvas.width = 512; roadCanvas.height = 512;
    const rctx = roadCanvas.getContext('2d');
    rctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    rctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 5000; i++) {
      rctx.fillStyle = Math.random() > 0.5 ? '#111' : '#222';
      rctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    const roadTex = new THREE.CanvasTexture(roadCanvas);
    roadTex.wrapS = THREE.RepeatWrapping;
    roadTex.wrapT = THREE.RepeatWrapping;
    roadTex.repeat.set(1, 50);

    const material = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.65, metalness: 0.0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0.1; 
    mesh.receiveShadow = true;
    scene.add(mesh);
  };

  drawRoad(CIRCUIT_DEF.road.mainPoints, CIRCUIT_DEF.road.mainWidth, 0x1a1a1a);
  drawRoad(CIRCUIT_DEF.road.shortcutPoints, CIRCUIT_DEF.road.shortcutWidth, 0x3a2a2a); // Dirt path look

  // Gates (Checkpoints)
  //
  // TWO BUGS FIXED HERE (2026-08-02): this tested `gate.id === 'G0'`, but no gate
  // has that id — the finish gate is 'finish' (circuit-track.js), so the finish was
  // never distinguished. And it passed `gate.width`, which does not exist: gates
  // carry `halfWidth`. That made `width` undefined, so halfW was NaN and every
  // pillar and bar of all nine gates got NaN geometry — the entire checkpoint
  // structure of the circuit rendered as nothing. Confirmed by screenshot: no
  // arches anywhere on the track.
  for (const gate of CIRCUIT_DEF.gates) {
    const isFinish = gate.id === 'finish';
    const isShortcut = gate.id.startsWith('shortcut');
    const gateColor = isFinish ? 0xffdd33 : isShortcut ? 0xff7722 : 0x33ddff;
    createCheckpointGate(scene, gate.center.x, gate.center.z, gate.halfWidth * 2, gateColor, gate.normal, isFinish);
  }

  // Ramps
  for (const pad of CIRCUIT_DEF.launchPads) {
    createRamp3D(scene, pad.x, pad.z, pad.width, pad.length, 2);
  }

  // Item spawner pads
  for (const spawner of CIRCUIT_DEF.itemSpawners) {
    createSpawnerPad(scene, spawner.x, spawner.z);
  }
}

function createRamp3D(scene, x, z, width, length, height) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(length, 0);
  shape.lineTo(0, height);
  shape.closePath();

  const extrudeSettings = { depth: width, bevelEnabled: false };
  const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  const mat = new THREE.MeshStandardMaterial({ color: 0xff8800, roughness: 0.6, metalness: 0.2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  mesh.rotation.y = Math.PI / 2;
  mesh.position.set(x + width / 2, 0, z - length / 2);
  scene.add(mesh);
}

function createSpawnerPad(scene, x, z) {
  const ringGeo = new THREE.TorusGeometry(2, 0.3, 8, 24);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x66ffff });
  ringMat.color.multiplyScalar(1.3);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.3, z);
  scene.add(ring);
}

function createCheckpointGate(scene, x, z, width, color, normal, isFinish = false) {
  const group = new THREE.Group();
  const pillarHeight = isFinish ? 11 : 8;
  const pillarRadius = 0.4;
  const halfW = width / 2;

  const pillarGeo = new THREE.CylinderGeometry(pillarRadius, pillarRadius, pillarHeight, 8);
  const pillarMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.5, metalness: 0.2 });
  
  const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
  leftPillar.position.set(-halfW, pillarHeight / 2, 0);
  group.add(leftPillar);

  const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
  rightPillar.position.set(halfW, pillarHeight / 2, 0);
  group.add(rightPillar);

  const barGeo = new THREE.CylinderGeometry(pillarRadius * 0.7, pillarRadius * 0.7, width, 8);
  const barMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.5, metalness: 0.2 });
  const bar = new THREE.Mesh(barGeo, barMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, pillarHeight, 0);
  group.add(bar);

  // The start/finish line gets a chequered banner slung between the pillars —
  // the single most recognisable piece of furniture on an arcade circuit, and the
  // thing that tells a player at a glance where a lap begins.
  if (isFinish) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    const sq = 32;
    for (let ix = 0; ix < c.width / sq; ix++) {
      for (let iy = 0; iy < c.height / sq; iy++) {
        // WHY NOT PURE WHITE: #ffffff under the directional sun lands well above
        // the bloom threshold of 0.9, and the finish gate sits about 9m in front of
        // the starting grid — so a pure-white chequer filled the entire opening
        // shot with glare. Mid-grey still reads as chequered flag and stays under
        // the threshold.
        g.fillStyle = (ix + iy) % 2 === 0 ? '#b9b9b9' : '#141414';
        g.fillRect(ix * sq, iy * sq, sq, sq);
      }
    }
    const bannerTex = new THREE.CanvasTexture(c);
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(width, 3),
      new THREE.MeshStandardMaterial({ map: bannerTex, side: THREE.DoubleSide, roughness: 0.9 })
    );
    banner.position.set(0, pillarHeight - 2.2, 0);
    group.add(banner);

    // And a chequered strip painted across the tarmac itself.
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(width, 4),
      new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.8 })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.16, 0);
    group.add(road);
  }

  group.position.set(x, 0, z);

  // Align with gate normal (normal points forward through the gate)
  if (normal) {
    const angle = Math.atan2(normal.x, normal.z);
    group.rotation.y = angle;
  }

  scene.add(group);
}

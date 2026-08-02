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
  for (const gate of CIRCUIT_DEF.gates) {
    const isFinish = gate.id === 'G0';
    const gateColor = isFinish ? 0xffffff : 0x00ccff;
    createCheckpointGate(scene, gate.center.x, gate.center.z, gate.width, gateColor, gate.normal);
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

function createCheckpointGate(scene, x, z, width, color, normal) {
  const group = new THREE.Group();
  const pillarHeight = 8;
  const pillarRadius = 0.4;
  const halfW = width / 2;

  const pillarGeo = new THREE.CylinderGeometry(pillarRadius, pillarRadius, pillarHeight, 8);
  const pillarMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.0, roughness: 0.4, metalness: 0.3 });
  
  const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
  leftPillar.position.set(-halfW, pillarHeight / 2, 0);
  group.add(leftPillar);

  const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
  rightPillar.position.set(halfW, pillarHeight / 2, 0);
  group.add(rightPillar);

  const barGeo = new THREE.CylinderGeometry(pillarRadius * 0.7, pillarRadius * 0.7, width, 8);
  const barMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.0, roughness: 0.4, metalness: 0.3 });
  const bar = new THREE.Mesh(barGeo, barMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, pillarHeight, 0);
  group.add(bar);

  group.position.set(x, 0, z);
  
  // Align with gate normal (normal points forward through the gate)
  if (normal) {
    const angle = Math.atan2(normal.x, normal.z);
    group.rotation.y = angle;
  }
  
  scene.add(group);
}

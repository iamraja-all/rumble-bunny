import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ParticleSystem } from './particles.js';

/**
 * Render Engine (Three.js Wrapper)
 *
 * WHY:
 * Isolates all 3D WebGL calls. It maps the incoming headless ledger state
 * (which uses a Right-Handed, Y-Up coordinate system — native to Three.js)
 * directly to visual meshes.
 *
 * Phase 4 upgrade: Supports loading GLTF/GLB models for vehicles.
 * Falls back to a detailed programmatic kart (chassis + 4 wheels + spoiler)
 * if the model file is missing.
 */

// Player color palette — each slot gets a distinct hue
const PLAYER_COLORS = [
  0x00ccff, // P0 — Cyan (local player)
  0xff3333, // P1 — Red
  0x33ff33, // P2 — Green
  0xff9900, // P3 — Orange
  0xcc33ff, // P4 — Purple
  0xffff33, // P5 — Yellow
  0xff66cc, // P6 — Pink
  0x3399ff, // P7 — Blue
];

export class Renderer {
  constructor(canvas) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e); // Twilight dark blue
    this.scene.fog = new THREE.Fog(0x1a1a2e, 50, 300);

    this.camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Track meshes/groups mapped by entity ID (e.g. 'P0' -> Group)
    this.meshes = new Map();

    // GLTF model template (null until loaded, if ever)
    this.kartModelTemplate = null;
    this.kartModelLoaded = false;

    // Particle Systems
    this.smokeSystem = new ParticleSystem(this.scene, 2000);
    this.flameSystem = new ParticleSystem(this.scene, 1000);

    this.setupLighting();
    this.setupEnvironment();
    this.loadAssets();

    // Smooth camera follow state
    this._camPos = new THREE.Vector3(0, 5, 12);
    this._camTarget = new THREE.Vector3();

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // ── ASSET LOADING ─────────────────────────────────────────────────────
  loadAssets() {
    const loader = new GLTFLoader();
    loader.load(
      '/models/kart.glb',
      (gltf) => {
        console.log('✅ GLTF kart model loaded successfully');
        this.kartModelTemplate = gltf.scene;
        this.kartModelTemplate.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        this.kartModelLoaded = true;
      },
      undefined,
      () => {
        // File not found — that's fine, we use the programmatic fallback
        console.log('ℹ️  No kart.glb found — using programmatic kart mesh');
        this.kartModelLoaded = false;
      }
    );
  }

  // ── LIGHTING ──────────────────────────────────────────────────────────
  setupLighting() {
    // Hemisphere light for natural sky/ground ambient (dimmed for twilight)
    const hemiLight = new THREE.HemisphereLight(0x444466, 0x112211, 0.3);
    this.scene.add(hemiLight);

    // Main directional (moonlight)
    const dirLight = new THREE.DirectionalLight(0x88bbff, 0.4);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.top = 120;
    dirLight.shadow.camera.bottom = -120;
    dirLight.shadow.camera.left = -120;
    dirLight.shadow.camera.right = 120;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 300;
    this.scene.add(dirLight);
  }

  // ── ENVIRONMENT ───────────────────────────────────────────────────────
  setupEnvironment() {
    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(500, 500);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x55aa55 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Starting line
    const startGeo = new THREE.PlaneGeometry(100, 5);
    const startMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const startLine = new THREE.Mesh(startGeo, startMat);
    startLine.rotation.x = -Math.PI / 2;
    startLine.position.y = 0.01;
    this.scene.add(startLine);

    // Ramps — use 3D wedge shapes instead of flat planes
    this.createRamp3D(0, -50, 20, 5, 2);   // ramp_1
    this.createRamp3D(0, -150, 20, 5, 3);  // ramp_2

    // Item spawner pads
    this.createSpawnerPad(-5, -30);
    this.createSpawnerPad(5, -30);
    this.createSpawnerPad(0, -100);

    // Checkpoint gates (matching race.js CHECKPOINTS)
    this.createCheckpointGate(0, -40, 40, 0x00ccff, 'CP1');
    this.createCheckpointGate(0, -80, 40, 0x00ccff, 'CP2');
    this.createCheckpointGate(0, -130, 40, 0x00ccff, 'CP3');
    this.createCheckpointGate(0, -180, 40, 0x00ccff, 'CP4');

    // Finish line arch
    this.createCheckpointGate(0, -5, 40, 0xffffff, 'FINISH');
  }

  createRamp3D(x, z, width, length, height) {
    // Build a wedge from a custom buffer geometry
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(length, 0);
    shape.lineTo(0, height);
    shape.closePath();

    const extrudeSettings = { depth: width, bevelEnabled: false };
    const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    const mat = new THREE.MeshLambertMaterial({ color: 0xff8800 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Position and rotate so it sits on the ground with the slope facing +Z (toward the player)
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(x + width / 2, 0, z - length / 2);
    this.scene.add(mesh);
  }

  createSpawnerPad(x, z) {
    // Glowing ring instead of flat circle
    const ringGeo = new THREE.TorusGeometry(2, 0.3, 8, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x66ffff });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.3, z);
    this.scene.add(ring);
  }

  createCheckpointGate(x, z, width, color) {
    const group = new THREE.Group();
    const pillarHeight = 8;
    const pillarRadius = 0.4;
    const halfW = width / 2;

    // Left pillar
    const pillarGeo = new THREE.CylinderGeometry(pillarRadius, pillarRadius, pillarHeight, 8);
    const pillarMat = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.3 });
    const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
    leftPillar.position.set(-halfW, pillarHeight / 2, 0);
    group.add(leftPillar);

    // Right pillar
    const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
    rightPillar.position.set(halfW, pillarHeight / 2, 0);
    group.add(rightPillar);

    // Top bar
    const barGeo = new THREE.CylinderGeometry(pillarRadius * 0.7, pillarRadius * 0.7, width, 8);
    const barMat = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.3 });
    const bar = new THREE.Mesh(barGeo, barMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, pillarHeight, 0);
    group.add(bar);

    group.position.set(x, 0, z);
    this.scene.add(group);
  }

  // ── PROGRAMMATIC KART (FALLBACK) ──────────────────────────────────────
  createProceduralKart(color) {
    const group = new THREE.Group();

    // ─ Chassis ─
    const chassisGeo = new THREE.BoxGeometry(2.0, 0.6, 3.5);
    const chassisMat = new THREE.MeshPhongMaterial({
      color,
      specular: 0x444444,
      shininess: 60,
    });
    const chassis = new THREE.Mesh(chassisGeo, chassisMat);
    chassis.position.y = 0.5;
    chassis.castShadow = true;
    group.add(chassis);

    // ─ Cockpit (rounded top) ─
    const cockpitGeo = new THREE.BoxGeometry(1.4, 0.5, 1.6);
    const cockpitMat = new THREE.MeshPhongMaterial({
      color: 0x222222,
      specular: 0x111111,
      shininess: 80,
    });
    const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
    cockpit.position.set(0, 1.05, -0.2);
    cockpit.castShadow = true;
    group.add(cockpit);

    // ─ Spoiler ─
    const spoilerGeo = new THREE.BoxGeometry(2.2, 0.1, 0.4);
    const spoilerMat = new THREE.MeshPhongMaterial({ color });
    const spoiler = new THREE.Mesh(spoilerGeo, spoilerMat);
    spoiler.position.set(0, 1.2, 1.5);
    spoiler.castShadow = true;
    group.add(spoiler);

    // Spoiler pylons
    for (const side of [-0.8, 0.8]) {
      const pylonGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6);
      const pylonMat = new THREE.MeshPhongMaterial({ color: 0x333333 });
      const pylon = new THREE.Mesh(pylonGeo, pylonMat);
      pylon.position.set(side, 0.95, 1.5);
      group.add(pylon);
    }

    // ─ Wheels (4x) ─
    const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16);
    const wheelMat = new THREE.MeshPhongMaterial({
      color: 0x111111,
      specular: 0x333333,
      shininess: 30,
    });

    const wheelPositions = [
      { x: -1.1, y: 0.4, z: -1.2 }, // front-left
      { x: 1.1, y: 0.4, z: -1.2 },  // front-right
      { x: -1.1, y: 0.4, z: 1.2 },  // rear-left
      { x: 1.1, y: 0.4, z: 1.2 },   // rear-right
    ];

    for (const pos of wheelPositions) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2; // Rotate so cylinder axis is along X
      wheel.position.set(pos.x, pos.y, pos.z);
      wheel.castShadow = true;
      group.add(wheel);

      // Hub cap
      const hubGeo = new THREE.CircleGeometry(0.25, 8);
      const hubMat = new THREE.MeshBasicMaterial({ color: 0x888888 });
      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.rotation.y = pos.x > 0 ? Math.PI / 2 : -Math.PI / 2;
      hub.position.set(
        pos.x + (pos.x > 0 ? 0.16 : -0.16),
        pos.y,
        pos.z
      );
      group.add(hub);
    }

    // ─ Exhaust pipes ─
    for (const side of [-0.5, 0.5]) {
      const exGeo = new THREE.CylinderGeometry(0.12, 0.15, 0.6, 8);
      const exMat = new THREE.MeshPhongMaterial({
        color: 0x666666,
        specular: 0x999999,
        shininess: 100,
      });
      const exhaust = new THREE.Mesh(exGeo, exMat);
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(side, 0.5, 2.0);
      group.add(exhaust);
    }

    // ─ Headlights ─
    for (const side of [-0.6, 0.6]) {
      const lightGeo = new THREE.SphereGeometry(0.15, 8, 8);
      const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });
      const headlight = new THREE.Mesh(lightGeo, lightMat);
      headlight.position.set(side, 0.7, -1.8);
      group.add(headlight);
    }

    return group;
  }

  // ── ENTITY → MESH MAPPING ────────────────────────────────────────────
  getMeshForEntity(entity) {
    if (this.meshes.has(entity.id)) {
      return this.meshes.get(entity.id);
    }

    let mesh;

    if (entity.type === 'VEHICLE') {
      // Determine player color from slot index
      const slotIndex = parseInt(entity.id.replace('P', ''), 10) || 0;
      const color = PLAYER_COLORS[slotIndex % PLAYER_COLORS.length];

      if (this.kartModelLoaded && this.kartModelTemplate) {
        // Clone the GLTF model
        mesh = this.kartModelTemplate.clone();
        // Tint all meshes in the clone
        mesh.traverse((child) => {
          if (child.isMesh) {
            child.material = child.material.clone();
            child.material.color.setHex(color);
          }
        });
      } else {
        // Programmatic fallback
        mesh = this.createProceduralKart(color);
      }

      // Add Headlights (Dynamic SpotLight)
      const headlight = new THREE.SpotLight(0xffffff, 2.0);
      headlight.position.set(0, 1.5, 0.5); // position on the hood
      headlight.angle = Math.PI / 4;
      headlight.penumbra = 0.5;
      headlight.decay = 1.5;
      headlight.distance = 50;
      headlight.castShadow = true;
      headlight.shadow.mapSize.width = 512;
      headlight.shadow.mapSize.height = 512;
      
      // Point the light forward (-Z is forward in local space)
      headlight.target.position.set(0, 0, -10);
      
      mesh.add(headlight);
      mesh.add(headlight.target);

      // Add a small glowing bulb mesh so the player can see the light source
      const bulbGeo = new THREE.SphereGeometry(0.3, 8, 8);
      const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.set(0, 1.5, -1.0); // right on the nose
      mesh.add(bulb);
    } else if (entity.type === 'TRAP') {
      // Spiky yellow sphere
      const geo = new THREE.IcosahedronGeometry(1, 0);
      const mat = new THREE.MeshPhongMaterial({
        color: 0xffcc00,
        specular: 0xffff00,
        shininess: 40,
        flatShading: true,
      });
      mesh = new THREE.Mesh(geo, mat);
    } else if (entity.type === 'PROJECTILE') {
      // Green glowing sphere
      const geo = new THREE.SphereGeometry(0.6, 16, 16);
      const mat = new THREE.MeshPhongMaterial({
        color: 0x00ff44,
        emissive: 0x00ff44,
        emissiveIntensity: 0.5,
        shininess: 100,
      });
      mesh = new THREE.Mesh(geo, mat);
    } else if (entity.type === 'POWERUP_BOOST') {
      // Rotating blue crystal
      const geo = new THREE.OctahedronGeometry(1.0, 0);
      const mat = new THREE.MeshPhongMaterial({
        color: 0x3399ff,
        emissive: 0x1166cc,
        emissiveIntensity: 0.4,
        shininess: 120,
        flatShading: true,
      });
      mesh = new THREE.Mesh(geo, mat);
      // Tag it for animation
      mesh.userData.isPickup = true;
    } else {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshLambertMaterial({ color: 0x888888 });
      mesh = new THREE.Mesh(geo, mat);
    }

    // Enable shadows on single meshes (groups handle it per-child)
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }

    this.scene.add(mesh);
    this.meshes.set(entity.id, mesh);

    return mesh;
  }

  // ── PER-FRAME STATE SYNC ──────────────────────────────────────────────
  updateState(entities, localPid) {
    const activeIds = new Set();
    const time = performance.now() * 0.001; // seconds

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      activeIds.add(entity.id);

      const mesh = this.getMeshForEntity(entity);

      // Position
      mesh.position.set(entity.x, entity.y, entity.z);

      // Rotation
      mesh.rotation.set(entity.rotX, entity.rotY, entity.rotZ, 'YXZ');

      // Animate pickups (hover + spin)
      if (mesh.userData && mesh.userData.isPickup) {
        mesh.position.y += 1.0 + Math.sin(time * 3) * 0.3;
        mesh.rotation.y = time * 2;
      }

      // Vehicle state visual effects
      if (entity.type === 'VEHICLE') {
        const slotIndex = parseInt(entity.id.replace('P', ''), 10) || 0;
        const baseColor = PLAYER_COLORS[slotIndex % PLAYER_COLORS.length];

        // Find the chassis mesh (first direct child mesh, or first child in group)
        const setKartColor = (color) => {
          if (mesh.isGroup) {
            // Color the chassis (first child)
            const chassis = mesh.children[0];
            if (chassis && chassis.isMesh) {
              chassis.material.color.setHex(color);
            }
            // Also color the spoiler (third child)
            const spoiler = mesh.children[2];
            if (spoiler && spoiler.isMesh) {
              spoiler.material.color.setHex(color);
            }
          } else if (mesh.isMesh) {
            mesh.material.color.setHex(color);
          }
        };

        if (entity.state === 'CRASHED') {
          setKartColor(0x333333);
        } else if (entity.state === 'BOOSTING') {
          // Pulse between orange and base color
          const pulse = Math.sin(time * 10) > 0 ? 0xffaa00 : 0xff6600;
          setKartColor(pulse);
        } else {
          setKartColor(baseColor);
        }

        // --- Particles Emission ---
        // Emit 2 particles per frame per effect for density
        const emitCount = 2;
        
        // Calculate a vector pointing backwards based on kart rotation
        const backwardDir = new THREE.Vector3(0, 0, 1);
        backwardDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), entity.rotY);

        if (entity.state === 'DRIFT') {
          for (let k = 0; k < emitCount; k++) {
            // Emit smoke near the rear wheels
            const offset = backwardDir.clone().multiplyScalar(1.2);
            offset.x += (Math.random() - 0.5) * 2.0; // spread left/right
            offset.y += 0.2; // ground level
            
            this.smokeSystem.emit({
              position: mesh.position.clone().add(offset),
              velocity: new THREE.Vector3(
                (Math.random() - 0.5) * 2.0, 
                Math.random() * 2.0 + 1.0, // move up
                (Math.random() - 0.5) * 2.0
              ),
              life: 0.8 + Math.random() * 0.4,
              startScale: 0.5 + Math.random() * 0.5,
              endScale: 1.5,
              color: 0xcccccc
            });
          }
        }

        if (entity.state === 'BOOSTING') {
          for (let k = 0; k < emitCount; k++) {
            // Emit fire from exhaust pipes (rear)
            const offset = backwardDir.clone().multiplyScalar(1.8);
            offset.x += (Math.random() - 0.5) * 1.0;
            offset.y += 0.5;
            
            // Push particles backward based on kart speed
            const exhaustVelocity = backwardDir.clone().multiplyScalar(entity.speed * 0.5 + 5.0);
            exhaustVelocity.x += (Math.random() - 0.5) * 2.0;
            exhaustVelocity.y += (Math.random() - 0.5) * 2.0;

            const isYellow = Math.random() > 0.5;
            this.flameSystem.emit({
              position: mesh.position.clone().add(offset),
              velocity: exhaustVelocity,
              life: 0.2 + Math.random() * 0.2, // short lived
              startScale: 0.8,
              endScale: 0.1,
              color: isYellow ? 0xffff00 : 0xff4400 // yellow or orange-red
            });
          }
        }
      }

      // Camera Follow for local player — smooth lerp
      if (entity.id === localPid) {
        const desiredOffset = new THREE.Vector3(0, 6, 14);
        desiredOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), entity.rotY);

        const desiredPos = mesh.position.clone().add(desiredOffset);

        // Smooth lerp (lower = smoother, higher = snappier)
        this._camPos.lerp(desiredPos, 0.08);
        this._camTarget.lerp(mesh.position, 0.12);

        this.camera.position.copy(this._camPos);
        this.camera.lookAt(this._camTarget);
      }
    }

    // Despawn stale meshes
    for (const [id, mesh] of this.meshes.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        this.meshes.delete(id);
      }
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

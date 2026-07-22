import * as THREE from 'three';
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

    // PS1 Retro Render Effect: Force low resolution and disable antialiasing
    this.renderer.setPixelRatio(0.33); // Renders at 1/3 resolution then scales up
    this.renderer.antialias = false;

    // Smooth camera follow state: High and Wide angle for better visibility
    this._camPos = new THREE.Vector3(0, 10, 18);
    this._camTarget = new THREE.Vector3(0, 0, -10); // Look slightly ahead of the car

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // ── (ASSET LOADING REMOVED FOR PS1 RETRO AESTHETIC) ─────────────────

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
    // PS1 Grass Texture (Low Res 64x64)
    const grassCanvas = document.createElement('canvas');
    grassCanvas.width = 64; grassCanvas.height = 64;
    const gctx = grassCanvas.getContext('2d');
    gctx.fillStyle = '#2d5a27'; gctx.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 500; i++) {
      gctx.fillStyle = Math.random() > 0.5 ? '#24491f' : '#45853b';
      gctx.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
    }
    const grassTex = new THREE.CanvasTexture(grassCanvas);
    grassTex.wrapS = THREE.RepeatWrapping;
    grassTex.wrapT = THREE.RepeatWrapping;
    grassTex.repeat.set(50, 50);
    grassTex.magFilter = THREE.NearestFilter; // PS1 Crunchy Pixels
    grassTex.minFilter = THREE.NearestFilter;

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(1000, 1000);
    const groundMat = new THREE.MeshLambertMaterial({ map: grassTex });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // PS1 Asphalt Texture (Low Res 64x64)
    const roadCanvas = document.createElement('canvas');
    roadCanvas.width = 64; roadCanvas.height = 64;
    const rctx = roadCanvas.getContext('2d');
    rctx.fillStyle = '#222'; rctx.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 500; i++) {
      rctx.fillStyle = Math.random() > 0.5 ? '#1a1a1a' : '#333';
      rctx.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
    }
    // Track boundaries (white lines)
    rctx.fillStyle = '#dddddd';
    rctx.fillRect(2, 0, 4, 64); // left line
    rctx.fillRect(64 - 6, 0, 4, 64); // right line
    
    const roadTex = new THREE.CanvasTexture(roadCanvas);
    roadTex.wrapS = THREE.RepeatWrapping;
    roadTex.wrapT = THREE.RepeatWrapping;
    roadTex.repeat.set(1, 50);
    roadTex.magFilter = THREE.NearestFilter;
    roadTex.minFilter = THREE.NearestFilter;

    // Road plane (X: -40 to 40, Z: +50 to -250)
    const roadWidth = 80; // Total track width is 80 (±40)
    const roadLength = 300;
    const roadGeo = new THREE.PlaneGeometry(roadWidth, roadLength);
    const roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.01, -100);
    road.receiveShadow = true;
    this.scene.add(road);
    
    // PS1 Checkered Starting Line
    const checkCanvas = document.createElement('canvas');
    checkCanvas.width = 64; checkCanvas.height = 64;
    const cctx = checkCanvas.getContext('2d');
    cctx.fillStyle = '#fff'; cctx.fillRect(0, 0, 64, 64);
    cctx.fillStyle = '#000';
    cctx.fillRect(0, 0, 32, 32); cctx.fillRect(32, 32, 32, 32);
    const checkTex = new THREE.CanvasTexture(checkCanvas);
    checkTex.wrapS = THREE.RepeatWrapping; checkTex.wrapT = THREE.RepeatWrapping;
    checkTex.repeat.set(20, 2);
    checkTex.magFilter = THREE.NearestFilter;
    
    const startGeo = new THREE.PlaneGeometry(80, 10);
    const startMat = new THREE.MeshLambertMaterial({ map: checkTex });
    const startLine = new THREE.Mesh(startGeo, startMat);
    startLine.rotation.x = -Math.PI / 2;
    startLine.position.y = 0.02;
    startLine.receiveShadow = true;
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

  // ── STADIUM (HIGH FIDELITY ENVIRONMENT) ───────────────────────────────
  setupStadium() {
    const group = new THREE.Group();
    
    // Grandstands (Left and Right of the track)
    const standLength = 260;
    const standGeo = new THREE.BoxGeometry(20, 20, standLength);
    const standMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    
    // Left stand
    const leftStand = new THREE.Mesh(standGeo, standMat);
    leftStand.position.set(-60, 10, -100);
    leftStand.rotation.z = -Math.PI / 8; // slanted seating
    leftStand.castShadow = true;
    group.add(leftStand);
    
    // Right stand
    const rightStand = new THREE.Mesh(standGeo, standMat);
    rightStand.position.set(60, 10, -100);
    rightStand.rotation.z = Math.PI / 8;
    rightStand.castShadow = true;
    group.add(rightStand);

    // Neon Billboards
    const billboardGeo = new THREE.PlaneGeometry(30, 10);
    const billboardMat = new THREE.MeshBasicMaterial({ color: 0x00ccff }); // Glowing cyan
    
    for (let i = 0; i < 4; i++) {
      const zPos = -30 - (i * 60);
      
      const leftBoard = new THREE.Mesh(billboardGeo, billboardMat);
      leftBoard.position.set(-45, 15, zPos);
      leftBoard.rotation.y = Math.PI / 4;
      group.add(leftBoard);
      
      const rightBoard = new THREE.Mesh(billboardGeo, billboardMat);
      rightBoard.position.set(45, 15, zPos);
      rightBoard.rotation.y = -Math.PI / 4;
      group.add(rightBoard);
    }
    
    // Enclosing stadium walls (Back and Front)
    const wallGeo = new THREE.BoxGeometry(160, 40, 10);
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x050505 });
    
    const backWall = new THREE.Mesh(wallGeo, wallMat);
    backWall.position.set(0, 20, -250);
    group.add(backWall);

    const frontWall = new THREE.Mesh(wallGeo, wallMat);
    frontWall.position.set(0, 20, 50);
    group.add(frontWall);

    this.scene.add(group);
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

  // ── PROGRAMMATIC PS1 MUSCLE CAR ───────────────────────────────────────
  createRetroMuscleCar(hexColor, pid) {
    const group = new THREE.Group();
    
    // PS1 Pixelated Racing Stripe Texture
    const texCanvas = document.createElement('canvas');
    texCanvas.width = 64; texCanvas.height = 64;
    const ctx = texCanvas.getContext('2d');
    ctx.fillStyle = '#' + hexColor.toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, 64, 64);
    // Add white racing stripes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(24, 0, 6, 64);
    ctx.fillRect(34, 0, 6, 64);
    // Draw some pixel "dirt"
    ctx.fillStyle = '#000000';
    ctx.globalAlpha = 0.2;
    for(let i=0; i<30; i++) ctx.fillRect(Math.random()*64, Math.random()*64, 2, 2);
    ctx.globalAlpha = 1.0;

    const bodyTex = new THREE.CanvasTexture(texCanvas);
    bodyTex.magFilter = THREE.NearestFilter;
    const bodyMat = new THREE.MeshLambertMaterial({ map: bodyTex });

    // Lower Chassis (Blocky)
    const chassisGeo = new THREE.BoxGeometry(2, 0.6, 4);
    const chassis = new THREE.Mesh(chassisGeo, bodyMat);
    chassis.position.y = 0.5;
    chassis.castShadow = true;
    group.add(chassis);

    // Cabin (Blocky, slanted back)
    const cabinGeo = new THREE.BoxGeometry(1.6, 0.5, 1.8);
    // Black windows
    const winMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    // Use an array of materials to map the sides differently (simple box mapping)
    const cabinMats = [bodyMat, bodyMat, bodyMat, bodyMat, winMat, winMat];
    const cabin = new THREE.Mesh(cabinGeo, cabinMats);
    cabin.position.set(0, 1.05, -0.2);
    cabin.castShadow = true;
    group.add(cabin);

    // Blocky Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.4, 8); // 8 segments for PS1 look!
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    
    const wheelPositions = [
      [-1, 0.4, 1.2], [1, 0.4, 1.2], // Front
      [-1, 0.4, -1.2], [1, 0.4, -1.2] // Rear
    ];
    
    wheelPositions.forEach(pos => {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(...pos);
      w.castShadow = true;
      group.add(w);
    });

    // Retro Player Tag above car
    const tagCanvas = document.createElement('canvas');
    tagCanvas.width = 128; tagCanvas.height = 32;
    const tctx = tagCanvas.getContext('2d');
    tctx.fillStyle = 'rgba(0,0,0,0.5)'; tctx.fillRect(0,0,128,32);
    tctx.fillStyle = '#fff';
    tctx.font = 'bold 20px "Courier New"'; // Monospace retro font
    tctx.textAlign = 'center';
    tctx.fillText(pid || 'P?', 64, 22);
    const tagTex = new THREE.CanvasTexture(tagCanvas);
    tagTex.magFilter = THREE.NearestFilter;
    const tagMat = new THREE.MeshBasicMaterial({ map: tagTex, transparent: true, side: THREE.DoubleSide });
    const tagGeo = new THREE.PlaneGeometry(1.5, 0.4);
    const tag = new THREE.Mesh(tagGeo, tagMat);
    tag.position.set(0, 2, 0);
    tag.rotation.y = Math.PI; // Face backwards toward camera
    group.add(tag);

    return group;
  }

  // ── ENTITY → MESH MAPPING ────────────────────────────────────────────
  getMeshForEntity(entity, forceCreate = false) {
    if (!forceCreate && this.meshes.has(entity.id)) {
      return this.meshes.get(entity.id);
    }

    let mesh;

    if (entity.type === 'VEHICLE') {
      // Determine player color from slot index
      const slotIndex = parseInt(entity.id.replace('P', ''), 10) || 0;
      const color = PLAYER_COLORS[slotIndex % PLAYER_COLORS.length];

      mesh = this.createRetroMuscleCar(color, entity.id);
      mesh.userData.isProceduralKart = false;

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
          const pulse = Math.sin(time * 10) > 0 ? 0xffaa00 : 0xff6600;
          setKartColor(pulse);
        } else {
          // Keep texture base color
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
        const camOffset = new THREE.Vector3(0, 10, 18);
        camOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), entity.rotY);
        const targetCamPos = mesh.position.clone().add(camOffset);
        this._camPos.lerp(targetCamPos, 0.1);

        // Look slightly ahead of the car to see ramps
        const lookOffset = new THREE.Vector3(0, 0, -10);
        lookOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), entity.rotY);
        const lookTarget = mesh.position.clone().add(lookOffset);
        
        this._camTarget.lerp(lookTarget, 0.1);
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

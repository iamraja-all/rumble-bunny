import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
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
    // WHY: no hard-coded background colour any more — the procedural Sky dome
    // (setupSkyAndEnvironment) fills the backdrop and doubles as the light
    // source for image-based lighting. Fog is a light daytime haze pushed far
    // out so it grounds distant geometry without washing over the sky.
    this.scene.fog = new THREE.Fog(0xbcd4e6, 180, 600);

    this.camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.1,
      2000 // WHY: extended far plane so the 10,000-unit Sky dome stays visible
    );

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // WHY: cap at 1.0 — bloom + IBL is fragment-heavy; on integrated GPUs a 2x
    // pixel ratio quadruples that cost and drops the game to single-digit fps
    // (the "hang"). 1.0 keeps it smooth; the canvas is still crisp at this size.
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // WHY: ACES filmic tone mapping maps the wide dynamic range of a real sky
    // + IBL into displayable colour the way film does — this is the single
    // biggest step from "flat game look" to "real". Exposure trims overall
    // brightness. OutputPass (post-processing) reads this same setting so the
    // tone map is applied once, after bloom, in linear space.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.5; // WHY: 0.85 blew the scene to white; 0.5 gives real contrast

    // Track meshes/groups mapped by entity ID (e.g. 'P0' -> Group)
    this.meshes = new Map();

    // GLTF model template (null until loaded, if ever)
    this.kartModelTemplate = null;
    this.kartModelLoaded = false;
    // PERF: use the lightweight procedural kart instead of the heavy multi-mesh
    // sports-car GLB (11 copies dominated frame cost). Flip to true to A/B the GLB.
    this.useGlbKart = false;

    // Particle Systems
    this.smokeSystem = new ParticleSystem(this.scene, 2000);
    this.flameSystem = new ParticleSystem(this.scene, 1000);

    this.setupLighting();
    this.setupSkyAndEnvironment();
    this.setupEnvironment();
    this.setupPostProcessing();
    this.loadAssets();

    // Smooth camera follow state: High and Wide angle for better visibility
    this._camPos = new THREE.Vector3(0, 10, 18);
    this._camTarget = new THREE.Vector3(0, 0, -10); // Look slightly ahead of the car

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      // WHY: the composer owns its own render targets — they must be resized
      // alongside the renderer or the post-processed image stretches.
      if (this.composer) this.composer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // ── ASSET LOADING ─────────────────────────────────────────────────────
  loadAssets() {
    const loader = new GLTFLoader();
    
    // Add Draco decompression support
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/draco/');
    loader.setDRACOLoader(dracoLoader);
    
    // 1. Load City Environment (Littlest Tokyo CC0)
    loader.load(
      '/models/city.glb?v=' + Date.now(),
      (gltf) => {
        console.log('✅ City environment loaded successfully');
        const city = gltf.scene;
        // Littlest Tokyo is huge, scale it down
        city.scale.set(0.05, 0.05, 0.05);
        city.position.set(0, -2, -50); 
        this.scene.add(city);
      },
      undefined,
      (err) => console.error('Failed to load city:', err)
    );

    // 2. Load Premium F1 / Sports Car (only when GLB karts are enabled)
    if (this.useGlbKart) loader.load(
      '/models/kart.glb?v=' + Date.now(),
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

        // Upgrade any karts that were spawned before the GLTF finished loading!
        for (const [id, oldMesh] of this.meshes.entries()) {
          if (oldMesh.userData.isProceduralKart) {
            this.scene.remove(oldMesh);
            const newMesh = this.getMeshForEntity({ id, type: 'VEHICLE' }, true);
            newMesh.position.copy(oldMesh.position);
            newMesh.quaternion.copy(oldMesh.quaternion);
            this.scene.add(newMesh);
            this.meshes.set(id, newMesh);
          }
        }
      },
      undefined,
      (err) => {
        console.error('ℹ️  No kart.glb found — using programmatic kart mesh', err);
        this.kartModelLoaded = false;
      }
    );
  }

  // ── LIGHTING ──────────────────────────────────────────────────────────
  setupLighting() {
    // WHY: with real image-based lighting from the Sky (setupSkyAndEnvironment)
    // filling in ambient/fill light, the old stack of hemi(1.5)+dir(2.0)+
    // ambient(1.0) is now far too flat and bright — three overlapping fills
    // erase all form. We keep ONE gentle hemisphere for sky/ground colour
    // bounce and ONE strong directional sun; the environment map does the rest.
    const hemiLight = new THREE.HemisphereLight(0xbcd4e6, 0x4a5a3a, 0.25);
    this.scene.add(hemiLight);

    // Main directional (sunlight). Direction is aimed at the Sky's sun in
    // setupSkyAndEnvironment so shadows fall consistently with the visible sun.
    const dirLight = new THREE.DirectionalLight(0xfff4e0, 1.6);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    // PERF: 1024 shadow map (was 2048) — quarters the shadow-pass fill cost on
    // integrated GPUs for a barely-perceptible quality drop at this camera range.
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.top = 120;
    dirLight.shadow.camera.bottom = -120;
    dirLight.shadow.camera.left = -120;
    dirLight.shadow.camera.right = 120;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 300;
    dirLight.shadow.bias = -0.0005; // WHY: kills shadow acne on the flat road/ground
    this.scene.add(dirLight);
    this.scene.add(dirLight.target);
    this.dirLight = dirLight; // stored so the sky setup can aim it at the sun
  }

  // ── SKY + IMAGE-BASED LIGHTING (IBL) ──────────────────────────────────
  setupSkyAndEnvironment() {
    // WHY: a physically-based sky shader (bundled with three, zero external
    // assets — R06-clean) gives a real gradient sky AND, once baked into an
    // environment map via PMREM, becomes the source of realistic reflections
    // and soft fill light on every PBR/Standard material. This is what makes
    // the kart's paint and glass read as "real" instead of matte plastic.
    const sky = new Sky();
    sky.scale.setScalar(10000);
    const u = sky.material.uniforms;
    u['turbidity'].value = 2;        // WHY: lower = less bright white haze
    u['rayleigh'].value = 0.5;       // WHY: lower = dimmer sky, stops IBL washing the scene out
    u['mieCoefficient'].value = 0.005;
    u['mieDirectionalG'].value = 0.8; // sun glow tightness

    // Sun position — mid-afternoon: 28° elevation gives long, readable shadows.
    const sun = new THREE.Vector3();
    const phi = THREE.MathUtils.degToRad(90 - 28);   // elevation
    const theta = THREE.MathUtils.degToRad(150);      // azimuth
    sun.setFromSphericalCoords(1, phi, theta);
    u['sunPosition'].value.copy(sun);

    // Aim the directional sun light to match the visible sun in the sky.
    this.dirLight.position.copy(sun).multiplyScalar(150);
    this.dirLight.target.position.set(0, 0, -100); // centre of the track

    // Bake the sky into an environment map for IBL. PMREM needs a Scene, so we
    // render the sky in a throwaway scene, then keep the sky in the real scene
    // as the visible backdrop. (Standard three.js Sky-example pattern.)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(sky);
    const envTarget = pmrem.fromScene(envScene);
    this.scene.environment = envTarget.texture; // reflections + ambient for all PBR
    // WHY: scale down how strongly the environment map lights the scene, so IBL
    // adds realistic reflections without flooding everything to white.
    this.scene.environmentIntensity = 0.35;
    this.scene.add(sky);                          // visible sky dome
    pmrem.dispose();
  }

  // ── POST-PROCESSING (bloom) ───────────────────────────────────────────
  setupPostProcessing() {
    // WHY: neon billboards, boost flames, and emissive checkpoint gates only
    // "glow" if bright pixels bleed into their neighbours — that's bloom.
    // RenderPass draws the scene in linear HDR, UnrealBloomPass extracts and
    // blurs the bright parts, and OutputPass applies ACES tone mapping + sRGB
    // conversion last (single tone-map, correct order).
    const composer = new EffectComposer(this.renderer);
    composer.setSize(window.innerWidth, window.innerHeight);
    composer.addPass(new RenderPass(this.scene, this.camera));

    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.3,  // strength — subtle glow, was 0.55 (blew out the whole scene)
      0.3,  // radius
      0.9   // threshold — only the brightest emissive/neon pixels bloom
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    this.composer = composer;
  }

  // ── ENVIRONMENT ───────────────────────────────────────────────────────
  setupEnvironment() {
    // Procedural Grass Texture
    const grassCanvas = document.createElement('canvas');
    grassCanvas.width = 512; grassCanvas.height = 512;
    const gctx = grassCanvas.getContext('2d');
    gctx.fillStyle = '#2d5a27'; gctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 10000; i++) {
      gctx.fillStyle = Math.random() > 0.5 ? '#24491f' : '#366e2f';
      gctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    const grassTex = new THREE.CanvasTexture(grassCanvas);
    grassTex.wrapS = THREE.RepeatWrapping;
    grassTex.wrapT = THREE.RepeatWrapping;
    grassTex.repeat.set(50, 50);

    // Ground plane
    // WHY: MeshStandardMaterial (not Lambert) so the grass responds to the
    // IBL environment map and sun with physically-plausible shading. Grass is
    // fully rough / non-metallic.
    const groundGeo = new THREE.PlaneGeometry(1000, 1000);
    const groundMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1.0, metalness: 0.0 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Procedural Asphalt Texture
    const roadCanvas = document.createElement('canvas');
    roadCanvas.width = 512; roadCanvas.height = 512;
    const rctx = roadCanvas.getContext('2d');
    rctx.fillStyle = '#1a1a1a'; rctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 20000; i++) {
      rctx.fillStyle = Math.random() > 0.5 ? '#111' : '#222';
      rctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    // Track boundaries (white lines)
    rctx.fillStyle = '#ffffff';
    rctx.fillRect(10, 0, 15, 512); // left line
    rctx.fillRect(512 - 25, 0, 15, 512); // right line
    
    const roadTex = new THREE.CanvasTexture(roadCanvas);
    roadTex.wrapS = THREE.RepeatWrapping;
    roadTex.wrapT = THREE.RepeatWrapping;
    roadTex.repeat.set(1, 50);

    // Road plane (X: -40 to 40, Z: +50 to -250)
    const roadWidth = 80; // Total track width is 80 (±40)
    const roadLength = 300;
    const roadGeo = new THREE.PlaneGeometry(roadWidth, roadLength);
    // WHY: asphalt is smoother than grass — a lower roughness lets the sky
    // reflect faintly off the surface, reading as real tarmac rather than a
    // flat grey plane.
    const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.65, metalness: 0.0 });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.01, -100);
    road.receiveShadow = true;
    this.scene.add(road);
    
    // Add 3D Stadium
    this.setupStadium();

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

  // ── STADIUM (HIGH FIDELITY ENVIRONMENT) ───────────────────────────────
  setupStadium() {
    const group = new THREE.Group();
    
    // Grandstands (Left and Right of the track)
    // WHY: Standard material so the concrete stands catch the sun/IBL and show
    // form; slight metalness + mid roughness reads as painted concrete.
    const standLength = 260;
    const standGeo = new THREE.BoxGeometry(20, 20, standLength);
    const standMat = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.8, metalness: 0.1 });
    
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
    // WHY: pushed well above 1.0 luminance (colour multiplied bright) so they
    // clear the bloom threshold (0.85) and actually glow through the post pass.
    const billboardGeo = new THREE.PlaneGeometry(30, 10);
    const billboardMat = new THREE.MeshBasicMaterial({ color: 0x33ddff });
    billboardMat.color.multiplyScalar(1.3); // slightly over-bright to trigger a subtle bloom
    
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
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.9, metalness: 0.1 });
    
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

    // WHY: Standard material so the ramp catches sun/IBL like the rest of the
    // scene instead of looking like a flat orange decal.
    const mat = new THREE.MeshStandardMaterial({ color: 0xff8800, roughness: 0.6, metalness: 0.2 });
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
    ringMat.color.multiplyScalar(1.3); // WHY: slightly over-bright so the spawner ring blooms gently
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
    const pillarMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.0, roughness: 0.4, metalness: 0.3 });
    const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
    leftPillar.position.set(-halfW, pillarHeight / 2, 0);
    group.add(leftPillar);

    // Right pillar
    const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
    rightPillar.position.set(halfW, pillarHeight / 2, 0);
    group.add(rightPillar);

    // Top bar
    const barGeo = new THREE.CylinderGeometry(pillarRadius * 0.7, pillarRadius * 0.7, width, 8);
    const barMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.0, roughness: 0.4, metalness: 0.3 });
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
    chassis.receiveShadow = true;
    group.add(chassis);

    // PERF: removed the per-kart RectAreaLight underglow — real-time area lights
    // are expensive and 11 of them recreate the same framerate problem as the
    // spotlights. (A cheap emissive strip could fake underglow later if wanted.)

    // ─ Front Bumper ─
    const bumperGeo = new THREE.CylinderGeometry(0.3, 0.3, 2.2, 8);
    const bumperMat = new THREE.MeshPhongMaterial({ color: 0x222222 });
    const bumper = new THREE.Mesh(bumperGeo, bumperMat);
    bumper.rotation.z = Math.PI / 2;
    bumper.position.set(0, 0.4, -1.8);
    bumper.castShadow = true;
    group.add(bumper);

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
    cockpit.receiveShadow = true;
    group.add(cockpit);

    // ─ Spoiler ─
    const spoilerGeo = new THREE.BoxGeometry(2.2, 0.1, 0.4);
    const spoilerMat = new THREE.MeshPhongMaterial({ color });
    const spoiler = new THREE.Mesh(spoilerGeo, spoilerMat);
    spoiler.position.set(0, 1.2, 1.5);
    spoiler.castShadow = true;
    spoiler.receiveShadow = true;
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
      wheel.receiveShadow = true;
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
  getMeshForEntity(entity, forceCreate = false) {
    if (!forceCreate && this.meshes.has(entity.id)) {
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
        
        // The Ferrari GLTF from three.js examples might need scaling or rotation
        // Adjust these values to match our 2x3.5 physics hitbox (facing -Z)
        mesh.rotation.y = Math.PI; // often facing +Z, we need -Z
        mesh.scale.set(0.8, 0.8, 0.8);

        // Tint ONLY the car body, leave tires/glass alone
        mesh.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            const matName = child.material.name ? child.material.name.toLowerCase() : '';
            if (matName.includes('body') || matName.includes('paint') || matName.includes('color')) {
              child.material = child.material.clone();
              child.material.color.setHex(color);
            }
          }
        });
      } else {
        // Programmatic fallback
        mesh = this.createProceduralKart(color);
        mesh.userData.isProceduralKart = true;
      }

      // PERF (measured): a shadow-casting SpotLight PER kart meant ~11 extra
      // shadow-map render passes every frame — the single biggest framerate
      // cost (removing them took the game from 8fps to 16fps on integrated
      // graphics). In a daytime scene the directional sun already casts real
      // ground shadows for every kart, so per-car headlights add almost nothing
      // visually while costing the most. Removed. (Night tracks, if ever added,
      // can reintroduce ONE shared/cheap light behind a quality tier.)
      // The cheap glowing bulb mesh below is kept purely as a visual cue.

      // Add a small glowing bulb mesh so the player can see the light source
      const bulbGeo = new THREE.SphereGeometry(0.3, 8, 8);
      const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.set(0, 1.5, -1.0); // right on the nose
      mesh.add(bulb);
    } else if (entity.type === 'TRAP') {
      // Spiky yellow sphere. WHY: Standard + emissive so it reacts to IBL and
      // its bright yellow blooms, making the hazard pop on the track.
      const geo = new THREE.IcosahedronGeometry(1, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffcc00,
        emissive: 0xffaa00,
        emissiveIntensity: 1.2,
        roughness: 0.4,
        metalness: 0.3,
        flatShading: true,
      });
      mesh = new THREE.Mesh(geo, mat);
    } else if (entity.type === 'PROJECTILE') {
      // Green glowing sphere — strong emissive so it reads as an energy shell.
      const geo = new THREE.SphereGeometry(0.6, 16, 16);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x00ff44,
        emissive: 0x00ff44,
        emissiveIntensity: 1.4,
        roughness: 0.3,
        metalness: 0.0,
      });
      mesh = new THREE.Mesh(geo, mat);
    } else if (entity.type === 'POWERUP_BOOST') {
      // Rotating blue crystal — emissive core blooms as it hovers/spins.
      const geo = new THREE.OctahedronGeometry(1.0, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x3399ff,
        emissive: 0x1166cc,
        emissiveIntensity: 1.2,
        roughness: 0.2,
        metalness: 0.4,
        flatShading: true,
      });
      mesh = new THREE.Mesh(geo, mat);
      // Tag it for animation
      mesh.userData.isPickup = true;
    } else {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8, metalness: 0.1 });
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
    // WHY: render through the post-processing composer (RenderPass → bloom →
    // OutputPass/tone map) instead of the raw renderer, so bloom and ACES tone
    // mapping are applied every frame.
    this.composer.render();
  }
}

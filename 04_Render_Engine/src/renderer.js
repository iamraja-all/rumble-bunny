import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ParticleSystem } from './particles.js';
import { buildCircuitMesh } from './circuit-visuals.js';
import { buildScenery } from './scenery.js';

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

/**
 * A frozen picture with the engine note still droning is the worst possible
 * failure presentation — it looks like a hang with no cause. These put something
 * on screen so the player (and the next person debugging it) knows what happened.
 */
function showFatalOverlay(message) {
  let el = document.getElementById('rb-fatal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'rb-fatal';
    el.style.cssText =
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
      'z-index:9999;background:rgba(10,8,6,0.82);color:#ffb347;text-align:center;' +
      'font:700 20px/1.5 Bahnschrift,"DIN Alternate","Segoe UI",sans-serif;' +
      'letter-spacing:0.08em;padding:24px;';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.display = 'flex';
}

function hideFatalOverlay() {
  const el = document.getElementById('rb-fatal');
  if (el) el.style.display = 'none';
}

/**
 * Release the GPU resources behind an object and everything under it.
 *
 * WHY THE `shared` GUARD: createProceduralKart deliberately shares one cache of
 * geometries and materials across every kart (that sharing is what took the render
 * from ~209 draw calls back down). Disposing a despawned kart must therefore free
 * ONLY the things unique to it — its per-car paint material — and must never touch
 * the shared cache, or the next kart to spawn would render with destroyed buffers.
 */
function disposeObject(root, shared) {
  const sharedSet = new Set(shared ? Object.values(shared) : []);
  root.traverse((child) => {
    if (!child.isMesh) return;
    if (child.geometry && !sharedSet.has(child.geometry)) child.geometry.dispose();
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of mats) {
      if (!m || sharedSet.has(m)) continue;
      if (m.map) m.map.dispose();
      m.dispose();
    }
  });
}

export class Renderer {
  constructor(canvas) {
    this.scene = new THREE.Scene();
    // WHY: no hard-coded background colour any more — the procedural Sky dome
    // (setupSkyAndEnvironment) fills the backdrop and doubles as the light
    // source for image-based lighting. Fog is a light daytime haze pushed far
    // out so it grounds distant geometry without washing over the sky.
    // WHY PUSHED OUT FROM 180/600: with the chase camera now sitting low and close
    // (see updateState), haze starting at 180 units washed over the mid-ground and
    // the whole frame read as milky. Starting it further out keeps distant geometry
    // grounded without fogging the part of the track the player is actually driving.
    //
    // WHY PUSHED OUT AGAIN, 300/1100 -> 500/1600: the island (scenery.js) is a
    // 155 m disc centred on the circuit, so the furthest LAND the camera can ever
    // see is the far rim at 255 m. Nothing on the island was being fogged at 300
    // anyway — the only thing the near plane touched was the sea. And it hurt
    // there: at a 55 m shoulder the first visible water is 136 m out and the water
    // band runs from there to the horizon, so a near plane of 300 greyed out all
    // but ~13 px of it and the coast read as haze. 500 leaves the whole near sea
    // crisply blue. The far plane stays well under the camera's 2000 unit far
    // plane so the ocean reaches full haze BEFORE it is clipped — otherwise the
    // sea would end in a hard line against the sky.
    this.scene.fog = new THREE.Fog(0xaec9de, 500, 1600);

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

    // WHY THESE TWO HANDLERS EXIST:
    // without a 'webglcontextlost' listener the browser's default behaviour is to
    // drop the context permanently — the canvas simply stops updating, with no
    // error and no console message. Meanwhile audio.js's oscillator runs on its own
    // thread and keeps playing, so the game presents as "frozen picture, sound
    // still going" with nothing anywhere saying why. Reported from play, and it
    // took a screenshot-free guess to even locate. calling preventDefault() is what
    // permits the browser to hand the context BACK, and 'webglcontextrestored' then
    // lets us recover instead of requiring a reload.
    this.contextLost = false;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      console.error('[renderer] WebGL context lost — rendering halted. Attempting recovery.');
      showFatalOverlay('GRAPHICS CONTEXT LOST — attempting to recover…');
    }, false);

    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      console.warn('[renderer] WebGL context restored.');
      hideFatalOverlay();
    }, false);

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
    
    // 1. The Littlest Tokyo city.glb load lived here and has been removed.
    //    WHY: it is a 4.1 MB Japanese street scene parked at (0, -2, -50) in the
    //    middle of a COASTAL circuit — the wrong place entirely, and it was
    //    cache-busted with `?v=' + Date.now()` so every single page load
    //    re-downloaded all 4.1 MB. scenery.js now builds the island, cliffs, sea,
    //    guardrails and palms procedurally: no download, no licence question, and
    //    it actually matches the track it surrounds.

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
    // Centre of the track — MEASURED, not guessed. Sampling the Catmull-Rom road
    // curves gives a hull of x[-83.1, 83.3] z[-120.6, 70.6], so the centre is
    // (0, -25). It said -100, and with the shadow camera only ±120 around the
    // target that put the shadow frustum at z[-220, 20]: the entire return
    // straight and the final corner (out to z = +70) cast no shadows at all,
    // while 100 m of open sea to the north got a shadow pass all to itself.
    this.dirLight.target.position.set(0, 0, -25);

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
      // WHY 0.15 and not 0.3: with the chase camera now low and close to the
      // horizon, driving TOWARD the Sky's sun put the sun disc itself through the
      // bloom pass and washed the whole frame white — verified by screenshot at
      // two different points on the circuit. Halving the strength keeps the glow
      // on genuinely emissive things (gates, taillights, boost) without the sun
      // taking over whenever the track turns west.
      0.15, // strength — was 0.3, and 0.55 before that (blew out the whole scene)
      0.3,  // radius
      0.9   // threshold — only the brightest emissive/neon pixels bloom
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    this.composer = composer;
  }

  // ── ENVIRONMENT ───────────────────────────────────────────────────────
  setupEnvironment() {
    // WHY THE GROUND PLANE IS NO LONGER BUILT HERE: it was a hard-coded
    // CircleGeometry(240) at the origin, sitting next to an ISLAND_RADIUS = 240
    // declared independently in scenery.js. Two numbers that must always agree,
    // in two files, with nothing enforcing it — and the circle was centred on the
    // origin while the circuit's actual bounding-box centre is (0, -25), so the
    // grass and the cliff never really agreed about where the island was anyway.
    // scenery.js now owns the whole island footprint (grass, sand, cliff skirt)
    // and there is only one radius to get wrong.
    buildScenery(this.scene);
    buildCircuitMesh(this.scene);
  }

  // ── PROGRAMMATIC KART (FALLBACK) ──────────────────────────────────────
  createProceduralKart(color) {
    // Shared part cache — built once per renderer, reused by every kart.
    //
    // WHY: the previous builder allocated roughly 19 meshes, 14 geometries AND 14
    // materials PER CAR, none shared. At 11 karts that is ~209 draw calls plus a
    // shadow pass over every one, which is why swapping to "low poly" only reached
    // 46fps instead of the 60 ADR-0006 projected — the cost had moved from triangle
    // count to draw-call count. Geometry and every non-painted material are now
    // shared; only the paint is per-car, because each player picks their own colour.
    const P = this._kartParts || (this._kartParts = {
      body:     new THREE.BoxGeometry(2.00, 0.55, 4.00),
      hood:     new THREE.BoxGeometry(1.86, 0.20, 1.55),
      cabin:    new THREE.BoxGeometry(1.64, 0.62, 1.60),
      roof:     new THREE.BoxGeometry(1.58, 0.14, 1.35),
      scoop:    new THREE.BoxGeometry(0.72, 0.24, 0.85),
      wing:     new THREE.BoxGeometry(2.08, 0.11, 0.46),
      strut:    new THREE.BoxGeometry(0.13, 0.44, 0.13),
      bumper:   new THREE.BoxGeometry(2.06, 0.30, 0.34),
      sill:     new THREE.BoxGeometry(0.16, 0.22, 2.40),
      wheelF:   new THREE.CylinderGeometry(0.46, 0.46, 0.36, 14),
      wheelR:   new THREE.CylinderGeometry(0.58, 0.58, 0.54, 14),
      hub:      new THREE.CylinderGeometry(0.21, 0.21, 0.40, 10),
      exhaust:  new THREE.CylinderGeometry(0.11, 0.11, 0.46, 8),
      lamp:     new THREE.BoxGeometry(0.38, 0.18, 0.10),
      tyre:   new THREE.MeshStandardMaterial({ color: 0x131313, roughness: 0.95, metalness: 0.0 }),
      // WHY metalness 0.7 rather than 1.0: a pure mirror under the Sky IBL pushes
      // every bumper, hub and exhaust tip past the bloom threshold, and with the
      // camera now sitting close behind the car the whole frame whites out. ADR-0005
      // already lost this exact fight once at exposure 0.85.
      chrome: new THREE.MeshStandardMaterial({ color: 0xb6babe, metalness: 0.7, roughness: 0.42 }),
      glass:  new THREE.MeshStandardMaterial({ color: 0x0b1119, metalness: 0.5, roughness: 0.12 }),
      dark:   new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.55, metalness: 0.45 }),
      // Emissive stays low deliberately: the bloom pass runs at threshold 0.9 with
      // strength 0.3, so anything much above ~0.4 here floods the frame rather than
      // glowing. Lamps this close to the camera are the worst offenders.
      head:   new THREE.MeshStandardMaterial({ color: 0xfff7d0, emissive: 0xffefb0, emissiveIntensity: 0.30 }),
      tail:   new THREE.MeshStandardMaterial({ color: 0xff2a10, emissive: 0xff1400, emissiveIntensity: 0.40 }),
    });

    const group = new THREE.Group();

    // Paint is the one per-instance material: each player picks a colour.
    const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.32 });

    // Body panels are tagged so recolouring can find them by intent rather than by
    // child index. The old setKartColor reached for children[0] and children[2] and
    // would silently repaint a wheel the moment the build order changed.
    const add = (geo, mat, x, y, z, isBody = false) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      if (isBody) m.userData.isBody = true;
      group.add(m);
      return m;
    };

    // Forward is -Z (Right-Handed, Y-Up, per spec.md section 1), so the nose is
    // at negative Z and the tail at positive Z.

    // Long, low, wide slab — the muscle-car proportion. Everything else hangs off it.
    add(P.body, paint, 0, 0.62, 0, true);
    add(P.hood, paint, 0, 0.92, -1.28, true);
    add(P.scoop, P.dark, 0, 1.12, -1.22);

    // Greenhouse sits BACK on the body. A cabin pushed forward reads as a van; set
    // back behind the midpoint it reads as a muscle car with a long bonnet.
    add(P.cabin, P.glass, 0, 1.18, 0.42);
    add(P.roof, paint, 0, 1.54, 0.48, true);

    // Rear wing on two struts.
    add(P.strut, P.dark, -0.72, 1.02, 1.82);
    add(P.strut, P.dark, 0.72, 1.02, 1.82);
    add(P.wing, paint, 0, 1.28, 1.82, true);

    // Bumpers and side sills.
    add(P.bumper, P.chrome, 0, 0.52, -2.02);
    add(P.bumper, P.chrome, 0, 0.52, 2.02);
    add(P.sill, P.dark, -1.02, 0.45, 0.1);
    add(P.sill, P.dark, 1.02, 0.45, 0.1);

    // Lights.
    add(P.lamp, P.head, -0.62, 0.78, -2.02);
    add(P.lamp, P.head, 0.62, 0.78, -2.02);
    add(P.lamp, P.tail, -0.62, 0.78, 2.04);
    add(P.lamp, P.tail, 0.62, 0.78, 2.04);

    // Twin exhaust tips.
    const e1 = add(P.exhaust, P.chrome, -0.42, 0.34, 2.16);
    const e2 = add(P.exhaust, P.chrome, 0.42, 0.34, 2.16);
    e1.rotation.x = Math.PI / 2;
    e2.rotation.x = Math.PI / 2;

    // Wheels. Fat rears, narrower fronts — the single cheapest cue that says
    // "muscle car" rather than "go-kart".
    const wheel = (geo, x, z, r) => {
      const w = new THREE.Mesh(geo, P.tyre);
      w.position.set(x, r, z);
      w.rotation.z = Math.PI / 2;
      w.castShadow = true;
      group.add(w);
      const h = new THREE.Mesh(P.hub, P.chrome);
      h.position.set(x, r, z);
      h.rotation.z = Math.PI / 2;
      group.add(h);
    };
    wheel(P.wheelF, -1.02, -1.32, 0.46);
    wheel(P.wheelF, 1.02, -1.32, 0.46);
    wheel(P.wheelR, -1.05, 1.36, 0.58);
    wheel(P.wheelR, 1.05, 1.36, 0.58);

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
        let baseColor = PLAYER_COLORS[slotIndex % PLAYER_COLORS.length];
        if (entity.modifiers && entity.modifiers.color_sync !== undefined) {
          baseColor = entity.modifiers.color_sync;
        }

        // Find the chassis mesh (first direct child mesh, or first child in group)
        // WHY BY TAG AND NOT BY INDEX: this used to repaint mesh.children[0] and
        // mesh.children[2], which only worked while the kart happened to be built
        // chassis-first and spoiler-third. The muscle-car build order is different,
        // so index 2 is now a bonnet scoop — and a positional lookup would happily
        // paint a wheel. createProceduralKart tags every painted panel with
        // userData.isBody, so recolouring follows intent instead of build order.
        const setKartColor = (color) => {
          if (mesh.isGroup) {
            for (const child of mesh.children) {
              if (child.isMesh && child.userData.isBody) {
                child.material.color.setHex(color);
              }
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
        // WHY THE CAMERA CAME DOWN AND IN (2026-08-02):
        // it sat at (0, 10, 18) — ten metres up and eighteen back — which reads as
        // a strategy-game overhead view and flattens all sense of speed. Arcade
        // racers of the Rumble Racing era sit low and close, just behind the
        // bumper, so the road rushes past the bottom of the frame. Dropping to
        // 3.4m up / 8.5m back roughly triples the apparent velocity at the same
        // actual m/s, for free.
        const speedT = Math.min(Math.abs(entity.speed) / 40, 1);

        // Speed pullback: the camera eases back and lowers slightly as the kart
        // gains pace, which is the classic trick for making fast feel fast.
        const camOffset = new THREE.Vector3(0, 3.4 - speedT * 0.5, 8.5 + speedT * 2.2);
        camOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), entity.rotY);
        const targetCamPos = mesh.position.clone().add(camOffset);
        // Snappier follow than 0.1 — a loose camera at this distance feels drunk.
        this._camPos.lerp(targetCamPos, 0.18);

        // Aim at head height a little ahead of the car so ramps and the next gate
        // stay in frame rather than sitting off the top edge.
        const lookOffset = new THREE.Vector3(0, 1.6, -12);
        lookOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), entity.rotY);
        const lookTarget = mesh.position.clone().add(lookOffset);

        this._camTarget.lerp(lookTarget, 0.18);
        this.camera.position.copy(this._camPos);
        this.camera.lookAt(this._camTarget);

        // Widen the lens with speed. A rising FOV at pace is the cheapest and most
        // effective speed cue there is.
        const targetFov = 62 + speedT * 12;
        if (Math.abs(this.camera.fov - targetFov) > 0.05) {
          this.camera.fov += (targetFov - this.camera.fov) * 0.08;
          this.camera.updateProjectionMatrix();
        }
      }
    }

    // Despawn stale meshes — and actually FREE them.
    //
    // WHY THIS LEAKED, AND WHY IT FROZE THE GAME:
    // this used to be scene.remove() + meshes.delete() and nothing else.
    // Removing a mesh from the scene graph drops the JS reference but does NOT
    // release the GPU-side buffers — three.js requires an explicit dispose() on
    // every geometry and material. Items get a brand-new SphereGeometry AND a new
    // material each time they spawn, and track.js respawns all three pickups on a
    // 10-second cycle for the entire race. That is hundreds of orphaned GPU
    // allocations over a few minutes, climbing until the driver drops the WebGL
    // context. When that happens the canvas stops updating but the Web Audio
    // oscillator keeps running on its own thread — the game "freezes with only
    // sound", which is exactly what was reported from play.
    for (const [id, mesh] of this.meshes.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        this.meshes.delete(id);
        disposeObject(mesh, this._kartParts);
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

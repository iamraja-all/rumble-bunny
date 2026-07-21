import * as THREE from 'three';

/**
 * Render Engine (Three.js Wrapper)
 * 
 * WHY:
 * Isolates all 3D WebGL calls. It maps the incoming headless ledger state 
 * (which uses a Right-Handed, Y-Up coordinate system — native to Three.js) 
 * directly to visual meshes.
 */

export class Renderer {
  constructor(canvas) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb); // Sky blue
    
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;

    // Track meshes mapped by ID (e.g. 'P0' -> Mesh)
    this.meshes = new Map();

    this.setupLighting();
    this.setupEnvironment();

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  setupLighting() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.camera.top = 100;
    dirLight.shadow.camera.bottom = -100;
    dirLight.shadow.camera.left = -100;
    dirLight.shadow.camera.right = 100;
    this.scene.add(dirLight);
  }

  setupEnvironment() {
    // A simple green ground plane
    const groundGeo = new THREE.PlaneGeometry(500, 500);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x55aa55 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2; // Flat on XZ plane
    ground.receiveShadow = true;
    this.scene.add(ground);
    
    // Add a checkered starting line at Z=0
    const startGeo = new THREE.PlaneGeometry(100, 5);
    const startMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const startLine = new THREE.Mesh(startGeo, startMat);
    startLine.rotation.x = -Math.PI / 2;
    startLine.position.y = 0.01; // slightly above ground to prevent z-fighting
    this.scene.add(startLine);
  }

  getMeshForEntity(entity) {
    if (this.meshes.has(entity.id)) {
      return this.meshes.get(entity.id);
    }

    // Spawn a new placeholder mesh based on type
    let geometry, material;
    if (entity.type === 'VEHICLE') {
      // Vehicle: Red box
      geometry = new THREE.BoxGeometry(2, 1.5, 4);
      material = new THREE.MeshLambertMaterial({ color: 0xff0000 });
    } else if (entity.type === 'TRAP') {
      // Trap: Yellow sphere
      geometry = new THREE.SphereGeometry(1, 16, 16);
      material = new THREE.MeshLambertMaterial({ color: 0xffff00 });
    } else if (entity.type === 'PROJECTILE') {
      // Projectile: Green sphere
      geometry = new THREE.SphereGeometry(0.8, 16, 16);
      material = new THREE.MeshLambertMaterial({ color: 0x00ff00 });
    } else if (entity.type === 'POWERUP_BOOST') {
      // Boost: Blue box
      geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
      material = new THREE.MeshLambertMaterial({ color: 0x0000ff });
    } else {
      geometry = new THREE.BoxGeometry(1, 1, 1);
      material = new THREE.MeshLambertMaterial({ color: 0x888888 });
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    
    this.scene.add(mesh);
    this.meshes.set(entity.id, mesh);
    
    return mesh;
  }

  updateState(entities, localPid) {
    // Track active IDs to despawn stale meshes (e.g. consumed items or disconnected players)
    const activeIds = new Set();

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      activeIds.add(entity.id);
      
      const mesh = this.getMeshForEntity(entity);
      
      // Update position
      // Add half height so the box sits on the ground
      const halfHeight = entity.type === 'VEHICLE' ? 0.75 : 0.5;
      mesh.position.set(entity.x, entity.y + halfHeight, entity.z);

      // Update rotation
      // Euler order 'YXZ' allows yaw to be independent of pitch/roll
      mesh.rotation.set(entity.rotX, entity.rotY, entity.rotZ, 'YXZ');
      
      // Simple visual flair for states
      if (entity.type === 'VEHICLE') {
        if (entity.state === 'CRASHED') {
          mesh.material.color.setHex(0x333333); // Greyed out
        } else if (entity.state === 'BOOSTING') {
          mesh.material.color.setHex(0xffaa00); // Orange flame
        } else {
          // If it's my vehicle, make it cyan to stand out
          if (entity.id === localPid) {
            mesh.material.color.setHex(0x00ffff);
          } else {
            mesh.material.color.setHex(0xff0000); // Normal red
          }
        }
      }

      // Camera Follow for local player
      if (entity.id === localPid) {
        // Position camera behind and above the kart
        const camOffset = new THREE.Vector3(0, 5, 12);
        // Rotate offset by kart's yaw
        camOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), entity.rotY);
        
        this.camera.position.copy(mesh.position).add(camOffset);
        this.camera.lookAt(mesh.position);
      }
    }

    // Clean up meshes that are no longer in the ledger
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

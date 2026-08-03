import * as THREE from 'three';

/**
 * Instanced Particle System
 * 
 * WHY:
 * For performance, we use THREE.InstancedMesh. This allows us to draw thousands
 * of particles (smoke, fire) in a single WebGL draw call.
 * This runs purely on the client and is not tracked by the server ledger.
 */

export class ParticleSystem {
  constructor(scene, maxParticles = 2000) {
    this.maxParticles = maxParticles;
    this.particleIndex = 0;
    // How many slots currently hold a living particle. Kept so update() can tell an
    // idle system from a busy one in one integer compare — see the WHY in update().
    this.liveCount = 0;

    // Use a simple box geometry for a low-poly/voxel aesthetic
    const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    
    // We use a basic material to avoid expensive lighting calculations on particles,
    // but allow vertex colors so each instance can have its own color.
    const material = new THREE.MeshBasicMaterial({ 
      color: 0xffffff,
      transparent: true,
      opacity: 0.8
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, maxParticles);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    
    // We will update colors per instance
    this.colorArray = new Float32Array(maxParticles * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.colorArray, 3);
    
    // Hide all particles initially (scale 0)
    const dummy = new THREE.Object3D();
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    for (let i = 0; i < maxParticles; i++) {
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    scene.add(this.mesh);

    // Track particle state CPU-side
    this.particles = new Array(maxParticles);
    for (let i = 0; i < maxParticles; i++) {
      this.particles[i] = {
        life: 0,
        maxLife: 0,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        startScale: 1.0,
        endScale: 0.0,
        color: new THREE.Color()
      };
    }

    this._dummy = new THREE.Object3D();
  }

  /**
   * Emit a new particle.
   */
  emit(options) {
    const p = this.particles[this.particleIndex];

    // Read the OLD life before overwriting it: claiming a dead slot adds a living
    // particle, but the ring buffer wrapping onto a still-living one just replaces
    // it, so the count must not move. Getting this backwards would drift liveCount
    // upward forever and permanently defeat the idle skip in update().
    if (p.life <= 0) this.liveCount++;

    p.life = options.life || 1.0;
    p.maxLife = p.life;
    
    if (options.position) p.position.copy(options.position);
    if (options.velocity) p.velocity.copy(options.velocity);
    
    p.startScale = options.startScale !== undefined ? options.startScale : 1.0;
    p.endScale = options.endScale !== undefined ? options.endScale : 0.0;
    
    if (options.color) p.color.setHex(options.color);

    // Write initial color
    p.color.toArray(this.colorArray, this.particleIndex * 3);
    this.mesh.instanceColor.needsUpdate = true;

    // Advance ring buffer index
    this.particleIndex = (this.particleIndex + 1) % this.maxParticles;
  }

  /**
   * Update particle positions and scales based on life.
   */
  update(dt) {
    // WHY THIS EARLY OUT EXISTS (R07):
    // this loop used to walk every one of maxParticles slots on every frame and, if
    // even ONE particle was alive, flag the whole instanceMatrix for re-upload.
    // Across both systems that is 3000 instances x 16 floats x 4 bytes = ~192 KB
    // pushed to the GPU every frame, ~11 MB/s, for the entire race. But smoke only
    // exists while a kart is DRIFTing and flames only while BOOSTING, so the common
    // case is nothing alive at all — paying full price for an empty system. A live
    // count turns those frames into one integer compare, and hiding the mesh drops
    // its draw call and frustum test too. The audit flagged this cost; measuring the
    // freeze is what finally made it worth fixing.
    if (this.liveCount === 0) {
      if (this.mesh.visible) this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    let needsUpdate = false;

    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particles[i];
      if (p.life > 0) {
        // Decrease life
        p.life -= dt;

        if (p.life <= 0) {
          this.liveCount--;
          // Die -> scale to 0
          this._dummy.scale.set(0, 0, 0);
          this._dummy.updateMatrix();
          this.mesh.setMatrixAt(i, this._dummy.matrix);
        } else {
          // Move
          p.position.addScaledVector(p.velocity, dt);
          
          // Shrink (or grow) over time
          const t = 1.0 - (p.life / p.maxLife); // 0.0 to 1.0
          const currentScale = p.startScale + (p.endScale - p.startScale) * t;
          
          this._dummy.position.copy(p.position);
          
          // Add some spin for visual flair based on time
          const spin = p.life * 5.0;
          this._dummy.rotation.set(spin, spin, 0);
          
          this._dummy.scale.set(currentScale, currentScale, currentScale);
          this._dummy.updateMatrix();
          
          this.mesh.setMatrixAt(i, this._dummy.matrix);
        }
        
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

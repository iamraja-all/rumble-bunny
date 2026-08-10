# Rumble Racing Transformation Plan

## Overview
Transforming "Coastal Stunt Circuit" into a **Rumble Racing-style combat racer** with real-life licensed car aesthetics.

---

## Phase 1: Combat System (Priority #1)

### 1.1 Weapon Types
Create diverse weapon arsenal inspired by Rumble Racing/Blur:
- **Missile** - Homing projectile that targets nearest opponent
- **Mine** - Deployable trap that explodes on contact
- **Shockwave** - Area-of-effect blast that knocks back nearby vehicles
- **Boost Pack** - Instant speed burst + temporary invincibility
- **EMP Burst** - Disables opponents' controls temporarily
- **Shield** - Temporary protection from one hit

### 1.2 Combat Physics
Modify `vehicle-physics.js`:
```javascript
// New functions needed:
- applyImpactForce(vehicle, direction, magnitude)
- fireProjectile(owner, type, position, rotation)
- checkWeaponCollisions(projectiles, vehicles)
- applyDamage(vehicle, amount, type)
- handleVehicleSpinout(vehicle)
- applyEMPEffect(vehicle, duration)
```

### 1.3 Item Box System
- Place item boxes EVERYWHERE on track (not just 3 spawners)
- RNG distribution weighted toward trailing players (rubber-banding)
- Allow holding 2 items simultaneously
- Add weapon switching UI

---

## Phase 2: Arcade Physics Overhaul

### 2.1 Physics Tuning for "Rumble" Feel
Current: Simulation-focused racing
Needed: Arcade combat physics

Changes to `vehicle-physics.js`:
```javascript
// Increase drift reward
DRIFT_SPEED_BONUS = 1.15; // Gain speed from sliding

// Add bump combat
BUMP_FORCE_BASE = 25; // Force applied on vehicle-to-vehicle contact
BUMP_SPEED_BONUS = 0.08; // % of speed lost transferred to hitter

// Air control enhancement
AIR_STEER_MULT = 0.6; // Can steer significantly while airborne

// Contact rewards
RAMMING_BONUS = 0.05; // Small speed boost when hitting another car
```

### 2.2 Vehicle-to-Vehicle Collision
Currently missing entirely! Need:
- Bounding sphere collision detection between karts
- Elastic collision response with mass consideration
- Spin-out chance based on impact angle/speed
- Visual feedback (screen shake, spark particles)

---

## Phase 3: Real-Life Car Aesthetics

### 3.1 Car Models & Names
Replace procedural karts with GLTF models of real car types:

| Class | Inspiration | Characteristics |
|-------|-------------|-----------------|
| **Muscle** | Ford Mustang, Dodge Challenger | High top speed, heavy, strong ramming |
| **Sport** | Porsche 911, Nissan GT-R | Balanced handling, good acceleration |
| **Hypercar** | Bugatti Chiron, Koenigsegg | Extreme speed, fragile, expensive |
| **Off-Road** | Ford Bronco, Jeep Wrangler | Great off-road, slow on pavement |
| **Tuner** | Subaru WRX, Mitsubishi Evo | Quick acceleration, excellent handling |
| **Classic** | Mini Cooper, Fiat 500 Abarth | Small hitbox, nimble, low top speed |

### 3.2 Visual Style Changes
Modify `renderer.js`:
```javascript
// Camera changes for arcade feel
this._camPos = new THREE.Vector3(0, 12, 22); // Higher, further back
this.camera.fov = 80; // Wider FOV = more speed sensation

// Motion blur on boosts
// Screen shake on impacts
// Exaggerated particle effects
// Bold, saturated colors (less realistic, more arcade)
```

### 3.3 Car Customization
- Paint jobs (metallic, matte, pearlescent)
- Vinyl decals (racing stripes, flames, sponsors)
- Rim styles
- Neon underglow
- Performance visual upgrades (spoilers, body kits)

---

## Phase 4: Track Redesign for Combat

### 4.1 Arena Sections
Add to `circuit-track.js`:
- **Colosseum Zone**: Circular arena with multiple levels, jump pads into crowd
- **Gauntlet**: Narrow corridor with moving obstacles (crushing walls, spinning blades)
- **Mayhem Square**: Wide open area designed for chaotic multi-car battles

### 4.2 Interactive Hazards
- Exploding barrels (shoot them!)
- Jump ramps that launch INTO opponents
- Speed strips that activate traps
- Destructible barriers

### 4.3 Verticality
- Multi-level sections
- Loop-de-loops (simplified geometry)
- Wall-ride segments (arcade physics允许)

---

## Phase 5: Game Modes

### 5.1 Rumble Modes
- **Last Driver Standing**: Elimination until one remains
- **King of the Hill**: Hold zones for points
- **Team Deathmatch**: 4v4 combat racing
- **Survival**: Shrinking playfield, environmental hazards increase

### 5.2 Traditional Modes (Keep Existing)
- Circuit Racing
- Time Trial
- Elimination Lap

---

## Phase 6: Visual & Audio Polish

### 6.1 HUD Improvements
```javascript
// Add to hud.js:
- Weapon inventory display
- Damage indicator per player
- Combo counter (hits without being hit)
- Elimination feed ("P1 knocked out P3!")
- Radial speedometer (arcade style)
```

### 6.2 Particle Effects
- Explosions (multiple scales)
- Spark trails on contact
- Smoke from damaged vehicles
- Boost flames (color-coded by car class)
- EMP visual distortion

### 6.3 Audio (Future)
- Engine notes per car class
- Weapon firing sounds
- Impact/crash SFX
- Voice lines ("Got rekt!", "Payback!")

---

## File Modification Summary

### Modify These Files:
1. `/workspace/03_Stable_Build/vehicle-physics.js` - Combat physics
2. `/workspace/03_Stable_Build/items-physics.js` - Weapon system expansion
3. `/workspace/03_Stable_Build/circuit-track.js` - Arena sections, hazards
4. `/workspace/04_Render_Engine/src/renderer.js` - Car models, camera, effects
5. `/workspace/04_Render_Engine/src/hud.js` - Combat UI
6. `/workspace/04_Render_Engine/src/particles.js` - Explosion/combat particles

### Create These Files:
1. `/workspace/03_Stable_Build/combat-system.js` - Core combat logic
2. `/workspace/03_Stable_Build/weapons.js` - Weapon definitions
3. `/workspace/03_Stable_Build/car-classes.js` - Real car stats & names
4. `/workspace/04_Render_Engine/src/car-models.js` - GLTF model loader
5. `/workspace/04_Render_Engine/src/customization.js` - Car customization UI

---

## Estimated Timeline
- **Week 1-2**: Combat system + weapons
- **Week 3**: Arcade physics overhaul
- **Week 4-5**: Car models & customization
- **Week 6**: Track redesign
- **Week 7**: Game modes + polish

---

## Key Success Metrics
1. ✅ Every race has at least 3 weapon pickups per player
2. ✅ Vehicle-to-vehicle contact feels impactful (screen shake, audio)
3. ✅ Cars are recognizable real-world models with proper names
4. ✅ Camera and FOV create speed sensation
5. ✅ At least one dedicated arena section per track
6. ✅ Last-man-standing mode is fully playable


import './style.css';
import { NetworkController } from './network.js';
import { Renderer } from './renderer.js';
import { HUD } from './hud.js';

// Get canvas
const canvas = document.querySelector('#app');

// Initialize WebGL Renderer
const renderer = new Renderer(canvas);

// Initialize HUD Overlay
const hud = new HUD();

// Initialize Network (WebSocket)
const network = new NetworkController('ws://localhost:8080');

let lastTime = performance.now();

// 60fps Animation Loop
function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = (now - lastTime) / 1000.0;
  lastTime = now;

  const state = network.getLatestState();
  if (state && state.length > 0) {
    renderer.updateState(state, network.pid);
    hud.update(state, network.pid, network.raceInfo);
  } else {
    // Still update HUD for countdown even before entities arrive
    hud.update([], network.pid, network.raceInfo);
  }
  
  // Update particles
  renderer.smokeSystem.update(dt);
  renderer.flameSystem.update(dt);

  renderer.render();
}

// Start the loop
animate();

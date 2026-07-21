import './style.css';
import { NetworkController } from './network.js';
import { Renderer } from './renderer.js';
import { HUD } from './hud.js';
import { SoundEngine } from './audio.js';

// Get canvas
const canvas = document.querySelector('#app');

// Initialize WebGL Renderer
const renderer = new Renderer(canvas);

// Initialize Audio Engine
const audio = new SoundEngine();

// Initialize HUD Overlay (pass audio so it can trigger SFX)
const hud = new HUD(audio);

// Browsers require user interaction to start AudioContext
document.body.addEventListener('click', () => {
  audio.init();
  const msg = document.getElementById('audio-prompt');
  if (msg) msg.remove();
}, { once: true });

// Add a simple "Click to Start" overlay
const prompt = document.createElement('div');
prompt.id = 'audio-prompt';
prompt.style.cssText = `
  position: absolute; top: 20px; left: 50%; transform: translateX(-50%);
  background: rgba(0,204,255,0.2); border: 1px solid #0cf;
  color: #0cf; padding: 10px 20px; border-radius: 8px;
  font-family: Orbitron, sans-serif; font-size: 14px;
  cursor: pointer; z-index: 1000; backdrop-filter: blur(4px);
`;
prompt.textContent = '🔊 CLICK ANYWHERE TO ENABLE AUDIO';
document.body.appendChild(prompt);

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
    
    // Update audio engine pitch based on local player speed
    const localVehicle = state.find(v => v.id === network.pid);
    if (localVehicle) {
      audio.update(localVehicle);
    }
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

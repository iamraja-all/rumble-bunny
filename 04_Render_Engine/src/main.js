import './style.css';
import { NetworkController } from './network.js';
import { Renderer } from './renderer.js';
import { HUD } from './hud.js';
import { SoundEngine } from './audio.js';
import { Minimap } from './minimap.js';
import { MainMenu } from './menu.js';

// Get canvas
const canvas = document.querySelector('#app');

// Initialize WebGL Renderer
const renderer = new Renderer(canvas);

// Initialize Audio Engine
const audio = new SoundEngine();

// Initialize HUD Overlay (pass audio so it can trigger SFX)
const hud = new HUD(audio);

// Initialize Minimap
const minimap = new Minimap();

let network = null;
let lastTime = performance.now();

// Instantiate the Main Menu
const menu = new MainMenu((selectedColor) => {
  // 1. User clicked "ENTER LOBBY"
  
  // Browsers require user interaction to start AudioContext, this click qualifies
  audio.init();

  // 2. Connect to the WebSocket
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  network = new NetworkController(wsUrl);
  
  // NOTE: For now, the color is selected but we aren't sending it to the server yet.
  // In a future phase, we will pass it in the INIT message so the server spawns 
  // the kart with the correct color!

  // Start the animation loop
  lastTime = performance.now();
  requestAnimationFrame(animate);
});

// 60fps Animation Loop
function animate() {
  requestAnimationFrame(animate);
  if (!network) return;

  const now = performance.now();
  const dt = (now - lastTime) / 1000.0;
  lastTime = now;

  const state = network.getLatestState();
  if (state && state.length > 0) {
    // Hide menu and show HUD once race state begins broadcasting
    if (network.raceInfo.state === 'COUNTDOWN' || network.raceInfo.state === 'RACING') {
      menu.hide();
      document.getElementById('hud').style.display = 'block';
    }
    renderer.updateState(state, network.pid);
    hud.update(state, network.pid, network.raceInfo);
    
    // Update audio engine pitch based on local player speed
    const localVehicle = state.find(v => v.id === network.pid);
    if (localVehicle) {
      audio.update(localVehicle);
    }
    
    // Draw minimap
    minimap.draw(state, network.pid);
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

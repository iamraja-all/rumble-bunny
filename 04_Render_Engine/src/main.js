import './style.css';
import { NetworkController } from './network.js';
import { Renderer } from './renderer.js';
import { HUD } from './hud.js';
import { SoundEngine } from './audio.js';
import { Minimap } from './minimap.js';
import { MainMenu } from './menu.js';
import { startProbe, exposeRenderer, exposeHud } from './debug-probe.js';

// Get canvas
const canvas = document.querySelector('#app');

// Initialize WebGL Renderer
const renderer = new Renderer(canvas);

// GPU/JS resource sampler for the P3f freeze hunt. No-op unless the URL has
// ?debug — see debug-probe.js for why the samples are persisted rather than
// held on window.
const probeTick = startProbe(renderer);
exposeRenderer(renderer);

// Initialize Audio Engine
const audio = new SoundEngine();

// Initialize HUD Overlay (pass audio so it can trigger SFX)
const hud = new HUD(audio);
exposeHud(hud);

// Initialize Minimap
const minimap = new Minimap();

let network = null;
let lastTime = performance.now();

// Instantiate the Main Menu
const menu = new MainMenu((action) => {
  if (action.type === 'START') {
    if (network && network.ws.readyState === WebSocket.OPEN) {
      network.ws.send('START');
    }
    return;
  }
  
  // 1. User clicked HOST or JOIN
  
  // Browsers require user interaction to start AudioContext, this click qualifies
  audio.init();

  // 2. Connect to the WebSocket
  const isLocalDev = window.location.port === '5173';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = isLocalDev 
    ? `ws://localhost:8080` 
    : `${protocol}//${window.location.host}`;
  network = new NetworkController(wsUrl, action);
  
  // NOTE: For now, the color is selected but we aren't sending it to the server yet.
  // In a future phase, we will pass it in the INIT message so the server spawns 
  // the kart with the correct color!

// Start the animation loop
  // lastTime is already set, just let the existing loop continue
});

// The boot splash (index.html) has done its job now that the menu is on screen — it
// only covers the gap between first paint and this bundle finishing parsing. Removed
// rather than hidden so it can never swallow a click, and removed here rather than on
// window.load because load also waits on assets the menu does not need.
document.getElementById('boot-splash')?.remove();

// WHY A GLOBAL ERROR TRAP:
// animate() schedules its next frame BEFORE running its body, so an exception in
// the body does not stop the loop — it just throws again every single frame. The
// visible result is a picture frozen on the last good frame while audio.js's
// oscillator keeps droning on its own thread, i.e. "the game is stuck and I can
// only hear sound", with nothing on screen explaining it. This turns that silent
// state into a stated one. It fires once and then stops, so a per-frame throw
// cannot flood the console.
let _reportedFatal = false;
window.addEventListener('error', (e) => {
  if (_reportedFatal) return;
  _reportedFatal = true;
  console.error('[fatal] render loop threw:', e.error || e.message);
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'z-index:9999;background:rgba(10,8,6,0.82);color:#ffb347;text-align:center;' +
    'font:700 18px/1.5 Bahnschrift,"DIN Alternate","Segoe UI",sans-serif;padding:24px;';
  el.textContent = 'RENDER ERROR — ' + (e.message || 'unknown') + ' (see console)';
  document.body.appendChild(el);
});

// 60fps Animation Loop
function animate() {
  requestAnimationFrame(animate);
  probeTick();

  const now = performance.now();
  const dt = (now - lastTime) / 1000.0;
  lastTime = now;

  if (!network) {
    // Menu background animation
    const time = now * 0.0005;
    const radius = 60;
    renderer.camera.position.set(Math.sin(time) * radius, 30, Math.cos(time) * radius);
    renderer.camera.lookAt(0, 0, 0);
    renderer.render();
    return;
  }

  const state = network.getLatestState();
  if (state && state.length > 0) {
    if (network.roomCode && menu.container && menu.container.parentNode) {
      menu.showLobbyCode(network.roomCode);

      // Who else is in the room. Derived from the ledger rather than a new message:
      // bots only take slots at START, so while the lobby is up every P-prefixed
      // vehicle is a human who joined with the code. T1-T3 are traffic scenery and
      // must not be counted as players — that conflation is the same mistake that
      // once put traffic in the race results (ADR-0007).
      const joined = state
        .filter((e) => e.type === 'VEHICLE' && /^P\d+$/.test(e.id))
        .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
        .map((e) => ({
          pid: e.id,
          color:
            e.modifiers && e.modifiers.color_sync !== undefined
              ? `#${Number(e.modifiers.color_sync).toString(16).padStart(6, '0')}`
              : '#8b8b8b',
        }));
      menu.showLobbyRoster(joined, network.pid);
    }

    // Hide menu and show HUD once race state begins broadcasting
    if (network.raceInfo.state === 'COUNTDOWN' || network.raceInfo.state === 'RACING') {
      menu.hide();
      if (!window.resultsShown) document.getElementById('hud').style.display = 'block';
    }
    if (network.raceInfo.state === 'COMPLETE' && !window.resultsShown && network.leaderboard.length > 0) {
      window.resultsShown = true;
      document.getElementById('hud').style.display = 'none';
      menu.showResults(network.leaderboard, network.pid);
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

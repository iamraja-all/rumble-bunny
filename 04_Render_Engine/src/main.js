import './style.css';
import { NetworkController } from './network.js';
import { Renderer } from './renderer.js';

// Get canvas
const canvas = document.querySelector('#app');

// Initialize WebGL Renderer
const renderer = new Renderer(canvas);

// Initialize Network (WebSocket)
const network = new NetworkController('ws://localhost:8080');

// 60fps Animation Loop
function animate() {
  requestAnimationFrame(animate);

  const state = network.getLatestState();
  if (state && state.length > 0) {
    renderer.updateState(state, network.pid);
  }
  
  renderer.render();
}

// Start the loop
animate();

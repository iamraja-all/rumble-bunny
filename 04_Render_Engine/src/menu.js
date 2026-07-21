export class MainMenu {
  constructor(onJoin) {
    this.onJoin = onJoin;
    
    // Create container
    this.container = document.createElement('div');
    this.container.id = 'main-menu';
    
    // Default color
    this.selectedColor = '#ff0055';
    
    this.renderSelectionScreen();
    document.body.appendChild(this.container);
  }
  
  renderSelectionScreen() {
    this.container.innerHTML = `
      <div class="menu-card">
        <h1 class="glitch" data-text="RUMBLE BUNNY">RUMBLE BUNNY</h1>
        <p class="subtitle">AI-POWERED HEADLESS RACING</p>
        
        <div class="color-picker-section">
          <h3>SELECT YOUR KART COLOR</h3>
          <div class="color-options">
            <div class="color-swatch active" style="background: #ff0055;" data-color="#ff0055"></div>
            <div class="color-swatch" style="background: #00ccff;" data-color="#00ccff"></div>
            <div class="color-swatch" style="background: #00ff66;" data-color="#00ff66"></div>
            <div class="color-swatch" style="background: #ffaa00;" data-color="#ffaa00"></div>
            <div class="color-swatch" style="background: #cc00ff;" data-color="#cc00ff"></div>
          </div>
        </div>
        
        <button id="join-btn" class="neon-btn">ENTER LOBBY</button>
      </div>
    `;
    
    // Bind color selection
    const swatches = this.container.querySelectorAll('.color-swatch');
    swatches.forEach(swatch => {
      swatch.addEventListener('click', (e) => {
        swatches.forEach(s => s.classList.remove('active'));
        e.target.classList.add('active');
        this.selectedColor = e.target.getAttribute('data-color');
      });
    });
    
    // Bind Join button
    this.container.querySelector('#join-btn').addEventListener('click', () => {
      this.renderLobbyScreen();
      // Invoke callback to tell main.js to connect to server
      this.onJoin(this.selectedColor);
    });
  }
  
  renderLobbyScreen() {
    this.container.innerHTML = `
      <div class="menu-card lobby-card">
        <h2 class="pulsing">WAITING FOR PLAYERS...</h2>
        <div class="loader"></div>
        <p class="subtitle">Connecting to Headless Server</p>
      </div>
    `;
  }
  
  hide() {
    this.container.style.opacity = '0';
    this.container.style.pointerEvents = 'none';
    setTimeout(() => {
      if (this.container.parentNode) {
        this.container.parentNode.removeChild(this.container);
      }
    }, 500);
  }
}

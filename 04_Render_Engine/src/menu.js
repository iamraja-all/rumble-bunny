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
        
        <div style="display: flex; gap: 10px; margin-top: 15px;">
          <button id="host-btn" class="neon-btn">HOST GAME</button>
        </div>
        <div style="display: flex; gap: 10px; margin-top: 15px;">
          <input type="text" id="join-code" placeholder="CODE" maxlength="4" style="width: 80px; text-align: center; text-transform: uppercase; background: rgba(0,0,0,0.5); color: white; border: 1px solid #00ccff; padding: 10px;">
          <button id="join-btn" class="neon-btn">JOIN GAME</button>
        </div>
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
    
    // Bind Host button
    this.container.querySelector('#host-btn').addEventListener('click', () => {
      this.renderLobbyScreen("CREATING ROOM...", true);
      this.onJoin({ type: 'HOST', color: this.selectedColor });
    });

    // Bind Join button
    this.container.querySelector('#join-btn').addEventListener('click', () => {
      const code = this.container.querySelector('#join-code').value.toUpperCase();
      if (code.length === 4) {
        this.renderLobbyScreen(`JOINING ${code}...`);
        this.onJoin({ type: 'JOIN', code, color: this.selectedColor });
      } else {
        alert("Enter a 4-letter room code.");
      }
    });
  }
  
  renderLobbyScreen(message = "WAITING FOR PLAYERS...", isHost = false) {
    let hostControls = '';
    if (isHost) {
      hostControls = `<button id="start-btn" class="neon-btn" style="margin-top: 15px;">START RACE</button>`;
    }
    
    this.container.innerHTML = `
      <div class="menu-card lobby-card">
        <h2 class="pulsing">${message}</h2>
        <div class="loader"></div>
        <p class="subtitle" id="lobby-code-display">Connecting...</p>
        ${hostControls}
      </div>
    `;

    if (isHost) {
      this.container.querySelector('#start-btn').addEventListener('click', () => {
        this.onJoin({ type: 'START' });
        this.container.querySelector('#start-btn').style.display = 'none';
      });
    }
  }

  showLobbyCode(code) {
    const display = this.container.querySelector('#lobby-code-display');
    if (display) {
      display.textContent = `ROOM CODE: ${code}`;
    }
  }
  
  hide() {
    if (!this.container.parentNode) return;
    this.container.style.opacity = '0';
    this.container.style.pointerEvents = 'none';
    setTimeout(() => {
      if (this.container.parentNode) {
        this.container.parentNode.removeChild(this.container);
      }
    }, 500);
  }

  showResults(leaderboardData) {
    if (!this.container.parentNode) {
      document.body.appendChild(this.container);
    }
    
    // Make sure it's visible again
    this.container.style.opacity = '1';
    this.container.style.pointerEvents = 'auto';

    let rowsHtml = '';
    leaderboardData.forEach((entry, index) => {
      rowsHtml += `
        <div style="display: flex; justify-content: space-between; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.2);">
          <span>${index + 1}. ${entry.pid}</span>
          <span>${entry.time.toFixed(1)}s</span>
        </div>
      `;
    });

    this.container.innerHTML = `
      <div class="menu-card" style="width: 400px;">
        <h2 class="glitch" data-text="RACE FINISHED">RACE FINISHED</h2>
        <div style="margin-top: 20px; margin-bottom: 20px;">
          ${rowsHtml}
        </div>
        <button id="restart-btn" class="neon-btn">RETURN TO LOBBY</button>
      </div>
    `;

    this.container.querySelector('#restart-btn').addEventListener('click', () => {
      window.location.reload(); // Simple reload to restart flow
    });
  }
}

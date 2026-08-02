/**
 * Main Menu — PS2-era arcade racer front end.
 *
 * WHY THIS LOOKS THE WAY IT DOES:
 * The previous menu was cyan-on-black with the tagline "AI-POWERED HEADLESS
 * RACING", which reads as an engineering demo rather than the loud, warm,
 * high-contrast stunt racer described in domain/idea.md. The palette, the
 * condensed display type and the chunky pressable buttons are all here to make
 * the first screen say "arcade kart racer" before a single word is read.
 *
 * THE PUBLIC SURFACE IS UNCHANGED. main.js depends on exactly four things:
 *   new MainMenu(onJoin)   — onJoin receives {type:'HOST',color} /
 *                            {type:'JOIN',code,color} / {type:'START'}
 *   menu.container         — the root element, checked for .parentNode
 *   menu.showLobbyCode(c)  — called EVERY FRAME once a room code exists
 *   menu.hide()
 *   menu.showResults(leaderboard)
 * None of those signatures moved. Only markup and CSS class content changed.
 *
 * NO NETWORK ASSETS. Fonts are a local system stack, the checkered motif is a
 * CSS gradient, the swatches are colour values. idea.md:15 promises play over a
 * mobile hotspot, so anything that needs to be fetched can't be here.
 */

/**
 * The five hex values are gameplay data, not decoration — they are sent to the
 * server verbatim (`HOST|<hex>`) and become the kart's paint. They are left
 * EXACTLY as they were so the wire format and the spawned kart colours are
 * untouched; only the presentation and the names are new.
 */
const KART_LIVERIES = [
  { hex: '#ff0055', name: 'TORCH', label: 'Torch red paint' },
  { hex: '#00ccff', name: 'COOLANT', label: 'Coolant blue paint' },
  { hex: '#00ff66', name: 'NITRO', label: 'Nitro green paint' },
  { hex: '#ffaa00', name: 'AMBER', label: 'Amber gold paint' },
  { hex: '#cc00ff', name: 'VOLTAGE', label: 'Voltage purple paint' },
];

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Room codes and player ids arrive off the wire; never interpolate them raw. */
function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

export class MainMenu {
  constructor(onJoin) {
    this.onJoin = onJoin;

    // Create container
    this.container = document.createElement('div');
    this.container.id = 'main-menu';

    // Default color
    this.selectedColor = '#ff0055';

    // Last code handed to showLobbyCode(). main.js calls that method once per
    // animation frame, so it has to be a cheap no-op when nothing changed.
    this._lobbyCode = null;

    this.renderSelectionScreen();
    document.body.appendChild(this.container);
  }

  renderSelectionScreen() {
    const swatches = KART_LIVERIES.map((livery) => {
      const isActive = livery.hex === this.selectedColor;
      return `
            <button type="button"
                    role="radio"
                    class="color-swatch${isActive ? ' active' : ''}"
                    data-color="${livery.hex}"
                    style="--swatch: ${livery.hex};"
                    aria-checked="${isActive}"
                    aria-label="${esc(livery.label)}"
                    tabindex="${isActive ? '0' : '-1'}">
              <span class="swatch-chip" aria-hidden="true"></span>
              <span class="swatch-name">${livery.name}</span>
            </button>`;
    }).join('');

    this.container.innerHTML = `
      <div class="menu-card">
        <div class="title-block">
          <h1 class="rb-title">
            <span class="rb-title-top">RUMBLE</span>
            <span class="rb-title-bottom">BUNNY</span>
          </h1>
          <p class="subtitle">STUNT RACING &middot; 8-PLAYER MAYHEM</p>
        </div>

        <div class="color-picker-section">
          <h3 id="livery-label">PICK YOUR PAINT</h3>
          <div class="color-options" role="radiogroup" aria-labelledby="livery-label">${swatches}
          </div>
        </div>

        <div class="menu-actions">
          <button type="button" id="host-btn" class="neon-btn btn-primary">HOST GAME</button>
          <div class="join-row">
            <input type="text"
                   id="join-code"
                   class="code-input"
                   placeholder="CODE"
                   maxlength="4"
                   aria-label="Room code"
                   autocomplete="off"
                   autocapitalize="characters"
                   spellcheck="false">
            <button type="button" id="join-btn" class="neon-btn btn-secondary">JOIN GAME</button>
          </div>
        </div>
      </div>
    `;

    // Bind color selection
    const swatchEls = Array.from(this.container.querySelectorAll('.color-swatch'));

    const select = (swatch) => {
      swatchEls.forEach((s) => {
        const isActive = s === swatch;
        s.classList.toggle('active', isActive);
        s.setAttribute('aria-checked', String(isActive));
        s.tabIndex = isActive ? 0 : -1;
      });
      // currentTarget, not target: the button now has child spans, so target
      // would be the chip or the label and data-color would come back null.
      this.selectedColor = swatch.getAttribute('data-color');
    };

    swatchEls.forEach((swatch, index) => {
      swatch.addEventListener('click', (e) => select(e.currentTarget));

      // A radiogroup is expected to move between options with the arrow keys
      // and expose only the checked option to Tab (roving tabindex).
      swatch.addEventListener('keydown', (e) => {
        let next = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % swatchEls.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + swatchEls.length) % swatchEls.length;
        if (next === null) return;
        e.preventDefault();
        select(swatchEls[next]);
        swatchEls[next].focus();
      });
    });

    // Bind Host button
    this.container.querySelector('#host-btn').addEventListener('click', () => {
      this.renderLobbyScreen("CREATING ROOM...", true);
      this.onJoin({ type: 'HOST', color: this.selectedColor });
    });

    // Bind Join button
    const codeInput = this.container.querySelector('#join-code');
    const join = () => {
      const code = codeInput.value.toUpperCase();
      if (code.length === 4) {
        // The joiner already knows the code they typed, so seed the plate with
        // it rather than showing dashes until the server echoes it back.
        this.renderLobbyScreen(`JOINING ${code}...`, false, code);
        this.onJoin({ type: 'JOIN', code, color: this.selectedColor });
      } else {
        alert("Enter a 4-letter room code.");
      }
    };
    this.container.querySelector('#join-btn').addEventListener('click', join);
    codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') join();
    });
  }

  renderLobbyScreen(message = "WAITING FOR PLAYERS...", isHost = false, code = null) {
    this._lobbyCode = null;

    const hostControls = isHost
      ? `<button type="button" id="start-btn" class="neon-btn btn-primary">START RACE</button>`
      : `<p class="lobby-hint">WAITING FOR THE HOST TO DROP THE FLAG</p>`;

    this.container.innerHTML = `
      <div class="menu-card lobby-card">
        <p class="lobby-status pulsing" id="lobby-status">${esc(message)}</p>
        <div class="code-plate">
          <span class="code-plate-label">ROOM CODE</span>
          <span class="code-plate-value" id="code-plate-value">- - - -</span>
        </div>
        <div class="loader"></div>
        <p class="subtitle" id="lobby-code-display">Connecting...</p>
        ${hostControls}
      </div>
    `;

    if (isHost) {
      const startBtn = this.container.querySelector('#start-btn');
      startBtn.addEventListener('click', () => {
        this.onJoin({ type: 'START' });
        startBtn.style.display = 'none';
      });
    }

    if (code) this.showLobbyCode(code);
  }

  showLobbyCode(code) {
    // Called once per frame from main.js's animation loop. Bail immediately
    // when there is nothing new — this used to rewrite the DOM 60 times a
    // second, and it also left the card reading "CREATING ROOM..." forever
    // because the headline was never the thing being updated.
    if (!code || code === this._lobbyCode) return;

    const plate = this.container.querySelector('#code-plate-value');
    if (!plate) return; // not on the lobby screen (results / selection)

    this._lobbyCode = code;
    plate.textContent = code;

    const card = this.container.querySelector('.lobby-card');
    if (card) card.classList.add('has-code');

    const status = this.container.querySelector('#lobby-status');
    if (status) {
      status.textContent = 'ROOM IS LIVE';
      status.classList.remove('pulsing');
    }

    const display = this.container.querySelector('#lobby-code-display');
    if (display) display.textContent = 'SHARE THE CODE — UP TO 8 KARTS';
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
          <li class="result-row${index === 0 ? ' result-row-win' : ''}">
            <span class="result-pos">${index + 1}</span>
            <span class="result-name">${esc(entry.pid)}</span>
            <span class="result-time">${entry.time.toFixed(1)}s</span>
          </li>
      `;
    });

    this.container.innerHTML = `
      <div class="menu-card results-card">
        <h2 class="rb-title results-title">
          <span class="rb-title-bottom">RACE OVER</span>
        </h2>
        <ol class="result-list">
          ${rowsHtml}
        </ol>
        <button type="button" id="restart-btn" class="neon-btn btn-primary">RETURN TO LOBBY</button>
      </div>
    `;

    this.container.querySelector('#restart-btn').addEventListener('click', () => {
      window.location.reload(); // Simple reload to restart flow
    });
  }
}

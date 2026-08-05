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
import { CIRCUIT_DEF } from '../../03_Stable_Build/circuit-track.js';

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

/**
 * How many karts a room holds. DERIVED, not typed as 8.
 *
 * lobby.js already takes MAX_PLAYERS from `CIRCUIT_DEF.spawnPositions.length`, and
 * ADR-0009 records what happens when a second file restates a number instead of
 * deriving it: the lobby test sat red for days asserting 8 against a hard-coded 16.
 * A roster that promises "OF 8" while the server seats a different number would be
 * the same bug wearing different clothes.
 */
const MAX_KARTS = CIRCUIT_DEF.spawnPositions.length;

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
        <div class="roster">
          <p class="roster-count" id="roster-count">CONNECTING…</p>
          <ul class="roster-grid" id="roster-grid"></ul>
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

  /**
   * Who is actually in the room. Called once per frame from main.js, same contract
   * as showLobbyCode.
   *
   * WHY THIS EXISTS: the lobby told a host "SHARE THE CODE — UP TO 8 KARTS" and then
   * never mentioned it again. You sent the code to a friend and got no signal
   * whatsoever that they had arrived — no count, no name, nothing changed on screen.
   * For a game whose whole pitch (idea.md) is an 8-player room you join by code, the
   * one moment the lobby exists for was invisible.
   *
   * WHY NO PROTOCOL CHANGE: the ledger already broadcasts every joined vehicle 60
   * times a second, and each carries the player's chosen livery in
   * `modifiers.color_sync`. Bots only fill slots at START, so during WAITING a
   * P-prefixed vehicle IS a human. Adding a roster message would have been a second
   * source for something already on the wire (ponytail Rung 1).
   *
   * @param {Array} entries [{ pid, color }] sorted by slot
   * @param {string|null} localPid so a player can find themselves
   */
  showLobbyRoster(entries, localPid = null) {
    const grid = this.container.querySelector('#roster-grid');
    if (!grid) return; // not on the lobby screen

    // Bail unless something actually changed. Without this the roster would rebuild
    // its DOM 60 times a second — the exact bug showLobbyCode's comment describes,
    // and the reason that method compares before it writes.
    const signature = `${localPid}|${entries.map((e) => `${e.pid}:${e.color}`).join(',')}`;
    if (signature === this._rosterSignature) return;
    this._rosterSignature = signature;

    const count = this.container.querySelector('#roster-count');
    if (count) {
      count.textContent = `${entries.length} / ${MAX_KARTS} JOINED`;
    }

    // Every slot is drawn, filled or not, because "3 / 8" reads very differently
    // next to five visibly empty bays than it does on its own — the empty seats are
    // the reason the host is still waiting.
    let html = '';
    for (let slot = 0; slot < MAX_KARTS; slot++) {
      const entry = entries[slot];
      if (!entry) {
        html += `<li class="roster-slot roster-slot-open"><span class="roster-chip"></span><span class="roster-name">OPEN</span></li>`;
        continue;
      }
      const isYou = localPid && entry.pid === localPid;
      html += `
        <li class="roster-slot${isYou ? ' roster-slot-you' : ''}">
          <span class="roster-chip" style="background:${esc(entry.color)}"></span>
          <span class="roster-name">${esc(entry.pid)}${isYou ? ' (YOU)' : ''}</span>
        </li>`;
    }
    grid.innerHTML = html;
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

  /**
   * @param {Array} standings every entrant, finishers first — see RaceManager._buildStandings
   * @param {string|null} localPid the slot this player is driving, so they can find themselves
   */
  showResults(standings, localPid = null) {
    if (!this.container.parentNode) {
      document.body.appendChild(this.container);
    }

    // Make sure it's visible again
    this.container.style.opacity = '1';
    this.container.style.pointerEvents = 'auto';

    // WHY EVERY ENTRANT AND NOT JUST FINISHERS: this used to render `finishOrder`,
    // so an eight-car race that five karts finished produced a five-row screen with
    // no mention of the other three — and the player is very often one of the three,
    // reading a result they do not appear on at all. The server now sends full
    // standings; a DNF gets a row, a dash for position and DNF where the time goes.
    let rowsHtml = '';
    let finisherCount = 0;
    standings.forEach((entry) => {
      const isDnf = !!entry.dnf;
      if (!isDnf) finisherCount++;

      // Position numbering counts finishers only — a DNF has no finishing position,
      // and numbering them anyway would read as "6th" rather than "did not finish".
      const position = isDnf ? '—' : String(finisherCount);
      const result = isDnf ? 'DNF' : `${entry.time.toFixed(1)}s`;

      const classes = ['result-row'];
      if (!isDnf && finisherCount === 1) classes.push('result-row-win');
      if (isDnf) classes.push('result-row-dnf');
      // The one row the player actually looks for.
      if (localPid && entry.pid === localPid) classes.push('result-row-you');

      const label = localPid && entry.pid === localPid ? `${esc(entry.pid)} (YOU)` : esc(entry.pid);

      rowsHtml += `
          <li class="${classes.join(' ')}">
            <span class="result-pos">${position}</span>
            <span class="result-name">${label}</span>
            <span class="result-time">${result}</span>
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

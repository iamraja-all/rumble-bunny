/**
 * HUD Overlay — In-Game Heads-Up Display
 *
 * WHY:
 * Without a HUD the player has no feedback on their speed, boost status,
 * or stunt count. This module creates a pure-DOM overlay that sits on top
 * of the Three.js canvas and updates every frame from the ledger state.
 * 
 * WHY DOM instead of Three.js sprites:
 * DOM text is resolution-independent, styleable with CSS, and doesn't
 * require a second render pass. It also keeps the Render Engine focused
 * on 3D geometry only (separation of concerns).
 */

export class HUD {
  constructor(audioEngine) {
    this.audio = audioEngine;
    
    // Create container
    this.container = document.createElement('div');
    this.container.id = 'hud';
    this.container.innerHTML = `
      <div class="hud-top-bar">
        <div class="hud-lap" id="hud-lap">LAP 0/3</div>
        <div class="hud-position" id="hud-position">—</div>
        <div class="hud-state" id="hud-state">WAITING</div>
        <div class="hud-race-timer" id="hud-race-timer">0:00.0</div>
      </div>
      <div class="hud-bottom">
        <div class="hud-speed-block">
          <div class="hud-speed-value" id="hud-speed">0</div>
          <div class="hud-speed-label">KM/H</div>
          <div class="hud-speed-bar-track">
            <div class="hud-speed-bar-fill" id="hud-speed-bar"></div>
          </div>
        </div>
        <div class="hud-boost-block">
          <div class="hud-boost-label">BOOST</div>
          <div class="hud-boost-bar-track">
            <div class="hud-boost-bar-fill" id="hud-boost-bar"></div>
          </div>
          <div class="hud-boost-value" id="hud-boost-val">0.0s</div>
        </div>
        <div class="hud-stunt-block">
          <div class="hud-stunt-label">STUNTS</div>
          <div class="hud-stunt-value" id="hud-stunts">0</div>
        </div>
      </div>
      <div class="hud-center-message" id="hud-center-msg"></div>
      <div class="hud-countdown" id="hud-countdown"></div>
    `;

    document.body.appendChild(this.container);
    this.injectStyles();

    // Cache DOM references
    this.elLap = document.getElementById('hud-lap');
    this.elPosition = document.getElementById('hud-position');
    this.elState = document.getElementById('hud-state');
    this.elRaceTimer = document.getElementById('hud-race-timer');
    this.elSpeed = document.getElementById('hud-speed');
    this.elSpeedBar = document.getElementById('hud-speed-bar');
    this.elBoostBar = document.getElementById('hud-boost-bar');
    this.elBoostVal = document.getElementById('hud-boost-val');
    this.elStunts = document.getElementById('hud-stunts');
    this.elCenterMsg = document.getElementById('hud-center-msg');
    this.elCountdown = document.getElementById('hud-countdown');

    this._centerMsgTimer = 0;
    this._lastState = '';
    this._lastCountdown = 0;
    this._lastLap = 0;
  }

  update(entities, localPid, raceInfo) {
    // ── RACE STATE ──
    if (raceInfo) {
      // Countdown
      if (raceInfo.state === 'COUNTDOWN') {
        const cd = raceInfo.countdown;
        if (cd > 0) {
          this.elCountdown.textContent = cd;
          this.elCountdown.classList.add('visible');
        }
        if (cd !== this._lastCountdown && cd > 0) {
          // Re-trigger animation
          this.elCountdown.classList.remove('pop');
          void this.elCountdown.offsetWidth; // force reflow
          this.elCountdown.classList.add('pop');
          
          if (this.audio) this.audio.playCountdown('BEEP');
        }
        this._lastCountdown = cd;
      } else if (raceInfo.state === 'RACING') {
        if (this._lastCountdown > 0) {
          // Show GO! briefly
          this.elCountdown.textContent = 'GO!';
          this.elCountdown.classList.add('visible', 'pop');
          
          if (this.audio) this.audio.playCountdown('GO');
          
          setTimeout(() => {
            this.elCountdown.classList.remove('visible');
          }, 800);
          this._lastCountdown = 0;
        } else {
          this.elCountdown.classList.remove('visible');
        }
      } else if (raceInfo.state === 'COMPLETE') {
        this.elCountdown.classList.remove('visible');
      }

      // Race timer
      const t = raceInfo.raceTime || 0;
      const mins = Math.floor(t / 60);
      const secs = Math.floor(t % 60);
      const tenths = Math.floor((t * 10) % 10);
      this.elRaceTimer.textContent = `${mins}:${secs.toString().padStart(2, '0')}.${tenths}`;
    }

    if (!localPid || entities.length === 0) return;

    const me = entities.find(e => e.id === localPid);
    if (!me) return;

    // Speed (multiply by 3.6 to convert m/s → km/h for display)
    const speedKmh = Math.round(me.speed * 3.6);
    this.elSpeed.textContent = speedKmh;

    // Speed bar (percentage of max ~60 m/s boosted = 216 km/h)
    const speedPct = Math.min(speedKmh / 216, 1.0) * 100;
    this.elSpeedBar.style.width = `${speedPct}%`;

    // Color the speed bar based on state
    if (me.state === 'BOOSTING') {
      this.elSpeedBar.style.background = 'linear-gradient(90deg, #ff6600, #ffaa00)';
    } else {
      this.elSpeedBar.style.background = 'linear-gradient(90deg, #00ccff, #00ffaa)';
    }

    // Boost timer
    const boostTimer = me.modifiers?.boost_timer || 0;
    const boostPct = Math.min(boostTimer / 3.0, 1.0) * 100; // 3s is "full" visually
    this.elBoostBar.style.width = `${boostPct}%`;
    this.elBoostVal.textContent = `${boostTimer.toFixed(1)}s`;

    // Stunts
    const stunts = me.modifiers?.stunts || 0;
    this.elStunts.textContent = stunts;

    // State indicator
    this.elState.textContent = me.state;
    this.elState.className = 'hud-state';
    if (me.state === 'BOOSTING') {
      this.elState.classList.add('state-boost');
    } else if (me.state === 'CRASHED') {
      this.elState.classList.add('state-crash');
    } else if (me.state === 'AIRBORNE') {
      this.elState.classList.add('state-air');
    } else if (me.state === 'DRIFT') {
      this.elState.classList.add('state-drift');
    }

    // Check for state transitions to show center messages and play audio
    if (me.state !== this._lastState) {
      if (me.state === 'AIRBORNE') {
        this.showCenterMessage('🚀 AIRBORNE!');
        if (this.audio) this.audio.playJump();
      } else if (me.state === 'BOOSTING') {
        this.showCenterMessage('⚡ BOOST!');
        if (this.audio) this.audio.playBoost();
      } else if (me.state === 'CRASHED') {
        this.showCenterMessage('💥 CRASHED!');
        if (this.audio) this.audio.playCrash();
      }
      this._lastState = me.state;
    }

    // Position (rank among all vehicles by Z — further negative Z = further ahead)
    const vehicles = entities.filter(e => e.type === 'VEHICLE');
    vehicles.sort((a, b) => a.z - b.z); // most negative Z first = P1
    const rank = vehicles.findIndex(v => v.id === localPid) + 1;
    const suffix = rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th';
    this.elPosition.textContent = `${rank}${suffix}`;

    // Lap counter
    const lap = me.modifiers?.lap || 0;
    const totalLaps = raceInfo?.totalLaps || 3;
    this.elLap.textContent = `LAP ${Math.min(lap + 1, totalLaps)}/${totalLaps}`;

    // Lap completion message
    if (lap > this._lastLap && lap > 0) {
      if (lap >= totalLaps) {
        this.showCenterMessage('🏁 RACE FINISHED!');
      } else {
        this.showCenterMessage(`🏁 LAP ${lap} COMPLETE!`);
      }
      this._lastLap = lap;
    }
  }

  showCenterMessage(msg) {
    this.elCenterMsg.textContent = msg;
    this.elCenterMsg.classList.add('visible');
    clearTimeout(this._centerMsgTimer);
    this._centerMsgTimer = setTimeout(() => {
      this.elCenterMsg.classList.remove('visible');
    }, 1500);
  }

  injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&display=swap');

      #hud {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        pointer-events: none;
        z-index: 100;
        font-family: 'Orbitron', monospace, sans-serif;
        color: #fff;
      }

      /* ─ Top Bar ─ */
      .hud-top-bar {
        position: absolute;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 24px;
        align-items: center;
      }

      .hud-position {
        font-size: 48px;
        font-weight: 900;
        text-shadow: 0 0 20px rgba(0,204,255,0.8), 0 2px 4px rgba(0,0,0,0.6);
        letter-spacing: 2px;
      }

      .hud-state {
        font-size: 18px;
        font-weight: 700;
        padding: 6px 16px;
        border-radius: 6px;
        background: rgba(255,255,255,0.1);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255,255,255,0.2);
        text-transform: uppercase;
        letter-spacing: 3px;
      }
      .hud-state.state-boost {
        background: rgba(255,102,0,0.3);
        border-color: #ff6600;
        color: #ffaa00;
        text-shadow: 0 0 10px #ff6600;
      }
      .hud-state.state-crash {
        background: rgba(255,0,0,0.3);
        border-color: #ff0000;
        color: #ff4444;
        text-shadow: 0 0 10px #ff0000;
      }
      .hud-state.state-air {
        background: rgba(0,204,255,0.2);
        border-color: #00ccff;
        color: #00ccff;
        text-shadow: 0 0 10px #00ccff;
      }
      .hud-state.state-drift {
        background: rgba(255,255,0,0.2);
        border-color: #ffff00;
        color: #ffff00;
        text-shadow: 0 0 10px #ffff00;
      }

      /* ─ Bottom Panel ─ */
      .hud-bottom {
        position: absolute;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 30px;
        align-items: flex-end;
        background: rgba(0,0,0,0.4);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 16px;
        padding: 16px 28px;
      }

      /* Speed */
      .hud-speed-block {
        text-align: center;
      }
      .hud-speed-value {
        font-size: 56px;
        font-weight: 900;
        line-height: 1;
        text-shadow: 0 0 20px rgba(0,255,170,0.6);
      }
      .hud-speed-label {
        font-size: 14px;
        font-weight: 500;
        opacity: 0.6;
        letter-spacing: 3px;
        margin-top: 2px;
      }
      .hud-speed-bar-track {
        width: 160px;
        height: 6px;
        background: rgba(255,255,255,0.1);
        border-radius: 3px;
        margin-top: 8px;
        overflow: hidden;
      }
      .hud-speed-bar-fill {
        height: 100%;
        width: 0%;
        border-radius: 3px;
        background: linear-gradient(90deg, #00ccff, #00ffaa);
        transition: width 0.1s ease-out;
      }

      /* Boost */
      .hud-boost-block {
        text-align: center;
        min-width: 100px;
      }
      .hud-boost-label {
        font-size: 12px;
        font-weight: 700;
        opacity: 0.6;
        letter-spacing: 3px;
        margin-bottom: 6px;
      }
      .hud-boost-bar-track {
        width: 100px;
        height: 10px;
        background: rgba(255,255,255,0.1);
        border-radius: 5px;
        overflow: hidden;
      }
      .hud-boost-bar-fill {
        height: 100%;
        width: 0%;
        border-radius: 5px;
        background: linear-gradient(90deg, #ff6600, #ffaa00);
        transition: width 0.15s ease-out;
        box-shadow: 0 0 8px rgba(255,102,0,0.6);
      }
      .hud-boost-value {
        font-size: 14px;
        font-weight: 500;
        margin-top: 4px;
        opacity: 0.7;
      }

      /* Stunts */
      .hud-stunt-block {
        text-align: center;
        min-width: 80px;
      }
      .hud-stunt-label {
        font-size: 12px;
        font-weight: 700;
        opacity: 0.6;
        letter-spacing: 3px;
        margin-bottom: 4px;
      }
      .hud-stunt-value {
        font-size: 40px;
        font-weight: 900;
        text-shadow: 0 0 15px rgba(0,204,255,0.6);
      }

      /* ─ Center Message ─ */
      .hud-center-message {
        position: absolute;
        top: 35%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.5);
        font-size: 42px;
        font-weight: 900;
        letter-spacing: 4px;
        text-shadow: 0 0 30px rgba(255,255,255,0.8), 0 4px 8px rgba(0,0,0,0.5);
        opacity: 0;
        transition: opacity 0.2s ease-out, transform 0.2s ease-out;
        pointer-events: none;
      }
      .hud-center-message.visible {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }

      /* ─ Countdown ─ */
      .hud-countdown {
        position: absolute;
        top: 40%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.5);
        font-size: 120px;
        font-weight: 900;
        letter-spacing: 8px;
        text-shadow: 0 0 60px rgba(255,255,255,0.9), 0 0 120px rgba(0,204,255,0.5);
        opacity: 0;
        transition: opacity 0.15s ease-out, transform 0.15s ease-out;
        pointer-events: none;
      }
      .hud-countdown.visible {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }
      .hud-countdown.pop {
        animation: countdown-pop 0.3s ease-out;
      }
      @keyframes countdown-pop {
        0% { transform: translate(-50%, -50%) scale(1.5); }
        100% { transform: translate(-50%, -50%) scale(1); }
      }

      /* ─ Race Info ─ */
      .hud-lap {
        font-size: 20px;
        font-weight: 700;
        padding: 6px 16px;
        border-radius: 6px;
        background: rgba(0,0,0,0.4);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(0,204,255,0.3);
        letter-spacing: 2px;
      }
      .hud-race-timer {
        font-size: 20px;
        font-weight: 500;
        padding: 6px 16px;
        border-radius: 6px;
        background: rgba(0,0,0,0.4);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255,255,255,0.15);
        letter-spacing: 2px;
        font-variant-numeric: tabular-nums;
      }
    `;
    document.head.appendChild(style);
  }
}

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
      <div class="hud-oob" id="hud-oob">
        <div class="hud-oob-title">OFF COURSE</div>
        <div class="hud-oob-sub">RETURN TO THE TRACK</div>
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
    this.elOob = document.getElementById('hud-oob');
    this.elCenterMsg = document.getElementById('hud-center-msg');
    this.elCountdown = document.getElementById('hud-countdown');

    this._centerMsgTimer = 0;
    this._lastState = '';
    this._lastOffCourse = false;
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
    if (!me) {
      // Clear the off-course banner on the way out. Without this it would stay burned
      // on screen forever if the local kart leaves the ledger mid-warning — a
      // disconnect, or the room being torn down — because every code path that lowers
      // it lives below this return.
      if (this._lastOffCourse) {
        this.elOob.classList.remove('is-active');
        this._lastOffCourse = false;
      }
      return;
    }

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

    // Off-course warning.
    //
    // WHY THIS IS A SUSTAINED BANNER AND NOT A showCenterMessage TOAST:
    // `out_of_bounds` is not a state transition, it is a flag that stays up for the
    // whole 2.5-second grace window while the kart is off the island (see
    // race.js._enforcePlayfield). A toast fires once and fades, which tells the player
    // nothing about the fact that a clock is running — the warning has to persist for
    // exactly as long as the chance to fix it does.
    //
    // WHY IT EXISTS AT ALL: the engine has published this flag since `57a06a5` and
    // race.js's own comment says the HUD "only needs to know whether to shout OUT OF
    // BOUNDS". Nothing ever read it. So a player who drifted wide got silently
    // teleported back to the last gate with no warning and no explanation, which reads
    // as the game glitching rather than a rule being applied. Third time now that a
    // field was added for a consumer that was never written (the DNF flag was the
    // last — ADR-0015), so it is worth saying plainly: publishing a value is not the
    // same as shipping the feature.
    const offCourse = me.modifiers?.out_of_bounds === 1;
    if (offCourse !== this._lastOffCourse) {
      this.elOob.classList.toggle('is-active', offCourse);
      this._lastOffCourse = offCourse;
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

    // Position.
    //
    // TWO BUGS FIXED HERE (2026-08-02). This used to sort EVERY entity of type
    // VEHICLE by raw Z:
    //   1. Traffic obstacles serialize as Type=VEHICLE too, so three cones were
    //      counted as racers — which is why an 8-player race reported "9th".
    //   2. Ranking by Z alone is meaningless on a closed circuit. The moment a kart
    //      completes a lap its Z resets toward the start line, so the leader was
    //      reported last while a kart a full lap down was reported first.
    // Racers are the P<n> ids the lobby hands out; traffic uses T<n>. Rank is now
    // laps first, then progress through the circuit's gates, then Z as a tiebreak
    // within the current sector.
    const racers = entities.filter(e => e.type === 'VEHICLE' && /^P\d+$/.test(e.id));
    racers.sort((a, b) => {
      const lapDiff = (b.modifiers?.lap || 0) - (a.modifiers?.lap || 0);
      if (lapDiff !== 0) return lapDiff;
      const cpDiff = (b.modifiers?.checkpoint || 0) - (a.modifiers?.checkpoint || 0);
      if (cpDiff !== 0) return cpDiff;
      return a.z - b.z;
    });
    const rank = racers.findIndex(v => v.id === localPid) + 1;
    // 11th/12th/13th take "th", not "st/nd/rd" — irrelevant at 8 players today, but
    // the lobby cap is the kind of thing that changes.
    const tens = rank % 100;
    const suffix = tens >= 11 && tens <= 13 ? 'th'
      : rank % 10 === 1 ? 'st' : rank % 10 === 2 ? 'nd' : rank % 10 === 3 ? 'rd' : 'th';
    this.elPosition.textContent = rank > 0 ? `${rank}${suffix}` : '--';
    if (this.elPositionTotal) this.elPositionTotal.textContent = `/ ${racers.length}`;

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
      /* WHY THE GOOGLE FONTS IMPORT IS GONE:
         it fetched Orbitron from fonts.googleapis.com at runtime. idea.md:15
         promises play over a mobile hotspot / local Wi-Fi and idea.md:11 promises
         Docker-hosted dedicated servers — in both of those the request cannot
         resolve, the font never arrives, and the HUD renders in whatever the
         fallback is. Caught live: a race screenshot showed the speed and stunt
         readouts as tofu boxes instead of digits, because the glyphs never loaded.
         A racing HUD whose numbers can vanish depending on the network is not a
         HUD. This stack is all locally installed faces, so it always resolves and
         costs zero requests. */

      #hud {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        pointer-events: none;
        z-index: 100;
        font-family: 'Bahnschrift', 'DIN Alternate', 'Franklin Gothic Medium', 'Segoe UI', Impact, 'Arial Narrow Bold', sans-serif;
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

      /* ─ Off-course warning ─
         Sits ABOVE the centre message rather than on top of it, because both can be
         up at once: clipping a guardrail off the island raises this while CRASHED is
         still toasting. Red, because it is the only warning in the HUD that means
         "you are about to lose progress" — every other indicator is informational. */
      .hud-oob {
        position: absolute;
        top: 18%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.85);
        text-align: center;
        opacity: 0;
        transition: opacity 0.15s ease-out, transform 0.15s ease-out;
        pointer-events: none;
      }
      .hud-oob.is-active {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }
      .hud-oob-title {
        font-size: 40px;
        font-weight: 900;
        letter-spacing: 5px;
        color: #ff4632;
        text-shadow: 0 0 26px rgba(255, 70, 50, 0.75), 0 4px 8px rgba(0, 0, 0, 0.6);
        /* The pulse carries the urgency — a static banner reads as scenery. Held to a
           1s cycle so it is insistent without becoming a strobe. */
        animation: hud-oob-pulse 1s ease-in-out infinite;
      }
      .hud-oob-sub {
        margin-top: 4px;
        font-size: 15px;
        font-weight: 700;
        letter-spacing: 3px;
        color: rgba(255, 220, 210, 0.92);
        text-shadow: 0 2px 6px rgba(0, 0, 0, 0.7);
      }
      @keyframes hud-oob-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.45; }
      }
      @media (prefers-reduced-motion: reduce) {
        .hud-oob-title { animation: none; }
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

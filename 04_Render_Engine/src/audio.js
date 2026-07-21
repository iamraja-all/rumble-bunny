/**
 * Procedural Audio Engine
 * 
 * WHY:
 * Instead of loading large MP3/WAV files over the network, we use the Web Audio API
 * to synthesize sounds dynamically. This ensures instant loading and allows us to 
 * perfectly sync pitch with game state (e.g. engine RPM matches speed).
 */

export class SoundEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.5;
    this.masterGain.connect(this.ctx.destination);
    
    this.initialized = false;
    this.engineOsc = null;
    this.engineGain = null;

    // We will generate a short white noise buffer for crashes once
    this.noiseBuffer = this._createWhiteNoiseBuffer();
  }

  /**
   * Browsers block audio until a user interaction.
   * Call this on the first click.
   */
  async init() {
    if (this.initialized) return;
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    this.initialized = true;
    this._startEngineSound();
  }

  _startEngineSound() {
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 50; // idle rumble

    // Lowpass filter to make it sound muffled like an engine
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200;

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0; // silent until we start moving

    this.engineOsc.connect(filter);
    filter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    this.engineOsc.start();
  }

  /**
   * Call this every frame with the player's vehicle
   */
  update(vehicle) {
    if (!this.initialized || !this.engineOsc) return;

    // Map speed (0 to ~40) to frequency (50 to ~300)
    const targetFreq = 50 + (vehicle.speed * 6);
    this.engineOsc.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.1);

    // Map throttle/speed to volume
    const targetVol = vehicle.speed > 1 ? 0.3 : 0.05;
    this.engineGain.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.1);
  }

  // ── Procedural Sound Effects ──────────────────────────────────────────

  playBoost() {
    if (!this.initialized) return;
    const t = this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'square';
    // Pitch sweep up
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(800, t + 0.3);
    
    // Volume envelope (quick attack, short sustain)
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.4, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(t);
    osc.stop(t + 0.5);
  }

  playJump() {
    if (!this.initialized) return;
    const t = this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sine';
    // Quick boing
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(600, t + 0.2);
    
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.5, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(t);
    osc.stop(t + 0.3);
  }

  playCrash() {
    if (!this.initialized) return;
    const t = this.ctx.currentTime;
    
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;

    // Filter to make it sound bassy/impactful
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(100, t + 0.5);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(1.0, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    source.start(t);
  }

  playCountdown(type) {
    if (!this.initialized) return;
    const t = this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'square';
    if (type === 'BEEP') {
      osc.frequency.setValueAtTime(440, t); // A4
    } else {
      osc.frequency.setValueAtTime(880, t); // A5 (higher pitch for GO)
    }
    
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(t);
    osc.stop(t + 0.3);
  }

  _createWhiteNoiseBuffer() {
    const bufferSize = this.ctx.sampleRate * 1.0; // 1 second
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }
}

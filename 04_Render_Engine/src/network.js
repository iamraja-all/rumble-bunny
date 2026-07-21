import { parseLedger } from './ledger.js';

export class NetworkController {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.pid = null;
    this.latestState = [];
    this.raceInfo = { state: 'WAITING', countdown: 0, raceTime: 0, totalLaps: 3, finishedCount: 0 };
    
    this.input = {
      throttle: 0,
      brake: 0,
      steer: 0,
      drift: false
    };

    // Set up keyboard listeners
    this.setupInputs();

    this.ws.onmessage = (event) => {
      const msg = event.data;
      if (msg.startsWith('INIT|')) {
        this.pid = msg.split('|')[1];
        console.log(`Connected as ${this.pid}`);
        
        // Start sending inputs 60 times a second
        setInterval(() => this.sendInput(), 1000 / 60);
        return;
      }

      // Split lines and extract RACE metadata
      const lines = msg.split('\n');
      const ledgerLines = [];
      for (const line of lines) {
        if (line.startsWith('RACE|')) {
          const parts = line.split('|');
          this.raceInfo = {
            state: parts[1],
            countdown: Number(parts[2]),
            raceTime: Number(parts[3]),
            totalLaps: Number(parts[4]),
            finishedCount: Number(parts[5]),
          };
        } else {
          ledgerLines.push(line);
        }
      }
      this.latestState = parseLedger(ledgerLines.join('\n'));
    };
  }

  setupInputs() {
    const keys = { w: false, a: false, s: false, d: false, space: false };
    
    const updateKeys = (e, isDown) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') keys.w = isDown;
      if (key === 's' || key === 'arrowdown') keys.s = isDown;
      if (key === 'a' || key === 'arrowleft') keys.a = isDown;
      if (key === 'd' || key === 'arrowright') keys.d = isDown;
      if (key === ' ') keys.space = isDown;

      this.input.throttle = keys.w ? 1.0 : 0.0;
      this.input.brake = keys.s ? 1.0 : 0.0;
      
      this.input.steer = 0;
      if (keys.a) this.input.steer = -1.0;
      if (keys.d) this.input.steer = 1.0;
      
      this.input.drift = keys.space;
    };

    window.addEventListener('keydown', (e) => updateKeys(e, true));
    window.addEventListener('keyup', (e) => updateKeys(e, false));
  }

  sendInput() {
    if (this.ws.readyState === WebSocket.OPEN && this.pid) {
      const driftInt = this.input.drift ? 1 : 0;
      const msg = `INPUT|${this.input.throttle}|${this.input.brake}|${this.input.steer}|${driftInt}`;
      this.ws.send(msg);
    }
  }

  getLatestState() {
    return this.latestState;
  }
}

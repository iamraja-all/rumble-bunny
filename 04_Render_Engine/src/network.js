import { parseLedger } from './ledger.js';
import { InputManager } from './input.js';

export class NetworkController {
  constructor(url, action) {
    this.ws = new WebSocket(url);
    this.pid = null;
    this.roomCode = null;
    this.latestState = [];
    this.raceInfo = { state: 'WAITING', countdown: 0, raceTime: 0, totalLaps: 3, finishedCount: 0 };
    this.leaderboard = [];
    
    this.inputManager = new InputManager();

    this.ws.onopen = () => {
      if (action.type === 'HOST') {
        this.ws.send(`HOST|${action.color}`);
      } else if (action.type === 'JOIN') {
        this.ws.send(`JOIN|${action.code}|${action.color}`);
      }
    };

    this.ws.onmessage = (event) => {
      const msg = event.data;
      if (msg.startsWith('INIT|')) {
        const parts = msg.split('|');
        this.pid = parts[1];
        this.roomCode = parts[2];
        console.log(`Connected as ${this.pid} in room ${this.roomCode}`);
        
        // Start sending inputs 60 times a second
        setInterval(() => this.sendInput(), 1000 / 60);
        return;
      } else if (msg.startsWith('ERROR|')) {
        alert(msg.split('|')[1]);
        window.location.reload();
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
        } else if (line.startsWith('LEADERBOARD|')) {
          this.leaderboard = JSON.parse(line.substring('LEADERBOARD|'.length));
        } else {
          ledgerLines.push(line);
        }
      }
      this.latestState = parseLedger(ledgerLines.join('\n'));
    };
  }

  sendInput() {
    if (this.ws.readyState === WebSocket.OPEN && this.pid) {
      const state = this.inputManager.getState();
      const driftInt = state.drift ? 1 : 0;
      const msg = `INPUT|${state.throttle.toFixed(2)}|${state.brake.toFixed(2)}|${state.steer.toFixed(2)}|${driftInt}`;
      this.ws.send(msg);
    }
  }

  getLatestState() {
    return this.latestState;
  }
}

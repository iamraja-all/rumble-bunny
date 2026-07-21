import { getLaunchPadAt, updateSpawners } from './track.js';
import { serializeLedger } from './ledger.js';
import { WebSocketServer } from 'ws';
import { Lobby } from './lobby.js';
import { updateVehicle, launchVehicle } from './vehicle-physics.js';
import { updateItems } from './items-physics.js';
import { RaceManager } from './race.js';

/**
 * Headless WebSocket Server Wrapper
 * 
 * WHY:
 * Provides the actual network integration for the game state. Runs the 60fps
 * deterministic loop, processes raw client inputs, and broadcasts the 
 * pipe-delimited AI Whisperer ledger to all clients.
 */

const PORT = 8080;
const TICK_RATE = 60;
const DT = 1 / TICK_RATE;

const BALANCED_STATS = {
  max_speed: 40.0,
  acceleration: 5.0,
  handling: 1.5,
  stunt_rate: 2.0,
  weight: 1000.0,
  boost_mult: 1.5,
};

const wss = new WebSocketServer({ port: PORT });
const lobby = new Lobby('MainRoom', BALANCED_STATS);
const raceManager = new RaceManager();
let activeItems = [];
let clientCounter = 0;

console.log(`🚀 Rumble-Bunny Headless Server starting on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  const clientId = `client-${++clientCounter}`;
  
  const pid = lobby.join(clientId);
  if (!pid) {
    ws.send('ERROR|Lobby Full');
    ws.close();
    return;
  }

  console.log(`[+] Client connected: ${clientId} assigned ${pid}`);
  ws.send(`INIT|${pid}`);

  // Register player for race tracking
  raceManager.registerPlayer(clientId);

  // Default input state
  const v = lobby.getVehicle(clientId);
  v._input = { throttle: 0, brake: 0, steer: 0, drift: false };

  ws.on('message', (message) => {
    // Expected format: INPUT|throttle|brake|steer|drift
    const msg = message.toString().trim();
    if (msg.startsWith('INPUT|')) {
      const parts = msg.split('|');
      if (parts.length >= 5) {
        v._input.throttle = Math.max(0, Math.min(1, Number(parts[1])));
        v._input.brake = Math.max(0, Math.min(1, Number(parts[2])));
        v._input.steer = Math.max(-1, Math.min(1, Number(parts[3])));
        v._input.drift = parts[4] === '1' || parts[4] === 'true';
      }
    }
  });

  ws.on('close', () => {
    console.log(`[-] Client disconnected: ${clientId}`);
    raceManager.removePlayer(clientId);
    lobby.leave(clientId);
  });
});

// ── 60fps Core Game Loop ──────────────────────────────────────────────
setInterval(() => {
  // 0. Update Spawners
  const newItems = updateSpawners(DT, activeItems);
  if (newItems.length > 0) {
    activeItems.push(...newItems);
  }

  // 1. Update Physics for all vehicles
  const canGo = raceManager.canAccelerate();

  for (const [clientId, v] of lobby.players.entries()) {
    // During countdown, zero out throttle so karts can't move
    const input = canGo ? v._input : { throttle: 0, brake: 0, steer: 0, drift: false };
    
    let newV = updateVehicle(v, input, DT);
    
    // Check Launch Pads
    if (newV.state !== 'AIRBORNE' && newV.state !== 'CRASHED') {
      const pad = getLaunchPadAt(newV.x, newV.z);
      if (pad) {
        newV = launchVehicle(newV, pad.power);
      }
    }

    newV._input = v._input;
    lobby.players.set(clientId, newV);
  }

  // 2. Update Race (checkpoint/lap detection — writes to vehicle modifiers)
  raceManager.update(DT, lobby);

  // 3. Update Items & Collisions
  const updatedVehicles = lobby.getAllVehicles();
  activeItems = updateItems(activeItems, updatedVehicles, DT);

  // 4. Generate State Frame
  const vehicleLedger = lobby.getLedgerFrame();
  const itemLedger = serializeLedger(activeItems);
  
  // Prepend race metadata as a special RACE line
  const raceInfo = raceManager.getRaceInfo();
  const raceLine = `RACE|${raceInfo.state}|${raceInfo.countdown}|${raceInfo.raceTime.toFixed(1)}|${raceInfo.totalLaps}|${raceInfo.finishOrder.length}`;
  
  let fullFrame = raceLine;
  if (vehicleLedger) fullFrame += '\n' + vehicleLedger;
  if (itemLedger) fullFrame += '\n' + itemLedger;

  // 5. Broadcast
  if (fullFrame.length > 0) {
    wss.clients.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(fullFrame);
      }
    });
  }
}, 1000 / TICK_RATE);

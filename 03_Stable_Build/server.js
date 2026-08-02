import { getLaunchPadAt, updateSpawners } from './track.js';
import { serializeLedger } from './ledger.js';
import { WebSocketServer } from 'ws';
import { Lobby } from './lobby.js';
import { updateVehicle, launchVehicle, applyCarCollisions } from './vehicle-physics.js';
import { updateItems } from './items-physics.js';
import { RaceManager } from './race.js';
import { BotController } from './bots.js';
import { createTrafficVehicles, updateTrafficVehicle, advanceTrafficProgress } from './traffic.js';
import { RoomManager } from './room-manager.js';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Serve the built static files from the /public directory (which Docker will populate)
// In local dev, this directory might not exist if they use Vite dev server, but in prod it will.
const staticPath = path.join(__dirname, '..', 'public');
app.use(express.static(staticPath));

const server = createServer(app);

const PORT = process.env.PORT || 8080;
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

const wss = new WebSocketServer({ server });
const roomManager = new RoomManager();
let clientCounter = 0;

server.listen(PORT, () => {
  console.log(`dYs? Rumble-Bunny Web & Headless Server starting on http://localhost:${PORT}`);
});

wss.on('connection', (ws) => {
  const clientId = `client-${++clientCounter}`;
  ws.clientId = clientId;
  ws.roomCode = null;

  console.log(`[+] Client connected: ${clientId}`);

  ws.on('message', (message) => {
    const msg = message.toString().trim();
    
    // Handshake
    if (!ws.roomCode) {
      if (msg.startsWith('HOST|')) {
        const parts = msg.split('|');
        const color = parts[1] || '#ff00ff';
        
        const room = roomManager.createRoom(Lobby, RaceManager);
        
        // Spawn traffic immediately so it's there
        room.trafficList = createTrafficVehicles(BALANCED_STATS);
        
        const joinRes = roomManager.joinRoom(room.code, clientId);
        if (joinRes) {
          ws.roomCode = room.code;
          ws.send(`INIT|${joinRes.pid}|${room.code}`);
          const v = room.lobby.getVehicle(clientId);
          if (v) {
            v.color = color;
            v.modifiers.color_sync = parseInt(color.replace('#', ''), 16);
            v._input = { throttle: 0, brake: 0, steer: 0, drift: false };
          }
        }
      } else if (msg.startsWith('JOIN|')) {
        const parts = msg.split('|');
        const code = parts[1];
        const color = parts[2] || '#ff00ff';

        const joinRes = roomManager.joinRoom(code, clientId);
        if (joinRes) {
          ws.roomCode = joinRes.room.code;
          ws.send(`INIT|${joinRes.pid}|${joinRes.room.code}`);
          const v = joinRes.room.lobby.getVehicle(clientId);
          if (v) {
            v.color = color;
            v.modifiers.color_sync = parseInt(color.replace('#', ''), 16);
            v._input = { throttle: 0, brake: 0, steer: 0, drift: false };
          }
        } else {
          ws.send(`ERROR|Invalid Code or Room Full`);
          ws.close();
        }
      }
      return; // Stop processing further until handshake completes
    }

    // Normal play messages
    const room = roomManager.getRoom(ws.roomCode);
    if (!room) return;

    if (msg.startsWith('START')) {
      if (room.raceManager.state === 'WAITING') {
        // Fill remaining slots with bots
        let botIndex = 1;
        while (room.lobby.players.size < 8) {
          const botId = `bot-${room.code}-${botIndex++}`;
          room.lobby.join(botId);
          room.raceManager.registerPlayer(botId);
          room.bots.set(botId, new BotController(botId));
        }
        room.raceManager.startCountdown();
      }
    } else if (msg.startsWith('INPUT|')) {
      const parts = msg.split('|');
      const v = room.lobby.getVehicle(clientId);
      if (v && parts.length >= 5) {
        v._input.throttle = Math.max(0, Math.min(1, Number(parts[1])));
        v._input.brake = Math.max(0, Math.min(1, Number(parts[2])));
        v._input.steer = Math.max(-1, Math.min(1, Number(parts[3])));
        v._input.drift = parts[4] === '1' || parts[4] === 'true';
      }
    }
  });

  ws.on('close', () => {
    console.log(`[-] Client disconnected: ${clientId}`);
    if (ws.roomCode) {
      roomManager.leaveRoom(ws.roomCode, clientId);
    }
  });
});

setInterval(() => {
  for (const [code, room] of roomManager.rooms.entries()) {
    // 0. Update Spawners
    const newItems = updateSpawners(DT, room.activeItems);
    if (newItems.length > 0) {
      room.activeItems.push(...newItems);
    }

    // 1. Update Physics for all vehicles (Lobby)
    const canGo = room.raceManager.canAccelerate();
    const raceInfo = room.raceManager.getRaceInfo();

    for (const [clientId, v] of room.lobby.players.entries()) {
      let input;
      if (room.bots.has(clientId)) {
        const raceState = room.raceManager.raceStates.get(clientId);
        input = room.bots.get(clientId).generateInput(v, raceState, raceInfo);
        v._input = input;
      } else {
        input = v._input;
      }

      const finalInput = canGo ? input : { throttle: 0, brake: 0, steer: 0, drift: false };
      let newV = updateVehicle(v, finalInput, DT);
      
      if (newV.state !== 'AIRBORNE' && newV.state !== 'CRASHED') {
        const pad = getLaunchPadAt(newV.x, newV.z);
        if (pad) {
          newV = launchVehicle(newV, pad.power);
        }
      }

      newV._input = v._input;
      room.lobby.players.set(clientId, newV);
    }

    // Update Traffic
    for (const t of room.trafficList) {
      const input = updateTrafficVehicle(t, DT);
      t.vehicle = updateVehicle(t.vehicle, input, DT);
      if (t.vehicle.state !== 'AIRBORNE' && t.vehicle.state !== 'CRASHED') {
        const pad = getLaunchPadAt(t.vehicle.x, t.vehicle.z);
        if (pad) {
          t.vehicle = launchVehicle(t.vehicle, pad.power);
        }
      }
      advanceTrafficProgress(t);
    }

    // 2. Update Race
    room.raceManager.update(DT, room.lobby);

    // 3. Update Items & Collisions
    const updatedVehicles = room.lobby.getAllVehicles();
    const allVehicles = [...updatedVehicles, ...room.trafficList.map(t => t.vehicle)];
    
    room.activeItems = updateItems(room.activeItems, allVehicles, DT);
    applyCarCollisions(allVehicles);

    // 4. Generate State Frame
    const vehicleLedger = serializeLedger(allVehicles);
    const itemLedger = serializeLedger(room.activeItems);
    
    const raceLine = `RACE|${raceInfo.state}|${raceInfo.countdown}|${raceInfo.raceTime.toFixed(1)}|${raceInfo.totalLaps}|${raceInfo.finishOrder.length}`;
    
    let fullFrame = raceLine;
    if (raceInfo.finishOrder.length > 0) {
      fullFrame += '\nLEADERBOARD|' + JSON.stringify(raceInfo.finishOrder);
    }
    if (vehicleLedger) fullFrame += '\n' + vehicleLedger;
    if (itemLedger) fullFrame += '\n' + itemLedger;

    // 5. Broadcast to specific room
    if (fullFrame.length > 0) {
      wss.clients.forEach((client) => {
        if (client.readyState === 1 && client.roomCode === code) { // WebSocket.OPEN
          client.send(fullFrame);
        }
      });
    }
  }
}, 1000 / TICK_RATE);

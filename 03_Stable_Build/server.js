import { getLaunchPadAt, updateSpawners, createTrackState } from './track.js';
import { serializeLedger } from './ledger.js';
import { WebSocketServer } from 'ws';
import { Lobby } from './lobby.js';
import { updateVehicle, launchVehicle, applyCarCollisions } from './vehicle-physics.js';
import { updateItems } from './items-physics.js';
import { RaceManager } from './race.js';
import { BotController } from './bots.js';
import { createTrafficVehicles, updateTrafficVehicle, advanceTrafficProgress } from './traffic.js';
import { RoomManager } from './room-manager.js';
import { finiteClamp, safeHexColor } from './quarantine.js';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from './static-files.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve the built static files from /public (which Docker populates). In local dev
// that directory does not exist — Vite serves the client on :5173 — and the handler
// simply 404s every asset, which is what express.static did too.
//
// WHY NOT express ANY MORE (R06): it was here for this one mount while `node:http`
// was already imported. static-files.js does it with a boot-time whitelist, so no
// request string is ever turned into a filesystem path. See that file's header.
const staticPath = path.join(__dirname, '..', 'public');
const server = createServer(createStaticHandler(staticPath));

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

// R15: cap the frame size at the transport, before any of our code touches it.
// WHY 512 and not the ws default: the longest legitimate message this protocol has
// is `JOIN|ABCD|#00ccff` at 18 bytes. ws 8.x defaults to 100 MiB, and the handler
// unconditionally does message.toString() then .split('|') — so one 100 MiB frame of
// pipes allocates a multi-million-element array on the single thread serving every
// player in every room. Ponytail Rung 5: the installed dependency already has the
// control, so we do not write a framing layer.
const wss = new WebSocketServer({ server, maxPayload: 512 });

// WHY this listener is not optional: Node's EventEmitter contract rethrows an
// 'error' event that has no listener as an uncaught exception. `ws` emits 'error'
// on protocol-level frame violations and on socket resets, so without this a single
// malformed frame or one abruptly reset connection terminates the process for every
// player currently racing.
wss.on('error', (err) => console.error('[wss error]', err.message));

const roomManager = new RoomManager();
let clientCounter = 0;

// R15: a per-connection message budget. maxPayload bounds how BIG a frame is;
// this bounds how MANY. The tick loop reads whatever _input holds at 60Hz, so extra
// frames buy an attacker no gameplay advantage — only parse work on the shared
// thread. 180/s is triple the legitimate 60Hz input rate.
const MAX_MSGS_PER_SEC = 180;

server.listen(PORT, () => {
  console.log(`dYs? Rumble-Bunny Web & Headless Server starting on http://localhost:${PORT}`);
});

wss.on('connection', (ws) => {
  const clientId = `client-${++clientCounter}`;
  ws.clientId = clientId;
  ws.roomCode = null;

  console.log(`[+] Client connected: ${clientId}`);

  // See MAX_MSGS_PER_SEC. Counters live on the socket so they cost no allocation
  // and die with the connection.
  ws._msgCount = 0;
  ws._msgWindow = Date.now();

  // Per-socket 'error' listener — same rethrow contract as the server-level one
  // above. A client that vanishes mid-race must not take the room down with it.
  ws.on('error', (err) => console.error(`[ws error] ${clientId}: ${err.message}`));

  ws.on('message', (message) => {
    // R15 rate gate runs BEFORE toString(), so a flood costs us a comparison
    // rather than a string copy per frame. Big-O: O(1).
    const now = Date.now();
    if (now - ws._msgWindow > 1000) {
      ws._msgWindow = now;
      ws._msgCount = 0;
    }
    if (++ws._msgCount > MAX_MSGS_PER_SEC) return;

    const msg = message.toString().trim();

    // Handshake
    if (!ws.roomCode) {
      if (msg.startsWith('HOST|')) {
        const parts = msg.split('|');
        // R15: the colour is the first client-authored STRING that reaches the
        // ledger (via modifiers.color_sync, broadcast to every player in the room).
        // The AI Whisperer format has no escaping, so validate at the boundary
        // rather than relying on parseInt downstream to coerce the danger away.
        const color = safeHexColor(parts[1]);

        const room = roomManager.createRoom(Lobby, RaceManager, BALANCED_STATS);

        // Spawn traffic immediately so it's there
        room.trafficList = createTrafficVehicles(BALANCED_STATS);

        // Private item-spawn timers for this room. Previously every room mutated
        // one shared object on TRACK_DEF, so a pickup in one race silently re-timed
        // the spawners in every other race running in the same process.
        room.trackState = createTrackState();

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
        } else {
          // WHY this branch has to exist: without it a failed host leaves
          // ws.roomCode null, so every subsequent message falls back into the
          // handshake branch and the player sits on the lobby spinner forever with
          // no error and no timeout. JOIN already reported its failure; HOST did not.
          ws.send('ERROR|Could not create room');
          ws.close();
        }
      } else if (msg.startsWith('JOIN|')) {
        const parts = msg.split('|');
        const code = parts[1];
        const color = safeHexColor(parts[2]);

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
      // WHY the _input existence check: this handler writes through v._input, and
      // the property is only created on the handshake path. Any vehicle that reaches
      // here without it would throw a TypeError inside the ws 'message' callback —
      // uncaught, and therefore fatal to the whole process and everyone racing.
      if (v && v._input && parts.length >= 5) {
        // R15: finiteClamp, NOT Math.max/Math.min. Those PROPAGATE NaN rather than
        // rejecting it, so the previous expression clamped range but not finiteness
        // and `INPUT|abc|0|0|1` permanently poisoned this kart's position — proven
        // by execution in test_quarantine_v1.js T1 and T13a.
        v._input.throttle = finiteClamp(parts[1], 0, 1);
        v._input.brake = finiteClamp(parts[2], 0, 1);
        v._input.steer = finiteClamp(parts[3], -1, 1);
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
    // Defensive lazy init rather than letting updateSpawners throw: this runs inside
    // the 60Hz loop, and a throw here would kill the tick for every room at once.
    if (!room.trackState) room.trackState = createTrackState();
    const newItems = updateSpawners(DT, room.activeItems, room.trackState);
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

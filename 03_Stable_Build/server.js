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
import { CIRCUIT_DEF } from './circuit-track.js';
import { finiteClamp, safeHexColor } from './quarantine.js';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from './static-files.js';
import { getRandomWeapon, addWeaponToInventory } from './weapons.js';
import { fireWeapon, updateProjectiles, applyAreaEffect, cycleWeapon } from './weapon-firing.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── SOLID GROUND play-test switch (TEMPORARY) ────────────────────────────────
//
// S1-S4 live in 02_Isolation_Chamber and are green there (181 assertions), but R02 keeps
// them out of 03_Stable_Build until the human has SEEN them work — and they cannot be
// seen without being called. This flag is the smallest thing that resolves that circle.
//
// OFF unless SOLID_GROUND=1 is in the environment. With the flag absent, `solidGround`
// stays null, every call site below is skipped, and this file behaves exactly as it did
// before — which is what makes it safe to sit here before the gate.
//
//   node 03_Stable_Build/server.js              <- unchanged behaviour
//   SOLID_GROUND=1 node 03_Stable_Build/server.js   <- road, barriers, grip, terrain
//
// ⚠ DELETE THIS BLOCK AT PROMOTION. Once the four modules move into 03_Stable_Build the
// imports become ordinary ones and the flag becomes dead weight — and a permanent flag
// guarding half the physics is exactly the sort of thing that quietly becomes two engines.
let solidGround = null;
if (process.env.SOLID_GROUND === '1') {
  const [road, barriers, surfaces, heightfield, botLine] = await Promise.all([
    import('../02_Isolation_Chamber/road-geometry_v1.js'),
    import('../02_Isolation_Chamber/barriers_v1.js'),
    import('../02_Isolation_Chamber/surfaces_v1.js'),
    import('../02_Isolation_Chamber/heightfield_v1.js'),
    import('../02_Isolation_Chamber/bot-racing-line_v1.js'),
  ]);
  solidGround = {
    // Built ONCE at boot, not per room or per tick: the index is read-only, so sharing
    // one is safe, and building it costs 0.9 ms (ADR-0026).
    index: road.buildRoadIndex(CIRCUIT_DEF.road),
    field: heightfield.COAST,
    resolveBarrier: barriers.resolveBarrier,
    applySurfaceDrag: surfaces.applySurfaceDrag,
    settleOnTerrain: heightfield.settleOnTerrain,
    // S7: bots that know where the road is. Measured over ADR-0011's seeded 180 s sim,
    // the wrapper takes finishers 5 -> 8, gates 167 -> 216, time off the road
    // 25.6% -> 5.1%, and karts that fall off the island 7/8 -> 0/8.
    makeRoadAwareBot: botLine.makeRoadAwareBot,
  };
  console.log('[SOLID GROUND] road + barriers + grip + terrain + road-aware bots ACTIVE (S1-S4 + S7, unpromoted)');
}

/**
 * solidGroundStep — the S1-S4 passes for one vehicle, in the order their contracts
 * require: barrier clamp, then grip on the ground it ended up on, then the elevation
 * settle once x and z are final (heightfield_v1's header spells out why).
 *
 * The matching pre-step is the groundY argument at the updateVehicle call sites below —
 * sampled at the kart's OLD position, which is what stops a descending kart being
 * mislabelled AIRBORNE. Both halves are needed; neither works alone.
 */
function solidGroundStep(v) {
  if (!solidGround) return;
  solidGround.resolveBarrier(v, solidGround.index, DT);
  solidGround.applySurfaceDrag(v, solidGround.index, DT);
  solidGround.settleOnTerrain(v, solidGround.field, DT);
}

// The ground height under a kart right now, for the updateVehicle pre-step. Returns the
// module default (0) when the flag is off, so the call sites read identically either way.
function groundUnder(v) {
  return solidGround ? solidGround.field.heightAt(v.x, v.z) : 0;
}

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
        // S7 covers traffic as well as bots, and traffic.js:50 gives each car the SAME
        // BotController, so the same wrapper works with no new code. Without this the
        // three obstacle cars spend half the race on the grass — measured live at
        // 44-56% — which after S3 also means they crawl.
        if (solidGround) {
          for (const t of room.trafficList) {
            t.bot = solidGround.makeRoadAwareBot(t.bot, solidGround.index);
          }
        }

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
          // S7 wraps the controller so the bot holds a line on the road. With the flag
          // off this is the untouched BotController, exactly as before.
          const controller = new BotController(botId);
          room.bots.set(botId, solidGround
            ? solidGround.makeRoadAwareBot(controller, solidGround.index)
            : controller);
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
    } else if (msg.startsWith('FIRE')) {
      // Weapon fire command: FIRE or FIRE|weaponType
      const v = room.lobby.getVehicle(clientId);
      if (v && v.state !== 'CRASHED') {
        const parts = msg.split('|');
        const weaponType = parts[1] || null;
        const vehicleArray = Array.from(room.lobby.players.values());
        const fireResult = fireWeapon(v, weaponType, vehicleArray, code);
        
        if (fireResult) {
          if (fireResult.type === 'PROJECTILE' || fireResult.type === 'MINE') {
            room.activeItems.push(fireResult.data);
          } else if (fireResult.type === 'SHOCKWAVE' || fireResult.type === 'EMP') {
            applyAreaEffect(fireResult.data, vehicleArray);
          }
          // Broadcast fire event to all clients for visual/audio feedback
          for (const [cid, wsConn] of room.connections.entries()) {
            wsConn.send(`WEAPON_FIRE|${v.id}|${fireResult.type}`);
          }
        }
      }
    } else if (msg.startsWith('CYCLE_WEAPON')) {
      // Cycle to next weapon
      const v = room.lobby.getVehicle(clientId);
      if (v) {
        const newWeapon = cycleWeapon(v);
        ws.send(`WEAPON_CYCLE|${newWeapon || 'NONE'}`);
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
      let newV = updateVehicle(v, finalInput, DT, groundUnder(v));
      
      if (newV.state !== 'AIRBORNE' && newV.state !== 'CRASHED') {
        const pad = getLaunchPadAt(newV.x, newV.z);
        if (pad) {
          newV = launchVehicle(newV, pad.power);
        }
      }

      // After the pad check, so a launched kart is skipped by all three passes — which is
      // the exemption that makes the ramps and the shortcut work.
      solidGroundStep(newV);

      newV._input = v._input;
      room.lobby.players.set(clientId, newV);
    }

    // Update Traffic
    for (const t of room.trafficList) {
      const input = updateTrafficVehicle(t, DT);
      t.vehicle = updateVehicle(t.vehicle, input, DT, groundUnder(t.vehicle));
      if (t.vehicle.state !== 'AIRBORNE' && t.vehicle.state !== 'CRASHED') {
        const pad = getLaunchPadAt(t.vehicle.x, t.vehicle.z);
        if (pad) {
          t.vehicle = launchVehicle(t.vehicle, pad.power);
        }
      }
      solidGroundStep(t.vehicle);
      advanceTrafficProgress(t);
    }

    // 2. Update Race
    room.raceManager.update(DT, room.lobby);

    // 3. Update Projectiles (weapon system)
    if (room.projectiles && room.projectiles.length > 0) {
      const vehicleArray = Array.from(room.lobby.players.values());
      room.projectiles = updateProjectiles(room.projectiles, vehicleArray, DT);
    } else if (!room.projectiles) {
      room.projectiles = [];
    }

    // 4. Update Items & Collisions
    const updatedVehicles = room.lobby.getAllVehicles();
    const allVehicles = [...updatedVehicles, ...room.trafficList.map(t => t.vehicle)];
    
    room.activeItems = updateItems(room.activeItems, allVehicles, DT);
    applyCarCollisions(allVehicles);

    // applyCarCollisions PUSHES KARTS APART by editing x and z directly, with no idea a
    // barrier exists — so a pileup against a wall would shove a car straight through the
    // steel that step 1 had just contained. Re-clamping afterwards closes that, and it
    // costs 0.4 us per kart (ADR-0027). Grip and terrain are not re-run: a shove does not
    // change what you are standing on, and the elevation settle would fight the push.
    if (solidGround) {
      for (const v of allVehicles) solidGround.resolveBarrier(v, solidGround.index, DT);
    }

    // 4. Generate State Frame
    const vehicleLedger = serializeLedger(allVehicles);
    const itemLedger = serializeLedger(room.activeItems);
    const projectileLedger = room.projectiles.length > 0 ? serializeLedger(room.projectiles) : null;
    
    const raceLine = `RACE|${raceInfo.state}|${raceInfo.countdown}|${raceInfo.raceTime.toFixed(1)}|${raceInfo.totalLaps}|${raceInfo.finishOrder.length}`;
    
    let fullFrame = raceLine;
    // LEADERBOARD carries the FINAL STANDINGS and is sent only once the race is over.
    //
    // Two things changed here. It used to send `finishOrder` from the moment the
    // first racer crossed, re-running JSON.stringify on it 60 times a second for the
    // rest of the race — and no client ever read it before COMPLETE (R07). And it
    // was gated on `finishOrder.length > 0`, so a race where NOBODY finished sent no
    // leaderboard at all: the room reached COMPLETE and every client sat on a frozen
    // HUD with no results and no way out. `standings` always contains every entrant,
    // so that dead end is gone.
    //
    // Stringified once and cached on the room, because the broadcast loop keeps
    // running after the race ends and the standings never change again.
    if (raceInfo.standings) {
      if (!room._standingsJson) {
        room._standingsJson = JSON.stringify(raceInfo.standings);
      }
      fullFrame += '\nLEADERBOARD|' + room._standingsJson;
    }
    if (vehicleLedger) fullFrame += '\n' + vehicleLedger;
    if (itemLedger) fullFrame += '\n' + itemLedger;
    if (projectileLedger) fullFrame += '\nPROJECTILES|' + projectileLedger;

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

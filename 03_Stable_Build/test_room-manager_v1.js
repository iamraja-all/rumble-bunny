import { RoomManager } from './room-manager.js';

/**
 * test_room-manager_v1: room lifecycle — codes, join, leave, garbage collection,
 * and the stat block reaching the lobby.
 *
 * TWO THINGS THIS FILE GOT WRONG BEFORE (fixed 2026-08-02, ADR-0012):
 *
 * 1. It could not fail. Every check printed ✅ or ❌ and the process exited 0
 *    regardless, so a red assertion here would have sailed through `npm test`.
 *
 * 2. MockLobby's constructor took only (roomName) — the exact same one-argument
 *    shape as the BUG in RoomManager.createRoom, which called `new LobbyClass(code)`
 *    and silently dropped the stat block. A mock built to match the caller instead
 *    of the real collaborator's contract cannot catch a mismatch between them. The
 *    consequence shipped: every kart in every room was built with no stats, the
 *    physics produced NaN, and the whole field sat at (0,0,0). Only the end-to-end
 *    socket test found it. MockLobby now mirrors the real Lobby signature.
 */

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { console.log(`✅ PASS ${label}`); passed++; }
  else { console.log(`❌ FAIL ${label}`); failed++; }
}

class MockLobby {
  // Mirrors the real Lobby: (roomName, baseStats).
  constructor(roomName, baseStats) {
    this.roomName = roomName;
    this.baseStats = baseStats;
    this.players = new Set();
  }
  join(id) {
    if (this.players.size >= 8) return null;
    this.players.add(id);
    return `P${this.players.size - 1}`;
  }
  leave(id) {
    this.players.delete(id);
  }
}

class MockRaceManager {
  constructor() {
    this.state = 'WAITING';
    this.players = new Set();
  }
  registerPlayer(id) { this.players.add(id); }
  removePlayer(id) { this.players.delete(id); }
  startCountdown() { this.state = 'COUNTDOWN'; }
}

const STATS = { max_speed: 40, acceleration: 5, handling: 1.5, stunt_rate: 2, weight: 1000, boost_mult: 1.5 };
const rm = new RoomManager();

// Test 1: Generate valid room codes
const room = rm.createRoom(MockLobby, MockRaceManager, STATS);
assert(room.code.length === 4 && /^[A-Z]{4}$/.test(room.code), 'T1: Room code is 4 uppercase letters');
assert(rm.getRoom(room.code) === room, 'T1: Room retrieved by code');

// Test 2: Invalid join fails
assert(rm.joinRoom('BAD!', 'client-1') === null, 'T2: Joining bad code returns null');

// Test 3: Valid join
const joinRes = rm.joinRoom(room.code, 'client-1');
assert(joinRes !== null, 'T3: Valid join succeeds');
assert(room.clients.has('client-1'), 'T3: Client added to room');

// Test 5: the stat block actually reaches the lobby.
// Without this, every vehicle in the room is built from `undefined`, updateVehicle
// reads undefined for max_speed and acceleration, and the entire field NaNs out to
// the world origin while the race state cheerfully reports RACING.
assert(room.lobby.baseStats === STATS, 'T5: createRoom passes baseStats through to the Lobby');
assert(room.lobby.baseStats && room.lobby.baseStats.max_speed === 40, 'T5b: the stat block arrives intact');

// Test 4: Leave room and GC
rm.leaveRoom(room.code, 'client-1');
assert(!rm.getRoom(room.code), 'T4: Room garbage collected when empty');

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);

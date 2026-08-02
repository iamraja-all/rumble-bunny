import { RoomManager } from './room-manager.js';

class MockLobby {
  constructor(roomName) {
    this.roomName = roomName;
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

const rm = new RoomManager();

// Test 1: Generate valid room codes
const room = rm.createRoom(MockLobby, MockRaceManager);
console.log(room.code.length === 4 && /^[A-Z]{4}$/.test(room.code) ? '✅ PASS' : '❌ FAIL', 'T1: Room code is 4 uppercase letters');
console.log(rm.getRoom(room.code) === room ? '✅ PASS' : '❌ FAIL', 'T1: Room retrieved by code');

// Test 2: Invalid join fails
console.log(rm.joinRoom('BAD!', 'client-1') === null ? '✅ PASS' : '❌ FAIL', 'T2: Joining bad code returns null');

// Test 3: Valid join
const joinRes = rm.joinRoom(room.code, 'client-1');
console.log(joinRes !== null ? '✅ PASS' : '❌ FAIL', 'T3: Valid join succeeds');
console.log(room.clients.has('client-1') ? '✅ PASS' : '❌ FAIL', 'T3: Client added to room');

// Test 4: Leave room and GC
rm.leaveRoom(room.code, 'client-1');
console.log(!rm.getRoom(room.code) ? '✅ PASS' : '❌ FAIL', 'T4: Room garbage collected when empty');

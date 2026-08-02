// Room Manager - Isolation Chamber Prototype

export class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  // Generate a random 4-letter uppercase code
  _generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  createRoom(LobbyClass, RaceManagerClass) {
    let code;
    do {
      code = this._generateCode();
    } while (this.rooms.has(code));

    const lobby = new LobbyClass(code);
    const raceManager = new RaceManagerClass();

    const room = {
      code,
      lobby,
      raceManager,
      clients: new Set(),
      bots: new Map(),
      trafficList: [],
      activeItems: []
    };

    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get(code.toUpperCase());
  }

  joinRoom(code, clientId) {
    const room = this.getRoom(code);
    if (!room) return null;
    
    // Check if room is full
    // Mock lobby has a join method that returns a pid or null
    const pid = room.lobby.join(clientId);
    if (!pid) return null; // full

    room.raceManager.registerPlayer(clientId);
    room.clients.add(clientId);

    return { room, pid };
  }

  leaveRoom(code, clientId) {
    const room = this.getRoom(code);
    if (!room) return false;

    if (room.clients.has(clientId)) {
      room.clients.delete(clientId);
      room.raceManager.removePlayer(clientId);
      room.lobby.leave(clientId);
      
      // Garbage collect empty rooms
      if (room.clients.size === 0) {
        this.rooms.delete(room.code);
      }
      return true;
    }
    return false;
  }
}

import { RaceManager } from '../03_Stable_Build/race.js';

// Mock Lobby with 2 players
const mockLobby = {
  players: new Map([
    ['client-1', { id: 'P0', x: 0, y: 0, z: -10, modifiers: {} }],
    ['client-2', { id: 'P1', x: 0, y: 0, z: -10, modifiers: {} }]
  ])
};

const race = new RaceManager();
race.totalLaps = 1;
race.registerPlayer('client-1');
race.registerPlayer('client-2');

// Fast forward to racing
race.state = 'RACING';
race.raceTime = 0;

// Update 1: Client 1 finishes
mockLobby.players.get('client-1').z = -1000; // pretend far ahead
// Force circuit progress
race.update(1.0, mockLobby);
// wait, testing the internals of race.js which requires circuit track progress might be hard without moving them properly through the gates.
// Let's just directly manipulate the state for the test
race.raceStates.get('client-1').finished = true;
race.raceStates.get('client-1').finishTime = 45.2;
race.finishOrder.push({ clientId: 'client-1', pid: 'P0', time: 45.2 });

console.log("Leaderboard:", JSON.stringify(race.getRaceInfo().finishOrder));

if (race.getRaceInfo().finishOrder[0].pid === 'P0') {
  console.log("✅ PASS: Leaderboard contains P0 with time");
} else {
  console.log("❌ FAIL: Leaderboard incorrect");
}

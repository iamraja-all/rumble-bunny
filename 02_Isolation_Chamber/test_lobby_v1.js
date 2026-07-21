import { Lobby } from './lobby.js';
import { parseLedger } from './ledger.js';

/**
 * test_lobby_v1: Test runner for headless lobby and sync management.
 *
 * WHY:
 * Validates joining, leaving, slot tracking, and correct delta serialization
 * of up to 8 players. Terminal output is binary pass/fail per R04 Defined Win.
 */

const BALANCED_STATS = {
  max_speed: 40.0,
  acceleration: 5.0,
  handling: 1.5,
  stunt_rate: 2.0,
  weight: 1000.0,
  boost_mult: 1.5,
};

function runTests() {
  let allPassed = true;

  const assert = (condition, message) => {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
    } else {
      console.log(`❌ FAIL: ${message}`);
      allPassed = false;
    }
  };

  // ── Test 1: Lobby creation and initial state ────────────────────────
  (() => {
    const lobby = new Lobby('RoomA', BALANCED_STATS);
    assert(lobby.roomName === 'RoomA', 'T1: Lobby roomName is stored');
    assert(lobby.getAllVehicles().length === 0, 'T1: Lobby starts empty');
    assert(lobby.getLedgerFrame() === '', 'T1: Empty lobby yields empty ledger');
  })();

  // ── Test 2: Player join assigns PID and start position ────────────────
  (() => {
    const lobby = new Lobby('RoomA', BALANCED_STATS);
    const pid = lobby.join('client-xyz');

    assert(pid === 'P0', 'T2: First player assigned P0');
    
    const v = lobby.getVehicle('client-xyz');
    assert(v !== undefined, 'T2: Vehicle object created for client');
    assert(v.id === 'P0', 'T2: Vehicle id matches assigned PID');
    assert(v.x === -10 && v.y === 0 && v.z === 0, 'T2: Vehicle positioned at slot 0 start position');
  })();

  // ── Test 3: Same player cannot join twice ───────────────────────────
  (() => {
    const lobby = new Lobby('RoomA', BALANCED_STATS);
    lobby.join('client-1');
    const duplicatePid = lobby.join('client-1');

    assert(duplicatePid === null, 'T3: Duplicate client join returns null');
    assert(lobby.getAllVehicles().length === 1, 'T3: Duplicate join does not add extra slots');
  })();

  // ── Test 4: Maximum 8 players can join ──────────────────────────────
  (() => {
    const lobby = new Lobby('RoomA', BALANCED_STATS);
    
    for (let i = 0; i < 8; i++) {
      const pid = lobby.join(`client-${i}`);
      assert(pid === `P${i}`, `T4: Player ${i} assigned slot P${i}`);
    }

    assert(lobby.getAllVehicles().length === 8, 'T4: Lobby holds 8 players');
    
    const excessJoin = lobby.join('client-9');
    assert(excessJoin === null, 'T4: 9th player join returns null (lobby full)');
  })();

  // ── Test 5: Player leaving frees up slot ────────────────────────────
  (() => {
    const lobby = new Lobby('RoomA', BALANCED_STATS);
    lobby.join('client-0'); // P0
    lobby.join('client-1'); // P1
    lobby.join('client-2'); // P2

    const leaveSuccess = lobby.leave('client-1');
    assert(leaveSuccess === true, 'T5: Valid leave returns true');
    assert(lobby.getVehicle('client-1') === undefined, 'T5: Vehicle removed from map');
    
    const vehicles = lobby.getAllVehicles();
    assert(vehicles.length === 2, 'T5: Active vehicles length is 2');
    assert(vehicles[0].id === 'P0' && vehicles[1].id === 'P2', 'T5: P0 and P2 remain');

    // New join should take the first available slot (P1)
    const newPid = lobby.join('client-3');
    assert(newPid === 'P1', 'T5: New player fills vacated P1 slot');
  })();

  // ── Test 6: Ledger frame serialization (AI Whisperer Format) ────────
  (() => {
    const lobby = new Lobby('RoomA', BALANCED_STATS);
    lobby.join('client-0');
    lobby.join('client-1');

    const ledgerString = lobby.getLedgerFrame();
    const lines = ledgerString.split('\n');
    assert(lines.length === 2, 'T6: Ledger string has 2 lines for 2 players');
    assert(lines[0].startsWith('P0|VEHICLE|-10'), 'T6: Line 1 correct format');
    assert(lines[1].startsWith('P1|VEHICLE|10'), 'T6: Line 2 correct format');
  })();

  // ── Test 7: Ledger frame can be parsed back perfectly ───────────────
  (() => {
    const lobby = new Lobby('RoomA', BALANCED_STATS);
    lobby.join('client-0');
    
    // Modify state slightly to ensure fields serialize/parse
    const v = lobby.getVehicle('client-0');
    v.speed = 15.5;
    v.rotY = 1.0;
    v.state = 'AIRBORNE';
    v.modifiers.stunts = 2;

    const ledgerString = lobby.getLedgerFrame();
    const parsed = parseLedger(ledgerString);

    assert(parsed.length === 1, 'T7: Parsed ledger yields 1 entity');
    const parsedV = parsed[0];
    assert(parsedV.id === 'P0', 'T7: Parsed ID matches');
    assert(parsedV.speed === 15.5, 'T7: Parsed speed matches');
    assert(parsedV.rotY === 1.0, 'T7: Parsed rotY matches');
    assert(parsedV.state === 'AIRBORNE', 'T7: Parsed state matches');
    assert(parsedV.modifiers.stunts === 2, 'T7: Parsed modifier matches');
  })();

  // ── RESULTS ─────────────────────────────────────────────────────────
  console.log('');
  if (allPassed) {
    console.log('ALL TESTS PASSED ✅');
    process.exit(0);
  } else {
    console.log('SOME TESTS FAILED ❌');
    process.exit(1);
  }
}

runTests();

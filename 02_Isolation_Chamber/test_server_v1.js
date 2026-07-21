import WebSocket from 'ws';
import { parseLedger } from './ledger.js';

/**
 * test_server_v1: End-to-End Headless integration test for WebSocket server.
 * 
 * WHY:
 * Validates the full slice: connection -> lobby assignment -> physics tick -> 
 * serialization -> broadcast -> parsing.
 */

async function runTests() {
  let allPassed = true;

  const assert = (condition, message) => {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
    } else {
      console.log(`❌ FAIL: ${message}`);
      allPassed = false;
    }
  };

  const ws = new WebSocket('ws://localhost:8080');

  let initReceived = false;
  let pid = null;
  let framesReceived = 0;
  let vehicleState = null;

  ws.on('message', (data) => {
    const msg = data.toString().trim();
    
    if (msg.startsWith('INIT|')) {
      initReceived = true;
      pid = msg.split('|')[1];
      
      // Start holding throttle immediately after connection
      ws.send('INPUT|1.0|0|0|0');
      return;
    }

    // Must be a ledger frame
    const entities = parseLedger(msg);
    framesReceived++;
    
    if (pid) {
      vehicleState = entities.find(e => e.id === pid);
    }
  });

  // Wait 1 second (60 frames) to let physics accumulate
  await new Promise(resolve => setTimeout(resolve, 1000));

  ws.close();

  assert(initReceived, 'T1: Received INIT message from server');
  assert(pid === 'P0', `T1: Assigned PID is P0 (got ${pid})`);
  assert(framesReceived > 30, `T2: Received 60fps broadcasts (got ${framesReceived} frames in 1s)`);
  assert(vehicleState !== null, 'T3: Vehicle state found in ledger frame');
  
  // Acceleration is 5.0, so after 1s of holding throttle, speed should be > 0 (close to 5.0)
  assert(vehicleState && vehicleState.speed > 0, `T4: Input successfully applied (speed=${vehicleState ? vehicleState.speed : 0})`);
  assert(vehicleState && vehicleState.z < 0, `T4: Vehicle moved forward in Z (z=${vehicleState ? vehicleState.z : 0})`);

  console.log('');
  if (allPassed) {
    console.log('ALL TESTS PASSED ✅');
    process.exit(0);
  } else {
    console.log('SOME TESTS FAILED ❌');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

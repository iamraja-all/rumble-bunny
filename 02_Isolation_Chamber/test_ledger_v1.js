import { parseLedger, serializeLedger } from './ledger.js';

/**
 * test_ledger_v1: Test runner to validate ledger serialization/deserialization logic.
 * 
 * WHY:
 * Isolation Chamber test files must execute headlessly in the terminal and report
 * binary pass/fail results to establish correct behavior before stable build promotion.
 * 
 * Big-O Complexity: O(T * N * M) where T is number of test cases, N is number of lines, M is modifiers.
 */

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

  // Test 1: Basic parsing and matching fields
  (() => {
    const rawFrame = "P0|VEHICLE|120.45|12.3|-450.12|0.12|1.57|0|45.2|AIRBORNE|stunts:2;boost_timer:0";
    const entities = parseLedger(rawFrame);
    
    assert(entities.length === 1, "Should parse exactly one entity");
    const e = entities[0];
    assert(e.id === "P0", "ID should match");
    assert(e.type === "VEHICLE", "Type should match");
    assert(e.x === 120.45, "X coordinate should match");
    assert(e.y === 12.3, "Y coordinate should match");
    assert(e.z === -450.12, "Z coordinate should match");
    assert(e.rotX === 0.12, "RotX should match");
    assert(e.rotY === 1.57, "RotY should match");
    assert(e.rotZ === 0, "RotZ should match");
    assert(e.speed === 45.2, "Speed should match");
    assert(e.state === "AIRBORNE", "State should match");
    assert(e.modifiers.stunts === 2, "Modifiers stunts should match as number");
    assert(e.modifiers.boost_timer === 0, "Modifiers boost_timer should match as number");
  })();

  // Test 2: Roundtrip serialization consistency
  (() => {
    const originalFrame = "P0|VEHICLE|10.5|20.3|-30|0|0|0|5.5|NORMAL|boost:1\nP1|VEHICLE|0|0|0|0|0|0|0|NORMAL|";
    const parsed = parseLedger(originalFrame);
    const serialized = serializeLedger(parsed);
    
    // Normalize newlines and trim for string match comparison
    const norm = (s) => s.trim().replace(/\r\n/g, '\n');
    assert(norm(serialized) === norm(originalFrame), "Roundtrip serialization should match original flat string");
  })();

  // Test 3: Float formatting compression
  (() => {
    const entity = {
      id: "P0",
      type: "VEHICLE",
      x: 12.345678,
      y: 0.0001,
      z: -1.2,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      speed: 10.0,
      state: "NORMAL",
      modifiers: {}
    };
    
    const serialized = serializeLedger([entity]);
    const parsed = parseLedger(serialized)[0];
    
    // Float X should be clamped to 3 decimal places (12.346)
    assert(parsed.x === 12.346, "Float coordinates should be formatted/rounded to 3 decimal places max");
    // Float Y (0.0001) should round to 0
    assert(parsed.y === 0, "Float coordinates near 0 should format to 0");
  })();

  // Test 4: Handling of malformed input lines
  (() => {
    const malformedStr = "P0|VEHICLE|10.5|20.3\n\nINVALID_LINE_WITH_NO_PIPES\nP1|VEHICLE|0|0|0|0|0|0|0|NORMAL|";
    const parsed = parseLedger(malformedStr);
    assert(parsed.length === 1, "Malformed lines should be silently skipped, keeping valid ones");
    assert(parsed[0].id === "P1", "Remaining valid line should be parsed correctly");
  })();

  if (allPassed) {
    console.log("\nALL TESTS PASSED ✅");
    process.exit(0);
  } else {
    console.log("\nSOME TESTS FAILED ❌");
    process.exit(1);
  }
}

runTests();

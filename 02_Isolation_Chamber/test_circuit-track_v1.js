import {
  CIRCUIT_DEF,
  advanceCircuitProgress,
  createCircuitProgress,
  validateCircuitDefinition,
} from './circuit-track.js';

const MAIN_CROSSES = [
  [{ x: -53.12, z: 5.684 }, { x: -56.88, z: 4.316 }],
  [{ x: -64.718, z: -63.02 }, { x: -65.282, z: -66.98 }],
  [{ x: -21.494, z: -103.672 }, { x: -18.506, z: -106.328 }],
  [{ x: 58.256, z: -60.98 }, { x: 61.744, z: -59.02 }],
  [{ x: 60, z: 18 }, { x: 60, z: 22 }],
  [{ x: 21.504, z: 53.682 }, { x: 18.496, z: 56.318 }],
  [{ x: 1.11, z: 26.664 }, { x: -1.11, z: 23.336 }],
];

const SHORTCUT_CROSSES = [
  MAIN_CROSSES[0],
  MAIN_CROSSES[1],
  MAIN_CROSSES[2],
  [{ x: -10.798, z: -83.834 }, { x: -9.202, z: -80.166 }],
  [{ x: 30.772, z: -29.578 }, { x: 33.228, z: -26.422 }],
  MAIN_CROSSES[4],
  MAIN_CROSSES[5],
  MAIN_CROSSES[6],
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function advanceThrough(progress, crossings) {
  let current = progress;
  let lastResult = null;

  for (const [previous, next] of crossings) {
    lastResult = advanceCircuitProgress(current, previous, next);
    current = lastResult.progress;
  }

  return { progress: current, result: lastResult };
}

function expectThrows(action, expectedText, message) {
  try {
    action();
  } catch (error) {
    assert(error.message.includes(expectedText), message);
    return;
  }

  throw new Error(message);
}

function runTests() {
  validateCircuitDefinition(CIRCUIT_DEF);
  assert(CIRCUIT_DEF.spawnPositions.length === 8, 'T1: circuit exposes exactly eight racer spawns');
  assert(CIRCUIT_DEF.launchPads.filter((pad) => pad.type === 'MAIN').length === 3, 'T2: circuit exposes three main-route jumps');
  assert(CIRCUIT_DEF.shortcut.launchPadId === 'shortcut-ramp', 'T3: shortcut declares its physical ramp');

  const main = advanceThrough(createCircuitProgress(), MAIN_CROSSES);
  assert(main.result.lapCompleted, 'T4: legal main route completes a lap');
  assert(main.progress.lapsCompleted === 1, 'T5: main route records exactly one completed lap');
  assert(main.progress.route === 'UNSET', 'T6: main route resets branch after the finish');

  const shortcut = advanceThrough(createCircuitProgress(), SHORTCUT_CROSSES);
  assert(shortcut.result.lapCompleted, 'T7: legal shortcut route completes a lap');
  assert(shortcut.progress.lapsCompleted === 1, 'T8: shortcut records exactly one completed lap');

  const earlyFinish = advanceCircuitProgress(createCircuitProgress(), ...MAIN_CROSSES[6]);
  assert(!earlyFinish.lapCompleted, 'T9: finish before required gates does not score a lap');
  assert(earlyFinish.progress.nextGateIds[0] === 'coast-west', 'T10: early finish keeps the first gate required');

  const reverse = advanceCircuitProgress(createCircuitProgress(), MAIN_CROSSES[0][1], MAIN_CROSSES[0][0]);
  assert(!reverse.crossedGateId, 'T11: reverse travel cannot cross a directed gate');
  assert(reverse.progress.nextGateIds[0] === 'coast-west', 'T12: reverse travel cannot advance progress');

  const shortcutEntry = advanceThrough(createCircuitProgress(), SHORTCUT_CROSSES.slice(0, 4)).progress;
  const skippedLanding = advanceCircuitProgress(shortcutEntry, ...MAIN_CROSSES[4]);
  assert(!skippedLanding.crossedGateId, 'T13: shortcut merge cannot bypass its landing gate');
  assert(skippedLanding.progress.nextGateIds[0] === 'shortcut-landing', 'T14: landing remains required after a skipped merge');

  const coastCrossed = advanceCircuitProgress(createCircuitProgress(), ...MAIN_CROSSES[0]);
  const repeated = advanceCircuitProgress(coastCrossed.progress, MAIN_CROSSES[0][1], MAIN_CROSSES[0][1]);
  assert(!repeated.crossedGateId, 'T15: resting inside a gate cannot advance progress twice');

  const malformed = structuredClone(CIRCUIT_DEF);
  malformed.gates[1].id = malformed.gates[0].id;
  expectThrows(() => validateCircuitDefinition(malformed), 'duplicate gate ID', 'T16: duplicate gate IDs fail validation');

  console.log('ALL CIRCUIT CONTRACT TESTS PASSED');
}

runTests();

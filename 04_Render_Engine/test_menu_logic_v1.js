import { buildResultRows, deriveRoster } from './src/menu.js';

/**
 * test_menu_logic_v1.js — the results screen and the lobby roster, without a browser.
 *
 * Companion to test_hud_logic_v1.js, same reasoning (ADR-0024): these are judgement
 * calls welded to DOM writes, so they were only ever checked by looking at a screenshot
 * of a race that had to be driven to completion first — several minutes per look. Both
 * functions guard rules this project has already broken:
 *   - the results screen rendered `finishOrder` and omitted every DNF, so an eight-car
 *     race that five karts finished showed five rows and left the reader off the list
 *   - counting traffic as players is the same conflation that once reported "9th" in an
 *     eight-player race and once put a traffic car in the finishing order
 *
 * menu.js touches `document` only inside MainMenu, so importing it in Node is safe.
 *
 * INPUT:  hand-built standings arrays and ledger frames.
 * OUTPUT: result-row descriptors and lobby roster entries.
 * PASS:   every assertion green and exit code 0.
 */

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { console.log(`✅ PASS: ${label}`); passed++; }
  else { console.log(`❌ FAIL: ${label}`); failed++; }
}

// ── Test 1: a normal mixed result ─────────────────────────────────────────────
(() => {
  const rows = buildResultRows([
    { pid: 'P2', dnf: false, time: 153.84 },
    { pid: 'P3', dnf: false, time: 158.0 },
    { pid: 'P0', dnf: true, time: 0 },
    { pid: 'P5', dnf: true, time: 0 },
  ], 'P0');

  assert(rows.length === 4, `T1a: every entrant gets a row (got ${rows.length})`);
  assert(rows[0].position === '1' && rows[1].position === '2', 'T1b: finishers are numbered in order');
  assert(rows[0].result === '153.8s', `T1c: time is rounded to a tenth (got ${rows[0].result})`);
  assert(rows[0].classes.includes('result-row-win'), 'T1d: the first finisher is the winner');
  assert(!rows[1].classes.includes('result-row-win'), 'T1e: and only the first');

  // A DNF has no finishing position and no time.
  assert(rows[2].position === '—', `T1f: a DNF shows an em-dash for position (got ${rows[2].position})`);
  assert(rows[3].position === '—', 'T1g: every DNF, not just the first');
  assert(rows[2].result === 'DNF', `T1h: a DNF shows DNF, never a time (got ${rows[2].result})`);
  assert(rows[2].classes.includes('result-row-dnf'), 'T1i: DNF rows are tagged for dimming');
})();

// ── Test 2: DNFs must not consume finishing positions ─────────────────────────
// The ordering guarantee is the engine's, but if a DNF appeared mid-list the numbering
// must still skip it — otherwise the kart after it is numbered one place too low.
(() => {
  const rows = buildResultRows([
    { pid: 'P1', dnf: false, time: 100 },
    { pid: 'P2', dnf: true, time: 0 },
    { pid: 'P3', dnf: false, time: 120 },
  ], null);
  assert(rows[0].position === '1', 'T2a: first finisher is 1');
  assert(rows[1].position === '—', 'T2b: the DNF between them takes no number');
  assert(rows[2].position === '2', `T2c: the next finisher is 2, not 3 (got ${rows[2].position})`);
})();

// ── Test 3: a race nobody finished has no winner ──────────────────────────────
// Reachable when the only finisher disconnects (test_race_v1 T20). Crowning row zero
// would award the win to whoever happened to sort first among the DNFs.
(() => {
  const rows = buildResultRows([
    { pid: 'P0', dnf: true, time: 0 },
    { pid: 'P1', dnf: true, time: 0 },
  ], 'P1');
  assert(rows.every((r) => !r.classes.includes('result-row-win')), 'T3a: no winner is crowned when nobody finished');
  assert(rows.every((r) => r.position === '—'), 'T3b: nobody holds a finishing position');
  assert(rows[1].isYou === true && rows[1].classes.includes('result-row-you'), 'T3c: the local player is still marked');
})();

// ── Test 4: finding yourself ──────────────────────────────────────────────────
(() => {
  const standings = [{ pid: 'P4', dnf: false, time: 90 }, { pid: 'P7', dnf: false, time: 95 }];
  const mine = buildResultRows(standings, 'P7');
  assert(mine[1].isYou && !mine[0].isYou, 'T4a: exactly the local row is flagged');
  const spectator = buildResultRows(standings, null);
  assert(spectator.every((r) => !r.isYou), 'T4b: no local pid means no row is flagged');
  assert(buildResultRows([], 'P0').length === 0, 'T4c: empty standings produce no rows');
  assert(buildResultRows(undefined, 'P0').length === 0, 'T4d: missing standings do not throw');
})();

// ── Test 5: the roster counts players, never traffic ──────────────────────────
// THE REGRESSION THIS GUARDS. Traffic serializes as type VEHICLE.
(() => {
  const frame = [
    { id: 'P1', type: 'VEHICLE', modifiers: { color_sync: 0x00ff66 } },
    { id: 'T1', type: 'VEHICLE', modifiers: {} },
    { id: 'P0', type: 'VEHICLE', modifiers: { color_sync: 0xff0055 } },
    { id: 'T2', type: 'VEHICLE', modifiers: {} },
    { id: 'ITEM1', type: 'POWERUP_BOOST', modifiers: {} },
  ];
  const roster = deriveRoster(frame);
  assert(roster.length === 2, `T5a: only the two P-karts are players (got ${roster.length})`);
  assert(roster.map((r) => r.pid).join(',') === 'P0,P1', `T5b: sorted by slot number (got ${roster.map((r) => r.pid).join(',')})`);
  assert(!roster.some((r) => r.pid.startsWith('T')), 'T5c: no traffic in the roster');
})();

// ── Test 6: livery colours ────────────────────────────────────────────────────
(() => {
  const roster = deriveRoster([
    { id: 'P0', type: 'VEHICLE', modifiers: { color_sync: 0xff0055 } },
    { id: 'P1', type: 'VEHICLE', modifiers: {} },
    // A dark livery is the case that catches missing zero-padding: 0x0000ff must render
    // as #0000ff, not #ff.
    { id: 'P2', type: 'VEHICLE', modifiers: { color_sync: 0x0000ff } },
  ]);
  assert(roster[0].color === '#ff0055', `T6a: colour_sync becomes a hex string (got ${roster[0].color})`);
  assert(roster[1].color === '#8b8b8b', `T6b: a player with no colour gets the neutral default (got ${roster[1].color})`);
  assert(roster[2].color === '#0000ff', `T6c: dark colours are zero-padded to six digits (got ${roster[2].color})`);
  assert(roster.every((r) => /^#[0-9a-f]{6}$/.test(r.color)), 'T6d: every colour is a valid six-digit hex');
})();

// ── Test 7: slot ordering is numeric, not lexical ─────────────────────────────
// 'P10' sorts before 'P2' as a string. Unreachable at eight slots today, but the lobby
// cap is derived from spawnPositions and is exactly the number that changes.
(() => {
  const roster = deriveRoster([
    { id: 'P10', type: 'VEHICLE', modifiers: {} },
    { id: 'P2', type: 'VEHICLE', modifiers: {} },
    { id: 'P1', type: 'VEHICLE', modifiers: {} },
  ]);
  assert(roster.map((r) => r.pid).join(',') === 'P1,P2,P10', `T7: numeric slot order (got ${roster.map((r) => r.pid).join(',')})`);
  assert(deriveRoster([]).length === 0, 'T7b: an empty frame is an empty roster');
  assert(deriveRoster(undefined).length === 0, 'T7c: a missing frame does not throw');
})();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('SOME TESTS FAILED ❌');
  process.exit(1);
}
console.log('ALL TESTS PASSED ✅');
process.exit(0);

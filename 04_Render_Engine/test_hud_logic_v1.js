import { rankRacers, formatLapTime } from './src/hud.js';

/**
 * test_hud_logic_v1.js — the HUD's pure decisions, checked without a browser.
 *
 * WHY THIS FILE EXISTS:
 * the client is ~2,100 lines and, until `test_particles_v1.js`, had no automated test
 * of any kind. The reason was structural rather than lazy: everything interesting was
 * welded to the DOM, so checking it needed a real browser and a live race, and in
 * practice it got checked by driving and squinting. Two of the bugs that reached play
 * came from exactly that — the position readout counted traffic cones as racers and
 * reported "9th" in an eight-player race, and it ranked by raw Z, which on a closed
 * circuit means the leader reads last the moment they complete a lap.
 *
 * Neither needed a browser to catch. They needed the calculation to be reachable. So
 * `rankRacers` and `formatLapTime` are exported from hud.js and asserted here, in Node,
 * with no DOM and no new dependency — hud.js touches `document` only inside the class,
 * so importing it headlessly is safe (verified before this file was written).
 *
 * INPUT:  hand-built ledger entity arrays and raw second counts.
 * OUTPUT: field position and clock formatting.
 * PASS:   every assertion green and exit code 0.
 */

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { console.log(`✅ PASS: ${label}`); passed++; }
  else { console.log(`❌ FAIL: ${label}`); failed++; }
}

const kart = (id, lap, checkpoint, z) => ({
  id, type: 'VEHICLE', x: 0, y: 0, z, rotX: 0, rotY: 0, rotZ: 0, speed: 0, state: 'NORMAL',
  modifiers: { lap, checkpoint },
});

// ── Test 1: traffic is scenery, not competition ───────────────────────────────
// THE REGRESSION THIS FILE EXISTS FOR. Traffic serializes as type VEHICLE, so a naive
// filter counts three cones as racers and an 8-player race reports "9th".
(() => {
  const field = [
    kart('P0', 1, 3, 10), kart('P1', 1, 3, 5),
    { ...kart('T1', 0, 0, -50), id: 'T1' },
    { ...kart('T2', 0, 0, -60), id: 'T2' },
    { ...kart('T3', 0, 0, -70), id: 'T3' },
  ];
  const r = rankRacers(field, 'P0');
  assert(r.total === 2, `T1a: only the two P-karts are racers (got ${r.total})`);
  assert(r.rank === 2, `T1b: P0 is 2nd of 2, traffic ignored (got ${r.rank})`);
  assert(r.label === '2nd', `T1c: label reads 2nd (got ${r.label})`);
})();

// ── Test 2: laps outrank track position ───────────────────────────────────────
// THE OTHER REGRESSION. On a loop, Z resets toward the start line when a lap completes,
// so a leader on lap 2 sits at a "worse" Z than a backmarker on lap 1.
(() => {
  const leaderJustLapped = kart('P0', 2, 0, 30);   // one more lap, Z back near the line
  const backmarker = kart('P1', 1, 5, -100);       // deep into lap 1, far "ahead" in Z
  const r = rankRacers([backmarker, leaderJustLapped], 'P0');
  assert(r.rank === 1, `T2: more laps wins regardless of Z (got ${r.rank})`);
})();

// ── Test 3: gates break ties within a lap ─────────────────────────────────────
(() => {
  const ahead = kart('P0', 1, 4, 0);
  const behind = kart('P1', 1, 2, -80); // better Z, fewer gates cleared
  const r = rankRacers([behind, ahead], 'P0');
  assert(r.rank === 1, `T3: gates cleared beat raw Z within the same lap (got ${r.rank})`);
})();

// ── Test 4: Z breaks ties within a sector ─────────────────────────────────────
// Forward is -Z, so the lower Z is further along.
(() => {
  const further = kart('P0', 1, 3, -40);
  const nearer = kart('P1', 1, 3, -10);
  const r = rankRacers([nearer, further], 'P0');
  assert(r.rank === 1, `T4: lower Z leads inside the same sector (got ${r.rank})`);
})();

// ── Test 5: a player who is not in the field ──────────────────────────────────
// Happens between the handshake and the first ledger frame carrying your kart. It must
// read as "--", never as "1st" — telling someone they are leading a race they have not
// joined is worse than showing nothing.
(() => {
  const r = rankRacers([kart('P1', 0, 0, 0)], 'P0');
  assert(r.rank === 0, `T5a: unknown local pid gives rank 0 (got ${r.rank})`);
  assert(r.label === '--', `T5b: and the label is -- (got ${r.label})`);
  const empty = rankRacers([], 'P0');
  assert(empty.label === '--' && empty.total === 0, 'T5c: an empty field is -- of 0');
  assert(rankRacers(undefined, 'P0').label === '--', 'T5d: a missing entity list does not throw');
})();

// ── Test 6: ordinals, including the teens exception ───────────────────────────
// 11/12/13 take "th" despite ending 1/2/3. Unreachable at eight players today; a lobby
// cap is exactly the number that changes.
(() => {
  // Forward is -Z, so z = -i puts P0 at the BACK of the field and P(n-1) at the front.
  // Querying P0 therefore asks for nth place out of n. (First draft of this helper
  // queried P(n-1) and asserted last place — it was reading the front of the grid, and
  // every case came back "1st". The sort was right; the fixture was backwards.)
  const nth = (n) => {
    const field = [];
    for (let i = 0; i < n; i++) field.push(kart(`P${i}`, 0, 0, -i));
    return rankRacers(field, 'P0').label;
  };
  assert(nth(1) === '1st', `T6a: 1st (got ${nth(1)})`);
  assert(nth(2) === '2nd', `T6b: 2nd (got ${nth(2)})`);
  assert(nth(3) === '3rd', `T6c: 3rd (got ${nth(3)})`);
  assert(nth(4) === '4th', `T6d: 4th (got ${nth(4)})`);
  assert(nth(11) === '11th', `T6e: 11th, not 11st (got ${nth(11)})`);
  assert(nth(12) === '12th', `T6f: 12th, not 12nd (got ${nth(12)})`);
  assert(nth(13) === '13th', `T6g: 13th, not 13rd (got ${nth(13)})`);
  assert(nth(21) === '21st', `T6h: 21st (got ${nth(21)})`);
})();

// ── Test 7: missing modifiers must not throw ──────────────────────────────────
// A kart appears in the ledger before race.js publishes lap/checkpoint, so the very
// first frames of every race hit this path.
(() => {
  const bare = { id: 'P0', type: 'VEHICLE', z: 0, modifiers: {} };
  const none = { id: 'P1', type: 'VEHICLE', z: 5 };
  const r = rankRacers([bare, none], 'P0');
  assert(r.total === 2 && r.rank === 1, `T7: absent modifiers default to 0 rather than throwing (got ${r.rank}/${r.total})`);
})();

// ── Test 8: clock formatting ──────────────────────────────────────────────────
(() => {
  assert(formatLapTime(0) === '0:00.0', `T8a: zero (got ${formatLapTime(0)})`);
  assert(formatLapTime(58.9) === '0:58.9', `T8b: sub-minute (got ${formatLapTime(58.9)})`);
  assert(formatLapTime(64.3) === '1:04.3', `T8c: seconds are zero-padded (got ${formatLapTime(64.3)})`);
  assert(formatLapTime(83.5) === '1:23.5', `T8d: over a minute (got ${formatLapTime(83.5)})`);
  assert(formatLapTime(600) === '10:00.0', `T8e: two-digit minutes (got ${formatLapTime(600)})`);
  // Defensive: the race clock is fed straight from the wire, and a negative or absent
  // value must not render as "-1:-3.-2".
  assert(formatLapTime(-5) === '0:00.0', `T8f: negative clamps to zero (got ${formatLapTime(-5)})`);
  assert(formatLapTime(undefined) === '0:00.0', `T8g: undefined clamps to zero (got ${formatLapTime(undefined)})`);
  assert(formatLapTime(NaN) === '0:00.0', `T8h: NaN clamps to zero (got ${formatLapTime(NaN)})`);
})();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('SOME TESTS FAILED ❌');
  process.exit(1);
}
console.log('ALL TESTS PASSED ✅');
process.exit(0);

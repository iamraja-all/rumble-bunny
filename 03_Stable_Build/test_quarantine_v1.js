/**
 * test_quarantine_v1.js — Defined Win for the R15 quarantine layer.
 *
 * INPUT:   hostile values that a WebSocket client can actually send today.
 * OUTPUT:  every one is neutralised at the boundary; nothing non-finite and nothing
 *          delimiter-bearing reaches physics or the ledger.
 * PASS:    all assertions green AND exit code 0. Any failure exits 1.
 *
 * WHY the exit code matters: the audit found 3 of 5 suites had been failing for days
 * because nothing ran them and nothing checked a status. A test that cannot fail a
 * pipeline is documentation, not a test.
 *
 * Assertion style is copied from test_vehicle_physics_v1.js on purpose — ponytail
 * Rung 2, no new test framework for a project that already has a working one.
 */
import { finiteClamp, cleanDelimiters, safeHexColor, isCleanEntity, VALID_STATES } from './quarantine.js';
import { createVehicleState, updateVehicle } from './vehicle-physics.js';
import { serializeLedger, parseLedger } from './ledger.js';

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) {
    console.log(`✅ PASS: ${label}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${label}`);
    failed++;
  }
}

console.log('--- Quarantine Layer (R15) ---\n');

// ---------------------------------------------------------------------------
// T1 — Prove the vulnerability is real before proving the fix.
// This is the exact expression shipped at server.js:123.
// ---------------------------------------------------------------------------
const shippedClamp = Math.max(0, Math.min(1, Number('abc')));
assert(Number.isNaN(shippedClamp), 'T1: the shipped clamp really does return NaN for "abc" (bug confirmed)');

// ---------------------------------------------------------------------------
// T2-T5 — finiteClamp
// ---------------------------------------------------------------------------
assert(finiteClamp('abc', 0, 1) === 0, 'T2: junk string -> fallback, not NaN');
assert(finiteClamp(Infinity, 0, 1) === 0, 'T3a: Infinity -> fallback');
assert(finiteClamp(-Infinity, 0, 1) === 0, 'T3b: -Infinity -> fallback');
assert(finiteClamp(undefined, 0, 1) === 0, 'T3c: undefined -> fallback');
assert(finiteClamp({}, 0, 1) === 0, 'T3d: object -> fallback');
assert(finiteClamp('1e400', 0, 1) === 0, 'T3e: overflow-to-Infinity literal -> fallback');
assert(finiteClamp(5, 0, 1) === 1, 'T4a: above range clamps to hi');
assert(finiteClamp(-5, -1, 1) === -1, 'T4b: below range clamps to lo');
assert(finiteClamp(0.42, 0, 1) === 0.42, 'T5a: valid value passes through exactly');
assert(finiteClamp('-0.7', -1, 1) === -0.7, 'T5b: valid numeric string passes through exactly');
assert(finiteClamp('abc', 0, 1, 0.5) === 0.5, 'T5c: caller-supplied fallback is honoured');

// ---------------------------------------------------------------------------
// T6-T8 — cleanDelimiters. The AI Whisperer format has no escaping, so a client
// string containing a delimiter can forge an entire ledger row.
// ---------------------------------------------------------------------------
assert(cleanDelimiters('P0|VEHICLE|9|9|9') === 'P0VEHICLE999', 'T6a: pipes stripped');
assert(cleanDelimiters('a;b:c') === 'abc', 'T6b: semicolon and colon stripped');
assert(cleanDelimiters('a\nb\rc') === 'abc', 'T6c: CR and LF stripped');
assert(cleanDelimiters('x'.repeat(500)).length === 32, 'T7: length capped at 32');
assert(cleanDelimiters(null) === '' && cleanDelimiters(undefined) === '', 'T7b: null/undefined -> empty string');

// The forgery this prevents: an id that injects a second, fake row.
const forgedId = 'P0|VEHICLE|0|0|0|0|0|0|0|NORMAL|\nEVIL|VEHICLE|1|1|1|0|0|0|99|BOOSTING|';
const forgedRows = serializeLedger([
  { ...createVehicleState(cleanDelimiters(forgedId), {}), modifiers: {} },
]).split('\n');
assert(forgedRows.length === 1, 'T8: a forged id cannot inject a second ledger row');

// ---------------------------------------------------------------------------
// T9 — safeHexColor. This path is LIVE on this branch (server.js:76, :92).
// ---------------------------------------------------------------------------
assert(safeHexColor('#00ccff') === '#00ccff', 'T9a: valid hex accepted');
assert(safeHexColor('#00CCFF') === '#00ccff', 'T9b: valid hex normalised to lowercase');
assert(safeHexColor('red') === '#ff00ff', 'T9c: colour name rejected -> fallback');
assert(safeHexColor('#zzz') === '#ff00ff', 'T9d: junk rejected -> fallback');
assert(safeHexColor('#00ccff|EVIL') === '#ff00ff', 'T9e: delimiter-bearing colour rejected');
assert(safeHexColor(undefined) === '#ff00ff', 'T9f: missing colour -> fallback');
// parseInt is what server.js actually feeds the ledger; prove it can no longer be NaN.
assert(Number.isFinite(parseInt(safeHexColor('nonsense').replace('#', ''), 16)), 'T9g: colour_sync is always finite after validation');

// ---------------------------------------------------------------------------
// T10-T12 — isCleanEntity guards the parse side (RSK-001 / RSK-003).
// ---------------------------------------------------------------------------
const good = createVehicleState('P1', {});
assert(isCleanEntity(good), 'T10: a legitimate entity passes');
assert(!isCleanEntity({ ...good, x: NaN }), 'T11a: NaN coordinate rejected');
assert(!isCleanEntity({ ...good, speed: Infinity }), 'T11b: Infinite speed rejected');
assert(!isCleanEntity({ ...good, state: 'TOTALLY_FAKE_STATE' }), 'T11c: out-of-enum state rejected');
assert(!isCleanEntity({ ...good, id: '' }), 'T11d: empty id rejected');
assert(!isCleanEntity(null), 'T11e: null rejected');
assert(VALID_STATES.size === 5, 'T12: exactly the five states spec.md section 6 defines');

// A hostile frame is dropped rather than parsed into a poisoned entity.
const hostileFrame = 'P0|VEHICLE|NaN|0|0|0|0|0|0|NORMAL|\nP1|VEHICLE|1|2|3|0|0|0|10|NORMAL|';
const survivors = parseLedger(hostileFrame).filter(isCleanEntity);
assert(survivors.length === 1 && survivors[0].id === 'P1', 'T12b: hostile row dropped, clean row kept');

// ---------------------------------------------------------------------------
// T13 — END TO END. The original exploit, run against the real physics module for
// 300 frames. This is the Defined Win: the kart must never become non-finite.
// ---------------------------------------------------------------------------
const stats = { max_speed: 40, acceleration: 5, handling: 1.5, stunt_rate: 2, weight: 1000, boost_mult: 1.5 };

// (a) Unprotected: reproduce the bug exactly as it ships today.
let victim = createVehicleState('P0', stats);
const rawInput = {
  throttle: Math.max(0, Math.min(1, Number('abc'))),
  brake: Math.max(0, Math.min(1, Number('0'))),
  steer: Math.max(-1, Math.min(1, Number('0'))),
  drift: false,
};
for (let i = 0; i < 300; i++) victim = updateVehicle(victim, rawInput, 1 / 60);
assert(!Number.isFinite(victim.x) || !Number.isFinite(victim.speed), 'T13a: unprotected input DOES poison the kart (exploit reproduced)');

// (b) Protected: the same hostile packet through the quarantine layer.
let guarded = createVehicleState('P0', stats);
const cleanInput = {
  throttle: finiteClamp('abc', 0, 1),
  brake: finiteClamp('0', 0, 1),
  steer: finiteClamp('0', -1, 1),
  drift: false,
};
for (let i = 0; i < 300; i++) guarded = updateVehicle(guarded, cleanInput, 1 / 60);
assert(Number.isFinite(guarded.x) && Number.isFinite(guarded.z) && Number.isFinite(guarded.speed),
  'T13b: quarantined input leaves the kart finite after 300 frames');
assert(isCleanEntity(guarded), 'T13c: the quarantined kart still serialises as a clean entity');
assert(!serializeLedger([guarded]).includes('NaN'), 'T13d: no NaN reaches the broadcast frame');

// ---------------------------------------------------------------------------
console.log(`\n--- ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);

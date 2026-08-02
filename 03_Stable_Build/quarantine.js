/**
 * quarantine.js — the R15 trust boundary.
 *
 * WHY THIS FILE EXISTS:
 * R15 (Security Paranoia Default) states that all data entering the engine from any
 * external source is hostile until validated, and that the quarantine layer must be
 * written BEFORE the parsing logic. In this codebase it was written after: the
 * 2026-08-02 audit (ADR-0007) demonstrated by execution that a 16-byte WebSocket
 * message — `INPUT|abc|0|0|1` — permanently converts a kart's position to NaN and
 * that serializeLedger's `|| 0` guard then HIDES the corruption by rewriting NaN to
 * 0, so every client renders the kart parked at the world origin. Silent, permanent,
 * and invisible to the players it affects.
 *
 * WHY THESE FOUR FUNCTIONS AND NOTHING MORE:
 * Ponytail Rung 3 — every one of them is a thin wrapper over a stdlib primitive
 * (Number.isFinite, String.replace, Set.has). No validation framework, no schema
 * library, no per-field DSL. The rule asks for a trust boundary, not an abstraction.
 *
 * WHY IT LIVES HERE AND NOT IN 03_Stable_Build:
 * R02 — it is proven against test_quarantine_v1.js in the Isolation Chamber first.
 */

// The five states spec.md section 6 defines. Anything else on the wire is forged
// or corrupt. WHY a Set and not an array: membership is tested per entity per
// frame at 60Hz, so O(1) beats Array.includes's O(n) even at n=5.
export const VALID_STATES = new Set(['NORMAL', 'DRIFT', 'AIRBORNE', 'CRASHED', 'BOOSTING']);

// The four characters that carry structural meaning in the AI Whisperer format:
// row separator, field separator, modifier-pair separator, key/value separator.
// Any one of them inside a client-supplied string can forge a ledger row.
const DELIMITERS = /[|;:\n\r]/g;

/**
 * finiteClamp: turn an untrusted value into a number that is guaranteed to be
 * finite and inside [lo, hi], or the fallback.
 *
 * WHY THIS EXISTS RATHER THAN Math.max(lo, Math.min(hi, Number(raw))):
 * That is the exact expression the server shipped, and it does not work. Math.min
 * and Math.max PROPAGATE NaN rather than rejecting it — `Math.max(0, Math.min(1,
 * NaN))` returns NaN, so the clamp filters range but never finiteness. Number.isFinite
 * is the only check that rejects NaN, Infinity and -Infinity together, and unlike the
 * global isFinite() it does not coerce, so isFinite('') === true cannot bite us.
 *
 * Big-O: O(1). Safe inside the 60fps loop — no allocation, no iteration.
 */
export function finiteClamp(raw, lo, hi, fallback = 0) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * cleanDelimiters: strip the four structural characters out of a string that is
 * about to be written into a ledger field.
 *
 * WHY STRIP RATHER THAN ESCAPE:
 * Escaping requires a matching unescape on the far side, which means touching
 * parseLedger, the client's copy of it, and every future consumer — and a missed
 * unescape is a silent desync (RSK-003). Nothing legitimate in this game needs a
 * pipe in an id or a colon in a state, so removal costs nothing real and cannot
 * desync. Ponytail Rung 3: one String.replace, no escaping grammar to maintain.
 *
 * Also caps length, because an unbounded id inflates every broadcast frame to every
 * player in the room — a cheap amplification vector.
 *
 * Big-O: O(len), bounded by maxLen.
 */
export function cleanDelimiters(value, maxLen = 32) {
  return String(value == null ? '' : value).replace(DELIMITERS, '').slice(0, maxLen);
}

/**
 * safeHexColor: validate a client-supplied cosmetic colour.
 *
 * WHY THIS IS NEEDED NOW AND NOT LATER:
 * The audit flagged ledger injection as "armed but one feature away" — the feature
 * has since landed. server.js accepts `HOST|<color>` and `JOIN|<code>|<color>` and
 * writes the result into v.modifiers.color_sync, which IS serialized to every player.
 * Today parseInt() happens to neutralise the injection by coercing to a number, but
 * it returns NaN for junk, and relying on a downstream coercion for a security
 * property is how the NaN bug happened in the first place. Validate at the boundary.
 *
 * Big-O: O(1) — fixed-length regex over at most 7 characters.
 */
export function safeHexColor(raw, fallback = '#ff00ff') {
  return typeof raw === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : fallback;
}

/**
 * isCleanEntity: reject a parsed ledger row that cannot be trusted to reach a
 * transform, a physics step, or an Object3D.
 *
 * WHY REJECT THE WHOLE ROW RATHER THAN REPAIR THE BAD FIELD:
 * A row with one non-finite coordinate is not a row with a typo, it is a row from a
 * corrupt or hostile frame — the honest response is to drop it and keep the previous
 * known-good state for that entity. Repairing to 0 is what serializeLedger did, and
 * it is precisely what made the original bug invisible: a teleport to the world
 * origin looks like data, not like damage.
 *
 * Big-O: O(1) — seven fixed field checks and one Set lookup.
 */
export function isCleanEntity(e) {
  if (!e || typeof e.id !== 'string' || e.id.length === 0) return false;
  if (!VALID_STATES.has(e.state)) return false;
  return (
    Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.z) &&
    Number.isFinite(e.rotX) && Number.isFinite(e.rotY) && Number.isFinite(e.rotZ) &&
    Number.isFinite(e.speed)
  );
}

/**
 * parseLedger: Parses a flat, pipe-delimited sync ledger string into an array of entity state objects.
 * 
 * WHY:
 * A flat pipe-delimited string provides the lowest possible payload size for 60fps multiplayer sync.
 * We parse it row-by-row and map it into memory-efficient objects.
 * 
 * Big-O Complexity: O(N * M) where N is the number of lines (players/entities) and M is the number of modifiers.
 * This is optimal because we must process every field of every entity to construct the state.
 */
export function parseLedger(ledgerString) {
  if (!ledgerString || typeof ledgerString !== 'string') {
    return [];
  }

  const lines = ledgerString.trim().split('\n');
  const entities = [];

  // Loop Complexity: O(N) where N is the number of lines
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split('|');
    // Ensure we have the minimum standard fields (11 fields defined in spec)
    if (parts.length < 11) {
      continue;
    }

    const [id, type, x, y, z, rotX, rotY, rotZ, speed, state, modifiersStr] = parts;

    // Parse modifiers string: "key:value;key:value" into a dictionary
    const modifiers = {};
    if (modifiersStr) {
      const kvPairs = modifiersStr.split(';');
      // Loop Complexity: O(M) where M is the number of modifier key-value pairs
      for (let j = 0; j < kvPairs.length; j++) {
        const pair = kvPairs[j];
        if (!pair) continue;
        const [k, v] = pair.split(':');
        if (k && v !== undefined) {
          // Attempt numeric conversion for modifier values if possible
          const numVal = Number(v);
          modifiers[k] = isNaN(numVal) ? v : numVal;
        }
      }
    }

    const entity = {
      id,
      type,
      x: Number(x),
      y: Number(y),
      z: Number(z),
      rotX: Number(rotX),
      rotY: Number(rotY),
      rotZ: Number(rotZ),
      speed: Number(speed),
      state,
      modifiers
    };

    // R15 QUARANTINE — drop the row rather than admitting a poisoned entity.
    //
    // WHY drop instead of repair-to-zero: Number() returns NaN for anything
    // unparseable, and on the client that NaN flows into mesh.position.set() and
    // then into the camera lerp, which never recovers for the rest of the session.
    // Repairing to 0 is what the serializer used to do, and it is precisely what
    // made the original bug invisible — a kart teleported to the world origin reads
    // as data, not as damage. Dropping the row keeps the last known-good state for
    // that entity, which is both safer and visibly wrong if it ever happens.
    //
    // Big-O: O(1) per row — seven finite checks, no allocation. Safe at 60Hz.
    if (
      Number.isFinite(entity.x) && Number.isFinite(entity.y) && Number.isFinite(entity.z) &&
      Number.isFinite(entity.rotX) && Number.isFinite(entity.rotY) && Number.isFinite(entity.rotZ) &&
      Number.isFinite(entity.speed)
    ) {
      entities.push(entity);
    }
  }

  return entities;
}

/**
 * serializeLedger: Converts an array of entity state objects back to the flat pipe-delimited ledger string.
 * 
 * WHY:
 * Converting game state back to a flat string must be extremely fast to execute at the end of every physics frame.
 * Floats are clamped to 3 decimal places to compress network payloads.
 * 
 * Big-O Complexity: O(N * M) where N is the number of entities and M is the number of modifiers per entity.
 */
// Fires at most once per process; see formatFloat inside serializeLedger.
let warnedNonFinite = false;

export function serializeLedger(entities) {
  if (!Array.isArray(entities)) {
    return '';
  }

  const lines = [];

  // Helper to clamp float length to compress network string.
  //
  // WHY the explicit Number.isFinite branch: the call sites used to read
  // `formatFloat(entity.x || 0)`, and `NaN || 0` evaluates to 0. That silently
  // rewrote a corrupted coordinate to the world origin, so a NaN-poisoned kart was
  // broadcast to all eight players as a perfectly well-formed row parked at (0,0,0)
  // — the corruption was real, permanent, and invisible to everyone. The behaviour
  // here is deliberately unchanged (still 0), but it is now a stated decision rather
  // than an accident of `||` truthiness. The actual fix is upstream: quarantine.js
  // rejects non-finite input at the trust boundary so this can never trigger.
  const formatFloat = (num) => {
    const n = Number(num);
    if (!Number.isFinite(n)) {
      // WHY THIS WARNS: quarantine.js stops non-finite values arriving from the
      // NETWORK, but nothing stops them arising from corrupt INTERNAL state — and
      // that happened. RoomManager was constructing Lobby without a stat block, so
      // every kart in every room produced NaN from the physics and this guard
      // rendered the entire field as parked at (0, 0, 0). It looked like data, so
      // it went unnoticed. Silently writing 0 is still the right wire behaviour;
      // doing it without a word was the mistake.
      // R07: guarded to fire ONCE, so a 60Hz loop cannot be turned into a log flood.
      if (!warnedNonFinite) {
        warnedNonFinite = true;
        console.error(
          '[ledger] a non-finite value reached serialization and was written as 0. ' +
          'Internal state is corrupt — check that vehicles were built with a stat block. ' +
          'This warns once per process.'
        );
      }
      return '0';
    }
    return n.toFixed(3).replace(/\.?0+$/, '');
  };

  // Loop Complexity: O(N) where N is the number of entities
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (!entity || !entity.id) continue;

    // Serialize modifiers dictionary into "key:value;key:value" format
    const modParts = [];
    if (entity.modifiers) {
      const keys = Object.keys(entity.modifiers);
      // Loop Complexity: O(M) where M is the number of modifier keys
      for (let j = 0; j < keys.length; j++) {
        const key = keys[j];
        const val = entity.modifiers[key];
        modParts.push(`${key}:${val}`);
      }
    }
    const modifiersStr = modParts.join(';');

    const line = [
      entity.id,
      entity.type || 'VEHICLE',
      formatFloat(entity.x),
      formatFloat(entity.y),
      formatFloat(entity.z),
      formatFloat(entity.rotX),
      formatFloat(entity.rotY),
      formatFloat(entity.rotZ),
      formatFloat(entity.speed),
      entity.state || 'NORMAL',
      modifiersStr
    ].join('|');

    lines.push(line);
  }

  return lines.join('\n');
}

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

    entities.push({
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
    });
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
export function serializeLedger(entities) {
  if (!Array.isArray(entities)) {
    return '';
  }

  const lines = [];

  // Helper to clamp float length to compress network string
  const formatFloat = (num) => {
    return Number(num).toFixed(3).replace(/\.?0+$/, '');
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
      formatFloat(entity.x || 0),
      formatFloat(entity.y || 0),
      formatFloat(entity.z || 0),
      formatFloat(entity.rotX || 0),
      formatFloat(entity.rotY || 0),
      formatFloat(entity.rotZ || 0),
      formatFloat(entity.speed || 0),
      entity.state || 'NORMAL',
      modifiersStr
    ].join('|');

    lines.push(line);
  }

  return lines.join('\n');
}

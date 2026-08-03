const MAIN_ROUTE = [
  'coast-west',
  'northwest',
  'north',
  'east-bend',
  'harbor-merge',
  'return',
  'finish',
];

const SHORTCUT_ROUTE = [
  'coast-west',
  'northwest',
  'north',
  'shortcut-entry',
  'shortcut-landing',
  'harbor-merge',
  'return',
  'finish',
];

export const CIRCUIT_DEF = Object.freeze({
  // ── PLAYFIELD — the authoritative extent of the world ──────────────────────
  //
  // WHY THIS LIVES IN THE ENGINE AND NOT IN THE RENDERER: these numbers were born
  // in 04_Render_Engine/src/scenery.js, because the island started life as art.
  // They stopped being art the moment gameplay needed to know where the world
  // ends — race.js has to respawn a kart that drives past the coast, and the
  // engine is not allowed to import client code. The alternative, copying the
  // centre and radius into race.js, is precisely the failure this project has
  // already shipped twice: renderer.js hard-coding CircleGeometry(240) beside an
  // independently declared ISLAND_RADIUS = 240, and TRACK_DEF's spawn timers
  // being shared across rooms. Two numbers that must always agree, in two files,
  // is a seam. So the circuit owns its own footprint and scenery.js reads it.
  //
  // The values are unchanged from the ones scenery.js derived (see the essay at
  // the top of that file): centre (0, -25) is the circuit's bounding-box centre,
  // not the origin, and 155 m leaves 55.1 m of land beyond the outermost
  // guardrail at the tightest point of the lap. `radius` is therefore both the
  // cliff lip the player can see and the line past which there is no island —
  // one number, one meaning.
  playfield: Object.freeze({
    centerX: 0,
    centerZ: -25,
    radius: 155,
  }),
  road: {
    mainWidth: 28,
    shortcutWidth: 16,
    mainPoints: [
      { x: 0, z: 25 },
      { x: -55, z: 5 },
      { x: -65, z: -65 },
      { x: -20, z: -105 },
      { x: 60, z: -60 },
      { x: 60, z: 20 },
      { x: 20, z: 55 },
      { x: 0, z: 25 },
    ],
    shortcutPoints: [
      { x: -20, z: -105 },
      { x: -10, z: -82 },
      { x: 32, z: -28 },
      { x: 60, z: 20 },
    ],
  },
  gates: [
    { id: 'coast-west', center: { x: -55, z: 5 }, normal: { x: -0.94, z: -0.342 }, halfWidth: 18 },
    { id: 'northwest', center: { x: -65, z: -65 }, normal: { x: -0.141, z: -0.99 }, halfWidth: 18 },
    { id: 'north', center: { x: -20, z: -105 }, normal: { x: 0.747, z: -0.664 }, halfWidth: 18 },
    { id: 'east-bend', center: { x: 60, z: -60 }, normal: { x: 0.872, z: 0.49 }, halfWidth: 18 },
    { id: 'shortcut-entry', center: { x: -10, z: -82 }, normal: { x: 0.399, z: 0.917 }, halfWidth: 9 },
    { id: 'shortcut-landing', center: { x: 32, z: -28 }, normal: { x: 0.614, z: 0.789 }, halfWidth: 9 },
    { id: 'harbor-merge', center: { x: 60, z: 20 }, normal: { x: 0, z: 1 }, halfWidth: 18 },
    { id: 'return', center: { x: 20, z: 55 }, normal: { x: -0.752, z: 0.659 }, halfWidth: 18 },
    { id: 'finish', center: { x: 0, z: 25 }, normal: { x: -0.555, z: -0.832 }, halfWidth: 18 },
  ],
  routes: {
    MAIN: MAIN_ROUTE,
    SHORTCUT: SHORTCUT_ROUTE,
  },
  launchPads: [
    { id: 'north-jump', type: 'MAIN', x: -35, z: -98, width: 20, length: 5, power: 15 },
    { id: 'east-jump', type: 'MAIN', x: 52, z: -48, width: 20, length: 5, power: 20 },
    { id: 'return-jump', type: 'MAIN', x: 35, z: 44, width: 20, length: 5, power: 18 },
    { id: 'shortcut-ramp', type: 'SHORTCUT', x: -10, z: -82, width: 16, length: 5, power: 20 },
  ],
  shortcut: {
    launchPadId: 'shortcut-ramp',
    entryGateId: 'shortcut-entry',
    landingGateId: 'shortcut-landing',
  },
  spawnPositions: [
    { x: 5, y: 0, z: 34 },
    { x: 7, y: 0, z: 28 },
    { x: 9, y: 0, z: 22 },
    { x: 11, y: 0, z: 16 },
    { x: 13, y: 0, z: 37 },
    { x: 15, y: 0, z: 31 },
    { x: 17, y: 0, z: 25 },
    { x: 19, y: 0, z: 19 },
  ],
  itemSpawners: [
    { id: 'spawner_1', x: -47, z: -18, type: 'POWERUP_BOOST', respawnTime: 10, timer: 0 },
    { id: 'spawner_2', x: -58, z: -43, type: 'TRAP', respawnTime: 10, timer: 0 },
    { id: 'spawner_3', x: 42, z: -76, type: 'POWERUP_BOOST', respawnTime: 10, timer: 0 },
  ],
});

function getGate(definition, id) {
  return definition.gates.find((gate) => gate.id === id) ?? null;
}

function failValidation(message) {
  throw new Error(`Invalid circuit definition: ${message}`);
}

export function validateCircuitDefinition(definition) {
  if (!definition || !Array.isArray(definition.gates)) {
    failValidation('gates must be an array');
  }

  const gateIds = new Set();
  for (const gate of definition.gates) {
    if (!gate?.id || gateIds.has(gate.id)) {
      failValidation(`duplicate gate ID: ${gate?.id ?? 'missing'}`);
    }
    gateIds.add(gate.id);

    const values = [gate.center?.x, gate.center?.z, gate.normal?.x, gate.normal?.z, gate.halfWidth];
    if (values.some((value) => !Number.isFinite(value)) || gate.halfWidth <= 0) {
      failValidation(`gate ${gate.id} must have finite coordinates and positive width`);
    }
  }

  for (const [routeName, route] of Object.entries(definition.routes ?? {})) {
    if (!Array.isArray(route) || route.length === 0) {
      failValidation(`${routeName} route must contain gates`);
    }
    if (route.at(-1) !== 'finish') {
      failValidation(`${routeName} route must end at finish`);
    }
    for (const gateId of route) {
      if (!gateIds.has(gateId)) {
        failValidation(`${routeName} route references missing gate ${gateId}`);
      }
    }
  }

  if (!definition.routes?.MAIN || !definition.routes?.SHORTCUT) {
    failValidation('MAIN and SHORTCUT routes are required');
  }

  const shortcut = definition.shortcut;
  const shortcutPad = definition.launchPads?.find((pad) => pad.id === shortcut?.launchPadId);
  if (!shortcutPad || !gateIds.has(shortcut?.entryGateId) || !gateIds.has(shortcut?.landingGateId)) {
    failValidation('shortcut requires a ramp, entry gate, and landing gate');
  }
  if (!definition.routes.SHORTCUT.includes(shortcut.entryGateId) || !definition.routes.SHORTCUT.includes(shortcut.landingGateId)) {
    failValidation('shortcut route must include entry and landing gates');
  }
  if (definition.spawnPositions?.length !== 8) {
    failValidation('exactly eight spawn positions are required');
  }

  const field = definition.playfield;
  const fieldValues = [field?.centerX, field?.centerZ, field?.radius];
  if (fieldValues.some((value) => !Number.isFinite(value)) || !(field?.radius > 0)) {
    failValidation('playfield needs a finite centre and a positive radius');
  }

  // WHY EVERY RESPAWN TARGET IS CHECKED AGAINST THE BOUNDARY: race.js sends an
  // out-of-bounds kart back to a gate centre, or to its grid slot if it has
  // cleared none. If either sat outside the playfield the kart would arrive
  // already out of bounds and be respawned again a few seconds later, forever —
  // a boundary that eats the player instead of saving them. Cheap to rule out
  // here (O(G + S), once, at boot) and impossible to reason about at 60Hz.
  const outside = [
    ...definition.gates.map((gate) => ({ label: `gate ${gate.id}`, x: gate.center.x, z: gate.center.z })),
    ...definition.spawnPositions.map((spawn, i) => ({ label: `spawn ${i}`, x: spawn.x, z: spawn.z })),
  ].find(({ x, z }) => Math.hypot(x - field.centerX, z - field.centerZ) >= field.radius);
  if (outside) {
    failValidation(`${outside.label} lies outside the playfield boundary`);
  }

  return true;
}

/**
 * getLastClearedGate — the gate a kart most recently passed, or null on lap one
 * before the first gate.
 *
 * WHY THIS LOGIC IS HERE AND NOT IN race.js: turning "cleared N gates" back into
 * "which gate was that" needs the route tables, and the route tables live here.
 * race.js only needs the answer.
 *
 * WHY MAIN IS A SAFE STAND-IN WHILE THE ROUTE IS UNSET: the two routes share their
 * first three gates (coast-west, northwest, north) and only diverge on the fourth,
 * which is the crossing that SETS the route. A progress record still reading UNSET
 * has therefore cleared at most three gates, and MAIN[0..2] === SHORTCUT[0..2] —
 * so the shared prefix answers it without guessing which way the kart would have
 * gone.
 *
 * Big-O: O(G) with G = 9 gates, and it is called only when a kart is actually
 * respawned — an event, not a per-tick cost.
 */
export function getLastClearedGate(progress) {
  const cleared = progress?.clearedGateCount ?? 0;
  if (cleared <= 0) {
    return null;
  }
  const path = CIRCUIT_DEF.routes[progress.route] ?? MAIN_ROUTE;
  return getGate(CIRCUIT_DEF, path[cleared - 1]);
}

export function createCircuitProgress() {
  return {
    route: 'UNSET',
    nextGateIds: [MAIN_ROUTE[0]],
    clearedGateCount: 0,
    lapsCompleted: 0,
  };
}

/**
 * createCircuitProgressAt — a progress record for something that starts partway
 * round the lap instead of on the grid.
 *
 * WHY IT LIVES HERE: traffic.js spawns its cars at three points spread around the
 * circuit, and a car placed beside the north gate must be HEADING for the north
 * gate — otherwise it drives backwards across the island toward gate one, which is
 * exactly what it did before this existed. Building that record inside traffic.js
 * would put the shape of a progress object in two files, and the essay at the top
 * of this one is about what two owners of the same fact cost this project.
 *
 * The route is MAIN because traffic is predictable scenery, not a competitor: it
 * should never take the shortcut and surprise a player coming out of the tunnel.
 *
 * Big-O: O(G) over a 7-entry route table, called three times at room creation.
 */
export function createCircuitProgressAt(gateId) {
  const index = MAIN_ROUTE.indexOf(gateId);
  if (index < 0) {
    throw new Error(`createCircuitProgressAt: '${gateId}' is not on the MAIN route`);
  }
  return {
    route: 'MAIN',
    nextGateIds: [gateId],
    clearedGateCount: index,
    lapsCompleted: 0,
  };
}

export function crossesDirectedGate(gate, previous, current) {
  const moveX = current.x - previous.x;
  const moveZ = current.z - previous.z;
  const denominator = moveX * gate.normal.x + moveZ * gate.normal.z;

  if (denominator <= 0) {
    return false;
  }

  const fromGateX = previous.x - gate.center.x;
  const fromGateZ = previous.z - gate.center.z;
  const t = -(fromGateX * gate.normal.x + fromGateZ * gate.normal.z) / denominator;
  if (t < 0 || t > 1) {
    return false;
  }

  const hitX = previous.x + moveX * t - gate.center.x;
  const hitZ = previous.z + moveZ * t - gate.center.z;
  const lateral = Math.abs(hitX * -gate.normal.z + hitZ * gate.normal.x);
  return lateral <= gate.halfWidth;
}

function getNextGateIds(route, crossedGateId) {
  if (route !== 'UNSET') {
    const path = CIRCUIT_DEF.routes[route];
    const nextGateId = path[path.indexOf(crossedGateId) + 1];
    return nextGateId ? [nextGateId] : [];
  }

  const mainIndex = MAIN_ROUTE.indexOf(crossedGateId);
  const shortcutIndex = SHORTCUT_ROUTE.indexOf(crossedGateId);
  const mainNext = MAIN_ROUTE[mainIndex + 1];
  const shortcutNext = SHORTCUT_ROUTE[shortcutIndex + 1];

  if (!mainNext && !shortcutNext) {
    return [];
  }
  if (mainNext === shortcutNext) {
    return [mainNext];
  }
  return [mainNext, shortcutNext].filter(Boolean);
}

function getRouteAfterCrossing(route, crossedGateId) {
  if (route !== 'UNSET') {
    return route;
  }
  if (crossedGateId === 'east-bend') {
    return 'MAIN';
  }
  if (crossedGateId === 'shortcut-entry') {
    return 'SHORTCUT';
  }
  return 'UNSET';
}

export function getCurrentGate(progress) {
  return getGate(CIRCUIT_DEF, progress?.nextGateIds?.[0]);
}

export function advanceCircuitProgress(progress, previous, current) {
  const gate = progress?.nextGateIds
    ?.map((id) => getGate(CIRCUIT_DEF, id))
    .find((candidate) => candidate && crossesDirectedGate(candidate, previous, current));

  if (!gate) {
    return { progress, crossedGateId: null, lapCompleted: false };
  }

  if (gate.id === 'finish') {
    return {
      progress: {
        ...createCircuitProgress(),
        lapsCompleted: progress.lapsCompleted + 1,
      },
      crossedGateId: gate.id,
      lapCompleted: true,
    };
  }

  const route = getRouteAfterCrossing(progress.route, gate.id);
  return {
    progress: {
      ...progress,
      route,
      nextGateIds: getNextGateIds(route, gate.id),
      clearedGateCount: progress.clearedGateCount + 1,
    },
    crossedGateId: gate.id,
    lapCompleted: false,
  };
}

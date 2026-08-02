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

  return true;
}

export function createCircuitProgress() {
  return {
    route: 'UNSET',
    nextGateIds: [MAIN_ROUTE[0]],
    clearedGateCount: 0,
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

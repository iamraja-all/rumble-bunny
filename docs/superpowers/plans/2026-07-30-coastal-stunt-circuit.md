# Coastal Stunt Circuit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the straight prototype strip with a headless-authoritative coastal circuit whose main loop, shortcut, jumps, spawns, bots, renderer, and minimap use one definition.

**Architecture:** First prove a pure circuit module in the isolation chamber. Promote that same module into the stable build, where `RaceManager` owns only lifecycle and delegates directed gate progress to it. The Vite client imports the pure definition for static road and minimap visuals; it never calculates lap progress.

**Tech Stack:** Node.js ESM, vanilla JavaScript, WebSocket server, Three.js, Vite, Node terminal test scripts.

## Global Constraints

- Keep the server authoritative at a fixed 60 fps; clients only render ledger state.
- Do not add dependencies or change the pipe-delimited ledger field format.
- Use `CIRCUIT_DEF` as the single source for XZ geometry, spawns, ramps, gates, items, road paths, bots, renderer, and minimap.
- Keep the circuit to one main route, one faster shortcut, three main-route jumps, and no item reward on the shortcut.
- Limit `Lobby` to exactly eight racers; server-owned traffic karts must not occupy a player slot, receive race state, or block race completion.
- Preserve existing `RaceManager` countdown, finish-order, total-lap, timing, and ledger-modifier behavior.
- Keep the existing performance guardrails: pixel ratio 1, one directional shadow light, and no per-kart spotlights.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `02_Isolation_Chamber/circuit-track.js` | Pure circuit data validation and directed-gate progress prototype. |
| `02_Isolation_Chamber/test_circuit-track_v1.js` | Terminal proof for legal and illegal circuit traversals. |
| `03_Stable_Build/circuit-track.js` | Promoted, tested production circuit contract. |
| `03_Stable_Build/track.js` | Existing launch-pad and item-spawner API backed by `CIRCUIT_DEF`. |
| `03_Stable_Build/race.js` | Race lifecycle plus authoritative circuit progress and ledger modifiers. |
| `03_Stable_Build/lobby.js` | Exactly eight circuit-grid player slots; no non-racer fallback. |
| `03_Stable_Build/bots.js` | Existing steering controller targets the current circuit gate center. |
| `03_Stable_Build/traffic.js` | Server-owned low-speed obstacle karts that reuse circuit progress without joining a race. |
| `03_Stable_Build/server.js` | Keeps player and traffic collections separate while combining them only for physics, collisions, and ledger broadcast. |
| `03_Stable_Build/test_race_circuit_v1.js` | Stable-build integration regression for circuit laps and bot target lookup. |
| `04_Render_Engine/src/circuit-visuals.js` | Three.js meshes for road, ramps, gate markers, and start grid from `CIRCUIT_DEF`. |
| `04_Render_Engine/src/renderer.js` | Replaces fixed straight-track environment calls with `circuit-visuals`. |
| `04_Render_Engine/src/minimap.js` | Draws circuit paths and gates from `CIRCUIT_DEF`. |
| `04_Render_Engine/vite.config.js` | Explicitly permits the client to import the pure stable-build definition. |

### Task 1: Prove the Circuit Contract in Isolation

**Files:**
- Create: `02_Isolation_Chamber/circuit-track.js`
- Create: `02_Isolation_Chamber/test_circuit-track_v1.js`

**Interfaces:**
- Produces: `CIRCUIT_DEF`, `validateCircuitDefinition(definition)`, `createCircuitProgress()`, `advanceCircuitProgress(progress, previousPosition, currentPosition)`, and `getCurrentGate(progress)`.
- Consumes: `{ x: number, z: number }` previous and current positions.

- [ ] **Step 1: Write the failing terminal test for definition and route traversal**

```js
import {
  CIRCUIT_DEF,
  advanceCircuitProgress,
  createCircuitProgress,
  validateCircuitDefinition,
} from './circuit-track.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cross(gate) {
  const before = {
    x: gate.center.x - gate.normal.x * 2,
    z: gate.center.z - gate.normal.z * 2,
  };
  const after = {
    x: gate.center.x + gate.normal.x * 2,
    z: gate.center.z + gate.normal.z * 2,
  };
  return [before, after];
}

function traverse(ids) {
  let progress = createCircuitProgress();
  for (const id of ids) {
    const gate = CIRCUIT_DEF.gates.find((candidate) => candidate.id === id);
    const [before, after] = cross(gate);
    progress = advanceCircuitProgress(progress, before, after).progress;
  }
  return progress;
}

validateCircuitDefinition(CIRCUIT_DEF);
assert(CIRCUIT_DEF.spawnPositions.length === 8, 'T1: exactly eight grid spawns');
assert(CIRCUIT_DEF.launchPads.filter((pad) => pad.type === 'MAIN').length === 3, 'T2: three main-route jumps');
assert(CIRCUIT_DEF.shortcut.launchPadId === 'shortcut-ramp', 'T3: shortcut jump is declared');
assert(traverse(CIRCUIT_DEF.routes.MAIN).lapsCompleted === 1, 'T4: main route completes one lap');
assert(traverse(CIRCUIT_DEF.routes.SHORTCUT).lapsCompleted === 1, 'T5: shortcut route completes one lap');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node 02_Isolation_Chamber/test_circuit-track_v1.js`

Expected: failure because `circuit-track.js` does not exist.

- [ ] **Step 3: Implement the minimal validated definition and directed crossing helper**

```js
export const CIRCUIT_DEF = Object.freeze({
  road: {
    mainWidth: 28,
    shortcutWidth: 16,
    mainPoints: [{ x: 0, z: 25 }, { x: -55, z: 5 }, { x: -65, z: -65 }, { x: -20, z: -105 }, { x: 60, z: -60 }, { x: 60, z: 20 }, { x: 20, z: 55 }, { x: 0, z: 25 }],
    shortcutPoints: [{ x: -20, z: -105 }, { x: -10, z: -82 }, { x: 32, z: -28 }, { x: 60, z: 20 }],
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
    MAIN: ['coast-west', 'northwest', 'north', 'east-bend', 'harbor-merge', 'return', 'finish'],
    SHORTCUT: ['coast-west', 'northwest', 'north', 'shortcut-entry', 'shortcut-landing', 'harbor-merge', 'return', 'finish'],
  },
  launchPads: [
    { id: 'north-jump', type: 'MAIN', x: -35, z: -98, width: 20, length: 5, power: 15 },
    { id: 'east-jump', type: 'MAIN', x: 52, z: -48, width: 20, length: 5, power: 20 },
    { id: 'return-jump', type: 'MAIN', x: 35, z: 44, width: 20, length: 5, power: 18 },
    { id: 'shortcut-ramp', type: 'SHORTCUT', x: -10, z: -82, width: 16, length: 5, power: 20 },
  ],
  shortcut: { launchPadId: 'shortcut-ramp', entryGateId: 'shortcut-entry', landingGateId: 'shortcut-landing' },
  spawnPositions: [
    { x: 5, y: 0, z: 34 }, { x: 7, y: 0, z: 28 }, { x: 9, y: 0, z: 22 }, { x: 11, y: 0, z: 16 },
    { x: 13, y: 0, z: 37 }, { x: 15, y: 0, z: 31 }, { x: 17, y: 0, z: 25 }, { x: 19, y: 0, z: 19 },
  ],
  itemSpawners: [
    { id: 'spawner_1', x: -47, z: -18, type: 'POWERUP_BOOST', respawnTime: 10, timer: 0 },
    { id: 'spawner_2', x: -58, z: -43, type: 'TRAP', respawnTime: 10, timer: 0 },
    { id: 'spawner_3', x: 42, z: -76, type: 'POWERUP_BOOST', respawnTime: 10, timer: 0 },
  ],
});

export function crossesDirectedGate(gate, previous, current) {
  const moveX = current.x - previous.x;
  const moveZ = current.z - previous.z;
  const denominator = moveX * gate.normal.x + moveZ * gate.normal.z;
  if (denominator <= 0) return false;
  const fromGateX = previous.x - gate.center.x;
  const fromGateZ = previous.z - gate.center.z;
  const t = -(fromGateX * gate.normal.x + fromGateZ * gate.normal.z) / denominator;
  if (t < 0 || t > 1) return false;
  const hitX = previous.x + moveX * t - gate.center.x;
  const hitZ = previous.z + moveZ * t - gate.center.z;
  const lateral = Math.abs(hitX * -gate.normal.z + hitZ * gate.normal.x);
  return lateral <= gate.halfWidth;
}
```

`validateCircuitDefinition` must reject duplicate gate IDs, a non-positive width, a route that names an absent gate, an empty route, a shortcut that does not contain both `shortcut-entry` and `shortcut-landing`, or any route that does not finish at `finish`. `advanceCircuitProgress` must accept either `east-bend` or `shortcut-entry` only after `north`, return `{ progress, crossedGateId, lapCompleted }`, and reset the route to `UNSET` only after a legal finish crossing.

- [ ] **Step 4: Add negative tests before accepting the module**

```js
const finish = CIRCUIT_DEF.gates.find((gate) => gate.id === 'finish');
const [forwardStart, forwardEnd] = cross(finish);
let progress = createCircuitProgress();
assert(!advanceCircuitProgress(progress, forwardStart, forwardEnd).lapCompleted, 'T6: early finish is rejected');
progress = traverse(['coast-west', 'northwest', 'north', 'shortcut-entry']);
assert(!advanceCircuitProgress(progress, forwardStart, forwardEnd).lapCompleted, 'T7: shortcut cannot skip landing');
assert(!advanceCircuitProgress(createCircuitProgress(), forwardEnd, forwardStart).crossedGateId, 'T8: reverse crossing is rejected');
```

- [ ] **Step 5: Run the isolation test to verify it passes**

Run: `node 02_Isolation_Chamber/test_circuit-track_v1.js`

Expected: every T1-T8 assertion passes and the process exits with status 0.

- [ ] **Step 6: Commit the isolated circuit contract**

```bash
git add 02_Isolation_Chamber/circuit-track.js 02_Isolation_Chamber/test_circuit-track_v1.js
git commit -m "feat: prove circuit progress in isolation"
```

### Task 2: Promote the Contract into Race, Spawn, and Bot Systems

**Files:**
- Move: `02_Isolation_Chamber/circuit-track.js` to `03_Stable_Build/circuit-track.js`
- Move: `02_Isolation_Chamber/test_circuit-track_v1.js` to `03_Stable_Build/test_circuit-track_v1.js`
- Modify: `03_Stable_Build/track.js`
- Modify: `03_Stable_Build/race.js`
- Modify: `03_Stable_Build/lobby.js`
- Modify: `03_Stable_Build/bots.js`
- Create: `03_Stable_Build/traffic.js`
- Modify: `03_Stable_Build/server.js`
- Create: `03_Stable_Build/test_race_circuit_v1.js`
- Create: `03_Stable_Build/test_traffic_v1.js`

**Interfaces:**
- Consumes: the Task 1 exports, vehicle `x`, `z`, and existing race lifecycle state.
- Produces: `raceState.trackProgress`, `modifiers.route`, current gate lookup for bots, exactly eight circuit-grid player spawns, and traffic entities outside the race.

- [ ] **Step 1: Promote the exact tested module and test**

```bash
git mv 02_Isolation_Chamber/circuit-track.js 03_Stable_Build/circuit-track.js
git mv 02_Isolation_Chamber/test_circuit-track_v1.js 03_Stable_Build/test_circuit-track_v1.js
```

Update the moved test import to `./circuit-track.js` and run `node 03_Stable_Build/test_circuit-track_v1.js`; it must still pass before any integration edit.

- [ ] **Step 2: Write the failing race integration test**

```js
import { CIRCUIT_DEF } from './circuit-track.js';
import { RaceManager } from './race.js';

const vehicle = { id: 'P0', x: 0, z: 25, modifiers: {} };
const lobby = { players: new Map([['player-1', vehicle]]) };
const manager = new RaceManager();
manager.state = 'RACING';
manager.registerPlayer('player-1');

function tickAcross(gateId) {
  const gate = CIRCUIT_DEF.gates.find((gate) => gate.id === gateId);
  vehicle.x = gate.center.x - gate.normal.x * 2;
  vehicle.z = gate.center.z - gate.normal.z * 2;
  manager.update(1 / 60, lobby);
  vehicle.x = gate.center.x + gate.normal.x * 2;
  vehicle.z = gate.center.z + gate.normal.z * 2;
  manager.update(1 / 60, lobby);
}

for (const gateId of CIRCUIT_DEF.routes.MAIN) tickAcross(gateId);
if (vehicle.modifiers.lap !== 1) throw new Error('T1: RaceManager records a legal circuit lap');
if (vehicle.modifiers.route !== 'UNSET') throw new Error('T2: route resets after the finish');
```

- [ ] **Step 3: Integrate the circuit without changing race lifecycle behavior**

```js
// race.js
import {
  advanceCircuitProgress,
  createCircuitProgress,
  getCurrentGate,
} from './circuit-track.js';

export function createRaceState() {
  return { lap: 0, nextCheckpoint: 0, route: 'UNSET', trackProgress: createCircuitProgress(), finished: false, finishTime: 0, bestLapTime: Infinity, lapStartTime: 0 };
}
```

Store a `previousPositions` map on `RaceManager`. Each racing tick calls `advanceCircuitProgress` with the previous and current XZ positions, copies `trackProgress.route` to `route`, increments `nextCheckpoint` only when the helper reports a crossed gate, and performs the existing lap-time/finish-order block only when `lapCompleted` is true. Write `modifiers.route` along with the existing lap, checkpoint, finish, race-time, and best-lap modifiers.

In `track.js`, set `TRACK_DEF.launchPads` and `TRACK_DEF.itemSpawners` from `CIRCUIT_DEF`; preserve `getLaunchPadAt` and `updateSpawners` signatures. In `lobby.js`, set `MAX_PLAYERS` to `CIRCUIT_DEF.spawnPositions.length` and use the matching start position directly; slots beyond P7 return `null`. In `bots.js`, replace the `CHECKPOINTS` import with an exported `getBotTarget(raceState)` helper that returns `getCurrentGate(raceState.trackProgress).center`, set the target XZ from that helper, and preserve existing steering/drift behavior.

Create `traffic.js` with `createTrafficVehicles(baseStats)` and `updateTrafficVehicle(vehicle, progress)`. The factory returns exactly three `{ vehicle, progress, bot }` records with IDs `T1`, `T2`, and `T3`, low throttle `0.3`, and offsets on the main road. The updater calls the existing `BotController` toward `getCurrentGate(progress)`, advances its private circuit progress after movement, and never writes a race modifier. In `server.js`, replace `lobby.join('traffic-*')` with this collection; include traffic only when applying collisions and serializing the ledger.

- [ ] **Step 4: Cover branch and bot regression behavior**

```js
import { BotController, getBotTarget } from './bots.js';
import { CIRCUIT_DEF, createCircuitProgress } from './circuit-track.js';
import { RaceManager } from './race.js';

const bot = new BotController('bot-1');
const target = getBotTarget({ trackProgress: createCircuitProgress() });
if (target.x !== -55 || target.z !== 5) throw new Error('T3: bot targets the first circuit gate center');

const shortcutVehicle = { id: 'P1', x: 0, z: 25, modifiers: {} };
const shortcutLobby = { players: new Map([['player-2', shortcutVehicle]]) };
const shortcutManager = new RaceManager();
shortcutManager.state = 'RACING';
shortcutManager.registerPlayer('player-2');
for (const gateId of ['coast-west', 'northwest', 'north', 'shortcut-entry']) {
  const gate = CIRCUIT_DEF.gates.find((candidate) => candidate.id === gateId);
  shortcutVehicle.x = gate.center.x - gate.normal.x * 2;
  shortcutVehicle.z = gate.center.z - gate.normal.z * 2;
  shortcutManager.update(1 / 60, shortcutLobby);
  shortcutVehicle.x = gate.center.x + gate.normal.x * 2;
  shortcutVehicle.z = gate.center.z + gate.normal.z * 2;
  shortcutManager.update(1 / 60, shortcutLobby);
}
const shortcutState = shortcutManager.raceStates.get('player-2');
if (shortcutState.trackProgress.nextGateIds[0] !== 'shortcut-landing') {
  throw new Error('T4: shortcut requires its landing gate before merge');
}
if (shortcutState.lap !== 0) throw new Error('T5: incomplete shortcut does not score a lap');
```

Add a duplicate-position assertion: calling `RaceManager.update` twice at the same gate position cannot increment `nextCheckpoint` twice. Also assert an early finish leaves `lap` at zero. Keep the existing `test_lobby_v1.js` assertion that a ninth player is rejected, and add `test_traffic_v1.js` with:

```js
import { createTrafficVehicles } from './traffic.js';

const traffic = createTrafficVehicles({ max_speed: 40, acceleration: 5, handling: 1.5, stunt_rate: 2, weight: 1000, boost_mult: 1.5 });
if (traffic.length !== 3) throw new Error('T6: exactly three traffic karts are created');
if (traffic.some(({ vehicle }) => !['T1', 'T2', 'T3'].includes(vehicle.id))) throw new Error('T7: traffic IDs do not consume player slots');
if (traffic.some(({ vehicle }) => vehicle.modifiers.lap !== undefined)) throw new Error('T8: traffic has no race modifier');
```

Run `node 03_Stable_Build/test_lobby_v1.js`, `node 03_Stable_Build/test_circuit-track_v1.js`, `node 03_Stable_Build/test_race_circuit_v1.js`, and `node 03_Stable_Build/test_traffic_v1.js`.

- [ ] **Step 5: Commit stable headless integration**

```bash
git add 03_Stable_Build/circuit-track.js 03_Stable_Build/test_circuit-track_v1.js 03_Stable_Build/track.js 03_Stable_Build/race.js 03_Stable_Build/lobby.js 03_Stable_Build/bots.js 03_Stable_Build/traffic.js 03_Stable_Build/server.js 03_Stable_Build/test_race_circuit_v1.js 03_Stable_Build/test_traffic_v1.js
git commit -m "feat: integrate coastal circuit race flow"
```

### Task 3: Render the Shared Circuit and Minimap

**Files:**
- Create: `04_Render_Engine/src/circuit-visuals.js`
- Modify: `04_Render_Engine/src/renderer.js`
- Modify: `04_Render_Engine/src/minimap.js`
- Modify: `04_Render_Engine/vite.config.js`

**Interfaces:**
- Consumes: `CIRCUIT_DEF` from `../../03_Stable_Build/circuit-track.js`.
- Produces: `createCircuitVisuals(THREE)`, `drawCircuit(context, mapCoordinate)`, and a client build that accepts the external pure module.

- [ ] **Step 1: Write the failing production build check**

Run: `npm run build`

Working directory: `04_Render_Engine`

Expected before the feature: PASS, establishing the baseline. After adding the external circuit import, a failure due to Vite file-system restrictions is the expected signal to add the explicit allow-list in the next step.

- [ ] **Step 2: Implement client-side read-only circuit visuals**

```js
import * as THREE from 'three';
import { CIRCUIT_DEF } from '../../03_Stable_Build/circuit-track.js';

export function createCircuitVisuals() {
  const group = new THREE.Group();
  for (const [points, width] of [
    [CIRCUIT_DEF.road.mainPoints, CIRCUIT_DEF.road.mainWidth],
    [CIRCUIT_DEF.road.shortcutPoints, CIRCUIT_DEF.road.shortcutWidth],
  ]) {
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      const length = Math.hypot(to.x - from.x, to.z - from.z);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length), roadMaterial);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = Math.atan2(to.x - from.x, to.z - from.z);
      mesh.position.set((from.x + to.x) / 2, 0.02, (from.z + to.z) / 2);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return group;
}
```

Build the reusable asphalt material and its canvas texture once per circuit group. Add low-poly ramp wedges for `launchPads`, checkpoint arches from `gates`, a checkerboard start line at `finish`, and eight start-grid markers from `spawnPositions`. Replace the fixed `PlaneGeometry(80, 300)`, two hard-coded ramps, fixed checkpoint gates, and fixed finish arch in `Renderer.setupEnvironment()` with this group. Leave the terrain, lighting, particles, and kart performance controls intact.

- [ ] **Step 3: Make the minimap data-driven and configure Vite explicitly**

```js
// vite.config.js
export default defineConfig({
  server: {
    fs: { allow: ['..'] },
    proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } },
  },
});
```

Import `CIRCUIT_DEF` in `minimap.js`, calculate its bounds from both road point arrays with 15 m padding, stroke main and shortcut polylines, and draw each gate using its center, normal, and `halfWidth`. Delete the hard-coded straight center line, checkpoint Z array, finish Z coordinate, and fixed map bounds.

- [ ] **Step 4: Verify the client build and visual alignment**

Run: `npm run build`

Working directory: `04_Render_Engine`

Expected: Vite completes with no unresolved import or external file-system error.

Start the headless server and Vite client. In the browser, verify that the player grid is behind the checkerboard line; every visible ramp sits at its headless launch-pad coordinate; the shortcut merges at the same gate shown by the minimap; and the browser console has no errors.

- [ ] **Step 5: Commit renderer and minimap integration**

```bash
git add 04_Render_Engine/src/circuit-visuals.js 04_Render_Engine/src/renderer.js 04_Render_Engine/src/minimap.js 04_Render_Engine/vite.config.js
git commit -m "feat: render coastal stunt circuit"
```

### Task 4: Run the Full Regression and Record the Result

**Files:**
- Modify: `E:/MyProject/AIModelTrain/use-ai-os-v2/contexts/rumble-bunny/memory/session-context.md` after the code commit succeeds.

**Interfaces:**
- Consumes: completed headless tests and Vite build output.
- Produces: a verified circuit slice with a recorded result and no unrelated file changes.

- [ ] **Step 1: Run all relevant headless tests**

```bash
node 03_Stable_Build/test_vehicle_physics_v1.js
node 03_Stable_Build/test_items_v1.js
node 03_Stable_Build/test_lobby_v1.js
node 03_Stable_Build/test_ledger_v1.js
node 03_Stable_Build/test_circuit-track_v1.js
node 03_Stable_Build/test_race_circuit_v1.js
node 03_Stable_Build/test_traffic_v1.js
```

Expected: each script exits with status 0. Preserve the exact failing command and output in the session record if any command fails.

- [ ] **Step 2: Run the full client build again**

Run: `npm run build`

Working directory: `04_Render_Engine`

Expected: successful Vite production build.

- [ ] **Step 3: Check the scoped diff before final commit**

```bash
git diff --check
git status --short
git log -3 --oneline
```

Expected: no whitespace errors; only intended circuit files are staged or committed; `.superpowers/` remains untracked and excluded.

- [ ] **Step 4: Update the context session record**

Record the implementation commit hashes, exact test commands and outcomes, production-build outcome, and any remaining manual visual check in `E:/MyProject/AIModelTrain/use-ai-os-v2/contexts/rumble-bunny/memory/session-context.md`. Do not stage or commit unrelated governance-repository changes. Do not push without the user's explicit request.

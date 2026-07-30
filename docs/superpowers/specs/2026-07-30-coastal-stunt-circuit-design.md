# Coastal Stunt Circuit Design

## Goal

Replace the prototype's straight strip with one server-authoritative beach circuit that supports a reliable main route, three jumps, and one faster shortcut whose reward depends on a clean ramp landing. Existing bots and the minimap must consume that same circuit data so the playable race remains coherent.

This is one micro-system: circuit definition and directed lap progress. Road collision, off-road slowdown, new vehicle physics, new items, and art assets are out of scope.

## Player Experience

The player starts at the south-west portion of a broad coastal loop and drives counter-clockwise through a sequence of readable turns. The normal route is wide enough for an eight-kart pack. It contains two optional main-route jumps and a third jump near the return leg.

At the north section, a marked ramp provides a narrow interior shortcut. The shortcut skips the slow eastern bend, but its landing gate must be crossed before the merge gate. Missing the landing or taking the ramp in the wrong direction makes the player rejoin without advancing, so the safe main route remains dependable.

## Defined Win

Input: a track definition plus each vehicle's previous and current XZ positions on a fixed server tick.

Output: validated per-player route, next progress stage, lap count, finish state, and a shared set of renderable road, gate, ramp, spawn, and item-spawner coordinates.

Pass/fail: a headless test drives a vehicle through either legal route and then the finish gate to complete exactly one lap. Crossing gates in reverse, crossing the finish early, or entering the shortcut without its landing gate must not increment the lap.

## Geometry Contract

`CIRCUIT_DEF` is the only source for the following XZ-plane values. The headless server uses gates and zones from it; the renderer uses the same values to draw the road and its markers.

| Element | Coordinates / role |
| --- | --- |
| Start/finish | Center `(0, 25)`, heading toward negative Z, 18 m half-width |
| Main loop stages | `coast-west (-55, 5)`, `northwest (-65, -65)`, `north (-20, -105)`, `east-bend (60, -60)`, `harbor-merge (60, 20)`, `return (20, 55)` |
| Shortcut stages | `shortcut-entry (-10, -82)`, `shortcut-landing (32, -28)`, then `harbor-merge (60, 20)` |
| Main-route jumps | `north-jump (-35, -98)`, `east-jump (52, -48)`, `return-jump (35, 44)` |
| Shortcut jump | `shortcut-ramp (-10, -82)` is the ramp zone; `shortcut-entry` is its progress gate and `shortcut-landing` is the required landing gate |
| Road width | 28 m main route; 16 m shortcut |
| Spawn grid | Eight positions behind the finish gate, with four columns and two rows, centered on the start heading |
| Items | Existing item spawners move onto the main loop approach and one normal-route bend. The shortcut has no item reward in this slice. |

The main route follows the stages in listed order. At the north stage, the route selector accepts either `east-bend` or `shortcut-entry`; choosing one fixes that route for the lap. Both legal branches converge at `harbor-merge`, then require `return` and the finish gate.

## Headless Progress Rules

Each gate is a directed line segment with a center, tangent/normal, and half-width. Progress advances only when a vehicle crosses the current gate from its required side between the previous and current XZ positions. A position merely resting inside a gate cannot trigger it repeatedly.

Race state adds `route: 'UNSET' | 'MAIN' | 'SHORTCUT'`. It resets to `UNSET` when a lap begins. `lap`, `nextCheckpoint`, `finished`, timing, and ledger modifiers remain the responsibility of `RaceManager`.

The main branch sequence is:

`coast-west -> northwest -> north -> east-bend -> harbor-merge -> return -> finish`

The shortcut branch sequence is:

`coast-west -> northwest -> north -> shortcut-entry -> shortcut-landing -> harbor-merge -> return -> finish`

No branch may bypass `harbor-merge`; no finish crossing is valid until the active branch and `return` are complete. The server remains authoritative and writes only the current lap, progress stage, route, finish state, race time, and best lap to vehicle modifiers.

## Components and Data Flow

1. `02_Isolation_Chamber/circuit-track.js` defines and validates circuit data plus pure directed-gate helpers.
2. Its terminal test supplies synthetic previous/current positions and proves legal and illegal progress paths without WebSocket or rendering dependencies.
3. `03_Stable_Build/track.js` adopts the validated definition for ramps, item spawners, spawn positions, and renderer-facing geometry.
4. `03_Stable_Build/race.js` delegates checkpoint selection and crossing checks to the circuit helper, retaining countdown, timing, finish ordering, and ledger writes.
5. `03_Stable_Build/bots.js` aims the existing controller at the current circuit gate center. It does not add decision-making or racing strategy.
6. `04_Render_Engine/src/renderer.js` builds the road and route markers from circuit data, and `04_Render_Engine/src/minimap.js` draws its path and gates from that data. Neither computes lap progress.

Malformed circuit data fails fast at server startup: duplicate IDs, an empty required route, a route branch that does not merge, or a gate with non-positive width is rejected with a descriptive error. This prevents a partially valid track from silently producing impossible races.

## Tests

The isolation test must prove:

1. The definition contains eight spawns, three main-route jump zones, one separate shortcut ramp/landing pair, and one merge gate.
2. A complete main-route traversal records one lap and resets the branch selector.
3. A complete shortcut traversal records one lap only after the shortcut landing gate.
4. Reverse gate crossings do not advance progress.
5. A finish crossing before all required stages does not increment the lap.
6. Repeated positions inside one gate advance at most once.

The stable-build regression test must preserve existing countdown, finish order, total-lap, and ledger-modifier behavior while using the circuit helper. A bot regression test confirms that the controller selects the current gate center instead of a hard-coded Z coordinate. A manual renderer and minimap check confirms that the visible road, jump markers, shortcut entrance, landing, start grid, and 2D circuit path align with the definition.

## Scope Boundaries

The circuit does not add a new dependency, change the ledger field format, or alter vehicle balance. It is compatible with the existing fixed 60 fps server loop. It changes the existing bot target from a hard-coded straight-line coordinate to the next circuit gate, but does not add bot pathfinding or strategy. Any future wall collision, respawn, shortcuts with collectibles, or terrain art will be separate micro-systems.

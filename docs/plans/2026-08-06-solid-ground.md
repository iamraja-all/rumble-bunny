# SOLID GROUND — making the track a place instead of a picture

**Status:** PLAN ONLY. No code written. Raised 2026-08-06 from play feedback:
*"the track is not good and it goes beyond the track boundaries that blocks by steel
and it is not look like rumble racing."*

**Suggested branch:** `codex/solid-ground`

---

## 1. The one root cause

All three complaints are the same defect wearing three hats. Verified by reading the
code on 2026-08-06, not assumed:

| check | result |
|---|---|
| Collisions in the engine | **only** kart-vs-kart (`applyCarCollisions`) and item-vs-kart (`checkCollision`) |
| Consumers of `road.mainWidth` / `shortcutWidth` | `circuit-visuals.js` and `scenery.js` — **renderer only, zero engine consumers** |
| Guardrails | exist solely in `04_Render_Engine/src/scenery.js`; the engine mentions them only in comments |
| Ground | flat `y = 0` everywhere (`DEFAULT_GROUND_Y`) |

> **The engine does not know a road exists.** The tarmac, the steel and the grass are
> all paint on an infinite flat plane. The only thing that stops a kart is the 155 m
> playfield circle in `race.js`, which does not block — it waits 2.5 s and teleports.

That is why you can drive through steel: there is no steel. And it is a large part of
why it does not read as Rumble Racing — with no edges, no grip difference and no
elevation, every corner is optional and the fastest line is a straight line across the
grass.

## 2. Two facts that make this much cheaper than it looks

1. **The physics already accepts terrain.** `updateVehicle(vehicle, input, dt, groundY = 0)`
   takes a ground height and `applyMovement` already snaps/falls to it — `server.js`
   simply never passes one. **Elevation needs a `heightAt(x, z)` function, not a new
   integrator.**
2. **The road data already exists in the engine.** `CIRCUIT_DEF.road` has the centreline
   points and widths in `03_Stable_Build/circuit-track.js`. The renderer builds its
   Catmull-Rom from exactly that. Ponytail Rung 2: the geometry is there, nothing
   consumes it yet.

## 3. Non-negotiable constraint on the whole effort

**R01 — the engine goes first, every time.** The road must exist as headless truth that
prints correct answers in a terminal *before* a single line of renderer changes. And
per RSK-007's lesson, the renderer must consume the SAME sampler the engine uses — if
the drawn road and the physical road are computed twice, they will disagree, and that
disagreement is invisible until a player is driving through a wall that is visibly
there.

---

## 4. The sessions

One micro-system each (R03). Each has a Defined Win (R04) statable before code.

### S1 — Road geometry in the engine *(foundation, blocks everything else)*
Give `circuit-track.js` a real centreline: sample the Catmull-Rom into a polyline once
at boot (written from scratch — R06 forbids importing three into the engine) and expose
`roadAt(x, z, hint)` → `{ lateralOffset, halfWidth, segmentIndex, surface, edge }`.
- Search is **windowed by the kart's existing `trackProgress`**, not a scan of all
  segments — state the Big-O before writing it (R07).
- The renderer imports the same sampler instead of building its own curve.
- **Defined Win:** given any XZ, the engine reports distance from the centreline and
  whether that point is on tarmac. Centre → ~0; a point at the painted edge → ±halfWidth;
  the shortcut resolves against the shortcut spline, not the main one.

### S2 — Barriers that actually stop you *(this is the reported bug)*
Per-segment `edge` type: `WALL` (steel) or `OPEN` (run-off). Resolve a kart that crosses
a `WALL` edge by clamping it to the barrier and **sliding along** it, conserving the
along-wall component and bleeding the into-wall component.
- No bounce. A reflective barrier at 40 m/s flings the kart across the track and is
  worse than the current hole.
- Reuse the momentum-conserving approach ADR-0011 settled on for kart-kart contact
  rather than inventing a second collision style.
- **Defined Win:** a kart driven straight at a walled segment at max speed ends up
  travelling alongside it; lateral offset never exceeds the barrier line on any walled
  segment, over a seeded multi-lap headless sim.

### S3 — Surfaces: tarmac, dirt, grass
Per-surface grip/friction so leaving the road costs time. Currently `FRICTION` is one
constant everywhere, which is why cutting corners is free and the racing line is
decorative.
- **Defined Win:** a seeded headless lap driven on the racing line is measurably faster
  than the same lap cutting every corner across the grass. That comparison is the test.
- Makes the existing shortcut a genuine risk/reward decision rather than a free saving.

### S4 — Elevation *(the biggest "looks like Rumble Racing" lever)*
A `heightAt(x, z)` heightfield: banked corners, crests, the drop to the coast. Pass it
as the `groundY` argument that already exists.
- Landing pitch already decides crash-vs-clean (spec §4.3), so slopes immediately make
  the existing stunt system read better.
- **Defined Win:** a kart follows terrain height with no falling through and no jitter
  on slopes; a jump launched uphill lands cleanly downhill; `test_vehicle_physics_v1`
  stays green.
- ⚠ Interacts with S2 (barriers must follow the terrain) and with the renderer (the
  road mesh must be built from the same height function).

### S5 — Track shape *(taste call — needs the owner in the loop)*
The current circuit is eight Catmull-Rom points forming a plain loop. A circuit that
*reads* as one wants varied corner radii, at least one hairpin, one long straight for
top speed, and a signature feature. This is deliberately **after** S1–S4 so a new shape
can be validated against real containment and grip, and because everything derives from
`CIRCUIT_DEF` the reshape stays cheap.
- **Defined Win:** owner-approved. This one cannot be settled by a test.

### S6 — The track dressed as a circuit
Kerbs at apexes, centre line, run-off, barrier posts aligned to the **physical** barrier
line from S2, pit-straight widening. All driven from the S1 sampler.
- **Defined Win:** screenshots at three points on the lap read as a race circuit rather
  than a grey ribbon on grass.

### S7 — Bots and traffic on the new track
Bots currently steer at gate centres, which with real barriers means grinding along
walls through every corner. They need a racing line (offset from the centreline, apex
seeking) and awareness of grip.
- **Defined Win:** the seeded 180 s sim from ADR-0011 keeps or improves its finisher
  count with barriers and surfaces active — no bot stuck against a wall.
- **Do not skip this.** It is the dependency most likely to be discovered late.

### S8 — Re-tune out-of-bounds
With real barriers, the playfield teleport stops being containment and becomes a last
resort for genuine escapes (big jumps, glitches). Revisit the 2.5 s grace and consider
respawning onto the racing line rather than the gate centre.
- **Defined Win:** `test_race_v1`'s out-of-bounds cases still pass with the new
  containment; the teleport fires only where a barrier genuinely does not exist.

---

## 5. Order and dependencies

```
S1 road geometry ──┬── S2 barriers ──┬── S6 dressing
                   ├── S3 surfaces ──┤
                   └── S4 elevation ─┴── S7 bots ── S8 out-of-bounds
                                   S5 shape (owner) ──┘
```

**S1 blocks everything.** S2 is the reported bug and should follow immediately. S5 is
the only item that cannot be closed by a test.

## 6. Risks worth naming now

- **RSK-007 class — two sources of truth.** If the renderer keeps its own curve, the
  visible wall and the physical wall drift apart. The sampler must have one owner.
- **R07 at 60 Hz × 8 karts.** A naive nearest-segment search over ~200 segments is
  1,600 distance tests per frame. Window it by `trackProgress`.
- **Determinism (RSK-003).** Collision response must stay deterministic; no
  `Math.random()` in the resolver.
- **Scope creep into a physics engine.** The target is arcade containment, not a rigid
  body solver. ADR-0011 already accepted scalar-speed approximations for kart contact;
  hold that line.

## 7. Explicitly NOT in this plan

Already done and not to be redone: sun exposure (ADR-0019), results/standings
(ADR-0015), lobby roster and boot splash (ADR-0016), ledger slimming (ADR-0022),
Dockerfile fixes (ADR-0023), client logic tests (ADR-0024/0025).
Still owner-gated and untouched by this plan: the branch merge, the barrel-roll
play-test, the freeze confirmation, and `docker build`.

# Camera View Toggle Design

## Goal

Make close chase the default racing view and let the player switch instantly between close chase and wide tactical camera presets.

## Scope

This is a client-only camera feature. It does not send an input to the server, change the ledger, affect physics, or modify race state. It has exactly two modes and does not persist the selected mode after a page reload.

## Camera Modes

| Mode | Follow offset (local X/Y/Z) | Look-ahead distance | Follow interpolation |
| --- | --- | --- | --- |
| `CLOSE` | `(0, 6.5, 11)` | `12` m | `0.12` |
| `WIDE` | `(0, 10, 18)` | `10` m | `0.10` |

`CLOSE` is the default. It reduces camera height and trailing distance so the kart occupies more of the lower frame, while its 12 m look-ahead keeps ramps and shortcut landings visible. `WIDE` preserves the existing high tactical framing for traffic and route awareness.

## Player Controls

The player switches views with `V` or a compact camera icon button in the HUD. The button has `aria-label="Switch camera view"` and a tooltip naming the current action. Each switch displays a short HUD confirmation: `CLOSE VIEW` or `WIDE VIEW`.

Key repeat is ignored so holding `V` cannot rapidly cycle views. Clicking the button and pressing `V` call the same renderer toggle method.

## Components and Data Flow

1. `04_Render_Engine/src/camera-config.js` exports immutable `CAMERA_PRESETS`, `DEFAULT_CAMERA_MODE`, and `getNextCameraMode(mode)`.
2. `Renderer` stores `cameraMode`, exposes `toggleCameraMode()` and `getCameraMode()`, and selects the preset in its existing per-frame camera-follow block.
3. `main.js` listens for non-repeating `V` key presses and calls `renderer.toggleCameraMode()`.
4. `HUD` creates the camera icon button, routes its click to the same toggle callback, and renders the confirmation message.

The existing world-space offset rotation around vehicle `rotY`, camera position interpolation, and target interpolation remain in `Renderer`; only their preset inputs change.

## Defined Win

Input: a local player presses `V` once or clicks the HUD camera button while a race is running.

Output: the renderer changes from `CLOSE` to `WIDE` or from `WIDE` to `CLOSE`, and the HUD confirms the active mode.

Pass/fail: a terminal test proves the default mode and two-way toggle sequence. A browser check proves that close chase is the initial camera, one `V` press changes to wide tactical, a second returns to close chase, and neither action sends a WebSocket input or changes the local vehicle ledger state.

## Error Handling and Boundaries

An unknown camera mode falls back to `CLOSE`. The input listener only reacts to `event.code === 'KeyV'` when `event.repeat` is false. The HUD button does not exist until the HUD is constructed, and it has no effect until its supplied toggle callback is available.

No bumper camera, free camera, per-player network synchronization, or preference storage is part of this feature.

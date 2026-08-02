# Grand Prix UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the prototype's bare HTML overlay into a premium game experience. This involves rendering a live background behind the main menu, making the color picker functional across the network, and adding a post-race Results/Leaderboard screen.

**Architecture:** The server's `RaceManager` needs to broadcast a structured `LEADERBOARD` message when racers cross the finish line. The client's `menu.js` will intercept these messages and manage HTML CSS overlays (Menu -> HUD -> Leaderboard) while keeping the Three.js canvas active in the background.

**Tech Stack:** Vanilla JavaScript, HTML/CSS, WebSocket.

## Global Constraints

- Do not use React/Vue/Svelte; stick to vanilla DOM manipulation in `04_Render_Engine/src/menu.js`.
- The main menu background should be a live rendering of the track, not a static image.
- Ensure the UI matches the premium glassmorphism/neon aesthetic of the game.
- The `raceManager` should retain its logic of tracking laps, but now explicitly emit ordered finish times.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `02_Isolation_Chamber/test_race-results_v1.js` | Headless test verifying that the race manager emits a correctly sorted leaderboard when players finish. |
| `03_Stable_Build/race.js` | Emits `LEADERBOARD` network messages with player IDs, placements, and times. |
| `04_Render_Engine/index.html` | Adds the Results/Leaderboard overlay markup. |
| `04_Render_Engine/src/menu.js` | Toggles UI overlays (Menu, HUD, Results). Handles color picker state. |
| `04_Render_Engine/src/client.js` | Parses the `LEADERBOARD` message from the server and passes it to `menu.js`. Applies the chosen vehicle color to the player's kart. |
| `04_Render_Engine/src/renderer.js` | Initializes the 3D scene *before* connecting to the server, so the camera slowly pans across the track as the main menu background. |

---

## Tasks

### Task 1: Server-Side Race Results (Isolation Chamber)
- [ ] Update `03_Stable_Build/race.js` (or mock it in isolation chamber first):
  - When a player finishes all laps, record their total race time.
  - When a player finishes, the server should broadcast `LEADERBOARD|JSON_PAYLOAD` to all clients in the room. The JSON should be an array of objects: `[{ id: 'P0', time: 124.5, rank: 1 }, ...]`.
- [ ] Create `02_Isolation_Chamber/test_race-results_v1.js` to simulate a race finishing and assert the leaderboard array is sorted by time and correctly formatted.

### Task 2: Live Background & Branding
- [ ] Add a favicon to `04_Render_Engine/public/favicon.ico` and update `<title>` in `index.html` to `Rumble-Bunny: Coastal Circuit`.
- [ ] Update `04_Render_Engine/src/renderer.js` and `client.js`:
  - Separate `renderer.init()` from the WebSocket `connect()`.
  - On page load, immediately initialize Three.js, draw the circuit, and start a slow rotating/panning camera animation around the track.
  - When the player clicks "Start Game", snap the camera to the vehicle and start following the physics updates.

### Task 3: Color Picker Integration
- [ ] Update `04_Render_Engine/src/menu.js`:
  - Ensure the color picker `<input type="color">` value is captured when the user clicks "Start".
  - Send the color as part of the handshake: e.g., `JOIN|CODE|#ff00ff`.
- [ ] Update `03_Stable_Build/server.js` and `lobby.js`:
  - Store the requested color on the player's slot.
  - Broadcast the color to all clients so opponents render in the correct color.
- [ ] Update `04_Render_Engine/src/client.js`:
  - Apply the received color to the procedural kart meshes in Three.js.

### Task 4: Leaderboard UI
- [ ] Update `04_Render_Engine/index.html` and `style.css`:
  - Create a hidden `<div id="results-screen">` featuring a glassmorphism table for placements.
- [ ] Update `04_Render_Engine/src/menu.js`:
  - Create a `showResults(leaderboardData)` function that populates the table and fades it in over the HUD.
  - Add a "Return to Lobby" button to the results screen.
- [ ] Update `04_Render_Engine/src/client.js`:
  - Listen for the `LEADERBOARD|...` message type.
  - If received, call `menu.showResults()`.

### Task 5: Regression and Final Validation
- [ ] Run all headless tests.
- [ ] Start the game in Vite.
- [ ] Verify the camera slowly pans across the track before you connect.
- [ ] Pick a bright green color, join a game, and verify your kart is green.
- [ ] Complete 3 laps. Verify the game smoothly transitions to the Results screen showing your time.

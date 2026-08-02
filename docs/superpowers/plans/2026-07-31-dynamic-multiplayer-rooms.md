# Dynamic Multiplayer Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single hard-coded server room with dynamic, on-demand room instances using 4-letter join codes. Overhaul the client UI to support "Host Game" and "Join Game" flows, bridging the gap between a tech demo and a real multiplayer game.

**Architecture:** First, build a `RoomManager` module in the isolation chamber to handle lifecycle (create, join, leave, destroy empty rooms). Then, integrate it into the stable build's `server.js`, refactoring the WebSocket connections to route to specific room instances based on initial handshake data. Finally, build the frontend UI for entering codes and displaying room state.

**Tech Stack:** Node.js ESM, vanilla JavaScript, WebSocket server, HTML/CSS.

## Global Constraints

- Keep the server authoritative at a fixed 60 fps; run physics loops per active room, not globally.
- Do not add dependencies. Use the existing `ws` package.
- Room codes must be exactly 4 uppercase letters (e.g., `ABCD`).
- Rooms automatically shut down when the last human player leaves to save server resources.
- Support a maximum of 8 players per room, matching the circuit grid limit.
- The UI must feel premium, utilizing the CSS design system from the Render Engine.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `02_Isolation_Chamber/room-manager.js` | Headless logic for generating codes, managing room instances (Lobby/Race pairs), and cleaning up. |
| `02_Isolation_Chamber/test_room-manager_v1.js` | Terminal proof for creating rooms, assigning clients, and garbage collecting empty rooms. |
| `03_Stable_Build/room-manager.js` | Promoted, tested production module. |
| `03_Stable_Build/server.js` | Routes incoming WS connections to specific rooms. Runs `tick()` for active rooms only. |
| `04_Render_Engine/index.html` | New UI panels for Main Menu, Host Game, Join Game (input field), and Lobby State. |
| `04_Render_Engine/src/menu.js` | Manages UI state transitions and sends `JOIN|ABCD` or `HOST` messages via WebSocket. |

---

## Tasks

### Task 1: Isolation Chamber — Room Manager
- [ ] Create `02_Isolation_Chamber/room-manager.js`.
  - Export a `RoomManager` class holding a Map of `rooms` (keyed by 4-letter string).
  - Implement `createRoom()` (generates unique 4-letter code, instantiates a mocked `Lobby` and `RaceManager`).
  - Implement `joinRoom(code, client)` (adds client, returns success/fail).
  - Implement `leaveRoom(code, client)` (removes client, deletes room if empty).
- [ ] Create `02_Isolation_Chamber/test_room-manager_v1.js`.
  - Test that room codes are exactly 4 uppercase letters.
  - Test that a client joining an invalid code fails.
  - Test that a room is destroyed when the last client leaves.
- [ ] Run `node 02_Isolation_Chamber/test_room-manager_v1.js` and verify it passes.

### Task 2: Stable Build Integration — Server Routing
- [ ] Move `room-manager.js` and `test_room-manager_v1.js` to `03_Stable_Build`.
- [ ] Update `03_Stable_Build/room-manager.js` to instantiate the REAL `Lobby` and `RaceManager` classes from the stable build.
- [ ] Refactor `03_Stable_Build/server.js`:
  - Remove the global `lobby` and `raceManager` singletons.
  - Instantiate a global `RoomManager`.
  - Update the `ws.on('message')` handler: the first message from a client must be `HOST` or `JOIN|CODE`. Route subsequent messages to the correct room instance.
  - Update the main game loop (`setInterval`): iterate over all active rooms in `RoomManager` and call their respective `tick()` methods.
- [ ] Update `03_Stable_Build/traffic.js` and `bots.js` to be scoped per room rather than global singletons.

### Task 3: Render Engine — UI Overhaul
- [ ] Update `04_Render_Engine/index.html`:
  - Build a sleek "Main Menu" with "Host Game" and "Join Game" buttons.
  - Build a "Join Game" modal with a 4-character text input and "Connect" button.
  - Build a "Lobby" screen displaying the 4-letter room code and connected players.
- [ ] Update `04_Render_Engine/style.css`:
  - Ensure the new panels match the premium neon/glassmorphism aesthetic.
- [ ] Update `04_Render_Engine/src/menu.js` and `client.js`:
  - Prevent connecting the WebSocket immediately on load. Wait until the user clicks Host or Join.
  - On connect, send the handshake (`HOST` or `JOIN|CODE`).
  - Handle a `ROOM_REJECTED` server message (invalid code, full lobby) by showing an error in the UI.
  - Transition from Menu -> Lobby -> Race seamlessly.

### Task 4: Regression and Final Validation
- [ ] Run all headless tests in `03_Stable_Build` to ensure nothing broke.
- [ ] Start the server and Vite client. Open two separate browser windows.
- [ ] Window 1: Click "Host Game". Verify a 4-letter code is shown.
- [ ] Window 2: Click "Join Game", enter the code. Verify both windows show each other in the lobby.
- [ ] Window 1: Start the race. Verify both clients load the race.
- [ ] Close Window 1 & 2. Verify server logs show the room was destroyed.
- [ ] Update `session-context.md` with the outcome.

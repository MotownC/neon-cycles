# Online Multiplayer (Server-Sequenced Lockstep) — Design Spec

Date: 2026-07-05
Status: Approved, ready for implementation planning

## Summary

Add a fourth game mode, **Online**, that lets two players in different
locations play the existing versus rules (first to 10, wall density, trail
mode, player colors) over the internet.

Architecture: **server-sequenced deterministic lockstep.** Both browsers run
the exact same pure simulation (`round.js` and friends) from a shared random
seed. A small Node server pairs players via 4-letter room codes and relays
per-tick input messages; it never simulates anything. A client only executes
tick N once it holds both players' inputs for N, so the two simulations can
never diverge. Cross-state round-trip latency (~40–80 ms) hides inside a
fixed 2-tick input delay (~220 ms at round start, ~110 ms at full speed),
which matches the feel of the existing 3-deep buffered turn queue.

The server is deployed to Render's free tier and serves the game's static
files too, so both players just open the same URL. Opening `index.html`
locally continues to work exactly as today (the Online mode simply needs the
server to be reachable).

## Goals

- Play a full first-to-10 versus match against a remote friend with
  local-feeling controls at friendly-distance latencies.
- Keep all new game logic in pure, DOM-free, socket-free, tested modules,
  per the project's architecture rules.
- Keep the server dumb (~200 lines): rooms, seed, relay, disconnect notice.
- The browser game remains dependency-free; the one new dependency (`ws`)
  is server-only.

## Non-goals (v1)

- **Turbo online.** Turbo's per-snake tick timing (`tickSingle` path)
  complicates lockstep; online always uses the shared `Round.tick` path.
- **Derezzer bolts / fire online.** No fire inputs are relayed; bolts never
  advance in online mode.
- **Powerups online.** `Powerups.maybeSpawn`/`claim` are not called in
  online mode.
- Reconnection, spectating, >2 players, lobby browsing, matchmaking beyond
  room codes, cheat protection (it's a friend).
- Rollback/prediction. Lockstep stalls briefly on network hiccups instead.

## Determinism model

Lockstep only works if both machines compute bit-identical rounds. The
sources of nondeterminism in local play, and how each is handled:

1. **Wall generation** — `Walls.generate(w, h, density, rand)` already
   takes an injectable `rand`. Both clients build a seeded PRNG
   (mulberry32) from a server-chosen 32-bit seed. Round R uses
   `mulberry32(seed + R)` so every round gets fresh-but-identical walls.
2. **Elapsed time** — local play drives `state.elapsed` from wall-clock
   `requestAnimationFrame` deltas, which two machines would never agree
   on. Online play instead derives *simulated elapsed*: executing tick N
   advances `simElapsed += Speed.tickInterval(simElapsed) / 1000`. This
   feeds the speed ramp, trail fade, HUD, renderer, and audio intensity
   identically on both machines.
3. **Turn inputs** — exchanged via the protocol below and applied through
   the existing `Snake.bufferDirection` (itself deterministic) at the same
   tick on both sides.
4. **Cosmetics** — `Renderer.randomBorderColor()`, audio noise, and each
   player's color choice touch no game state and stay local. Each player
   keeps their own chosen color for their own snake; the opponent renders
   via the existing `pickOpponentColor` fallback.

## Components

### `server/server.js` (new, Node, ~200 lines)

Plain `node:http` static file server (game root) plus a `ws` WebSocket
server on the same port (`process.env.PORT || 8735`). Responsibilities:

- **Rooms:** `Map<code, room>`. `host` message → create room with a fresh
  4-letter code (unambiguous alphabet, no 0/O/1/I) and a random 32-bit
  seed; reply `hosted {code}`. `join {code}` → attach as player 2 or reply
  `joinError {reason}` (unknown code / room full).
- **Match start:** when the second player arrives, send both sides
  `start {seed, settings, youAre}` where `settings` is the host's
  `{wallDensity, trailMode}` and `youAre` is 0 (host) or 1 (joiner).
- **Relay:** any `input` or `ready` message from one player is forwarded
  verbatim to the other. The server never parses tick contents.
- **Disconnects:** when either socket closes, notify the survivor with
  `opponentLeft` and delete the room.
- **Protocol version:** clients send `hello {v}` on connect; a mismatch
  with the server's `Net.PROTOCOL_VERSION` gets `versionMismatch` (client
  shows "refresh the page"). The server obtains the constant by
  `require('../src/net.js')` — the UMD wrapper already supports CommonJS.

Room/pairing decisions are factored into a pure, socket-free helper object
so they can be unit tested (`createRooms()` with injectable `rand`);
`server.js` itself is thin socket plumbing around it.

### `src/net.js` (new, pure, tested)

The lockstep brain. No DOM, no WebSocket, no timers — callers pass
messages in and ask questions. Exports `__name: 'Net'` plus:

- `PROTOCOL_VERSION` — bumped whenever the message format changes.
- `INPUT_DELAY` — 2 (ticks).
- `mulberry32(seed)` — tiny seeded PRNG factory (shared by both clients
  for wall generation; also reusable by tests).
- `createSession(playerIndex)` — lockstep state: next tick to execute,
  per-tick input store for both players, outbox of unsent local messages.
- `localTurns(session, dirs)` — schedule the local player's buffered
  turns for tick `next + INPUT_DELAY`, record them locally, and return
  the message to send. Called once per executed local tick (dirs may be
  empty — every tick produces a message so the peer can always advance).
- `remoteInput(session, msg)` — store the opponent's inputs for their
  stated tick.
- `canTick(session)` — true when both players' inputs for the next tick
  are present (ticks 0..INPUT_DELAY-1 are pre-seeded empty).
- `takeTick(session)` — pop `{tick, turns: [p0Turns, p1Turns]}` for
  execution and advance the tick counter.
- `stateHash(round)` — cheap order-independent digest (snake heads,
  directions, alive flags, lit-cell count) used as a desync tripwire.
  Every 60th input message carries the sender's hash for the tick it just
  executed; `checkHash(session, msg, localHash)` flags a mismatch.

### `src/online.js` (new, browser-only glue)

- Opens the WebSocket (`ws://`/`wss://` derived from `location`), with a
  "waking up server…" notice while connecting (Render free tier cold
  start can take ~30 s) and a clear failure message if the page is being
  served without the server (e.g. opened from `file://`).
- Drives the host/join UI flow and surfaces room codes / join errors.
- Bridges `net.js` to the wire: sends outbox messages, feeds incoming
  `input` messages to `Net.remoteInput`, and exposes callbacks into
  `main.js` for `start`, `opponentLeft`, and desync.
- Between rounds, sends `ready` when the local player hits Enter and
  reports when both sides are ready so the next round starts in sync.

### `main.js` + `index.html` + menu changes

- New menu button `ONLINE — FIRST TO 10` and a small host/join panel
  (HOST shows the room code to text your friend; JOIN takes a code).
  Reuses existing `.neon-btn`/`.wall-btn`/`.hint` styling — **no
  `styles.css` changes** (it has unrelated uncommitted WIP).
- New mode `'online'` in `main.js` state:
  - `newRound()` uses walls from `Walls.generate(COLS, ROWS,
    settings.wallDensity, Net.mulberry32(seed + roundNumber))` and the
    host's `trailMode`; local menu color still applies to the local
    player's own snake (host renders as index 0, joiner as index 1).
  - The rAF loop keeps rendering every frame, but in online mode the
    simulation advances via `while (Net.canTick(session))`: apply both
    players' turns with `Snake.bufferDirection`, call
    `Round.tick(round, simElapsed)`, advance `simElapsed` by
    `Speed.tickInterval(simElapsed)/1000`. Real-time accumulator gates
    how many ticks we *want* per frame; `canTick` gates how many we
    *may*.
  - Key presses in online mode go into a small pending-turns list
    (validated the same way, capped at 3) that `Net.localTurns` drains on
    each executed tick, instead of touching the snake directly.
  - No turbo, no fire, no powerups, no bolt accumulator in online mode.
  - Stall indicator: if the sim is blocked >500 ms waiting on remote
    input, show "CONNECTION LAGGING…" in the HUD; clear when it resumes.
  - Round/match end reuses `Match.awardRound` and the existing overlays
    with `YOU` / `FRIEND` labels; Enter sends `ready` and waits for the
    opponent ("WAITING FOR OPPONENT…") instead of starting immediately.
  - Disconnect or desync at any point: overlay message, back to menu.
- `index.html`: `<script src="src/net.js">` (before `online.js`, which
  precedes `main.js`), the new menu markup, version bump.

## Message protocol (JSON over WebSocket)

| Direction | Message | Fields |
|---|---|---|
| C→S | `hello` | `v` |
| C→S | `host` | `settings {wallDensity, trailMode}` |
| S→C | `hosted` | `code` |
| C→S | `join` | `code` |
| S→C | `joinError` | `reason` |
| S→C | `start` | `seed`, `settings`, `youAre` |
| C→S→C | `input` | `t` (tick), `turns` (0–3 dirs), `hash?` (every 60th tick) |
| C→S→C | `ready` | — (next-round handshake) |
| S→C | `opponentLeft` | — |
| S→C | `versionMismatch` | — |

## Error handling

- **Opponent disconnects** (any phase): "OPPONENT DISCONNECTED" overlay,
  match void, back to menu. No reconnection in v1 — start a new room.
- **Bad/full room code:** inline error in the join panel, stay on menu.
- **Desync tripwire fires:** end the match with "GAME OUT OF SYNC —
  PLEASE REFRESH" rather than silently playing two different games. With
  deterministic modules this should never fire; it exists to fail loudly.
- **Stale cached client:** protocol version check on `hello` → "NEW
  VERSION AVAILABLE — REFRESH THE PAGE".
- **Network stall:** simulation freezes (lockstep guarantee) and shows
  the lagging indicator; play resumes automatically when input arrives.

## Testing plan

All `node:test`, matching existing patterns:

- **`tests/net.test.js`** — `canTick` false until both inputs present;
  pre-seeded empty ticks 0..D-1; `localTurns` schedules at `next + D` and
  emits a message every call; `takeTick` returns turns in player order
  and advances; hash: identical rounds hash equal, a one-cell difference
  hashes differently; `mulberry32` determinism; protocol encode/decode
  round-trips.
- **Determinism test** (in `tests/net.test.js`) — build two independent
  rounds from the same seed and scripted input log (walls via
  `mulberry32`, simulated-elapsed tick loop as in `main.js`), assert
  final snake bodies, lit sets, and winner are deep-equal. This is the
  test that proves lockstep is sound and guards future logic changes
  against introducing nondeterminism.
- **`tests/server.test.js`** — pure room-manager tests: host creates a
  room with a code from the safe alphabet, join pairs and reports both
  start payloads (same seed, correct `youAre`), join errors on unknown/
  full codes, disconnect tears down the room. (Socket plumbing itself
  stays thin and untested, like other shell code.)

Existing tests must stay green; no changes to `round.js`, `board.js`,
`snake.js`, `walls.js`, or any other pure module are needed or allowed
(several carry unrelated uncommitted WIP).

## Deployment

- `package.json`: add `"ws"` dependency and `"start": "node
  server/server.js"`; version bump.
- `docs/deploy.md` (new, short): one-time Render setup — create a free
  Web Service from the repo, build command `npm install`, start command
  `npm start`; every push auto-deploys. Note the free-tier cold start.
- Local testing: `npm start` then two browser windows at
  `http://localhost:8735`.
- Version bump across `index.html` (`?v=`, `#version`) and
  `package.json` per the cache-busting rule; `CLAUDE.md` updated to
  mention the online mode, the server, and the server-only `ws`
  dependency.

## Files touched

- `server/server.js` (new)
- `src/net.js` (new)
- `src/online.js` (new)
- `src/main.js` (online mode wiring)
- `index.html` (menu markup, script tags, version bump)
- `package.json` (ws dep, start script, version bump)
- `tests/net.test.js`, `tests/server.test.js` (new)
- `docs/deploy.md` (new), `CLAUDE.md` (architecture note)

Deliberately untouched (uncommitted WIP lives here): `styles.css`,
`src/round.js`, `src/cpu.js`, `src/audio.js`, `src/powerups.js`,
`src/gauntlet.js`, and their tests.

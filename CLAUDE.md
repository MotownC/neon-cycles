# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Neon Cycles** — a browser-based Tron-style light-cycle game. Snakes leave glowing trails. Crashing into the arena boundary, an interior wall, any trail, or head-on with the opponent ends the round. Vanilla JS, HTML5 canvas, Web Audio — **no build step, no framework; the browser game has no dependencies** (the online server has one, `ws`, server-only).

Modes: 1P Survival (timed, localStorage leaderboard), 1P vs CPU, local 2P (first to 10 rounds), Gauntlet (CPU rival ladder), and Online (remote 2P via room codes). Menu options: wall density (none/low/med/high), rival, turbo on/off, trail mode, player color.

## Commands

```
node --test                      # run all tests
node --test tests/round.test.js  # run a single test file
npm start                        # online server (serves the game + WebSocket relay, port 8735)
```

There is no lint, build, or bundler. To play, open `index.html` directly in a browser, or serve the directory (a static server config named `neon-cycles-static` exists in `.claude/launch.json`, port 8734, for browser preview).

## Versioning / cache busting

Script and stylesheet tags in `index.html` carry a `?v=<version>` query string that must match the version shown in the menu (`#version` element) and `package.json`. **When bumping the version, update all three together** so browsers refetch instead of using stale cached files.

## Architecture

### UMD module pattern (load order matters)

Every file in `src/` uses the same UMD-ish wrapper: a factory returning an API object with a `__name` key. Under Node (`require` exists) it uses CommonJS for tests; in the browser it attaches to `window[api.__name]` (e.g. `window.Round`, `window.CPU`). There are no ES modules and no imports in the browser — `index.html` loads scripts in dependency order, and `main.js` must be last. Adding a new module means adding a `<script>` tag in the right position.

### Pure logic vs. DOM shell

- **Pure, DOM-free, tested modules:** `geometry.js` (direction vectors, turns, reversal checks), `snake.js` (body array — head is the *last* element — plus a 3-deep buffered turn queue), `board.js` (lit-cell `Set` keyed `"x,y"`, collision checks, BFS `distanceMap`/`openArea`), `walls.js` (procedural mirrored wall generation with spawn-safe zones), `round.js` (tick engine), `match.js` (round scoring to a target), `cpu.js` (AI), `speed.js` (tick-interval ramp + turbo constants), `leaderboard.js` (localStorage top-10), `net.js` (online lockstep: seeded PRNG, per-tick input pipeline with a 2-tick input delay, desync hashes), plus `server/rooms.js` (pure room pairing, tested in `tests/server.test.js`). Each has a matching file in `tests/` using `node:test`.
- **Browser-only modules (no unit tests for behavior):** `main.js` (game state machine, rAF loop, HUD, menu wiring), `renderer.js` (canvas drawing, palette), `input.js` (keyboard mapping), `audio.js` (procedural Web Audio soundtrack that intensifies over time, crash SFX), `online.js` (WebSocket shell). `server/server.js` is the Node shell (static files + message relay); `ws` is its only dependency and it never loads in the browser.

Keep new game logic in pure modules with tests; keep DOM/canvas/audio access out of them.

### Game loop and ticking

`main.js` runs a `requestAnimationFrame` loop with an accumulator: real time is converted into fixed logic ticks whose interval shrinks as the round progresses (`Speed.tickInterval(elapsed)`, 110ms → 55ms floor). Two ticking paths exist:

- **Turbo off:** one shared accumulator; `Round.tick(round)` advances all snakes simultaneously with proper simultaneous-collision (head-on) resolution.
- **Turbo on:** per-snake accumulators; each snake ticks at its own interval (boosting snakes tick faster) via `Round.tickSingle(round, i)`. Turbo is a fuel/cooldown resource (`freshTurbo()` in `main.js`, constants in `speed.js`), held with Shift keys.

Game phases in `main.js` state: `menu → countdown → playing → roundover/gameover`. Direction input is *buffered* (up to 3 turns, each validated against the previous queued direction) so fast S-turns work — see `Snake.bufferDirection`.

### Online mode (server-sequenced lockstep)

The `online` mode runs the same deterministic sim on both browsers from a
server-chosen seed; the server (`server/server.js`) only pairs 4-letter room
codes and relays per-tick `input` messages. A client executes tick N only
when both players' inputs for N are present (`Net.canTick`), with a 2-tick
input delay. **Online `state.elapsed` is simulated time** (advanced by
`Speed.tickInterval` per executed tick, never wall clock) — anything fed
into the sim must stay a pure function of seed + tick inputs. Turbo, bolts,
and powerups are disabled online (v1). Deploy notes: `docs/deploy.md`.

### CPU opponent

`cpu.js` scores each candidate move (straight/left/right) by **Voronoi territory**: BFS distance maps from both heads, counting cells reached strictly first minus cells the opponent reaches first. A straight-line bonus discourages pointless turns; a large head-on penalty makes trades a last resort. Deterministic given a seeded `rand` — tests exploit this.

### Debug trace

`main.js` keeps a 64-entry ring buffer (`window.__trace`) of key presses and applied tick directions, dumped to the console with per-snake crash verdicts on every round end. Use it to diagnose control/steering complaints from pasted console output.

## Browser preview testing

After verifying anything in the browser preview that started a round (music
starts on countdown-end via `Audio.start()`), call
`window.Audio.stop()` via `preview_eval` (or navigate back to the menu,
which calls it too) before ending the turn — otherwise the soundtrack keeps
playing in the background after the tool session moves on.

## Gotchas

- `README.md` controls section is stale (P1/P2 swapped; missing CPU mode, walls, turbo). The in-game hint in `index.html` is authoritative: P1 = arrows + Right Shift turbo, P2 = WASD + Left Shift turbo.
- `Round.tickSingle` checks collisions against a snapshot of other snakes (they don't move that tick), so turbo mode has slightly different head-on semantics than the shared `tick` path.
- Board `lit` cells can be unlit during play by trail modes (`fade`/`classic` trim) and by derezzer-bolt cuts (`projectile.js`), plus the CPU's speculative scoring. When destroying a cell, it must also be removed from its owner (`snake.body` / `board.walls`) — the renderer draws from those arrays and `tickSingle` collides against `body`, so an unlight-only cut leaves an invisible-but-passable hole.
- Design/plan history lives under `docs/plans/` and `docs/superpowers/specs/`.

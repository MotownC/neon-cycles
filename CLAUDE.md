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

**Bump the version as its own commit at the end of every change that touches any `src/*.js` file or `styles.css`** (a follow-up commit is fine if it was missed — don't fold unrelated fixes into a silent no-bump commit). A real user's browser caches the old `?v=` file indefinitely otherwise; several bug reports in this project's history turned out to be nothing more than the fix not having shipped to the user's browser yet.

## Architecture

### UMD module pattern (load order matters)

Every file in `src/` uses the same UMD-ish wrapper: a factory returning an API object with a `__name` key. Under Node (`require` exists) it uses CommonJS for tests; in the browser it attaches to `window[api.__name]` (e.g. `window.Round`, `window.CPU`). There are no ES modules and no imports in the browser — `index.html` loads scripts in dependency order, and `main.js` must be last. Adding a new module means adding a `<script>` tag in the right position.

### Pure logic vs. DOM shell

- **Pure, DOM-free, tested modules:** `geometry.js` (direction vectors, turns, reversal checks), `snake.js` (body array — head is the *last* element — plus a 3-deep buffered turn queue), `board.js` (lit-cell `Set` keyed `"x,y"`, collision checks, BFS `distanceMap`/`openArea`), `walls.js` (procedural mirrored wall generation with spawn-safe zones), `round.js` (tick engine), `match.js` (round scoring to a target), `cpu.js` (AI), `speed.js` (tick-interval ramp + turbo constants), `leaderboard.js` (localStorage top-10), `net.js` (online lockstep: seeded PRNG, per-tick input pipeline with a 2-tick input delay, desync hashes), `hazard.js` (1P Survival's shrinking-arena hazard: border/square ring math, telegraph timing, safety floor), plus `server/rooms.js` (pure room pairing, tested in `tests/server.test.js`). Each has a matching file in `tests/` using `node:test`.
- **Browser-only modules (no unit tests for behavior):** `main.js` (game state machine, rAF loop, HUD, menu wiring), `renderer.js` (canvas drawing, palette), `input.js` (keyboard mapping), `audio.js` (two selectable procedural Web Audio soundtracks — ORIGINAL and DARKWAVE — that intensify over time, plus a user-supplied custom audio file track and crash SFX), `online.js` (WebSocket shell). `server/server.js` is the Node shell (static files + message relay); `ws` is its only dependency and it never loads in the browser.

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

### Custom audio track lifecycle (`audio.js`)

Unlike ORIGINAL/DARKWAVE (procedural, driven by a Web Audio `AudioContext`), a user-supplied CUSTOM track plays through a plain `<audio>` element (`customEl`). Its lifecycle is deliberately asymmetric from the procedural tracks and easy to break by "simplifying" it back toward their pattern:

- **Priming is mandatory and gesture-bound.** `Audio.primeCustomTrack()` must be called synchronously from a real click handler (currently: the `[data-mode]` mode-button click in `main.js`) — it starts the element playing *muted*. Some browsers (observed: Edge with certain extensions/policies) silently refuse a `play()` call that fires later from a `setTimeout`/`setInterval` (e.g. the countdown), even though the same call succeeds from a direct click. Muted playback has no such restriction, so priming sidesteps it entirely. Do not remove priming or move the `play()` call into `Audio.start()`'s countdown-driven path.
- **`crash()` mutes the custom element, it does not pause it.** Pausing would force the *next* round's `Audio.start()` to call `play()` again from the countdown timer — the exact non-gesture context priming exists to avoid. Muting achieves the same "cut instantly on crash" UX with zero autoplay risk, since the element keeps silently playing/looping in the background and the next round just unmutes it.
- **`Audio.start()`'s `running` guard does not gate the custom-track branch.** `running` exists solely to stop the procedural sequencer (`pump()`/`startDrone()`) from double-starting; it's only ever reset by `stop()`, which is not called between rounds within a match. If the custom-track branch were gated by it too, `playCustomTrack()` (which does the unmuting) would only ever run once per match instead of once per round.
- **`window[api.__name] = api`** (the UMD wrapper, shared by every module) overwrites the browser's native `window.Audio` constructor, since this module's own `__name` is `'Audio'`. `NativeAudioCtor` captures the real constructor at factory-execution time — before that overwrite runs — specifically so `new Audio()` inside `loadCustomTrack` keeps working. Don't call the bare `Audio` identifier anywhere in this file; use `NativeAudioCtor`.

### Debug trace

`main.js` keeps a 64-entry ring buffer (`window.__trace`) of key presses and applied tick directions, dumped to the console with per-snake crash verdicts on every round end. Use it to diagnose control/steering complaints from pasted console output.

## Browser preview testing

After verifying anything in the browser preview that started a round (music
starts on countdown-end via `Audio.start()`), call
`window.Audio.stop()` via `preview_eval` (or navigate back to the menu,
which calls it too) before ending the turn — otherwise the soundtrack keeps
playing in the background after the tool session moves on.

**Known harness quirks** (cost real debugging time in this project's history — check these before concluding a real bug exists):

- The `neon-cycles-static` preview config always serves the main checkout, never a git worktree — there's no way to pass it a cwd. To verify a worktree branch in-browser, temporarily add a second `.claude/launch.json` entry that `os.chdir()`s into the worktree before starting the server on a scratch port (bind to `127.0.0.1`, not `''` — binding to all interfaces trips the auto-mode permission classifier), then revert the launch.json edit once done.
- `setTimeout`/`setInterval` (not just `requestAnimationFrame`) are unreliably throttled in this harness — a scheduled timer has fired tens of seconds late in one run and on-time in another, and inter-timer race ordering ("does A fire before B") is not trustworthy here. Verify timing-sensitive logic by reading the code, not by racing two timers in the preview.
- `console.log(label, someObject)` collapses to `Object`/`[object Object]` when the transcript is copied as plain text (this is exactly how a real user's bug report loses the useful part) — log `JSON.stringify(obj)` or plain-string-concatenated fields instead of a raw object whenever the log is meant to be copy-pasted back.
- Uncaught exceptions thrown inside DOM event listeners do **not** appear in `preview_console_logs` (it only captures explicit `console.*` calls) — register `window.addEventListener('error', ...)` before triggering the interaction if you need to catch one.
- When testing the CUSTOM audio track, a synthetic/garbage `Blob` as the "file" only proves the click-handling code path doesn't throw — it does not prove playback actually works, since a decode failure on invalid data is silently swallowed by design. Use a real, valid audio file (even a small synthesized-but-well-formed WAV) to actually verify playback state (`paused`/`muted`/`currentTime` advancing), not just the absence of errors.

## Gotchas

- `README.md` controls section is stale (P1/P2 swapped; missing CPU mode, walls, turbo). The in-game hint in `index.html` is authoritative: P1 = arrows + Right Shift turbo, P2 = WASD + Left Shift turbo.
- `Round.tickSingle` checks collisions against a snapshot of other snakes (they don't move that tick), so turbo mode has slightly different head-on semantics than the shared `tick` path.
- Board `lit` cells can be unlit during play by trail modes (`fade`/`classic` trim) and by derezzer-bolt cuts (`projectile.js`), plus the CPU's speculative scoring. When destroying a cell, it must also be removed from its owner (`snake.body` / `board.walls`) — the renderer draws from those arrays and `tickSingle` collides against `body`, so an unlight-only cut leaves an invisible-but-passable hole.
- Design/plan history lives under `docs/plans/` and `docs/superpowers/specs/`.

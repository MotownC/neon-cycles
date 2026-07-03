# Trail Decay Modes — Design Spec

Date: 2026-07-03
Status: Approved, ready for implementation planning

## Summary

Add a menu-selectable trail mode that changes how snake trails behave over a
round:

- **Tron** (current behavior) — trails are permanent.
- **Fade** — a snake's own trail cells expire and un-light themselves 8
  seconds after being laid down, dimming visually before they vanish.
- **Classic** — a snake's own trail is capped at a fixed length (20 cells);
  the tail is trimmed from the oldest end every tick, à la traditional Snake.

The mode is a single global menu toggle (like the existing WALLS/TURBO
toggles) and applies uniformly to all three game modes (1P Survival, 1P vs
CPU, 2P). Default is Tron, preserving current behavior exactly.

## Goals

- Give the arena "breathing room" in Fade/Classic modes instead of trails
  only ever accumulating.
- Reuse existing primitives (`Board.unlight`, the ordered `snake.body`
  array) rather than introducing new board-level bookkeeping.
- Keep Tron mode's behavior and tests byte-for-byte unchanged.

## Non-goals

- CPU awareness of future trail decay when scoring moves (it already
  re-evaluates every tick against current lit state, which stays correct).
- Per-mode leaderboard segmentation. Survival's leaderboard is time-based
  regardless of trail mode; Fade/Classic naturally allow longer survival
  times since the board doesn't permanently fill up — the existing
  tick-speed ramp (`Speed.tickInterval`, 110ms → 55ms floor) remains the
  only source of increasing difficulty in those modes.
- Any change to how interior walls or the arena boundary behave. Trimming
  only ever pops cells from a snake's own `body` array; `board.walls` is
  never touched by any trail mode.

## Data model changes

### `Snake.createSnake`

Every body cell gains a `t` field: the elapsed-seconds timestamp (relative
to the current round) at which that cell was laid down.

```js
body: [{ ...start, t: 0 }]
```

This is additive. Every existing consumer of body cells (collision checks,
the renderer, tests) reads only `x`/`y` and is unaffected by the extra
field.

### `Round.createRound(width, height, specs, walls = [], trailMode = 'tron')`

Gains a fifth parameter, stored as `round.trailMode`. Defaults to `'tron'`
so all existing call sites and tests keep working unchanged.

### `Round.tick(round, elapsedSec = 0)` / `Round.tickSingle(round, index, elapsedSec = 0)`

Both gain an `elapsedSec` parameter used to stamp newly-pushed head cells
and to evaluate Fade expiry. Defaulting to `0` means any caller that never
passes it (existing Tron-mode tests) is unaffected, since Tron mode never
reads the timestamp.

## New module: `src/trail.js`

Follows the same UMD wrapper pattern as every other `src/` module. Depends
only on `Board`.

```js
const FADE_SECONDS = 8;
const CLASSIC_LENGTH = 20;

// Pop cells from the oldest end of a snake's own trail per the active mode.
// Always leaves at least the head cell. Never touches board.walls.
function trim(snake, board, mode, elapsedSec) {
  if (mode === 'classic') {
    while (snake.body.length > CLASSIC_LENGTH) {
      B.unlight(board, snake.body.shift());
    }
  } else if (mode === 'fade') {
    while (snake.body.length > 1 && elapsedSec - snake.body[0].t >= FADE_SECONDS) {
      B.unlight(board, snake.body.shift());
    }
  }
  // 'tron' (or any unrecognized mode): no-op.
}
```

Exports: `__name: 'Trail'`, `MODES` (`['tron', 'fade', 'classic']`),
`FADE_SECONDS`, `CLASSIC_LENGTH`, `trim`.

## Round engine changes

In both `Round.tick` and `Round.tickSingle`, immediately after a surviving
snake's new head is computed and validated:

1. Stamp the head cell with `t: elapsedSec` before pushing it onto `body`.
2. `B.light(board, head)` as before.
3. Call `Trail.trim(snake, board, round.trailMode, elapsedSec)`.

This ordering means a cell is always lit before any trimming happens that
tick, and the just-added head (age 0) is never eligible for trimming.

`round.js` adds `Trail` to its dependency block the same way it currently
pulls in `Snake`, `Board`, and `Geometry`.

## Browser wiring

### `index.html`

- New `<script src="src/trail.js?v=...">` tag, positioned after
  `board.js` (its dependency) and before `round.js` (its consumer).
- New toggle group in the menu markup, structurally identical to the
  existing WALLS/TURBO groups:
  ```html
  <div class="trail-toggle" role="group" aria-label="Trail mode">
    <span class="hint">TRAIL</span>
    <button data-trail="tron" class="wall-btn active">TRON</button>
    <button data-trail="fade" class="wall-btn">FADE</button>
    <button data-trail="classic" class="wall-btn">CLASSIC</button>
  </div>
  ```
  Reuses the existing `.wall-btn` button styling; `.trail-toggle` reuses
  the `.wall-toggle`/`.turbo-toggle` flex layout rule in `styles.css`.

### `main.js`

- `state.trailMode = 'tron'` added to initial state.
- A `trailButtons` wiring block mirroring the existing `wallButtons`/
  `turboButtons` pattern (click sets `state.trailMode`, toggles `.active`).
- `newRound()` passes `state.trailMode` as the fifth argument to
  `Round.createRound`.
- The `loop()` function passes `state.elapsed` as the second argument to
  `Round.tick(state.round, state.elapsed)` and as the third argument to
  `Round.tickSingle(state.round, i, state.elapsed)`.
- `Renderer.render(...)` call sites pass `state.elapsed` through (see
  below).

## Renderer changes (Fade telegraph)

`Renderer.render` and `drawSnake` gain an `elapsedSec` parameter and read
`round.trailMode`. When `trailMode === 'fade'`, each body cell's opacity is
scaled down over the last 1.5 seconds of its life before it's trimmed, so
players get visual warning that a gap is about to open. Elsewhere
(`tron`/`classic`), rendering is unchanged — no per-cell age lookup, no
extra draw cost.

The alpha math is factored into a small, pure, exported function so it's
unit-testable without canvas mocking, matching the existing pattern used
by `pickOpponentColor`:

```js
// 1.0 until the last telegraphSeconds of life, then linearly down to a
// dim floor so an about-to-vanish cell is never fully invisible mid-fade.
function fadeAlpha(age, fadeSeconds, telegraphSeconds = 1.5, floor = 0.15) {
  const remaining = fadeSeconds - age;
  if (remaining >= telegraphSeconds) return 1;
  if (remaining <= 0) return floor;
  const p = remaining / telegraphSeconds;
  return floor + (1 - floor) * p;
}
```

`drawSnake` uses `fadeAlpha(elapsedSec - c.t, Trail.FADE_SECONDS)` as
`ctx.globalAlpha` per cell only when `trailMode === 'fade'`; other modes
keep the current full-opacity fill-rect loop untouched.

## Edge cases

- **Survival endurance in Fade/Classic:** intentional per the approved
  design — no natural board-filling death, the speed ramp is the only
  pressure. Not treated as a bug.
- **Turbo interaction:** Fade ages by wall-clock `state.elapsed`, shared
  across all snakes regardless of individual tick rate, so boosting
  doesn't distort fade timing. Classic's cap is a cell-count, so a
  boosting snake's tail simply chases its head faster — no special
  handling needed in either the round engine or `trail.js`.
- **Post-death ticking:** rounds end the instant `alive.length <= 1`
  (`Round.resolve`), so a live snake never continues ticking — and
  therefore never trims — after an opponent has died. No cross-snake
  trail interaction to handle.
- **CPU scoring:** untouched. `CPU.chooseDirection` re-scores from current
  board state every tick, which remains correct as trails shrink or grow.

## Testing plan

- **New `tests/trail.test.js`:**
  - Classic mode: `trim` pops from the front while `body.length >
    CLASSIC_LENGTH`, unlights each popped cell on the board, and never
    pops below 1 cell.
  - Fade mode: cells younger than `FADE_SECONDS` are untouched; cells at
    or past the threshold are popped and unlit; verifies behavior is
    driven by the passed `elapsedSec`, not wall-clock or call count.
  - Tron mode (and no mode / default): `body` and `board.lit` are
    completely unchanged regardless of age or length.
- **`tests/round.test.js`:** extend to confirm `trailMode` threads through
  `createRound`, and that repeated `tick`/`tickSingle` calls in fade/
  classic modes actually shrink `snake.body` and clear the corresponding
  cells from `board.lit` — while confirming existing Tron-mode tests still
  pass unmodified (no `elapsedSec` argument needed).
- **`tests/renderer.test.js`:** add pure tests for `fadeAlpha` — full
  opacity before the telegraph window, linear ramp down to the floor
  within it, floor (never 0) once expired.

## Files touched

- `src/trail.js` (new)
- `src/snake.js` (stamp `t` on creation)
- `src/round.js` (accept `trailMode`/`elapsedSec`, stamp + call `Trail.trim`)
- `src/renderer.js` (fade alpha in `drawSnake`, new pure `fadeAlpha` export)
- `src/main.js` (state, menu wiring, pass `elapsedSec` into tick/render calls)
- `index.html` (new script tag, new toggle markup)
- `styles.css` (`.trail-toggle` layout rule alongside existing toggles)
- `tests/trail.test.js` (new)
- `tests/round.test.js`, `tests/renderer.test.js` (extended)

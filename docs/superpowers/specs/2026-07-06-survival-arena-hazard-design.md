# Survival Arena Hazard — Design Spec

Source: user request, "1P survival is too boring."
Applies to: 1P Survival mode (`state.mode === '1p'`) only.

## Summary

Every ~15 seconds of elapsed survival time, the arena gets more dangerous in
one of two ways, chosen at random each time:

- **Border shrink**: the outer boundary contracts inward by one cell, on all
  four sides simultaneously.
- **Center square growth**: a wall square centered on the board grows
  outward by one ring.

New hazard cells telegraph (pulse, non-blocking) for ~1 second before
solidifying into permanent walls. If the snake's head occupies a cell at the
moment it solidifies, the snake dies immediately — "have to be alert for the
border change." Growth stops once the gap between the shrinking border and
the growing square gets too small, so a skilled run isn't guaranteed to be
walled in; it just gets harder and harder.

This mechanic is independent of the existing wall-density menu setting
(procedural interior walls, generated once at round start via `Walls.generate`)
— both can be present in the same round.

## Data model

New pure module `src/hazard.js`, mirroring the existing pure-module pattern
(`walls.js`, `projectile.js`). Hazard state lives at `round.hazard`, attached
in `main.js`'s `newRound()` right after `Round.createRound` (1P mode only —
`round.js` itself stays mode-agnostic and knows nothing about hazards).

```
round.hazard = {
  margin: 0,          // cells the border has shrunk inward, so far
  squareRadius: 0,     // outer ring radius of the center square, so far
  nextEventAt: 15,     // elapsedSec of the next shrink/grow event
  telegraph: null,     // { cells: [{x,y}...], type: 'border'|'square', solidifyAt } | null
  frozen: false,       // true once the safety floor is reached; no more events
}
```

`Hazard.createHazard(width, height)` returns the initial state above (using
board dimensions to compute the center point for the square).

`Hazard.advance(round, elapsedSec, rand)` is called once per game-loop tick
(from `main.js`, guarded to 1P mode only, alongside the existing
bolt/powerup advancement calls around the `!isOnline()` block). It:

1. If `hazard.telegraph` is set and `elapsedSec >= telegraph.solidifyAt`:
   light all `telegraph.cells` onto the board (`Board.light`, plus append to
   `round.board.walls` so the renderer draws them as normal walls). If the
   surviving snake's current head cell is among them, set `snake.alive =
   false` and call `Round.resolve(round)` (same path a normal crash takes,
   so `endRound()` in main.js fires unchanged). Clear `telegraph`.
2. Else if `!hazard.frozen && elapsedSec >= hazard.nextEventAt` and there is
   no pending telegraph: compute the safety-floor gap (see below). If the
   gap is already at/below the floor, set `hazard.frozen = true` and stop
   (no more events, ever, for this round). Otherwise pick `'border'` or
   `'square'` at random via `rand()`, compute that type's next ring of
   cells, skip any cells already lit (already-solid walls/trail don't need
   re-lighting — see Edge Cases), and set `hazard.telegraph = { cells, type,
   solidifyAt: elapsedSec + TELEGRAPH_SEC }`. Increment the counter
   (`margin` or `squareRadius`) immediately (the ring is "claimed" as soon as
   it telegraphs, so a second event can't double-claim the same ring while
   telegraph is pending). Schedule `nextEventAt += EVENT_INTERVAL_SEC`.

Constants: `EVENT_INTERVAL_SEC = 15`, `TELEGRAPH_SEC = 1`,
`SAFETY_FLOOR_GAP = 6` (cells).

### Ring math

- **Border ring at margin `m`**: all cells `{x, y}` with `x < m || y < m ||
  x >= width - m || y >= height - m`, restricted to exactly the newly-added
  ring (i.e. `min(x, y, width-1-x, height-1-y) === m - 1` after incrementing,
  or equivalently compute the ring at the *old* margin before incrementing).
- **Square ring at radius `r`** (`r >= 1`): all cells with Chebyshev distance
  `max(|x - cx|, |y - cy|) === r` from board center `(cx, cy)`, clipped to
  the board. `r = 0` (center point only) is never emitted as its own ring —
  the first square event goes straight to `r = 1`, an 8-cell ring around the
  center point, since a single center cell is a negligible hazard.

### Safety floor

Before generating a new ring of either type, compute:

```
innerHalfWidth  = (width  / 2) - margin
innerHalfHeight = (height / 2) - margin
gap = min(innerHalfWidth, innerHalfHeight) - squareRadius
```

If `gap <= SAFETY_FLOOR_GAP`, freeze (no more events). This is a
conservative, symmetric approximation (real min gap varies by direction
since width/height differ and the square is centered), which is fine — the
goal is "stop before the two hazards can plausibly meet," not precise
geometry.

## Rendering

- Solidified hazard cells need **no new renderer code**: they're appended to
  `round.board.walls`, which `Renderer.drawWalls` already iterates.
- Telegraph (pending) cells need a small addition to `renderer.js`: a
  pulsing highlight pass reading `round.hazard.telegraph.cells`, drawn after
  walls/trails but before the snakes, similar in spirit to the existing
  transient `flashes` markers. Suggested treatment: alpha pulses via
  `Math.sin` keyed off elapsed time, in a color distinct from normal walls
  (e.g. a warning red/amber) so it reads as "incoming," not "already solid."

## Edge cases

- **Telegraph cell already lit** (e.g. ring overlaps an existing interior
  wall or old trail): still included in `telegraph.cells` for rendering
  consistency, but `Board.light` on an already-lit cell is a no-op, and it's
  only pushed into `board.walls` if not already present (avoid duplicate
  entries — check `board.walls` doesn't already contain that cell before
  appending). No functional difference; it was already impassable.
- **Telegraph cell is the snake's own trail** (not the head): no kill: only
  the head cell is checked at solidify time. The trail cell simply stays lit
  (already was).
- **Round ends mid-telegraph** (snake crashes into something else before the
  telegraph resolves): `Hazard.advance` simply isn't called again once
  `round.over` is true (the main loop returns from the tick loop on crash
  before reaching the hazard-advance call), so a pending telegraph just
  never resolves. No cleanup needed.
- **Frozen state**: once `hazard.frozen` is true, `Hazard.advance` becomes a
  no-op for the rest of the round (checked first, cheap early return).

## Testing

`tests/hazard.test.js` (pure, no DOM), covering:

- Border ring cells at a given margin match the expected perimeter set.
- Square ring cells at a given radius match the expected Chebyshev-distance
  set, clipped to board bounds.
- Telegraph → solidify timing: cells aren't in `board.lit`/`board.walls`
  until `solidifyAt` has passed.
- Instant kill: a snake head placed on a telegraphed cell dies when that
  cell solidifies; a snake elsewhere survives.
- Safety floor: once the computed gap is at/below `SAFETY_FLOOR_GAP`,
  `advance` freezes and produces no further telegraphs, indefinitely.
- Deterministic given a seeded `rand`, matching the existing convention in
  `walls.js`/`cpu.js` tests.

## Out of scope

- CPU/2P/Gauntlet/Online modes — this is 1P Survival only, per the request.
- A menu toggle to disable it — always-on, per the request.
- Escalating event frequency — fixed 15s cadence, per the request.
- Precise (non-approximate) safety-floor geometry.

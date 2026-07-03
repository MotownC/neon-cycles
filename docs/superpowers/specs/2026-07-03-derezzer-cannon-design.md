# Derezzer Cannon — Design Spec

Source: IDEAS.md #1. Full scope: trail-cutting bolts, head-hit stun, ammo economy.
Applies to all three modes (1P Survival, 1P vs CPU, local 2P).

## Summary

Each snake can fire a forward-traveling energy bolt from its head. A bolt that
hits a lit cell (trail, wall — same `lit` Set, no distinction needed) unlights
a 3-cell gap starting at the impact point, continuing in the bolt's direction,
clipped to the board. A bolt that hits a living snake's head directly stuns
that snake (slows its ticking for 2s) instead of cutting a gap. Ammo is scarce:
1 bolt to start, +1 every 15s survived, capped at 3.

Stun's implementation differs slightly by turbo setting: in turbo mode (per-snake
tick accumulators) a stunned snake ticks at a slower but nonzero rate; in the
default non-turbo mode (shared tick accumulator) a stunned snake fully freezes
for the 2s duration instead, since the shared-tick model can't express a
sub-interval slowdown. Both are meaningfully "you're an easy target for 2s" —
the non-turbo freeze is simply the harsher of the two, and that's accepted as
the natural translation of the mechanic into that ticking model.

In 1P Survival (no opponent), the mechanic still applies: the only cuttable
target is the player's own trail/walls, giving a way to carve an escape from a
self-boxed corner.

## Data model

- `round.bolts`: array of `{ ownerIndex, pos: {x, y}, dir }`, initialized empty
  in `Round.createRound`.
- `round.firedCount`: array, one entry per snake, counting bolts fired so far.
  Ammo available is derived, not stored:
  `available = min(3, 1 + floor(elapsedSec / 15)) - firedCount[i]`.
- `snake.stunnedUntil`: elapsedSec timestamp set on a direct head hit. While
  `elapsedSec < stunnedUntil`, the snake's effective tick interval is slowed
  (`tickInterval / Speed.TURBO_MULTIPLIER` — turbo's speedup applied in
  reverse). Stun does not grant invincibility; a stunned snake can still crash
  normally.

No changes to `Board`: interior walls and trails are already the same `lit`
Set, so cutting a "wall" and cutting a "trail" are the same `Board.unlight`
call.

## New pure module: `src/projectile.js`

Follows the standard UMD wrapper (matching `board.js`, `geometry.js`, etc.),
depends on `Geometry` and `Board`.

- `createBolt(ownerIndex, head, dir)` — spawns one cell ahead of the head, in
  the snake's current direction.
- `ammoAvailable(elapsedSec, firedCount)` — the regen formula above.
- `advanceBolts(round, elapsedSec)` — advances every active bolt one cell:
  - Out of bounds → despawn. No wraparound, no bounce.
  - Lands on a living snake's head → set `stunnedUntil = elapsedSec + 2` on
    that snake, despawn the bolt.
  - Lands on a lit cell → `Board.unlight` that cell plus the next 2 cells
    continuing straight in the bolt's direction, clipped at board edges,
    despawn the bolt.
  - Otherwise → bolt moves forward one cell, stays active.
  - Bolts never collide with each other; they pass through freely.
- `fire(round, index, elapsedSec)` — no-ops if `ammoAvailable` is 0; otherwise
  pushes a new bolt via `createBolt` and increments `firedCount[index]`.

Test coverage (`tests/projectile.test.js`, `node:test`):
- Spawn position/direction correctness.
- Gap-cutting math, including clipping at board edges.
- Stun timestamp set on head hit.
- Ammo formula: starting value, regen timing, cap at 3, decrement on fire.
- Boundary despawn (no wraparound).
- Bolt stepping through empty cells without side effects.
- Firing with 0 ammo is a no-op.

## Tick-loop integration (`main.js`)

Bolts need their own clock, decoupled from the turbo/shared-tick split, since
they must advance every frame regardless of which snake is currently ticking.

- Add one shared accumulator, `state.boltAcc`.
- Bolt interval = `Speed.tickInterval(elapsedSec) / 3`, recomputed each frame
  the same way `turboInterval` already is.
- When the accumulator fires, call `Projectile.advanceBolts(round, elapsedSec)`.

Stun affects tick pacing: wherever `main.js` currently selects `turboInt` vs.
`normalInt` per snake, add a check — if `snake.stunnedUntil > state.elapsed`,
substitute the stunned interval instead of the normal one.

## Input

`src/input.js`:
- Add fire key mapping: `FIRE = { 0: 'Slash', 1: 'KeyQ' }` (P1 `/`, P2 `Q`).
- Edge-triggered on `keydown` (existing `e.repeat` guard already applies).
- New handler: `handlers.onFire(playerIndex)`.

`src/main.js`:
- Implement `onFire` — calls `Projectile.fire(round, i, state.elapsed)` when
  `state.phase === 'playing'`.

## CPU firing logic (`src/cpu.js`)

Add `CPU.shouldFire(round, index)`: fires when the Voronoi score of the CPU's
best available move (from the existing `scoreMove`/`chooseDirection` logic)
is negative — i.e., the CPU is currently losing territory — and ammo is
available. No new scoring machinery; reuses the existing heuristic.

`main.js` calls this once per CPU decision point and invokes `Projectile.fire`
when it returns true.

## Renderer (`src/renderer.js`)

- Draw each active bolt as a small bright streak/pixel in the owner's color,
  oriented along its travel direction.
- Draw a brief spark/flash at a successful cut or stun landing point.

## HUD (`src/main.js`)

- Add an ammo pip indicator per player (e.g. `●●○` for 2/3), rendered next to
  the existing turbo tag in the same HUD string builder that produces
  `turboTag`.

## Audio (`src/audio.js`)

- A short procedural "fire" SFX on launch.
- A distinct "derez crackle" SFX on a successful cut or stun, generated the
  same procedural way as existing crash SFX (no audio samples).

## Edge cases

- Firing with 0 ammo: no-op, no SFX.
- Gap-cutting near board edges: clip to valid cells only, never touch
  out-of-bounds coordinates.
- Stunned snake still dies normally on collision — stun only slows ticking.
- Solo Survival: bolts can only affect the player's own trail/walls (no
  opponent snake exists to hit).
- `Round.tickSingle` (turbo path) does not need bolt-specific changes; bolt
  advancement is fully decoupled onto its own accumulator in `main.js`.

## Out of scope (deferred to later ideas)

- Ammo pickups (idea #3) — not part of this pass; ammo regen is purely
  time-based here.
- Bolt-vs-bolt collisions.
- Any menu toggle to disable the cannon — it's a core mechanic in this pass,
  not optional, consistent with how turbo is always available.

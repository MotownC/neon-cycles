# Bolt Bounce & Lifetime — Design Spec

Follow-up to the [derezzer cannon](2026-07-03-derezzer-cannon-design.md) and
[fire delay](2026-07-03-fire-delay-design.md) work. Applies to all three
modes (1P Survival, 1P vs CPU, local 2P).

## Summary

Currently a bolt despawns the instant it would leave the arena boundary
(`advanceBolts` returns `false` on an out-of-bounds `next` cell). This change
makes bolts bounce off the boundary instead of despawning, and gives every
bolt a flat 15-second lifetime from the moment it's fired, after which it
silently disappears regardless of how many times it bounced.

Trail- and wall-cutting behavior is unchanged: a bolt that hits any lit cell
(trail or interior wall — same `lit` Set) still cuts a 3-cell gap and
despawns immediately, exactly as today. Only the arena boundary reflects;
interior walls and trails still consume the bolt on contact. A direct hit on
a living snake's head still stuns and despawns the bolt, unchanged.

## Data model

- `round.bolts` entries gain a `spawnedAt` field: the `elapsedSec` value at
  the moment `Projectile.fire` created the bolt.
- New constant `BOLT_LIFETIME_SEC = 15` in `src/projectile.js`.

## `src/projectile.js` changes

- `createBolt(ownerIndex, head, dir, spawnedAt)` — adds `spawnedAt` to the
  returned object.
- `fire(round, index, elapsedSec)` — passes `elapsedSec` through to
  `createBolt` as `spawnedAt`.
- `advanceBolts(round, elapsedSec)`, per bolt, in order:
  1. **Lifetime check first:** if `elapsedSec - bolt.spawnedAt >=
     BOLT_LIFETIME_SEC`, despawn silently (no outcome pushed) — same
     no-ceremony despawn as an out-of-bounds exit today. This is a hard cap
     from the firing moment; bouncing does not extend it.
  2. Compute `next = G.nextHead(bolt.pos, bolt.dir)`.
  3. **Boundary bounce:** if `next` is out of bounds, flip
     `bolt.dir = G.opposite(bolt.dir)`, recompute `next` from `bolt.pos`
     using the new direction (guaranteed in-bounds, since it steps back
     toward a cell the bolt already legally occupied), push
     `{ type: 'bounce', pos: next }` to outcomes, and continue processing
     this tick using the new `next` (so a bolt can bounce and, on the same
     tick, still be checked against a victim/lit cell one step in).
  4. Victim (head-hit stun) and lit-cell (gap-cut) checks proceed exactly as
     today, using the (possibly bounced) `next`.
- No changes to `ammoAvailable`, `FIRE_DELAY_SEC`, or the gap-cut/stun logic
  themselves.

## `src/audio.js` changes

- New `bounceSfx()`: a short, subtle tone (quick high-pitched blip with fast
  decay), following the same procedural pattern as `fireSfx`/`derezSfx`, but
  audibly distinct from the derez crackle (`derezSfx` is noise + a low
  sawtooth tone; `bounceSfx` is a quick clean high tone only — no noise
  layer).

## `src/main.js` changes

- The existing call site:
  ```js
  const outcomes = Projectile.advanceBolts(state.round, state.elapsed);
  if (outcomes.length) Audio.derezSfx();
  ```
  becomes a per-outcome dispatch:
  ```js
  const outcomes = Projectile.advanceBolts(state.round, state.elapsed);
  outcomes.forEach((o) => (o.type === 'bounce' ? Audio.bounceSfx() : Audio.derezSfx()));
  ```
  This also fixes a latent minor issue where multiple simultaneous outcomes
  in one tick only played one sound total; now each outcome plays its own
  cue.

## Renderer

No changes needed. `drawBolts` already draws from each bolt's current
`pos`/`dir` every frame, so a bounced bolt visually reverses on screen for
free. No flash/spark effect is added — consistent with the fact that cuts
and stuns don't have one today either (sound-only feedback throughout).

## Edge cases

- A bolt can only breach one axis per step (movement is axis-aligned), so at
  most one bounce is ever needed per tick — no corner/double-bounce
  handling required.
- A bolt that expires exactly on the tick it would otherwise have hit
  something simply expires first (lifetime check runs before movement) —
  accepted as the natural consequence of a hard cap.
- Bounced bolts are otherwise ordinary bolts: they still count toward
  nothing else (no interaction with ammo, CPU scoring, or `firedCount`).

## Test coverage

Add to `tests/projectile.test.js`:
- A bolt moving into the right/left/top/bottom boundary reflects direction
  (`Geometry.opposite`) and steps back into bounds, producing a `bounce`
  outcome, instead of despawning.
- A bolt reaches `elapsedSec - spawnedAt >= 15` and despawns with no
  outcome, even if it's mid-flight in open space.
- A bolt just under the 15s mark (`elapsedSec - spawnedAt = 14.9`) is left
  untouched.
- Existing bolt-literal fixtures in this file get an explicit
  `spawnedAt: 0` field for clarity (previously omitted; harmless today since
  a missing value made the new lifetime check compare against `NaN`, which
  is always false, but explicit is clearer and matches real bolt shape).

## Out of scope

- Any visual flash/spark effect (matches existing cut/stun precedent of
  sound-only feedback).
- Bouncing off interior walls or trails — only the arena boundary reflects.
- Any change to ammo economy, fire delay, CPU firing logic, or the HUD.

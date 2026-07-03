# Fire Delay — Design Spec

Small follow-up to the [derezzer cannon](2026-07-03-derezzer-cannon-design.md) mechanic.
Applies to all three modes (1P Survival, 1P vs CPU, local 2P).

## Problem

With the cannon live, both cycles start a round holding 1 ammo (per the
existing `ammoAvailable` regen formula, which grants 1 ammo at `elapsedSec = 0`)
and can fire the instant the round begins. In 2P this means both players can
shoot each other before either has had a chance to move or react.

## Fix

Add a flat 5-second firing lockout from round start, applied in
`Projectile.fire`.

- New constant in `src/projectile.js`: `FIRE_DELAY_SEC = 5`.
- `fire(round, index, elapsedSec)` no-ops (no bolt spawned, `firedCount`
  unchanged, no SFX) if `elapsedSec < FIRE_DELAY_SEC`, checked before the
  existing `ammoAvailable` check.

This is the single choke point both firing paths already go through — human
input (`main.js` `onFire` → `Projectile.fire`) and CPU (`CPU.shouldFire` →
`Projectile.fire`) — so one check in the pure, tested module covers both.

## Non-changes

- `ammoAvailable`/regen formula is untouched: ammo still accrues from
  `elapsedSec = 0` per the existing formula. The lockout only blocks
  *spending* it, not earning it. At `elapsedSec = 5` a player has whatever
  ammo the formula would already grant (1, unchanged from before this fix).
- No HUD change: ammo pips display normally throughout. Firing during the
  lockout is silently a no-op, same as firing with 0 ammo already is today —
  no new visual state to communicate.
- `CPU.shouldFire` is untouched. It may still return `true` during the
  lockout and call `Projectile.fire`, which will simply no-op.

## Test coverage

Add to `tests/projectile.test.js`:
- Firing at `elapsedSec < 5` with ammo available is a no-op: no bolt pushed,
  `firedCount` unchanged.
- Firing at `elapsedSec >= 5` behaves exactly as before (existing coverage
  should already exercise this at `elapsedSec` values >= 5, but add an
  explicit boundary case at `elapsedSec === 5`).

## Out of scope

- Any HUD/countdown indicator for the lockout.
- Per-mode variation (e.g. no lockout in Solo Survival) — the delay applies
  uniformly everywhere the cannon exists.

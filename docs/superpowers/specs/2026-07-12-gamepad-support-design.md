# Gamepad Support — Design Spec

Source: IDEAS.md #9 (gamepad half only; touch is a separate follow-up).
Applies to all local modes (1P Survival, 1P vs CPU, local 2P, Gauntlet). Online
mode gets steering "for free" since it shares the same `onDirection` callback,
but turbo/fire stay disabled online regardless of input source (existing v1
constraint, unrelated to this change).

## Summary

Add `Input.pollGamepads(handlers)` to `src/input.js`, using the exact same
`{ onDirection, onAction, onTurbo, onFire }` shape `Input.attach` already
takes. `main.js` calls it once per frame from the top of `loop(now)`,
unconditional of `state.phase` — each handler already self-guards by phase
(e.g. `onFire` no-ops outside `'playing'`), so polling every frame regardless
of phase is safe and requires no new phase logic in `input.js`.

Keyboard and gamepad are both always active, feeding the same two player
slots — no exclusivity, no mode switch. A player can steer with WASD one
round and a controller the next without any menu action.

## Player mapping

Each poll: read `navigator.getGamepads()`, drop nulls, sort by `.index`
ascending. First connected pad → player slot 0, second → slot 1. A third+ pad
is ignored (only two player slots exist).

## Steering — d-pad + left stick, edge-detected

Per mapped slot, compute the "currently pointed direction" from whichever is
active:
- **D-pad**: standard mapping buttons 12 (up) / 13 (down) / 14 (left) / 15 (right).
- **Left stick**: axes 0 (x) / 1 (y), deadzone 0.5, dominant axis wins (larger
  absolute value of the two; a tie yields no direction).

`pollGamepads` keeps a small internal per-slot `prevDir` cache (module-level
state in `input.js`, mirroring nothing external) and calls
`handlers.onDirection(slot, dir)` **only on a transition** into a new
direction — never every frame while held. This mirrors keyboard's `e.repeat`
guard: `Snake.bufferDirection`'s 3-deep queue would flood instantly if fed a
direction every tick while the stick/d-pad is held.

Reversal rejection (can't reverse directly into your own trail) is unchanged
— it already lives in `Snake.bufferDirection`, shared by every input source.

## Turbo — level-triggered

RB (button 5) OR RT (button 7) held → `onTurbo(slot, true)`. Both released →
`onTurbo(slot, false)`. Matches Shift key press/release semantics exactly
(`main.js`'s `onTurbo` handler already no-ops when `!state.turboEnabled` or
online).

## Fire + confirm — A button, edge-triggered

Button 0 (A), on a fresh press only (edge-detected the same way as steering):
call **both** `handlers.onFire(slot)` and `handlers.onAction()`. Safe because
each already ignores calls outside its relevant phase — `onFire` only acts
mid-round with a live snake, `onAction` only acts on `roundover`/`gameover`.
One button serves both purposes without any mode switch, the same way
Enter/Space and Slash/Q are separate keyboard bindings for the same two
callbacks today.

## Explicitly out of scope

- No menu button navigation (mode/wall/rival buttons stay mouse/keyboard-only).
- No on-screen "gamepad connected" indicator.
- No rumble/vibration.
- No remapping UI.
- Touch controls (rest of IDEAS.md #9) — separate future spec.

## Testing

`input.js`/`main.js` are the browser-only half of the codebase per project
convention (no `node:test` coverage — DOM/hardware access, not pure logic).
This change follows that pattern: no unit tests. Verification is manual, in
the browser preview, with a real Xbox controller.

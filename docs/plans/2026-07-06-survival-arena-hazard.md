# Survival Arena Hazard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make 1P Survival mode progressively more dangerous by periodically shrinking the border or growing a center wall square, with a telegraph warning before cells solidify.

**Architecture:** A new pure module `src/hazard.js` (no DOM/canvas access) owns all the ring-math and timing state, mirroring the existing `walls.js`/`projectile.js` pattern. It mutates `round.board` (adds wall cells) and `snake.alive`/`snake.crushedByHazard` directly — the same way `projectile.js` already does — so the existing tick-loop/end-of-round machinery in `main.js` and `round.js` needs no changes beyond one new call site. A small renderer addition draws the 1-second telegraph pulse before cells go solid.

**Tech Stack:** Vanilla JS (UMD module pattern), `node:test` for unit tests, HTML5 canvas for the telegraph pulse.

Reference: [docs/superpowers/specs/2026-07-06-survival-arena-hazard-design.md](../superpowers/specs/2026-07-06-survival-arena-hazard-design.md)

---

## Task 1: `hazard.js` — ring math (border + square)

**Files:**
- Create: `src/hazard.js`
- Test: `tests/hazard.test.js`

**Step 1: Write the failing tests**

```js
const assert = require('node:assert');
const { test } = require('node:test');
const H = require('../src/hazard');

test('borderRing at margin 0 is the full outer perimeter', () => {
  const cells = H.borderRing(6, 4, 0);
  const set = new Set(cells.map((c) => c.x + ',' + c.y));
  assert.strictEqual(cells.length, 2 * 6 + 2 * 4 - 4); // perimeter, no double-counted corners
  for (let x = 0; x < 6; x++) { assert.ok(set.has(`${x},0`)); assert.ok(set.has(`${x},3`)); }
  for (let y = 0; y < 4; y++) { assert.ok(set.has(`0,${y}`)); assert.ok(set.has(`5,${y}`)); }
  assert.ok(!set.has('1,1')); // interior cell not included
});

test('borderRing at margin 1 is one ring further in', () => {
  const cells = H.borderRing(6, 4, 1);
  const set = new Set(cells.map((c) => c.x + ',' + c.y));
  assert.ok(set.has('1,1'));
  assert.ok(set.has('4,1'));
  assert.ok(!set.has('0,0')); // outermost ring not re-included
});

test('squareRing at radius 1 is the 8-cell ring around the center', () => {
  const cells = H.squareRing(20, 14, 10, 7, 1);
  const set = new Set(cells.map((c) => c.x + ',' + c.y));
  assert.strictEqual(cells.length, 8);
  for (const [x, y] of [[9,6],[10,6],[11,6],[9,7],[11,7],[9,8],[10,8],[11,8]]) {
    assert.ok(set.has(`${x},${y}`), `missing ${x},${y}`);
  }
});

test('squareRing clips cells outside the board', () => {
  const cells = H.squareRing(6, 4, 0, 0, 1); // center at corner, ring mostly off-board
  for (const c of cells) {
    assert.ok(c.x >= 0 && c.x < 6 && c.y >= 0 && c.y < 4);
  }
  assert.ok(cells.length > 0 && cells.length < 8);
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test tests/hazard.test.js`
Expected: FAIL — `Cannot find module '../src/hazard'`

**Step 3: Write minimal implementation**

```js
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  // Perimeter of the rectangle inset by `m` cells on every side — i.e. the
  // ring that becomes solid on the (m+1)th border-shrink event.
  function borderRing(width, height, m) {
    const cells = [];
    for (let x = m; x < width - m; x++) {
      cells.push({ x, y: m });
      cells.push({ x, y: height - 1 - m });
    }
    for (let y = m + 1; y < height - 1 - m; y++) {
      cells.push({ x: m, y });
      cells.push({ x: width - 1 - m, y });
    }
    return cells;
  }

  // Outline of the square at Chebyshev distance `r` from (cx, cy), clipped
  // to the board. r must be >= 1 (r = 0 would just be the center point).
  function squareRing(width, height, cx, cy, r) {
    const cells = [];
    const inBounds = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
    for (let x = cx - r; x <= cx + r; x++) {
      if (inBounds(x, cy - r)) cells.push({ x, y: cy - r });
      if (inBounds(x, cy + r)) cells.push({ x, y: cy + r });
    }
    for (let y = cy - r + 1; y <= cy + r - 1; y++) {
      if (inBounds(cx - r, y)) cells.push({ x: cx - r, y });
      if (inBounds(cx + r, y)) cells.push({ x: cx + r, y });
    }
    return cells;
  }

  return { __name: 'Hazard', borderRing, squareRing };
});
```

**Step 4: Run tests to verify they pass**

Run: `node --test tests/hazard.test.js`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/hazard.js tests/hazard.test.js
git commit -m "feat: add hazard ring math for arena shrink/grow"
```

---

## Task 2: `hazard.js` — timing, telegraph, safety floor

**Files:**
- Modify: `src/hazard.js`
- Test: `tests/hazard.test.js`

**Step 1: Write the failing tests**

Append to `tests/hazard.test.js`:

```js
const B = require('../src/board');

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function makeRound(width, height, headPos) {
  const board = B.createBoard(width, height, []);
  const snake = { alive: true, body: [headPos] };
  return { board, snakes: [snake] };
}

test('createHazard starts with no telegraph, first event at 15s', () => {
  const hz = H.createHazard(20, 14);
  assert.strictEqual(hz.telegraph, null);
  assert.strictEqual(hz.nextEventAt, 15);
  assert.strictEqual(hz.frozen, false);
});

test('advance schedules a telegraph at the event time but does not solidify yet', () => {
  const round = makeRound(20, 14, { x: 0, y: 0 });
  const hz = H.createHazard(20, 14);
  H.advance(round, hz, 15, () => 0.9); // 0.9 >= 0.5 -> 'square'
  assert.ok(hz.telegraph);
  assert.strictEqual(hz.telegraph.type, 'square');
  assert.strictEqual(round.board.walls.length, 0); // not solid yet
});

test('advance solidifies the telegraphed cells one second later', () => {
  const round = makeRound(20, 14, { x: 0, y: 0 });
  const hz = H.createHazard(20, 14);
  H.advance(round, hz, 15, () => 0.1); // 0.1 < 0.5 -> 'border'
  H.advance(round, hz, 16, () => 0.1);
  assert.strictEqual(hz.telegraph, null);
  assert.ok(round.board.walls.length > 0);
  assert.ok(B.isLit(round.board, { x: 0, y: 0 }));
});

test('a snake head on a solidifying cell dies and is flagged', () => {
  const round = makeRound(20, 14, { x: 0, y: 0 }); // corner is on the border ring at margin 0
  const hz = H.createHazard(20, 14);
  H.advance(round, hz, 15, () => 0.1); // border
  H.advance(round, hz, 16, () => 0.1); // solidify
  assert.strictEqual(round.snakes[0].alive, false);
  assert.strictEqual(round.snakes[0].crushedByHazard, true);
});

test('a snake head elsewhere survives the same event', () => {
  const round = makeRound(20, 14, { x: 10, y: 7 }); // dead center, far from the border ring
  const hz = H.createHazard(20, 14);
  H.advance(round, hz, 15, () => 0.1);
  H.advance(round, hz, 16, () => 0.1);
  assert.strictEqual(round.snakes[0].alive, true);
});

test('advance freezes once the safety floor is reached and stops changing the board', () => {
  const round = makeRound(20, 14, { x: 10, y: 7 });
  const hz = H.createHazard(20, 14);
  let t = 15;
  const rand = seeded(1);
  for (let i = 0; i < 50 && !hz.frozen; i++) {
    H.advance(round, hz, t, rand);      // schedule (or freeze)
    if (hz.telegraph) H.advance(round, hz, t + 1, rand); // solidify
    t += 15;
  }
  assert.strictEqual(hz.frozen, true);
  const wallsBefore = round.board.walls.length;
  H.advance(round, hz, t + 100, rand);
  assert.strictEqual(round.board.walls.length, wallsBefore); // no further changes
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test tests/hazard.test.js`
Expected: FAIL — `H.createHazard is not a function` (and related)

**Step 3: Write minimal implementation**

Replace the `return` statement in `src/hazard.js` and add above it:

```js
  const EVENT_INTERVAL_SEC = 15;
  const TELEGRAPH_SEC = 1;
  const SAFETY_FLOOR_GAP = 6;

  function createHazard(width, height) {
    return {
      margin: 0,
      squareRadius: 0,
      cx: (width / 2) | 0,
      cy: (height / 2) | 0,
      nextEventAt: EVENT_INTERVAL_SEC,
      telegraph: null,
      frozen: false,
    };
  }

  // Conservative approximation of "how much open space is left between the
  // shrinking border and the growing square" — not exact geometry, just
  // enough to stop before the two can plausibly meet.
  function computeGap(width, height, margin, squareRadius) {
    const innerHalfWidth = width / 2 - margin;
    const innerHalfHeight = height / 2 - margin;
    return Math.min(innerHalfWidth, innerHalfHeight) - squareRadius;
  }

  function solidify(round, hazard) {
    const { board, snakes } = round;
    const { cells } = hazard.telegraph;
    for (const c of cells) {
      if (!board.walls) board.walls = [];
      // Light unconditionally (idempotent) so a hazard ring permanently
      // claims the cell even if it was previously just trail (which can
      // later be trimmed/unlit); only guard against duplicate wall entries.
      B.light(board, c);
      if (!board.walls.some((w) => w.x === c.x && w.y === c.y)) board.walls.push(c);
    }
    hazard.telegraph = null;
    for (const snake of snakes) {
      if (!snake.alive) continue;
      const head = snake.body[snake.body.length - 1];
      if (cells.some((c) => c.x === head.x && c.y === head.y)) {
        snake.alive = false;
        snake.crushedByHazard = true;
      }
    }
  }

  function scheduleNext(round, hazard, elapsedSec, rand) {
    const { board } = round;
    const gap = computeGap(board.width, board.height, hazard.margin, hazard.squareRadius);
    if (gap <= SAFETY_FLOOR_GAP) { hazard.frozen = true; return; }
    const type = rand() < 0.5 ? 'border' : 'square';
    let cells;
    if (type === 'border') {
      cells = borderRing(board.width, board.height, hazard.margin);
      hazard.margin += 1;
    } else {
      const r = hazard.squareRadius + 1;
      cells = squareRing(board.width, board.height, hazard.cx, hazard.cy, r);
      hazard.squareRadius = r;
    }
    hazard.telegraph = { cells, type, solidifyAt: elapsedSec + TELEGRAPH_SEC };
    hazard.nextEventAt = elapsedSec + EVENT_INTERVAL_SEC;
  }

  function advance(round, hazard, elapsedSec, rand = Math.random) {
    if (hazard.frozen) return;
    if (hazard.telegraph) {
      if (elapsedSec >= hazard.telegraph.solidifyAt) solidify(round, hazard);
      return;
    }
    if (elapsedSec >= hazard.nextEventAt) scheduleNext(round, hazard, elapsedSec, rand);
  }

  return {
    __name: 'Hazard',
    EVENT_INTERVAL_SEC, TELEGRAPH_SEC, SAFETY_FLOOR_GAP,
    borderRing, squareRing, createHazard, advance,
  };
```

This requires `B` (Board) inside the factory. Update the module header to match the dependency-injection pattern used by `round.js`:

```js
(function (root, factory) {
  const deps = typeof require === 'function'
    ? { B: require('./board') }
    : { B: window.Board };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function ({ B }) {
```

(closing the factory function body with `});` at the end, replacing the old no-deps header from Task 1).

**Step 4: Run tests to verify they pass**

Run: `node --test tests/hazard.test.js`
Expected: PASS (10 tests total)

**Step 5: Run the full suite to check nothing else broke**

Run: `node --test`
Expected: PASS, all existing suites unaffected (hazard.js isn't wired into anything yet)

**Step 6: Commit**

```bash
git add src/hazard.js tests/hazard.test.js
git commit -m "feat: add hazard telegraph timing and safety floor"
```

---

## Task 3: Wire hazard into the game loop (`main.js`)

**Files:**
- Modify: `src/main.js:96` (inside `newRound`, right after `state.round = Round.createRound(...)`)
- Modify: `src/main.js:407-422` (the `!isOnline()` tick-loop block)
- Modify: `src/main.js:256-269` (`crashVerdicts`)
- Modify: `index.html` (add `<script src="src/hazard.js?v=...">` tag, must load after `board.js` and before `main.js`; also bump version — see Task 5)

**Step 1: Attach hazard state in `newRound`**

In `src/main.js`, right after this existing line (currently line 96-97):

```js
    state.round = Round.createRound(COLS, ROWS, specs, walls,
      online ? online.settings.trailMode : state.trailMode);
```

add:

```js
    state.round.hazard = state.mode === '1p' ? Hazard.createHazard(COLS, ROWS) : null;
```

**Step 2: Call `Hazard.advance` in the tick loop**

In the existing `if (!isOnline()) { ... }` block (around line 407-422 currently), after the `frozen = Powerups.frozenIndices(...)` line, add:

```js
      if (state.mode === '1p') Hazard.advance(state.round, state.round.hazard, state.elapsed, Math.random);
```

**Step 3: Recognize the hazard kill in crash traces**

In `crashVerdicts()` (currently starting at line 256), add a check before the existing `shotBy` check:

```js
    return state.round.snakes.map((s) => {
      if (s.alive) return 'alive';
      if (s.crushedByHazard) return 'caught by the closing arena';
      if (s.shotBy !== undefined) return `shot down by ${label(s.shotBy)}'s bolt`;
      ...
```

**Step 4: Add the script tag**

In `index.html`, add a new line right after `<script src="src/board.js?v=...">` (before `trail.js`):

```html
  <script src="src/hazard.js?v=0.16.0"></script>
```

(Version bump to `0.16.0` happens in Task 5 — for now just add the tag using whatever the current version is; Task 5 will bump every `?v=` tag together including this new one.)

**Step 5: Manual smoke test — run the full suite**

Run: `node --test`
Expected: PASS (no existing test touches `main.js`, since it's browser-only and untested per the project's own conventions — this just confirms the pure-module suite is still green)

**Step 6: Commit**

```bash
git add src/main.js index.html
git commit -m "feat: wire arena hazard into 1P survival tick loop"
```

---

## Task 4: Render the telegraph pulse

**Files:**
- Modify: `src/renderer.js:81-84` (near `drawWalls`)
- Modify: `src/renderer.js:191-199` (the `render` function)

**Step 1: Add the draw function**

In `src/renderer.js`, right after the existing `drawWalls` function (currently lines 81-84), add:

```js
  // Cells about to become permanent walls pulse in warning amber for the
  // ~1s telegraph window, distinguishing "incoming" from "already solid".
  function drawHazardTelegraph(ctx, hazard, cell, elapsedSec) {
    if (!hazard || !hazard.telegraph) return;
    const pulse = 0.4 + 0.4 * Math.abs(Math.sin(elapsedSec * 10));
    ctx.save();
    ctx.fillStyle = '#ff9933';
    ctx.shadowColor = '#ff9933';
    ctx.shadowBlur = cell * 1.2;
    ctx.globalAlpha = pulse;
    for (const c of hazard.telegraph.cells) ctx.fillRect(c.x * cell, c.y * cell, cell, cell);
    ctx.restore();
  }
```

**Step 2: Call it from `render`**

In the `render` function (currently around lines 191-199), add the call right after `drawWalls`:

```js
  function render(ctx, round, cell, colors = COLORS, borderColor = '#ff2b4a', elapsedSec = 0, flashes = [], atlas) {
    const { board, snakes, bolts, pickups, frozenUntil, hazard } = round;
    drawGrid(ctx, board.width, board.height, cell, borderColor);
    drawWalls(ctx, board.walls, cell, atlas);
    drawHazardTelegraph(ctx, hazard, cell, elapsedSec);
    drawPickups(ctx, pickups, cell, elapsedSec, atlas);
    ...
```

(only the `const { ... }` destructure and the one new call line change; everything else in `render` stays as-is)

**Step 3: Run the full test suite**

Run: `node --test`
Expected: PASS — `renderer.test.js` doesn't exercise `drawHazardTelegraph` directly since it's a pure visual addition guarded by `if (!hazard...) return;`, so existing renderer tests (which pass rounds without `.hazard`) are unaffected.

**Step 4: Commit**

```bash
git add src/renderer.js
git commit -m "feat: draw pulsing telegraph for incoming hazard cells"
```

---

## Task 5: Version bump

**Files:**
- Modify: `package.json`
- Modify: `index.html` (the `#version` element and every `?v=` query string, including the new `hazard.js` tag from Task 3)

**Step 1: Bump the version everywhere**

Per `CLAUDE.md`: bump `package.json` version, the `#version` element text, and every script/stylesheet `?v=` query string together, from `0.15.1` to `0.16.0`.

- `package.json`: `"version": "0.15.1"` → `"version": "0.16.0"`
- `index.html`: `<p class="hint" id="version">v0.15.1</p>` → `<p class="hint" id="version">v0.16.0</p>`
- `index.html`: every `?v=0.15.1` (including the `hazard.js` tag added in Task 3) → `?v=0.16.0`

**Step 2: Verify no stale references remain**

Run: `grep -rn "0.15.1" index.html package.json`
Expected: no output (empty match)

**Step 3: Commit**

```bash
git add package.json index.html
git commit -m "chore: bump version to 0.16.0 for arena hazard feature"
```

---

## Task 6: Manual browser verification

**Files:** none (verification only)

**Step 1: Start the static preview server and open the game**

Use the `neon-cycles-static` preview config (port 8734). Navigate to the menu, select 1P Survival, and start a round.

**Step 2: Verify the hazard fires**

Let the round run past 15s of elapsed time (visible in the HUD `TIME` counter). Confirm:
- Around t=15s, either the outer ring or a ring around the center pulses amber for ~1 second, then becomes a solid wall tile (same look as procedural interior walls).
- The HUD/console shows no errors (`preview_console_logs`).
- If the player is deliberately steered onto a telegraphed cell as it solidifies, the round ends immediately and the console crash trace (dumped by `endRound`) reports `"caught by the closing arena"` for that snake.

**Step 3: Verify the safety floor (optional, time-permitting)**

Either let a round run long enough (several minutes) or temporarily lower `EVENT_INTERVAL_SEC`/`SAFETY_FLOOR_GAP` in a scratch copy to confirm hazard events stop once the gap is small, rather than crashing or looping forever. Revert any temporary constant changes before finishing.

**Step 4: Stop audio before ending the turn**

Per `CLAUDE.md`: call `window.Audio.stop()` via `preview_eval` (or navigate back to the menu) before ending the session, so the soundtrack doesn't keep playing in the background.

No commit for this task — it's verification only.

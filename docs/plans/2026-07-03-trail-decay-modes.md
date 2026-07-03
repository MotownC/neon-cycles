# Trail Decay Modes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a menu-selectable trail mode (Tron / Fade / Classic) that changes how long a snake's own trail persists, per `docs/superpowers/specs/2026-07-03-trail-decay-modes-design.md`.

**Architecture:** Every body cell gains a `t` (elapsed-seconds) timestamp. A new pure module `src/trail.js` trims a snake's own `body` array from the oldest end — by cell count in Classic mode, by age in Fade mode — reusing the existing `Board.unlight`. `Round.tick`/`Round.tickSingle` stamp new head cells and call the trimmer every tick. The renderer dims aging cells in Fade mode via a pure, testable `fadeAlpha` helper.

**Tech Stack:** Vanilla JS, UMD-style modules (`src/*.js`), `node:test` for pure-module tests, no build step.

---

### Task 1: `src/trail.js` module

**Files:**
- Create: `src/trail.js`
- Create: `tests/trail.test.js`

**Step 1: Write the failing tests**

Create `tests/trail.test.js`:

```js
const assert = require('node:assert');
const { test } = require('node:test');
const T = require('../src/trail');
const B = require('../src/board');

test('tron mode never trims regardless of age or length', () => {
  const board = B.createBoard(50, 50);
  const body = [];
  for (let i = 0; i < 30; i++) body.push({ x: i, y: 0, t: i });
  body.forEach((c) => B.light(board, c));
  const snake = { body, alive: true };
  T.trim(snake, board, 'tron', 1000);
  assert.strictEqual(snake.body.length, 30);
  assert.strictEqual(B.isLit(board, { x: 0, y: 0 }), true);
});

test('classic mode caps body length by popping the oldest cell', () => {
  const board = B.createBoard(50, 50);
  const body = [];
  for (let i = 0; i < T.CLASSIC_LENGTH + 5; i++) body.push({ x: i, y: 0, t: i });
  body.forEach((c) => B.light(board, c));
  const snake = { body, alive: true };
  T.trim(snake, board, 'classic', 1000);
  assert.strictEqual(snake.body.length, T.CLASSIC_LENGTH);
  assert.strictEqual(snake.body[0].x, 5); // oldest 5 cells popped
  assert.strictEqual(B.isLit(board, { x: 0, y: 0 }), false); // popped, unlit
  assert.strictEqual(B.isLit(board, { x: 5, y: 0 }), true);  // kept, still lit
});

test('classic mode is a no-op when already at or under the cap', () => {
  const board = B.createBoard(50, 50);
  const body = [{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: 1 }];
  body.forEach((c) => B.light(board, c));
  const snake = { body, alive: true };
  T.trim(snake, board, 'classic', 1000);
  assert.strictEqual(snake.body.length, 2);
});

test('fade mode pops cells once they reach FADE_SECONDS old', () => {
  const board = B.createBoard(50, 50);
  const body = [{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: 3 }, { x: 2, y: 0, t: 6 }];
  body.forEach((c) => B.light(board, c));
  const snake = { body, alive: true };
  T.trim(snake, board, 'fade', T.FADE_SECONDS); // elapsed = 8
  assert.deepStrictEqual(snake.body.map((c) => c.x), [1, 2]);
  assert.strictEqual(B.isLit(board, { x: 0, y: 0 }), false);
  assert.strictEqual(B.isLit(board, { x: 1, y: 0 }), true);
});

test('fade mode leaves fresh cells untouched', () => {
  const board = B.createBoard(50, 50);
  const body = [{ x: 0, y: 0, t: 0 }];
  B.light(board, body[0]);
  const snake = { body, alive: true };
  T.trim(snake, board, 'fade', T.FADE_SECONDS - 0.01);
  assert.strictEqual(snake.body.length, 1);
});

test('fade mode always leaves at least the head cell', () => {
  const board = B.createBoard(50, 50);
  const body = [{ x: 0, y: 0, t: 0 }]; // only cell, very old
  B.light(board, body[0]);
  const snake = { body, alive: true };
  T.trim(snake, board, 'fade', 1000);
  assert.strictEqual(snake.body.length, 1);
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test tests/trail.test.js`
Expected: FAIL — `Cannot find module '../src/trail'`

**Step 3: Write the implementation**

Create `src/trail.js`:

```js
(function (root, factory) {
  const deps = typeof require === 'function'
    ? { B: require('./board') }
    : { B: window.Board };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function ({ B }) {
  const FADE_SECONDS = 8;
  const CLASSIC_LENGTH = 20;

  // Pop cells from the oldest end of a snake's own trail per the active
  // mode. Always leaves at least the head cell. Never touches board.walls,
  // since it only ever pops from a snake's own body array.
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
    // 'tron' (or anything unrecognized): no-op.
  }

  return { __name: 'Trail', MODES: ['tron', 'fade', 'classic'], FADE_SECONDS, CLASSIC_LENGTH, trim };
});
```

**Step 4: Run tests to verify they pass**

Run: `node --test tests/trail.test.js`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add src/trail.js tests/trail.test.js
git commit -m "feat: add Trail module for fade/classic trail trimming"
```

---

### Task 2: Stamp `t` on snake creation

**Files:**
- Modify: `src/snake.js:6-14` (`createSnake`)
- Modify: `tests/snake.test.js:6-11`

**Step 1: Update the existing test to expect the new field**

In `tests/snake.test.js`, change:

```js
test('createSnake seeds a one-cell body facing a direction', () => {
  const s = S.createSnake({ x: 5, y: 5 }, 'right');
  assert.deepStrictEqual(s.body, [{ x: 5, y: 5 }]);
  assert.strictEqual(s.direction, 'right');
  assert.strictEqual(s.alive, true);
});
```

to:

```js
test('createSnake seeds a one-cell body facing a direction, stamped at t=0', () => {
  const s = S.createSnake({ x: 5, y: 5 }, 'right');
  assert.deepStrictEqual(s.body, [{ x: 5, y: 5, t: 0 }]);
  assert.strictEqual(s.direction, 'right');
  assert.strictEqual(s.alive, true);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/snake.test.js`
Expected: FAIL on the updated test — actual body is `[{ x: 5, y: 5 }]`, missing `t`.

**Step 3: Implement**

In `src/snake.js`, change `createSnake`:

```js
function createSnake(start, direction) {
  return {
    body: [{ ...start, t: 0 }],
    direction,
    pendingDirection: direction,
    queue: [],
    alive: true,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `node --test tests/snake.test.js`
Expected: PASS (all tests, including the fuzz test — `stepSnake` is untouched and doesn't stamp `t`, which is fine since production code never calls it)

**Step 5: Commit**

```bash
git add src/snake.js tests/snake.test.js
git commit -m "feat: stamp snake body cells with an elapsed-time timestamp"
```

---

### Task 3: Wire trail mode and timestamps through the round engine

**Files:**
- Modify: `src/round.js` (whole file — dependency block, `createRound`, `tick`, `tickSingle`)
- Modify: `tests/round.test.js`

**Step 1: Write the failing tests**

In `tests/round.test.js`, add `const B = require('../src/board');` and `const Trail = require('../src/trail');` near the top imports, then add these tests at the end of the file:

```js
test('createRound defaults to tron trail mode', () => {
  const round = setup(10, 10, [{ start: { x: 5, y: 5 }, direction: 'right' }]);
  assert.strictEqual(round.trailMode, 'tron');
});

test('createRound stores the requested trail mode', () => {
  const round = R.createRound(10, 10, [{ start: { x: 5, y: 5 }, direction: 'right' }], [], 'fade');
  assert.strictEqual(round.trailMode, 'fade');
});

test('classic mode trims the tail as the snake advances', () => {
  const round = R.createRound(50, 50, [{ start: { x: 25, y: 25 }, direction: 'right' }], [], 'classic');
  for (let i = 0; i < Trail.CLASSIC_LENGTH + 10; i++) R.tick(round, i);
  assert.strictEqual(round.snakes[0].body.length, Trail.CLASSIC_LENGTH);
});

test('fade mode unlights trail cells once they expire', () => {
  const round = R.createRound(50, 50, [{ start: { x: 5, y: 5 }, direction: 'right' }], [], 'fade');
  // initial cell (5,5) stamped t=0 at creation
  R.tick(round, 1); // head -> (6,5) at t=1; (5,5) is only 1s old
  assert.strictEqual(B.isLit(round.board, { x: 5, y: 5 }), true);
  R.tick(round, Trail.FADE_SECONDS); // (5,5) now FADE_SECONDS old -> popped
  assert.strictEqual(B.isLit(round.board, { x: 5, y: 5 }), false);
  assert.strictEqual(B.isLit(round.board, { x: 6, y: 5 }), true);
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test tests/round.test.js`
Expected: FAIL — `round.trailMode` is `undefined`, classic/fade tests don't trim.

**Step 3: Implement**

Replace the full contents of `src/round.js`:

```js
(function (root, factory) {
  const deps = typeof require === 'function'
    ? { S: require('./snake'), B: require('./board'), G: require('./geometry'), T: require('./trail') }
    : { S: window.Snake, B: window.Board, G: window.Geometry, T: window.Trail };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function ({ S, B, G, T }) {
  function createRound(width, height, specs, walls = [], trailMode = 'tron') {
    const board = B.createBoard(width, height, walls);
    const snakes = specs.map((s) => S.createSnake(s.start, s.direction));
    snakes.forEach((snake) => B.light(board, snake.body[0]));
    return { board, snakes, over: false, winnerIndex: null, trailMode };
  }

  function tick(round, elapsedSec = 0) {
    const { board, snakes } = round;
    // 1. Consume one buffered turn and compute each living snake's next head.
    const intended = snakes.map((snake) =>
      snake.alive ? G.nextHead(snake.body[snake.body.length - 1], S.nextDirection(snake)) : null
    );

    // 2. Kill snakes colliding with board/edge/existing trail.
    intended.forEach((head, i) => {
      if (!snakes[i].alive) return;
      if (B.wouldCollide(board, head)) snakes[i].alive = false;
    });

    // 3. Kill snakes targeting the same cell as another living snake this tick.
    intended.forEach((head, i) => {
      if (!snakes[i].alive) return;
      for (let j = 0; j < intended.length; j++) {
        if (j === i || !snakes[j].alive) continue;
        if (intended[j] && head.x === intended[j].x && head.y === intended[j].y) {
          snakes[i].alive = false;
          snakes[j].alive = false;
        }
      }
    });

    // 4. Advance survivors: apply direction, append head, light the cell,
    //    then trim the trail per the round's trail mode.
    snakes.forEach((snake, i) => {
      if (!snake.alive) return;
      snake.direction = snake.pendingDirection;
      const head = { ...intended[i], t: elapsedSec };
      snake.body.push(head);
      B.light(board, head);
      T.trim(snake, board, round.trailMode, elapsedSec);
    });

    resolve(round);
  }

  function resolve(round) {
    const alive = round.snakes.filter((s) => s.alive);
    if (round.snakes.length === 1) {
      // Solo: round ends when the snake dies.
      if (!round.snakes[0].alive) { round.over = true; round.winnerIndex = null; }
      return;
    }
    if (alive.length <= 1) {
      round.over = true;
      round.winnerIndex = alive.length === 1 ? round.snakes.indexOf(alive[0]) : null;
    }
  }

  // Advance a single snake (used for turbo bonus ticks).
  // Collision is checked for this snake only; the other snake doesn't move.
  function tickSingle(round, index, elapsedSec = 0) {
    const { board, snakes } = round;
    const snake = snakes[index];
    if (!snake || !snake.alive) return;
    const nextHead = G.nextHead(snake.body[snake.body.length - 1], S.nextDirection(snake));
    if (B.wouldCollide(board, nextHead)) { snake.alive = false; resolve(round); return; }
    // Also check collision with other snakes' current trails
    for (let j = 0; j < snakes.length; j++) {
      if (j === index) continue;
      if (snakes[j].body.some((c) => c.x === nextHead.x && c.y === nextHead.y)) {
        snake.alive = false; resolve(round); return;
      }
    }
    snake.direction = snake.pendingDirection;
    const head = { ...nextHead, t: elapsedSec };
    snake.body.push(head);
    B.light(board, head);
    T.trim(snake, board, round.trailMode, elapsedSec);
    resolve(round);
  }

  return { __name: 'Round', createRound, tick, tickSingle, resolve };
});
```

**Step 4: Fix the now-broken pre-existing assertions**

Every tick now stamps `t` on pushed cells (default `0`), so the two pre-existing body assertions need to include it. In `tests/round.test.js`, in the `'tick consumes one buffered direction per tick'` test, change:

```js
  assert.deepStrictEqual(round.snakes[0].body[round.snakes[0].body.length - 1], { x: 5, y: 4 });
  R.tick(round);
  assert.deepStrictEqual(round.snakes[0].body[round.snakes[0].body.length - 1], { x: 4, y: 4 });
```

to:

```js
  assert.deepStrictEqual(round.snakes[0].body[round.snakes[0].body.length - 1], { x: 5, y: 4, t: 0 });
  R.tick(round);
  assert.deepStrictEqual(round.snakes[0].body[round.snakes[0].body.length - 1], { x: 4, y: 4, t: 0 });
```

**Step 5: Run the full suite to verify everything passes**

Run: `node --test`
Expected: PASS — all files, including `round.test.js`, `cpu.test.js`, `trail.test.js`, `snake.test.js`

**Step 6: Commit**

```bash
git add src/round.js tests/round.test.js
git commit -m "feat: thread trail mode and elapsed time through the round engine"
```

---

### Task 4: Renderer fade telegraph

**Files:**
- Modify: `src/renderer.js`
- Modify: `tests/renderer.test.js`

**Step 1: Write the failing tests**

Append to `tests/renderer.test.js`:

```js
test('fadeAlpha is fully opaque outside the telegraph window', () => {
  assert.strictEqual(Renderer.fadeAlpha(0, 8), 1);
  assert.strictEqual(Renderer.fadeAlpha(6, 8), 1); // 2s remaining, window is 1.5s
});

test('fadeAlpha ramps down inside the telegraph window', () => {
  const alpha = Renderer.fadeAlpha(7.25, 8); // 0.75s remaining of 1.5s window
  assert.ok(alpha > 0.15 && alpha < 1, `expected mid-ramp alpha, got ${alpha}`);
});

test('fadeAlpha never drops below the floor once expired', () => {
  assert.strictEqual(Renderer.fadeAlpha(8, 8), 0.15);
  assert.strictEqual(Renderer.fadeAlpha(100, 8), 0.15);
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test tests/renderer.test.js`
Expected: FAIL — `Renderer.fadeAlpha is not a function`

**Step 3: Implement**

In `src/renderer.js`:

1. Add a dependency block at the top (the file currently has none — match the pattern used in `round.js`):

```js
(function (root, factory) {
  const deps = typeof require === 'function'
    ? { T: require('./trail') }
    : { T: window.Trail };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function ({ T }) {
```

   (This replaces the current no-dependency factory wrapper — keep everything else inside the same as today, just change the opening wrapper and the closing `});` stays as-is.)

2. Add the pure helper, near the top of the factory body:

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

3. Update `drawSnake` to accept and use trail mode / elapsed time:

```js
  function drawSnake(ctx, snake, color, cell, trailMode, elapsedSec) {
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = cell * 0.9;
    ctx.fillStyle = color;
    for (const c of snake.body) {
      if (trailMode === 'fade') ctx.globalAlpha = fadeAlpha(elapsedSec - c.t, T.FADE_SECONDS);
      ctx.fillRect(c.x * cell + 1, c.y * cell + 1, cell - 2, cell - 2);
    }
    ctx.restore();
    drawCycle(ctx, snake, color, cell);
  }
```

4. Update `render` to accept and pass through `elapsedSec`:

```js
  function render(ctx, round, cell, colors = COLORS, borderColor = '#ff2b4a', elapsedSec = 0) {
    const { board, snakes } = round;
    drawGrid(ctx, board.width, board.height, cell, borderColor);
    drawWalls(ctx, board.walls, cell, borderColor);
    snakes.forEach((s, i) => drawSnake(ctx, s, colors[i], cell, round.trailMode, elapsedSec));
  }
```

5. Add `fadeAlpha` to the returned API object:

```js
  return { __name: 'Renderer', COLORS, PALETTE, pickOpponentColor, randomBorderColor, fadeAlpha, fit, drawGrid, drawWalls, drawSnake, render };
```

**Step 4: Run tests to verify they pass**

Run: `node --test tests/renderer.test.js`
Expected: PASS (all tests)

**Step 5: Run the full suite**

Run: `node --test`
Expected: PASS — everything, including `trail.test.js`, `round.test.js`

**Step 6: Commit**

```bash
git add src/renderer.js tests/renderer.test.js
git commit -m "feat: dim aging trail cells in fade mode before they vanish"
```

---

### Task 5: Browser wiring — menu, state, main loop

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `src/main.js`

**Step 1: Add the script tag**

In `index.html`, insert a new script tag after `board.js` and before `walls.js` (Trail depends only on Board, and must load before both `round.js` and `renderer.js`, which now depend on it):

```html
  <script src="src/geometry.js?v=0.4.4"></script>
  <script src="src/snake.js?v=0.4.4"></script>
  <script src="src/board.js?v=0.4.4"></script>
  <script src="src/trail.js?v=0.4.4"></script>
  <script src="src/walls.js?v=0.4.4"></script>
  <script src="src/round.js?v=0.4.4"></script>
  <script src="src/match.js?v=0.4.4"></script>
  <script src="src/cpu.js?v=0.4.4"></script>
  <script src="src/speed.js?v=0.4.4"></script>
  <script src="src/leaderboard.js?v=0.4.4"></script>
  <script src="src/audio.js?v=0.4.4"></script>
  <script src="src/renderer.js?v=0.4.4"></script>
  <script src="src/input.js?v=0.4.4"></script>
  <script src="src/main.js?v=0.4.4"></script>
```

**Step 2: Add the menu toggle markup**

In `index.html`, add a new toggle group right after the existing `turbo-toggle` block and before `color-toggle`:

```html
      <div class="trail-toggle" role="group" aria-label="Trail mode">
        <span class="hint">TRAIL</span>
        <button data-trail="tron" class="wall-btn active">TRON</button>
        <button data-trail="fade" class="wall-btn">FADE</button>
        <button data-trail="classic" class="wall-btn">CLASSIC</button>
      </div>
```

**Step 3: Add the layout rule in styles.css**

In `styles.css`, extend the existing shared selector (don't duplicate rules):

```css
.wall-toggle, .turbo-toggle, .trail-toggle { display: flex; align-items: center; gap: 10px; }
.wall-toggle .hint, .turbo-toggle .hint, .trail-toggle .hint { opacity: .5; font-size: 13px; }
```

(This replaces the two existing lines that currently list only `.wall-toggle, .turbo-toggle`.)

**Step 4: Wire state and menu buttons in main.js**

In `src/main.js`, add `trailMode: 'tron'` to the `state` object (next to `wallDensity`):

```js
  const state = {
    phase: 'menu', mode: '1p', round: null, match: null,
    elapsed: 0, acc: 0, last: 0, raf: null, wallDensity: 'none',
    trailMode: 'tron',
    playerColor: Renderer.PALETTE[0], colors: Renderer.COLORS,
    borderColor: '#ff2b4a',
    turboEnabled: false,
    turbo: [freshTurbo(), freshTurbo()],
  };
```

Add button wiring near the existing `wallButtons`/`turboButtons` blocks:

```js
  const trailButtons = document.querySelectorAll('[data-trail]');
  trailButtons.forEach((btn) => btn.addEventListener('click', () => {
    state.trailMode = btn.dataset.trail;
    trailButtons.forEach((b) => b.classList.toggle('active', b === btn));
  }));
```

**Step 5: Pass trail mode into round creation**

In `src/main.js`, in `newRound()`, change:

```js
    state.round = Round.createRound(COLS, ROWS, specs, walls);
```

to:

```js
    state.round = Round.createRound(COLS, ROWS, specs, walls, state.trailMode);
```

**Step 6: Pass elapsed time into every tick and render call**

In `src/main.js`, in `loop()`, update all three sites:

- The turbo-off tick: `Round.tick(state.round);` → `Round.tick(state.round, state.elapsed);`
- The turbo-on tick: `Round.tickSingle(state.round, i);` → `Round.tickSingle(state.round, i, state.elapsed);`
- All three `Renderer.render(ctx, state.round, cell, state.colors, state.borderColor)` calls (two inside the tick loops on round-over, one at the bottom of `loop()`) → `Renderer.render(ctx, state.round, cell, state.colors, state.borderColor, state.elapsed);`

**Step 7: Commit**

```bash
git add index.html styles.css src/main.js
git commit -m "feat: add trail mode menu toggle and wire it into the game loop"
```

---

### Task 6: Manual verification in the browser

**Step 1: Run the full test suite one more time**

Run: `node --test`
Expected: PASS, all files.

**Step 2: Start the dev server and load the game**

Use `preview_start` with the `neon-cycles-static` configuration from `.claude/launch.json`, then load the page.

**Step 3: Verify the menu**

Use `preview_snapshot` to confirm a TRAIL toggle group with TRON / FADE / CLASSIC buttons is present, TRON active by default.

**Step 4: Verify Tron mode is unchanged**

Start a 1P Survival round with TRON selected (default). Confirm via `preview_screenshot` that trails persist as before.

**Step 5: Verify Classic mode**

Select CLASSIC, start a 1P Survival round, let it run long enough (over `Trail.CLASSIC_LENGTH` = 20 ticks) via `preview_eval` (e.g. dispatch keydown events or just wait), and confirm via screenshot that the trail behind the cycle has a visibly capped length instead of growing indefinitely.

**Step 6: Verify Fade mode**

Select FADE, start a round, and confirm via screenshot/console that older trail segments dim and then disappear roughly 8 seconds after being laid down, and that the arena boundary/interior walls are unaffected.

**Step 7: Check for console errors**

Use `preview_console_logs` with `level: 'error'` across all three modes to confirm no runtime errors.

**Step 8: Report results to the user**

Summarize what was verified (or any issues found and fixed) before considering the feature complete.

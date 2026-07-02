# Neon Light-Cycles Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a self-contained browser light-cycle game with neon visuals, 1-player survival (with local leaderboard) and 2-player first-to-10 versus, WASD/arrow controls, a speed ramp, and an accelerating procedural synth soundtrack.

**Architecture:** Pure, DOM-free game-logic modules (geometry, collision, match, leaderboard, speed) are unit-tested with Node's built-in test runner. Browser-only modules (renderer, input, audio, main loop) wire them to Canvas, keyboard, and Web Audio. Every file uses a small UMD shim so it loads via `<script>` from `file://` (no build step) yet is `require()`-able in Node tests.

**Tech Stack:** HTML5 Canvas, vanilla JavaScript (ES2019, no bundler), Web Audio API, `localStorage`, Node `node:test` + `node:assert` for tests.

---

## Conventions

**UMD shim** — every `src/*.js` logic file ends with this pattern so it is both a browser global and a Node module:

```javascript
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  // ...module body returns an object with a __name property...
});
```

**Directions** are the strings `'up' | 'down' | 'left' | 'right'`. **Cells** are `{x, y}` integer grid coordinates. **Board** origin `(0,0)` is top-left; `x` increases right, `y` increases down.

**Commit style:** `feat:`, `test:`, `chore:`, `style:` prefixes. Commit after every green test or completed unit.

---

## Task 0: Project scaffold

**Files:**
- Create: `.gitignore`
- Create: `package.json`

**Step 1: Initialize git**

```bash
cd /c/Users/motow/snake
git init
```

**Step 2: Create `.gitignore`**

```
node_modules/
.DS_Store
*.log
```

**Step 3: Create `package.json`**

```json
{
  "name": "neon-light-cycles",
  "version": "0.1.0",
  "private": true,
  "description": "Neon light-cycle game (browser, no build).",
  "scripts": {
    "test": "node --test"
  }
}
```

**Step 4: Verify Node test runner works**

Run: `node --test`
Expected: exits cleanly reporting `tests 0` (no test files yet). Confirms Node is available.

**Step 5: Commit**

```bash
git add .gitignore package.json
git commit -m "chore: scaffold project"
```

---

## Task 1: Geometry & direction model (pure)

**Files:**
- Create: `src/geometry.js`
- Test: `tests/geometry.test.js`

**Step 1: Write the failing test**

```javascript
const assert = require('node:assert');
const { test } = require('node:test');
const G = require('../src/geometry');

test('vector returns unit step per direction', () => {
  assert.deepStrictEqual(G.vector('up'), { x: 0, y: -1 });
  assert.deepStrictEqual(G.vector('down'), { x: 0, y: 1 });
  assert.deepStrictEqual(G.vector('left'), { x: -1, y: 0 });
  assert.deepStrictEqual(G.vector('right'), { x: 1, y: 0 });
});

test('opposite returns the reversed direction', () => {
  assert.strictEqual(G.opposite('up'), 'down');
  assert.strictEqual(G.opposite('left'), 'right');
});

test('isReversal detects 180-degree turns', () => {
  assert.strictEqual(G.isReversal('up', 'down'), true);
  assert.strictEqual(G.isReversal('up', 'left'), false);
});

test('nextHead advances a cell by one step', () => {
  assert.deepStrictEqual(G.nextHead({ x: 3, y: 3 }, 'right'), { x: 4, y: 3 });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/geometry.test.js`
Expected: FAIL — cannot find module `../src/geometry`.

**Step 3: Write minimal implementation**

```javascript
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const VECTORS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

  function vector(dir) { return { ...VECTORS[dir] }; }
  function opposite(dir) { return OPPOSITE[dir]; }
  function isReversal(current, next) { return OPPOSITE[current] === next; }
  function nextHead(cell, dir) {
    const v = VECTORS[dir];
    return { x: cell.x + v.x, y: cell.y + v.y };
  }

  return { __name: 'Geometry', vector, opposite, isReversal, nextHead };
});
```

**Step 4: Run test to verify it passes**

Run: `node --test tests/geometry.test.js`
Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add src/geometry.js tests/geometry.test.js
git commit -m "feat: add geometry and direction model"
```

---

## Task 2: Snake model & stepping (pure)

A snake holds an ordered list of lit cells (`body`), a current `direction`, a
`pendingDirection` (buffered input), and an `alive` flag. Because trails never
shrink, stepping only appends a new head.

**Files:**
- Create: `src/snake.js`
- Test: `tests/snake.test.js`

**Step 1: Write the failing test**

```javascript
const assert = require('node:assert');
const { test } = require('node:test');
const S = require('../src/snake');

test('createSnake seeds a one-cell body facing a direction', () => {
  const s = S.createSnake({ x: 5, y: 5 }, 'right');
  assert.deepStrictEqual(s.body, [{ x: 5, y: 5 }]);
  assert.strictEqual(s.direction, 'right');
  assert.strictEqual(s.alive, true);
});

test('bufferDirection ignores 180-degree reversals', () => {
  const s = S.createSnake({ x: 5, y: 5 }, 'right');
  S.bufferDirection(s, 'left');
  assert.strictEqual(s.pendingDirection, 'right');
  S.bufferDirection(s, 'up');
  assert.strictEqual(s.pendingDirection, 'up');
});

test('stepSnake applies pending direction and appends new head', () => {
  const s = S.createSnake({ x: 5, y: 5 }, 'right');
  S.bufferDirection(s, 'up');
  const head = S.stepSnake(s);
  assert.deepStrictEqual(head, { x: 5, y: 4 });
  assert.strictEqual(s.direction, 'up');
  assert.deepStrictEqual(s.body[s.body.length - 1], { x: 5, y: 4 });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/snake.test.js`
Expected: FAIL — cannot find module `../src/snake`.

**Step 3: Write minimal implementation**

```javascript
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./geometry') : window.Geometry);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function (G) {
  function createSnake(start, direction) {
    return {
      body: [{ ...start }],
      direction,
      pendingDirection: direction,
      alive: true,
    };
  }

  function bufferDirection(snake, dir) {
    if (!dir || G.isReversal(snake.direction, dir)) return;
    snake.pendingDirection = dir;
  }

  function stepSnake(snake) {
    snake.direction = snake.pendingDirection;
    const head = G.nextHead(snake.body[snake.body.length - 1], snake.direction);
    snake.body.push(head);
    return head;
  }

  return { __name: 'Snake', createSnake, bufferDirection, stepSnake };
});
```

Note the factory receives `Geometry`. In the browser, `geometry.js` must load
before `snake.js` (handled by `<script>` order in Task 8).

**Step 4: Run test to verify it passes**

Run: `node --test tests/snake.test.js`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add src/snake.js tests/snake.test.js
git commit -m "feat: add snake model and stepping"
```

---

## Task 3: Board & collision detection (pure)

The board tracks lit cells in a `Set` keyed `"x,y"` for O(1) collision lookup.
Collision is evaluated on the cell a head is *about to* enter, before it is lit.

**Files:**
- Create: `src/board.js`
- Test: `tests/board.test.js`

**Step 1: Write the failing test**

```javascript
const assert = require('node:assert');
const { test } = require('node:test');
const B = require('../src/board');

test('inBounds respects edges', () => {
  const board = B.createBoard(10, 8);
  assert.strictEqual(B.inBounds(board, { x: 0, y: 0 }), true);
  assert.strictEqual(B.inBounds(board, { x: 9, y: 7 }), true);
  assert.strictEqual(B.inBounds(board, { x: -1, y: 0 }), false);
  assert.strictEqual(B.inBounds(board, { x: 10, y: 0 }), false);
  assert.strictEqual(B.inBounds(board, { x: 0, y: 8 }), false);
});

test('lit cells are tracked and detected', () => {
  const board = B.createBoard(10, 8);
  B.light(board, { x: 3, y: 3 });
  assert.strictEqual(B.isLit(board, { x: 3, y: 3 }), true);
  assert.strictEqual(B.isLit(board, { x: 4, y: 3 }), false);
});

test('wouldCollide is true off-board or onto a lit cell', () => {
  const board = B.createBoard(10, 8);
  B.light(board, { x: 5, y: 5 });
  assert.strictEqual(B.wouldCollide(board, { x: 5, y: 5 }), true);
  assert.strictEqual(B.wouldCollide(board, { x: -1, y: 0 }), true);
  assert.strictEqual(B.wouldCollide(board, { x: 6, y: 5 }), false);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/board.test.js`
Expected: FAIL — cannot find module `../src/board`.

**Step 3: Write minimal implementation**

```javascript
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const key = (c) => c.x + ',' + c.y;

  function createBoard(width, height) {
    return { width, height, lit: new Set() };
  }
  function inBounds(board, c) {
    return c.x >= 0 && c.y >= 0 && c.x < board.width && c.y < board.height;
  }
  function light(board, c) { board.lit.add(key(c)); }
  function isLit(board, c) { return board.lit.has(key(c)); }
  function wouldCollide(board, c) { return !inBounds(board, c) || isLit(board, c); }

  return { __name: 'Board', createBoard, inBounds, light, isLit, wouldCollide };
});
```

**Step 4: Run test to verify it passes**

Run: `node --test tests/board.test.js`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add src/board.js tests/board.test.js
git commit -m "feat: add board and collision detection"
```

---

## Task 4: Round engine — tick resolution (pure)

Advances all snakes one tick and resolves deaths, including the mutual-death
(draw) case where two snakes enter the same empty cell on the same tick. This is
the heart of the game and must be DOM-free.

**Files:**
- Create: `src/round.js`
- Test: `tests/round.test.js`

**Step 1: Write the failing test**

```javascript
const assert = require('node:assert');
const { test } = require('node:test');
const R = require('../src/round');

function setup(width, height, specs) {
  // specs: [{start, direction}] -> round state
  return R.createRound(width, height, specs);
}

test('a snake dies when it hits an edge', () => {
  const round = setup(5, 5, [{ start: { x: 4, y: 2 }, direction: 'right' }]);
  R.tick(round);
  assert.strictEqual(round.snakes[0].alive, false);
  assert.strictEqual(round.over, true);
});

test('a snake dies when it hits an existing trail', () => {
  const round = setup(10, 10, [{ start: { x: 5, y: 5 }, direction: 'right' }]);
  // manually lay a wall directly ahead
  round.board.lit.add('6,5');
  R.tick(round);
  assert.strictEqual(round.snakes[0].alive, false);
});

test('head-on into the same empty cell kills both (draw)', () => {
  const round = setup(10, 10, [
    { start: { x: 4, y: 5 }, direction: 'right' },
    { start: { x: 6, y: 5 }, direction: 'left' },
  ]);
  R.tick(round); // both target {5,5}
  assert.strictEqual(round.snakes[0].alive, false);
  assert.strictEqual(round.snakes[1].alive, false);
  assert.strictEqual(round.winnerIndex, null); // draw
});

test('last snake alive wins the round', () => {
  const round = setup(10, 10, [
    { start: { x: 0, y: 0 }, direction: 'up' },   // dies immediately (edge)
    { start: { x: 5, y: 5 }, direction: 'right' },
  ]);
  R.tick(round);
  assert.strictEqual(round.over, true);
  assert.strictEqual(round.winnerIndex, 1);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/round.test.js`
Expected: FAIL — cannot find module `../src/round`.

**Step 3: Write minimal implementation**

```javascript
(function (root, factory) {
  const deps = typeof require === 'function'
    ? { S: require('./snake'), B: require('./board'), G: require('./geometry') }
    : { S: window.Snake, B: window.Board, G: window.Geometry };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function ({ S, B, G }) {
  function createRound(width, height, specs) {
    const board = B.createBoard(width, height);
    const snakes = specs.map((s) => S.createSnake(s.start, s.direction));
    snakes.forEach((snake) => B.light(board, snake.body[0]));
    return { board, snakes, over: false, winnerIndex: null };
  }

  function tick(round) {
    const { board, snakes } = round;
    // 1. Compute intended next head for each living snake.
    const intended = snakes.map((snake) =>
      snake.alive ? G.nextHead(snake.body[snake.body.length - 1], snake.pendingDirection) : null
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

    // 4. Advance survivors: apply direction, append head, light the cell.
    snakes.forEach((snake, i) => {
      if (!snake.alive) return;
      snake.direction = snake.pendingDirection;
      snake.body.push(intended[i]);
      B.light(board, intended[i]);
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

  return { __name: 'Round', createRound, tick, resolve };
});
```

**Step 4: Run test to verify it passes**

Run: `node --test tests/round.test.js`
Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add src/round.js tests/round.test.js
git commit -m "feat: add round tick resolution with draw handling"
```

---

## Task 5: Match engine — first-to-10 (pure)

**Files:**
- Create: `src/match.js`
- Test: `tests/match.test.js`

**Step 1: Write the failing test**

```javascript
const assert = require('node:assert');
const { test } = require('node:test');
const M = require('../src/match');

test('new match starts 0-0 and not over', () => {
  const m = M.createMatch(10);
  assert.deepStrictEqual(m.scores, [0, 0]);
  assert.strictEqual(m.over, false);
});

test('awarding a round increments the winner and detects match end', () => {
  const m = M.createMatch(2);
  M.awardRound(m, 0);
  assert.deepStrictEqual(m.scores, [1, 0]);
  assert.strictEqual(m.over, false);
  M.awardRound(m, 0);
  assert.deepStrictEqual(m.scores, [2, 0]);
  assert.strictEqual(m.over, true);
  assert.strictEqual(m.winnerIndex, 0);
});

test('a draw (null winner) awards no point', () => {
  const m = M.createMatch(10);
  M.awardRound(m, null);
  assert.deepStrictEqual(m.scores, [0, 0]);
  assert.strictEqual(m.over, false);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/match.test.js`
Expected: FAIL — cannot find module `../src/match`.

**Step 3: Write minimal implementation**

```javascript
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  function createMatch(target = 10) {
    return { target, scores: [0, 0], over: false, winnerIndex: null };
  }
  function awardRound(match, winnerIndex) {
    if (winnerIndex === null || winnerIndex === undefined) return match;
    match.scores[winnerIndex] += 1;
    if (match.scores[winnerIndex] >= match.target) {
      match.over = true;
      match.winnerIndex = winnerIndex;
    }
    return match;
  }
  return { __name: 'Match', createMatch, awardRound };
});
```

**Step 4: Run test to verify it passes**

Run: `node --test tests/match.test.js`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add src/match.js tests/match.test.js
git commit -m "feat: add first-to-10 match engine"
```

---

## Task 6: Speed ramp (pure)

Maps elapsed round seconds to a tick interval (ms). Starts slow, shortens over
time, clamped to a floor.

**Files:**
- Create: `src/speed.js`
- Test: `tests/speed.test.js`

**Step 1: Write the failing test**

```javascript
const assert = require('node:assert');
const { test } = require('node:test');
const Sp = require('../src/speed');

test('interval starts at the base value at t=0', () => {
  assert.strictEqual(Sp.tickInterval(0), Sp.BASE_MS);
});

test('interval decreases as time passes', () => {
  assert.ok(Sp.tickInterval(30) < Sp.tickInterval(0));
});

test('interval never drops below the floor', () => {
  assert.strictEqual(Sp.tickInterval(100000), Sp.FLOOR_MS);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/speed.test.js`
Expected: FAIL — cannot find module `../src/speed`.

**Step 3: Write minimal implementation**

```javascript
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const BASE_MS = 110;   // starting tick interval
  const FLOOR_MS = 55;   // fastest allowed
  const RAMP_PER_SEC = 1.1; // ms removed per elapsed second

  function tickInterval(elapsedSec) {
    return Math.max(FLOOR_MS, BASE_MS - elapsedSec * RAMP_PER_SEC);
  }
  return { __name: 'Speed', BASE_MS, FLOOR_MS, RAMP_PER_SEC, tickInterval };
});
```

**Step 4: Run test to verify it passes**

Run: `node --test tests/speed.test.js`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add src/speed.js tests/speed.test.js
git commit -m "feat: add speed ramp curve"
```

---

## Task 7: Leaderboard (pure, storage injected)

Logic is pure by injecting a storage object (`{getItem, setItem}`). In the
browser we pass `localStorage`; in tests we pass a fake.

**Files:**
- Create: `src/leaderboard.js`
- Test: `tests/leaderboard.test.js`

**Step 1: Write the failing test**

```javascript
const assert = require('node:assert');
const { test } = require('node:test');
const L = require('../src/leaderboard');

function fakeStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
}

test('empty storage yields an empty board', () => {
  assert.deepStrictEqual(L.load(fakeStorage()), []);
});

test('qualifies when board not full or score beats the lowest', () => {
  assert.strictEqual(L.qualifies([], 5), true);
  // Descending order (highest first), matching insert()'s sort — the lowest
  // score is last, which is what qualifies() checks against.
  const full = Array.from({ length: 10 }, (_, i) => ({ name: 'X', time: 10 - i }));
  assert.strictEqual(L.qualifies(full, 0.5), false);
  assert.strictEqual(L.qualifies(full, 5.5), true);
});

test('insert keeps top 10 sorted descending by time', () => {
  const store = fakeStorage();
  let board = [];
  for (let t = 1; t <= 12; t++) board = L.insert(store, board, 'P' + t, t);
  assert.strictEqual(board.length, 10);
  assert.strictEqual(board[0].time, 12);
  assert.strictEqual(board[9].time, 3);
  // persisted round-trip
  assert.deepStrictEqual(L.load(store), board);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/leaderboard.test.js`
Expected: FAIL — cannot find module `../src/leaderboard`.

**Step 3: Write minimal implementation**

```javascript
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const KEY = 'neon-cycles-leaderboard';
  const MAX = 10;

  function load(storage) {
    try {
      const raw = storage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }
  function qualifies(board, time) {
    if (board.length < MAX) return true;
    return time > board[board.length - 1].time;
  }
  function insert(storage, board, name, time) {
    const next = board.concat([{ name: (name || '???').slice(0, 8), time }])
      .sort((a, b) => b.time - a.time)
      .slice(0, MAX);
    storage.setItem(KEY, JSON.stringify(next));
    return next;
  }
  return { __name: 'Leaderboard', KEY, MAX, load, qualifies, insert };
});
```

**Step 4: Run test to verify it passes**

Run: `node --test tests/leaderboard.test.js`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add src/leaderboard.js tests/leaderboard.test.js
git commit -m "feat: add leaderboard with injected storage"
```

---

## Task 8: HTML shell & neon styling

No unit test — verified by opening in a browser. Provides the canvas plus
overlay screens that later tasks show/hide.

**Files:**
- Create: `index.html`
- Create: `styles.css`

**Step 1: Create `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NEON CYCLES</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <div id="stage">
    <canvas id="game"></canvas>

    <!-- Menu overlay -->
    <section id="menu" class="overlay">
      <h1 class="neon-title">NEON&nbsp;CYCLES</h1>
      <div class="menu-buttons">
        <button data-mode="1p" class="neon-btn cyan">1 PLAYER — SURVIVAL</button>
        <button data-mode="2p" class="neon-btn magenta">2 PLAYER — FIRST TO 10</button>
      </div>
      <div id="leaderboard" class="leaderboard"></div>
      <p class="hint">P1: W A S D &nbsp;•&nbsp; P2: ARROW KEYS</p>
    </section>

    <!-- Countdown overlay -->
    <section id="countdown" class="overlay hidden"><span id="count">3</span></section>

    <!-- HUD (during play) -->
    <div id="hud" class="hud hidden"></div>

    <!-- Round/Game over overlay -->
    <section id="gameover" class="overlay hidden">
      <h2 id="go-title" class="neon-title"></h2>
      <div id="go-body"></div>
      <button id="go-continue" class="neon-btn">PRESS ENTER</button>
    </section>
  </div>

  <script src="src/geometry.js"></script>
  <script src="src/snake.js"></script>
  <script src="src/board.js"></script>
  <script src="src/round.js"></script>
  <script src="src/match.js"></script>
  <script src="src/speed.js"></script>
  <script src="src/leaderboard.js"></script>
  <script src="src/audio.js"></script>
  <script src="src/renderer.js"></script>
  <script src="src/input.js"></script>
  <script src="src/main.js"></script>
</body>
</html>
```

**Step 2: Create `styles.css`**

```css
:root {
  --bg: #05060a;
  --cyan: #00f0ff;
  --magenta: #ff2bd6;
  --grid: rgba(60, 90, 140, 0.12);
}
* { box-sizing: border-box; }
html, body {
  margin: 0; height: 100%; background: var(--bg);
  color: #eaf6ff; font-family: "Trebuchet MS", "Segoe UI", sans-serif;
  overflow: hidden;
}
#stage { position: relative; width: 100vw; height: 100vh; }
#game { display: block; width: 100%; height: 100%; }

.overlay {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 24px;
  background: radial-gradient(ellipse at center, rgba(5,6,10,0.72), rgba(5,6,10,0.94));
  text-align: center;
}
.hidden { display: none; }

.neon-title {
  font-size: clamp(28px, 7vw, 84px); letter-spacing: 6px; margin: 0;
  color: #fff;
  text-shadow: 0 0 8px var(--cyan), 0 0 22px var(--cyan), 0 0 44px var(--magenta);
}
.menu-buttons { display: flex; flex-direction: column; gap: 16px; }
.neon-btn {
  cursor: pointer; background: transparent; color: #eaf6ff;
  border: 2px solid var(--cyan); border-radius: 8px;
  padding: 14px 26px; font-size: 18px; letter-spacing: 2px;
  text-shadow: 0 0 6px var(--cyan); box-shadow: 0 0 12px rgba(0,240,255,0.35) inset, 0 0 12px rgba(0,240,255,0.35);
  transition: transform .08s ease, box-shadow .2s ease;
}
.neon-btn:hover { transform: scale(1.04); }
.neon-btn.magenta { border-color: var(--magenta); text-shadow: 0 0 6px var(--magenta);
  box-shadow: 0 0 12px rgba(255,43,214,0.35) inset, 0 0 12px rgba(255,43,214,0.35); }

.leaderboard { min-width: 260px; font-variant-numeric: tabular-nums; }
.leaderboard .row { display: flex; justify-content: space-between; padding: 2px 8px; opacity: .9; }
.leaderboard h3 { letter-spacing: 3px; margin: 0 0 8px; color: var(--cyan); text-shadow: 0 0 8px var(--cyan); }

.hud {
  position: absolute; top: 14px; left: 0; right: 0; display: flex;
  justify-content: center; gap: 48px; font-size: 22px; letter-spacing: 3px;
  pointer-events: none; text-shadow: 0 0 8px currentColor;
}
.hud .p1 { color: var(--cyan); } .hud .p2 { color: var(--magenta); }

#count { font-size: clamp(60px, 18vw, 200px); color: #fff;
  text-shadow: 0 0 16px var(--cyan), 0 0 40px var(--magenta); }
.hint { opacity: .6; letter-spacing: 2px; }
```

**Step 3: Verify visually**

Open `index.html` in a browser. Expected: dark screen, glowing NEON CYCLES
title, two mode buttons, a controls hint. (Buttons do nothing yet.)

**Step 4: Commit**

```bash
git add index.html styles.css
git commit -m "feat: add HTML shell and neon styling"
```

---

## Task 9: Audio engine (accelerating synth)

Browser-only. Verified by ear. Exposes start/stop and a `setIntensity(0..1)`
that raises tempo, plus a `crash()` SFX.

**Files:**
- Create: `src/audio.js`

**Step 1: Implement**

```javascript
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  let ctx = null, master = null, seqTimer = null, step = 0, intensity = 0, running = false;
  const SCALE = [0, 3, 5, 7, 10, 12, 15]; // minor pentatonic-ish
  const ROOT = 220;

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);
  }

  function note(freq, dur, type = 'sawtooth', gain = 0.5) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur);
  }

  function stepInterval() { return 260 - intensity * 150; } // ms per arp step

  function tick() {
    const semis = SCALE[step % SCALE.length] + (step % 14 >= 7 ? 12 : 0);
    note(ROOT * Math.pow(2, semis / 12), 0.16, 'sawtooth', 0.35);
    if (step % 4 === 0) note(ROOT / 2, 0.12, 'square', 0.25); // bass pulse
    step++;
    seqTimer = setTimeout(tick, stepInterval());
  }

  function start() { ensure(); if (ctx.state === 'suspended') ctx.resume();
    if (running) return; running = true; step = 0; tick(); }
  function stop() { running = false; if (seqTimer) clearTimeout(seqTimer); seqTimer = null; }
  function setIntensity(v) { intensity = Math.max(0, Math.min(1, v)); }
  function crash() { ensure();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(180, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.4);
    g.gain.setValueAtTime(0.5, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + 0.4);
  }

  return { __name: 'Audio', start, stop, setIntensity, crash };
});
```

**Step 2: Verify by ear**

Temporarily add `<button onclick="Audio.start()">snd</button>` (or call from
console after loading). Expected: an arpeggio loop plays; calling
`Audio.setIntensity(1)` speeds it up; `Audio.crash()` makes a descending zap.
Remove any temporary button afterward.

**Step 3: Commit**

```bash
git add src/audio.js
git commit -m "feat: add accelerating synth audio engine"
```

---

## Task 10: Renderer (canvas neon)

Browser-only. Draws grid, trails (with glow), heads, and resizes the canvas to
fit the grid crisply. Cell size derived so the grid fits the viewport.

**Files:**
- Create: `src/renderer.js`

**Step 1: Implement**

```javascript
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const COLORS = ['#00f0ff', '#ff2bd6'];

  function fit(canvas, cols, rows) {
    const dpr = window.devicePixelRatio || 1;
    const cell = Math.floor(Math.min(window.innerWidth / cols, window.innerHeight / rows));
    canvas.width = cols * cell * dpr;
    canvas.height = rows * cell * dpr;
    canvas.style.width = cols * cell + 'px';
    canvas.style.height = rows * cell + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { cell, ctx };
  }

  function drawGrid(ctx, cols, rows, cell) {
    ctx.clearRect(0, 0, cols * cell, rows * cell);
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, cols * cell, rows * cell);
    ctx.strokeStyle = 'rgba(60,90,140,0.12)'; ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x++) { ctx.beginPath(); ctx.moveTo(x*cell, 0); ctx.lineTo(x*cell, rows*cell); ctx.stroke(); }
    for (let y = 0; y <= rows; y++) { ctx.beginPath(); ctx.moveTo(0, y*cell); ctx.lineTo(cols*cell, y*cell); ctx.stroke(); }
  }

  function drawSnake(ctx, snake, color, cell) {
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = cell * 0.9;
    ctx.fillStyle = color;
    for (const c of snake.body) {
      ctx.fillRect(c.x * cell + 1, c.y * cell + 1, cell - 2, cell - 2);
    }
    // brighter head
    const head = snake.body[snake.body.length - 1];
    ctx.shadowBlur = cell * 1.4; ctx.fillStyle = '#ffffff';
    ctx.fillRect(head.x * cell + cell*0.2, head.y * cell + cell*0.2, cell*0.6, cell*0.6);
    ctx.restore();
  }

  function render(ctx, round, cell) {
    const { board, snakes } = round;
    drawGrid(ctx, board.width, board.height, cell);
    snakes.forEach((s, i) => drawSnake(ctx, s, COLORS[i], cell));
  }

  return { __name: 'Renderer', COLORS, fit, drawGrid, drawSnake, render };
});
```

**Step 2: Commit**

```bash
git add src/renderer.js
git commit -m "feat: add neon canvas renderer"
```

---

## Task 11: Input handling

Browser-only. Maps WASD → snake 0, arrows → snake 1, buffering via
`Snake.bufferDirection`. Also emits an "action" (Enter/Space) for menu/replay.

**Files:**
- Create: `src/input.js`

**Step 1: Implement**

```javascript
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const P1 = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
  const P2 = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

  // handlers: { onDirection(playerIndex, dir), onAction() }
  function attach(handlers) {
    window.addEventListener('keydown', (e) => {
      if (P1[e.code]) { handlers.onDirection(0, P1[e.code]); e.preventDefault(); }
      else if (P2[e.code]) { handlers.onDirection(1, P2[e.code]); e.preventDefault(); }
      else if (e.code === 'Enter' || e.code === 'Space') { handlers.onAction(); e.preventDefault(); }
    });
  }
  return { __name: 'Input', P1, P2, attach };
});
```

**Step 2: Commit**

```bash
git add src/input.js
git commit -m "feat: add keyboard input handling"
```

---

## Task 12: Main loop & game states

Browser-only. Owns the state machine (`menu → countdown → playing →
roundover/gameover`), the accumulator-based tick loop using `Speed.tickInterval`,
audio intensity updates, leaderboard flow, and match tracking.

**Files:**
- Create: `src/main.js`

**Step 1: Implement**

```javascript
(function () {
  const COLS = 64, ROWS = 40, MATCH_TARGET = 10;
  const canvas = document.getElementById('game');
  let cell, ctx;

  const el = (id) => document.getElementById(id);
  const menu = el('menu'), countdown = el('countdown'), hud = el('hud'),
        gameover = el('gameover'), countSpan = el('count'),
        goTitle = el('go-title'), goBody = el('go-body');

  const state = {
    phase: 'menu', mode: '1p', round: null, match: null,
    elapsed: 0, acc: 0, last: 0, best: 0, raf: null,
  };

  function show(node) { for (const o of [menu, countdown, gameover]) o.classList.add('hidden');
    if (node) node.classList.remove('hidden'); }

  function newRound() {
    const specs = state.mode === '1p'
      ? [{ start: { x: (COLS/2)|0, y: (ROWS/2)|0 }, direction: 'right' }]
      : [{ start: { x: (COLS*0.25)|0, y: (ROWS/2)|0 }, direction: 'right' },
         { start: { x: (COLS*0.75)|0, y: (ROWS/2)|0 }, direction: 'left' }];
    state.round = Round.createRound(COLS, ROWS, specs);
    state.elapsed = 0; state.acc = 0; state.last = performance.now();
    const f = Renderer.fit(canvas, COLS, ROWS); cell = f.cell; ctx = f.ctx;
  }

  function startCountdown() {
    state.phase = 'countdown'; hud.classList.add('hidden'); show(countdown);
    let n = 3; countSpan.textContent = n;
    const iv = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(iv); show(null); hud.classList.remove('hidden');
        state.phase = 'playing'; state.last = performance.now(); Audio.start(); }
      else countSpan.textContent = n;
    }, 700);
  }

  function updateHud() {
    if (state.mode === '1p') hud.innerHTML = `<span class="p1">TIME ${state.elapsed.toFixed(1)}s</span>`;
    else hud.innerHTML = `<span class="p1">P1 ${state.match.scores[0]}</span>`
      + `<span class="p2">P2 ${state.match.scores[1]}</span>`;
  }

  function endRound() {
    Audio.crash(); state.phase = 'roundover';
    if (state.mode === '1p') return finishSolo();
    Match.awardRound(state.match, state.round.winnerIndex);
    if (state.match.over) return finishMatch();
    // brief pause then next round
    show(gameover);
    goTitle.textContent = state.round.winnerIndex === null ? 'DRAW'
      : `PLAYER ${state.round.winnerIndex + 1} WINS ROUND`;
    goBody.innerHTML = `<p>MATCH ${state.match.scores[0]} — ${state.match.scores[1]}</p>`;
    el('go-continue').textContent = 'PRESS ENTER FOR NEXT ROUND';
  }

  function finishMatch() {
    show(gameover);
    goTitle.textContent = `PLAYER ${state.match.winnerIndex + 1} WINS THE MATCH`;
    goBody.innerHTML = `<p>FINAL ${state.match.scores[0]} — ${state.match.scores[1]}</p>`;
    el('go-continue').textContent = 'PRESS ENTER FOR MENU';
    state.phase = 'gameover';
  }

  function finishSolo() {
    const time = Number(state.elapsed.toFixed(1));
    let board = Leaderboard.load(window.localStorage);
    show(gameover); goTitle.textContent = 'GAME OVER';
    if (Leaderboard.qualifies(board, time)) {
      const name = (prompt(`New high score: ${time}s! Enter name:`, 'YOU') || 'YOU');
      board = Leaderboard.insert(window.localStorage, board, name, time);
    }
    goBody.innerHTML = `<p>SURVIVED ${time.toFixed(1)}s</p>` + renderBoard(board);
    el('go-continue').textContent = 'PRESS ENTER FOR MENU';
    state.phase = 'gameover';
  }

  function renderBoard(board) {
    if (!board.length) return '';
    const rows = board.map((r, i) =>
      `<div class="row"><span>${i+1}. ${r.name}</span><span>${r.time.toFixed(1)}s</span></div>`).join('');
    return `<div class="leaderboard"><h3>LEADERBOARD</h3>${rows}</div>`;
  }

  function loop(now) {
    state.raf = requestAnimationFrame(loop);
    if (state.phase !== 'playing') return;
    const dt = now - state.last; state.last = now;
    state.elapsed += dt / 1000; state.acc += dt;
    Audio.setIntensity(Math.min(1, state.elapsed / 60));
    const interval = Speed.tickInterval(state.elapsed);
    while (state.acc >= interval) {
      state.acc -= interval;
      Round.tick(state.round);
      if (state.round.over) { Renderer.render(ctx, state.round, cell); return endRound(); }
    }
    updateHud();
    Renderer.render(ctx, state.round, cell);
  }

  function beginGame(mode) {
    state.mode = mode;
    state.match = Match.createMatch(MATCH_TARGET);
    newRound(); startCountdown();
  }

  function onAction() {
    if (state.phase === 'gameover') { showMenu(); }
    else if (state.phase === 'roundover') { newRound(); startCountdown(); }
  }

  function showMenu() {
    state.phase = 'menu'; hud.classList.add('hidden'); Audio.stop();
    el('leaderboard').innerHTML = renderBoard(Leaderboard.load(window.localStorage));
    show(menu);
  }

  // wire input + menu buttons
  Input.attach({
    onDirection: (i, dir) => { if (state.phase === 'playing' && state.round.snakes[i])
      Snake.bufferDirection(state.round.snakes[i], dir); },
    onAction,
  });
  document.querySelectorAll('[data-mode]').forEach((btn) =>
    btn.addEventListener('click', () => beginGame(btn.dataset.mode)));
  el('go-continue').addEventListener('click', onAction);

  window.addEventListener('resize', () => {
    if (state.round) { const f = Renderer.fit(canvas, COLS, ROWS); cell = f.cell; ctx = f.ctx; }
  });

  showMenu();
  state.raf = requestAnimationFrame(loop);
})();
```

**Step 2: Commit**

```bash
git add src/main.js
git commit -m "feat: wire main loop, game states, match and leaderboard flow"
```

---

## Task 13: Full test run & manual verification

**Step 1: Run all unit tests**

Run: `node --test`
Expected: PASS — all suites green (geometry, snake, board, round, match, speed,
leaderboard).

**Step 2: Manual playtest checklist (open `index.html`)**

- Menu shows title, both buttons, leaderboard (empty first run).
- **1P:** countdown runs; cyan snake moves with WASD; trail glows and persists;
  crashing into wall/own trail ends the round; timer counts up; music starts on
  play and audibly speeds up over ~a minute; snake gets slightly faster;
  game-over prompts for name when qualifying; leaderboard updates and persists
  after reload.
- **2P:** both snakes controllable simultaneously (WASD + arrows); round winner
  awarded; match score increments; head-on collision = DRAW (no point); first to
  10 shows match-over screen.
- Enter/Space and the on-screen button advance countdown/menu correctly.
- Window resize keeps the board fitted.

**Step 3: Fix any issues found**, re-running `node --test` after logic changes.

**Step 4: Commit**

```bash
git add -A
git commit -m "test: full suite green and manual playtest pass"
```

---

## Task 14: README

**Files:**
- Create: `README.md`

**Step 1: Write**

```markdown
# Neon Cycles

A neon light-cycle game. Snakes leave permanent glowing trails — hit any wall,
your own trail, or your opponent's and you crash.

## Play
Open `index.html` in a modern browser (no build step, no server needed).

- **1 Player — Survival:** last as long as you can; times go on a local
  leaderboard.
- **2 Player — First to 10:** win rounds until someone reaches 10.

## Controls
- **Player 1:** W A S D
- **Player 2:** Arrow keys
- **Enter / Space:** start, next round, back to menu

Music and snake speed ramp up the longer a round lasts.

## Develop / Test
Pure game logic is in `src/*.js` (DOM-free) with tests under `tests/`:

    node --test
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## Done

All logic is unit-tested; the game runs by opening `index.html`. Future
enhancements (out of scope): AI solo opponent, online multiplayer, power-ups,
configurable keys.

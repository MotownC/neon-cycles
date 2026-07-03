# Derezzer Cannon Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a forward-firing energy bolt to every snake that cuts 3-cell gaps in trails/walls, stuns on a direct head hit, and is gated by a time-based ammo economy (1 start, +1/15s, cap 3) — across all three modes (1P Survival, 1P vs CPU, local 2P).

**Architecture:** A new pure, DOM-free module `src/projectile.js` owns all bolt logic (spawn, per-cell advance, gap-cutting, stun-marking, ammo math) and is fully covered by `node:test`. `round.js` gains two plain-data fields (`bolts`, `firedCount`) but no new logic. `main.js` drives bolt movement off its own accumulator (independent of the turbo/shared-tick split), wires a new fire key per player, and applies the stun-interval substitution. `cpu.js` gains a `shouldFire` heuristic reusing the existing Voronoi `scoreMove`. `renderer.js` and `audio.js` get additive drawing/SFX hooks.

**Tech Stack:** Vanilla JS (UMD-per-file pattern), `node:test`, HTML5 canvas, Web Audio. No build step.

**Spec:** `docs/superpowers/specs/2026-07-03-derezzer-cannon-design.md`

---

### Task 1: `projectile.js` module skeleton + `createBolt` + `ammoAvailable`

**Files:**
- Create: `src/projectile.js`
- Create: `tests/projectile.test.js`

**Step 1: Write the failing tests**

```js
// tests/projectile.test.js
const assert = require('node:assert');
const { test } = require('node:test');
const P = require('../src/projectile');

test('createBolt spawns one cell ahead of the head in the travel direction', () => {
  const bolt = P.createBolt(0, { x: 5, y: 5 }, 'right');
  assert.deepStrictEqual(bolt, { ownerIndex: 0, pos: { x: 6, y: 5 }, dir: 'right' });
});

test('createBolt works for all four directions', () => {
  assert.deepStrictEqual(P.createBolt(1, { x: 3, y: 3 }, 'up').pos, { x: 3, y: 2 });
  assert.deepStrictEqual(P.createBolt(1, { x: 3, y: 3 }, 'down').pos, { x: 3, y: 4 });
  assert.deepStrictEqual(P.createBolt(1, { x: 3, y: 3 }, 'left').pos, { x: 2, y: 3 });
});

test('ammoAvailable starts at 1 and is unaffected before the first regen', () => {
  assert.strictEqual(P.ammoAvailable(0, 0), 1);
  assert.strictEqual(P.ammoAvailable(14.9, 0), 1);
});

test('ammoAvailable grants +1 every 15 seconds survived', () => {
  assert.strictEqual(P.ammoAvailable(15, 0), 2);
  assert.strictEqual(P.ammoAvailable(30, 0), 3);
});

test('ammoAvailable caps at 3 no matter how long the round runs', () => {
  assert.strictEqual(P.ammoAvailable(999, 0), 3);
});

test('ammoAvailable subtracts bolts already fired', () => {
  assert.strictEqual(P.ammoAvailable(30, 2), 1);
  assert.strictEqual(P.ammoAvailable(0, 1), 0);
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test tests/projectile.test.js`
Expected: FAIL — `Cannot find module '../src/projectile'`

**Step 3: Write minimal implementation**

```js
// src/projectile.js
(function (root, factory) {
  const deps = typeof require === 'function'
    ? { G: require('./geometry'), B: require('./board') }
    : { G: window.Geometry, B: window.Board };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function ({ G, B }) {
  const REGEN_SEC = 15;   // seconds between +1 ammo
  const AMMO_CAP = 3;
  const GAP_CELLS = 3;    // cells unlit on a successful trail/wall hit
  const STUN_SEC = 2;

  function createBolt(ownerIndex, head, dir) {
    return { ownerIndex, pos: G.nextHead(head, dir), dir };
  }

  function ammoAvailable(elapsedSec, firedCount) {
    const earned = Math.min(AMMO_CAP, 1 + Math.floor(elapsedSec / REGEN_SEC));
    return Math.max(0, earned - firedCount);
  }

  return {
    __name: 'Projectile',
    REGEN_SEC, AMMO_CAP, GAP_CELLS, STUN_SEC,
    createBolt, ammoAvailable,
  };
});
```

**Step 4: Run tests to verify they pass**

Run: `node --test tests/projectile.test.js`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add src/projectile.js tests/projectile.test.js
git commit -m "feat: add projectile module with bolt spawn and ammo math"
```

---

### Task 2: `advanceBolts` — movement through open space + boundary despawn

**Files:**
- Modify: `src/projectile.js`
- Modify: `tests/projectile.test.js`

**Step 1: Write the failing tests**

```js
// append to tests/projectile.test.js
test('advanceBolts moves a bolt one cell forward through open space', () => {
  const round = { board: B.createBoard(10, 10), bolts: [P.createBolt(0, { x: 5, y: 5 }, 'right')], snakes: [] };
  P.advanceBolts(round, 0);
  assert.strictEqual(round.bolts.length, 1);
  assert.deepStrictEqual(round.bolts[0].pos, { x: 7, y: 5 });
});

test('advanceBolts despawns a bolt that would leave the board', () => {
  const round = { board: B.createBoard(10, 10), bolts: [{ ownerIndex: 0, pos: { x: 9, y: 5 }, dir: 'right' }], snakes: [] };
  P.advanceBolts(round, 0);
  assert.strictEqual(round.bolts.length, 0);
});
```

Add the required import at the top of the test file: `const B = require('../src/board');`

**Step 2: Run tests to verify they fail**

Run: `node --test tests/projectile.test.js`
Expected: FAIL — `P.advanceBolts is not a function`

**Step 3: Write minimal implementation**

```js
// in src/projectile.js, replace the closing return with:
  function advanceBolts(round, elapsedSec) {
    const { board } = round;
    round.bolts = round.bolts.filter((bolt) => {
      const next = G.nextHead(bolt.pos, bolt.dir);
      if (!B.inBounds(board, next)) return false; // despawn at the boundary
      bolt.pos = next;
      return true;
    });
  }

  return {
    __name: 'Projectile',
    REGEN_SEC, AMMO_CAP, GAP_CELLS, STUN_SEC,
    createBolt, ammoAvailable, advanceBolts,
  };
```

**Step 4: Run tests to verify they pass**

Run: `node --test tests/projectile.test.js`
Expected: PASS (9 tests)

**Step 5: Commit**

```bash
git add src/projectile.js tests/projectile.test.js
git commit -m "feat: advance bolts through open space and despawn at the boundary"
```

---

### Task 3: `advanceBolts` — trail/wall gap cutting

**Files:**
- Modify: `src/projectile.js`
- Modify: `tests/projectile.test.js`

**Step 1: Write the failing tests**

```js
// append to tests/projectile.test.js
test('advanceBolts cuts a 3-cell gap starting at a lit cell it hits', () => {
  const board = B.createBoard(10, 10);
  [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }].forEach((c) => B.light(board, c));
  const round = { board, bolts: [{ ownerIndex: 0, pos: { x: 5, y: 5 }, dir: 'right' }], snakes: [] };
  P.advanceBolts(round, 0);
  assert.strictEqual(round.bolts.length, 0); // consumed on impact
  assert.strictEqual(B.isLit(board, { x: 6, y: 5 }), false);
  assert.strictEqual(B.isLit(board, { x: 7, y: 5 }), false);
  assert.strictEqual(B.isLit(board, { x: 8, y: 5 }), false);
  assert.strictEqual(B.isLit(board, { x: 9, y: 5 }), true); // beyond the 3-cell gap
});

test('advanceBolts clips the gap at the board edge instead of erroring', () => {
  const board = B.createBoard(10, 10);
  [{ x: 8, y: 5 }, { x: 9, y: 5 }].forEach((c) => B.light(board, c));
  const round = { board, bolts: [{ ownerIndex: 0, pos: { x: 7, y: 5 }, dir: 'right' }], snakes: [] };
  P.advanceBolts(round, 0);
  assert.strictEqual(B.isLit(board, { x: 8, y: 5 }), false);
  assert.strictEqual(B.isLit(board, { x: 9, y: 5 }), false);
});

test('a wall cell is cut exactly like a trail cell (same lit Set)', () => {
  const board = B.createBoard(10, 10, [{ x: 6, y: 5 }]);
  const round = { board, bolts: [{ ownerIndex: 0, pos: { x: 5, y: 5 }, dir: 'right' }], snakes: [] };
  P.advanceBolts(round, 0);
  assert.strictEqual(B.isLit(board, { x: 6, y: 5 }), false);
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test tests/projectile.test.js`
Expected: FAIL — gap cells remain lit (current code only moves/despawns, never unlights)

**Step 3: Write minimal implementation**

```js
// replace advanceBolts in src/projectile.js
  function advanceBolts(round, elapsedSec) {
    const { board, snakes = [] } = round;
    round.bolts = round.bolts.filter((bolt) => {
      const next = G.nextHead(bolt.pos, bolt.dir);
      if (!B.inBounds(board, next)) return false;

      const victim = snakes.find((s) => s.alive
        && s.body[s.body.length - 1].x === next.x && s.body[s.body.length - 1].y === next.y);
      if (victim) { victim.stunnedUntil = elapsedSec + STUN_SEC; return false; }

      if (B.isLit(board, next)) {
        let gap = next;
        for (let i = 0; i < GAP_CELLS; i++) {
          if (!B.inBounds(board, gap)) break;
          B.unlight(board, gap);
          gap = G.nextHead(gap, bolt.dir);
        }
        return false;
      }

      bolt.pos = next;
      return true;
    });
  }
```

**Step 4: Run tests to verify they pass**

Run: `node --test tests/projectile.test.js`
Expected: PASS (12 tests)

**Step 5: Commit**

```bash
git add src/projectile.js tests/projectile.test.js
git commit -m "feat: bolts cut a 3-cell gap in trails and walls on impact"
```

---

### Task 4: `advanceBolts` — head-hit stun

**Files:**
- Modify: `tests/projectile.test.js`

The stun branch was written in Task 3 (needed the same filter pass as gap-cutting to share the "what does this bolt hit" logic cleanly). This task adds the tests that pin down that behavior explicitly.

**Step 1: Write the failing tests**

```js
// append to tests/projectile.test.js
test('advanceBolts stuns a snake hit directly in the head instead of cutting a gap', () => {
  const board = B.createBoard(10, 10);
  const victim = { alive: true, body: [{ x: 6, y: 5, t: 0 }] };
  const round = { board, bolts: [{ ownerIndex: 0, pos: { x: 5, y: 5 }, dir: 'right' }], snakes: [victim] };
  P.advanceBolts(round, 10);
  assert.strictEqual(round.bolts.length, 0);
  assert.strictEqual(victim.stunnedUntil, 12);
  assert.strictEqual(B.isLit(board, { x: 6, y: 5 }), false); // head cell was never lit; no gap side effect
});

test('advanceBolts ignores dead snakes when checking for a head hit', () => {
  const board = B.createBoard(10, 10);
  const victim = { alive: false, body: [{ x: 6, y: 5, t: 0 }] };
  const round = { board, bolts: [{ ownerIndex: 0, pos: { x: 5, y: 5 }, dir: 'right' }], snakes: [victim] };
  P.advanceBolts(round, 10);
  assert.strictEqual(round.bolts.length, 1); // passed through the empty (unlit) cell
  assert.strictEqual(victim.stunnedUntil, undefined);
});
```

**Step 2: Run tests to verify they pass immediately (logic already present)**

Run: `node --test tests/projectile.test.js`
Expected: PASS (14 tests) — confirms Task 3's implementation already satisfies the stun contract

**Step 3: Commit**

```bash
git add tests/projectile.test.js
git commit -m "test: pin down head-hit stun and dead-snake pass-through behavior"
```

---

### Task 5: `fire()` with ammo gating

**Files:**
- Modify: `src/projectile.js`
- Modify: `tests/projectile.test.js`

**Step 1: Write the failing tests**

```js
// append to tests/projectile.test.js
test('fire pushes a bolt and increments firedCount when ammo is available', () => {
  const round = {
    board: B.createBoard(10, 10),
    bolts: [],
    firedCount: [0],
    snakes: [{ alive: true, body: [{ x: 5, y: 5, t: 0 }], direction: 'right' }],
  };
  P.fire(round, 0, 0);
  assert.strictEqual(round.bolts.length, 1);
  assert.strictEqual(round.firedCount[0], 1);
});

test('fire is a no-op when ammo is exhausted', () => {
  const round = {
    board: B.createBoard(10, 10),
    bolts: [],
    firedCount: [1], // already spent the starting bolt
    snakes: [{ alive: true, body: [{ x: 5, y: 5, t: 0 }], direction: 'right' }],
  };
  P.fire(round, 0, 5); // elapsedSec=5, still under the 15s regen mark
  assert.strictEqual(round.bolts.length, 0);
  assert.strictEqual(round.firedCount[0], 1);
});
```

**Step 2: Run tests to verify they fail**

Run: `node --test tests/projectile.test.js`
Expected: FAIL — `P.fire is not a function`

**Step 3: Write minimal implementation**

```js
// add alongside advanceBolts in src/projectile.js
  function fire(round, index, elapsedSec) {
    const available = ammoAvailable(elapsedSec, round.firedCount[index]);
    if (available <= 0) return;
    const snake = round.snakes[index];
    const head = snake.body[snake.body.length - 1];
    round.bolts.push(createBolt(index, head, snake.direction));
    round.firedCount[index] += 1;
  }
```

Update the returned API object to include `fire`.

**Step 4: Run tests to verify they pass**

Run: `node --test tests/projectile.test.js`
Expected: PASS (16 tests)

**Step 5: Commit**

```bash
git add src/projectile.js tests/projectile.test.js
git commit -m "feat: gate bolt firing on the ammo economy"
```

---

### Task 6: wire `bolts`/`firedCount` into `Round.createRound` + load `projectile.js`

**Files:**
- Modify: `src/round.js:9-14`
- Modify: `tests/round.test.js`
- Modify: `index.html:66-67`

**Step 1: Write the failing test**

```js
// append to tests/round.test.js
test('createRound initializes empty bolts and per-snake firedCount', () => {
  const round = setup(10, 10, [{ start: { x: 5, y: 5 }, direction: 'right' }, { start: { x: 6, y: 5 }, direction: 'left' }]);
  assert.deepStrictEqual(round.bolts, []);
  assert.deepStrictEqual(round.firedCount, [0, 0]);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/round.test.js`
Expected: FAIL — `round.bolts` is `undefined`

**Step 3: Write minimal implementation**

```js
// src/round.js:9-14, replace createRound
  function createRound(width, height, specs, walls = [], trailMode = 'tron') {
    const board = B.createBoard(width, height, walls);
    const snakes = specs.map((s) => S.createSnake(s.start, s.direction));
    snakes.forEach((snake) => B.light(board, snake.body[0]));
    return { board, snakes, over: false, winnerIndex: null, trailMode, bolts: [], firedCount: specs.map(() => 0) };
  }
```

Also add the script tag so the browser loads the new module (place after `trail.js`, since it depends only on `geometry.js`/`board.js`, both already loaded by that point):

```html
<!-- index.html, insert between the existing trail.js and walls.js lines -->
<script src="src/trail.js?v=0.4.5"></script>
<script src="src/projectile.js?v=0.4.5"></script>
<script src="src/walls.js?v=0.4.5"></script>
```

**Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS (all suites, including the new `round.test.js` case)

**Step 5: Commit**

```bash
git add src/round.js tests/round.test.js index.html
git commit -m "feat: initialize bolt state on round creation and load projectile.js"
```

---

### Task 7: input wiring — fire keys

**Files:**
- Modify: `src/input.js`
- Modify: `tests/input.test.js`

Look at `tests/input.test.js` first to match its existing style (simulated `keydown`/`keyup` dispatch against `window`) before writing the new cases.

**Step 1: Write the failing tests**

Add tests following the file's existing pattern, asserting:
- Pressing `Slash` calls `handlers.onFire(0)`.
- Pressing `KeyQ` calls `handlers.onFire(1)`.
- A `repeat: true` `Slash` keydown does NOT call `onFire` again (edge-triggered, matching the existing direction-key guard).

**Step 2: Run tests to verify they fail**

Run: `node --test tests/input.test.js`
Expected: FAIL — `onFire` never called

**Step 3: Write minimal implementation**

```js
// src/input.js — add near the other keydown branches
      else if (e.code === 'Slash' && handlers.onFire) { handlers.onFire(0); e.preventDefault(); }
      else if (e.code === 'KeyQ' && handlers.onFire) { handlers.onFire(1); e.preventDefault(); }
```

(This sits inside the same `if (e.repeat) return;`-guarded `keydown` listener, so it's edge-triggered for free.)

**Step 4: Run tests to verify they pass**

Run: `node --test tests/input.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/input.js tests/input.test.js
git commit -m "feat: wire fire key bindings (P1 slash, P2 Q)"
```

---

### Task 8: `main.js` — bolt accumulator, fire handler, stun-aware tick interval, HUD ammo pips

**Files:**
- Modify: `src/main.js`

This is DOM-glue code with no unit tests (per project convention — see CLAUDE.md's "Browser-only modules" list); verify manually in Task 12.

**Step 1: Add a bolt accumulator to state and reset it per round**

```js
// main.js:21-29, add boltAcc to state
  const state = {
    phase: 'menu', mode: '1p', round: null, match: null,
    elapsed: 0, acc: 0, boltAcc: 0, last: 0, raf: null, wallDensity: 'none',
    trailMode: 'tron',
    playerColor: Renderer.PALETTE[0], colors: Renderer.COLORS,
    borderColor: '#ff2b4a',
    turboEnabled: false,
    turbo: [freshTurbo(), freshTurbo()],
  };
```

```js
// main.js:50-52, in newRound(), reset it alongside acc
    state.elapsed = 0; state.acc = 0; state.boltAcc = 0; state.last = performance.now();
```

**Step 2: Advance bolts once per frame in `loop()`, on their own clock**

```js
// main.js, inside loop(now), after `Audio.setIntensity(...)` and before the
// turbo-enabled/disabled tick branch:
    const boltInt = Speed.tickInterval(state.elapsed) / 3;
    state.boltAcc += dt;
    while (state.boltAcc >= boltInt) {
      state.boltAcc -= boltInt;
      Projectile.advanceBolts(state.round, state.elapsed);
    }
```

**Step 3: Apply the stun interval wherever a per-snake interval is chosen**

```js
// main.js:216, inside the turboEnabled branch, replace:
        const interval = isBoosting(i) ? turboInt : normalInt;
// with:
        const stunned = snakes[i].stunnedUntil > state.elapsed;
        const interval = stunned ? normalInt / Speed.TURBO_MULTIPLIER
          : isBoosting(i) ? turboInt : normalInt;
```

The non-turbo (shared-accumulator) path ticks every snake at the same interval already, so add the same substitution there too — but since it's a *shared* accumulator, use the slowest of the two snakes' required intervals to decide whether to bank a stunned snake's tick this pass. Simpler: since stun is a rare edge case and the non-turbo path already advances all snakes together via `Round.tick`, skip per-snake stun pacing in that path for now — `Round.tick`'s single shared interval is an existing simplification the codebase already accepts (see `tickSingle` vs `tick` docs in CLAUDE.md), and stun without turbo enabled simply has no perceptible effect. Only wire the stun substitution in the turbo-enabled branch above, where per-snake intervals already exist. Do not add stun logic to the `!state.turboEnabled` branch.

**Step 4: Wire the fire handler**

```js
// main.js, inside the Input.attach({...}) call, add alongside onAction/onTurbo:
    onFire: (i) => {
      if (state.phase !== 'playing' || !state.round.snakes[i] || !state.round.snakes[i].alive) return;
      if (i === 1 && state.mode === 'cpu') return; // CPU fires itself, see Task 9
      Projectile.fire(state.round, i, state.elapsed);
    },
```

**Step 5: Add ammo pips to the HUD**

```js
// main.js, add near turboTag()
  function ammoTag(index, color) {
    const available = Projectile.ammoAvailable(state.elapsed, state.round.firedCount[index]);
    const pips = '●'.repeat(available) + '○'.repeat(Projectile.AMMO_CAP - available);
    return ` <span style="color:${color};opacity:0.7;font-size:14px">${pips}</span>`;
  }
```

```js
// main.js:82-86, updateHud(): append ammoTag(0, c0) / ammoTag(1, c1) next to each turboTag call
    if (state.mode === '1p') hud.innerHTML = `<span style="color:${c0}">TIME ${state.elapsed.toFixed(1)}s${turboTag(t0, c0)}${ammoTag(0, c0)}</span>`;
    else if (state.mode === 'cpu') hud.innerHTML = `<span style="color:${c0}">YOU ${state.match.scores[0]}${turboTag(t0, c0)}${ammoTag(0, c0)}</span>`
      + `<span style="color:${c1}">CPU ${state.match.scores[1]}${turboTag(t1, c1)}${ammoTag(1, c1)}</span>`;
    else hud.innerHTML = `<span style="color:${c0}">P1 ${state.match.scores[0]}${turboTag(t0, c0)}${ammoTag(0, c0)}</span>`
      + `<span style="color:${c1}">P2 ${state.match.scores[1]}${turboTag(t1, c1)}${ammoTag(1, c1)}</span>`;
```

**Step 6: Add the script tag**

```html
<!-- index.html, projectile.js is already loaded per Task 6; nothing further needed here -->
```

**Step 7: Run the full test suite to make sure nothing broke**

Run: `node --test`
Expected: PASS (main.js has no direct unit tests, but this guards against typos breaking required modules)

**Step 8: Commit**

```bash
git add src/main.js
git commit -m "feat: wire bolt ticking, firing, stun pacing, and HUD ammo pips into the game loop"
```

---

### Task 9: CPU firing logic

**Files:**
- Modify: `src/cpu.js`
- Modify: `tests/cpu.test.js`
- Modify: `src/main.js`

**Step 1: Write the failing test**

Read `tests/cpu.test.js` first to match its existing setup helpers, then add:

```js
// append to tests/cpu.test.js
test('shouldFire returns true when the CPU\'s best move score is negative and ammo is available', () => {
  // Construct a round where the CPU (index 1) is boxed in on 3 sides so every
  // safe move scores negative territory versus the opponent.
  // (Concrete board setup mirrors the boxed-in fixtures already used
  // elsewhere in this file for scoreMove-losing scenarios.)
  const round = /* ...boxed-in fixture... */;
  round.firedCount = [0, 0];
  assert.strictEqual(CPU.shouldFire(round, 1), true);
});

test('shouldFire returns false when ammo is exhausted even if losing', () => {
  const round = /* ...same boxed-in fixture... */;
  round.firedCount = [0, 3]; // no ammo left for index 1
  assert.strictEqual(CPU.shouldFire(round, 1), false);
});
```

Use the same board/snake construction helpers already present in `tests/cpu.test.js` for scenarios where `chooseDirection` is forced into a losing position — adapt one of those fixtures rather than inventing new geometry.

**Step 2: Run tests to verify they fail**

Run: `node --test tests/cpu.test.js`
Expected: FAIL — `CPU.shouldFire is not a function`

**Step 3: Write minimal implementation**

```js
// src/cpu.js — depends additionally on Projectile
(function (root, factory) {
  const deps = typeof require === 'function'
    ? { G: require('./geometry'), B: require('./board'), P: require('./projectile') }
    : { G: window.Geometry, B: window.Board, P: window.Projectile };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function ({ G, B, P }) {
  // ... existing STRAIGHT_BONUS, HEADON_PENALTY, scoreMove, chooseDirection unchanged ...

  function shouldFire(round, index) {
    if (P.ammoAvailable(round.elapsedSec ?? 0, round.firedCount[index]) <= 0) return false;
    const snake = round.snakes[index];
    const head = snake.body[snake.body.length - 1];
    const dirs = [snake.pendingDirection, G.leftOf(snake.pendingDirection), G.rightOf(snake.pendingDirection)];
    const safe = dirs.filter((d) => !B.wouldCollide(round.board, G.nextHead(head, d)));
    if (!safe.length) return true; // boxed in entirely: always worth a desperation shot
    const best = Math.max(...safe.map((d) => scoreMove(round, index, head, d)));
    return best < 0;
  }

  return { __name: 'CPU', chooseDirection, shouldFire };
});
```

`round.elapsedSec` doesn't exist on the round object today — `main.js` tracks elapsed time itself. Pass it explicitly instead of reading a nonexistent field:

```js
  function shouldFire(round, index, elapsedSec) {
    if (P.ammoAvailable(elapsedSec, round.firedCount[index]) <= 0) return false;
    // ...rest unchanged...
  }
```

Update the test calls accordingly: `CPU.shouldFire(round, 1, 0)`.

**Step 4: Run tests to verify they pass**

Run: `node --test tests/cpu.test.js`
Expected: PASS

**Step 5: Wire it into `main.js`**

```js
// main.js, in loop(), wherever CPU.chooseDirection is already called for
// state.mode === 'cpu' (both the turbo and non-turbo branches), add right after:
        if (state.mode === 'cpu' && CPU.shouldFire(state.round, 1, state.elapsed)) {
          Projectile.fire(state.round, 1, state.elapsed);
        }
```

**Step 6: Update `index.html` script order** — `cpu.js` now depends on `projectile.js`, which is already loaded earlier (Task 6), so no reordering is needed. Confirm by checking the tag order.

**Step 7: Run the full suite**

Run: `node --test`
Expected: PASS

**Step 8: Commit**

```bash
git add src/cpu.js src/main.js tests/cpu.test.js
git commit -m "feat: teach the CPU to fire when losing territory and ammo allows"
```

---

### Task 10: renderer — draw bolts and impact flashes

**Files:**
- Modify: `src/renderer.js`
- Modify: `tests/renderer.test.js`

**Step 1: Check `tests/renderer.test.js`** for its existing style (likely a mock 2D context recording calls) before writing new assertions.

**Step 2: Write the failing test**

```js
// append to tests/renderer.test.js, adapting to the file's existing mock-ctx helper
test('render draws each active bolt', () => {
  const ctx = /* existing mock context helper */;
  const round = { board: { width: 10, height: 10, walls: [] }, snakes: [], bolts: [{ ownerIndex: 0, pos: { x: 3, y: 3 }, dir: 'right' }], trailMode: 'tron' };
  Renderer.render(ctx, round, 10, ['#00f0ff', '#ff2bd6']);
  assert.ok(ctx.fillRectCalls.some((args) => /* matches the bolt's cell */));
});
```

**Step 3: Run test to verify it fails**

Run: `node --test tests/renderer.test.js`
Expected: FAIL — bolts are never drawn

**Step 4: Write minimal implementation**

```js
// src/renderer.js — add near drawWalls
  function drawBolts(ctx, bolts, colors, cell) {
    if (!bolts || !bolts.length) return;
    ctx.save();
    for (const b of bolts) {
      const color = colors[b.ownerIndex] || '#ffffff';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = color; ctx.shadowBlur = cell * 1.2;
      ctx.fillRect(b.pos.x * cell + cell * 0.3, b.pos.y * cell + cell * 0.3, cell * 0.4, cell * 0.4);
    }
    ctx.restore();
  }
```

```js
// src/renderer.js, render(): add the call after drawWalls
  function render(ctx, round, cell, colors = COLORS, borderColor = '#ff2b4a', elapsedSec = 0) {
    const { board, snakes, bolts } = round;
    drawGrid(ctx, board.width, board.height, cell, borderColor);
    drawWalls(ctx, board.walls, cell, borderColor);
    drawBolts(ctx, bolts, colors, cell);
    snakes.forEach((s, i) => drawSnake(ctx, s, colors[i], cell, round.trailMode, elapsedSec));
  }
```

Add `drawBolts` to the returned API object.

**Step 5: Run test to verify it passes**

Run: `node --test tests/renderer.test.js`
Expected: PASS

**Step 6: Commit**

```bash
git add src/renderer.js tests/renderer.test.js
git commit -m "feat: draw active bolts on the canvas"
```

---

### Task 11: audio — fire and derez SFX

**Files:**
- Modify: `src/audio.js`
- Modify: `src/main.js`
- Modify: `src/projectile.js`

`audio.js` has no unit tests (browser-only, per CLAUDE.md); verify manually in Task 12.

**Step 1: Add SFX functions to `audio.js`**

```js
// src/audio.js — add alongside crash()
  function fireSfx() {
    ensure(); const t = ctx.currentTime;
    tone(t, 1400, 0.08, 'square', 0.3, 4000);
  }

  function derezSfx() {
    ensure(); const t = ctx.currentTime;
    noise(t, 0.12, 0.4, 'bandpass', 2200);
    tone(t, 220, 0.1, 'sawtooth', 0.25, 900);
  }
```

Add both to the returned API object: `{ __name: 'Audio', start, stop, setIntensity, crash, fireSfx, derezSfx }`.

**Step 2: Have `Projectile.fire`/`advanceBolts` report outcomes so `main.js` can trigger SFX**

Rather than have the pure `projectile.js` module reach into `Audio` (breaking its DOM-free contract), have `advanceBolts` return a summary main.js can react to:

```js
// src/projectile.js — advanceBolts returns an array of outcomes instead of nothing
  function advanceBolts(round, elapsedSec) {
    const { board, snakes = [] } = round;
    const outcomes = [];
    round.bolts = round.bolts.filter((bolt) => {
      const next = G.nextHead(bolt.pos, bolt.dir);
      if (!B.inBounds(board, next)) return false;

      const victim = snakes.find((s) => s.alive
        && s.body[s.body.length - 1].x === next.x && s.body[s.body.length - 1].y === next.y);
      if (victim) { victim.stunnedUntil = elapsedSec + STUN_SEC; outcomes.push({ type: 'stun', pos: next }); return false; }

      if (B.isLit(board, next)) {
        let gap = next;
        for (let i = 0; i < GAP_CELLS; i++) {
          if (!B.inBounds(board, gap)) break;
          B.unlight(board, gap);
          gap = G.nextHead(gap, bolt.dir);
        }
        outcomes.push({ type: 'cut', pos: next });
        return false;
      }

      bolt.pos = next;
      return true;
    });
    return outcomes;
  }
```

Update `tests/projectile.test.js`'s existing `advanceBolts` assertions that check return value where relevant (most only inspect `round.bolts`/`board`, so this is additive and should not break them — run the suite to confirm).

**Step 3: Run tests**

Run: `node --test tests/projectile.test.js`
Expected: PASS (existing tests ignore the new return value; still green)

**Step 4: Wire SFX in `main.js`**

```js
// main.js, in loop(), where Projectile.advanceBolts is called:
    while (state.boltAcc >= boltInt) {
      state.boltAcc -= boltInt;
      const outcomes = Projectile.advanceBolts(state.round, state.elapsed);
      if (outcomes.length) Audio.derezSfx();
    }
```

```js
// main.js, in the onFire handler, after a successful Projectile.fire call:
    onFire: (i) => {
      if (state.phase !== 'playing' || !state.round.snakes[i] || !state.round.snakes[i].alive) return;
      if (i === 1 && state.mode === 'cpu') return;
      const before = state.round.firedCount[i];
      Projectile.fire(state.round, i, state.elapsed);
      if (state.round.firedCount[i] !== before) Audio.fireSfx();
    },
```

Also call `Audio.fireSfx()` from the CPU auto-fire branch added in Task 9, guarded the same way (compare `firedCount` before/after).

**Step 5: Run the full suite**

Run: `node --test`
Expected: PASS

**Step 6: Commit**

```bash
git add src/audio.js src/main.js src/projectile.js tests/projectile.test.js
git commit -m "feat: add fire and derez sound effects"
```

---

### Task 12: version bump + manual verification

**Files:**
- Modify: `package.json`
- Modify: `index.html` (all `?v=` query strings and `#version` element)

**Step 1: Bump the version everywhere, per CLAUDE.md's cache-busting rule**

- `package.json`: `"version": "0.4.6"`
- `index.html`: every `?v=0.4.5` → `?v=0.4.6` (stylesheet + all script tags), and `<p class="hint" id="version">v0.4.5</p>` → `v0.4.6`.

**Step 2: Run the full test suite**

Run: `node --test`
Expected: PASS (all suites)

**Step 3: Manual verification in a browser**

Serve the directory (the `neon-cycles-static` launch config, port 8734) and check, for each of the three modes:
- Firing (P1 `/`, P2 `Q`) launches a visible bolt that travels ~3x snake speed.
- A bolt hitting a trail/wall opens a visible 3-cell gap and both a fire SFX and derez SFX are audible.
- A bolt hitting an opponent's head stuns them (visibly slower ticking for ~2s) without killing them outright.
- The ammo pip HUD counts down on fire and regenerates after 15s, capping at 3.
- In 1P Survival, firing only ever affects the player's own trail/walls (no crash from a nonexistent opponent).
- In vs-CPU mode, the CPU fires on its own when losing territory and has ammo.

**Step 4: Commit**

```bash
git add package.json index.html
git commit -m "chore: bump version to 0.4.6 for derezzer cannon release"
```

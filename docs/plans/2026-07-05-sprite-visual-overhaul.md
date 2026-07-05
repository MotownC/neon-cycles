# Sprite Visual Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace per-frame procedural canvas drawing with sprites baked once into offscreen canvases — better-looking cycles, bolts, trails, walls, and pickups, with less per-frame cost.

**Architecture:** New browser-only module `src/sprites.js` bakes all artwork at 4× cell resolution into offscreen canvases (`Sprites.bake({cell, colors, borderColor})` → atlas object). `renderer.js` draw functions switch to `drawImage` blits from the atlas. `main.js` bakes at round start and on resize and passes the atlas to `Renderer.render`. Spec: `docs/superpowers/specs/2026-07-05-sprite-visual-overhaul-design.md`.

**Tech Stack:** Vanilla JS, HTML5 canvas, UMD wrapper pattern (see CLAUDE.md), `node:test` for the one pure helper.

**Version:** bump 0.8.0 → **0.9.0** in `index.html` (`?v=` on all tags + `#version`) and `package.json` together (cache-busting rule).

---

### Task 1: `sprites.js` skeleton + pure `trailKey` helper (TDD)

`trailKey` maps a body cell's neighbors to a trail-tile key. It's pure, so it gets a real test. Canonical letter order is `L,R,U,D`; no neighbors → `'O'`.

**Files:**
- Create: `src/sprites.js`
- Create: `tests/sprites.test.js`

**Step 1: Write the failing test**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const Sprites = require('../src/sprites');

test('trailKey: straight horizontal', () => {
  assert.equal(Sprites.trailKey({x:1,y:5}, {x:2,y:5}, {x:3,y:5}), 'LR');
});
test('trailKey: straight vertical', () => {
  assert.equal(Sprites.trailKey({x:2,y:4}, {x:2,y:5}, {x:2,y:6}), 'UD');
});
test('trailKey: corner (came from left, turned up)', () => {
  assert.equal(Sprites.trailKey({x:1,y:5}, {x:2,y:5}, {x:2,y:4}), 'LU');
});
test('trailKey: canonical order regardless of prev/next roles', () => {
  assert.equal(Sprites.trailKey({x:2,y:4}, {x:2,y:5}, {x:1,y:5}), 'LU');
});
test('trailKey: end cell (only one neighbor)', () => {
  assert.equal(Sprites.trailKey(null, {x:2,y:5}, {x:3,y:5}), 'R');
});
test('trailKey: lone cell', () => {
  assert.equal(Sprites.trailKey(null, {x:2,y:5}, null), 'O');
});
test('trailKey: non-adjacent neighbor ignored (cut trail)', () => {
  assert.equal(Sprites.trailKey({x:9,y:9}, {x:2,y:5}, {x:3,y:5}), 'R');
});
```

**Step 2: Run it — must fail** (`node --test tests/sprites.test.js`, fails: cannot find module).

**Step 3: Create `src/sprites.js`** with the standard UMD wrapper (no deps) and `trailKey` only; `bake` comes in Task 2:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const ORDER = 'LRUD';

  // Which trail tile a body cell needs, from its neighbors in the body array.
  // Neighbors that aren't 4-adjacent (e.g. across a derezzer cut) are ignored.
  function trailKey(prev, cur, next) {
    const letters = [];
    for (const n of [prev, next]) {
      if (!n) continue;
      const dx = n.x - cur.x, dy = n.y - cur.y;
      if (dx === -1 && dy === 0) letters.push('L');
      else if (dx === 1 && dy === 0) letters.push('R');
      else if (dy === -1 && dx === 0) letters.push('U');
      else if (dy === 1 && dx === 0) letters.push('D');
    }
    const uniq = [...new Set(letters)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    return uniq.join('') || 'O';
  }

  return { __name: 'Sprites', trailKey };
});
```

**Step 4: Run tests — pass.** Also run full `node --test` — all pass.

**Step 5: Commit** — `feat: sprites module skeleton with trailKey helper`

---

### Task 2: bake the atlas (trail tiles, cycle, bolts, wall, pickups)

All browser-only (uses `document.createElement('canvas')`) — no unit tests per CLAUDE.md; verified in Task 5. Everything bakes at `SCALE = 4`× cell resolution on padded square canvases so glow can bleed past the cell; each atlas entry records its `span` in cells and is blitted centered.

**Files:**
- Modify: `src/sprites.js` (add everything below `trailKey`, extend the return)

**Step 1: Add bake helpers and sprite painters.** Complete code:

```js
  const SCALE = 4; // bake resolution multiplier: crisp when downscaled to cell size

  function makeTile(cell, span) {
    const c = document.createElement('canvas');
    c.width = c.height = span * cell * SCALE;
    return c;
  }

  // --- trail tiles: light-ribbon segments -------------------------------
  const TRAIL_KEYS = ['LR', 'UD', 'LU', 'LD', 'RU', 'RD', 'L', 'R', 'U', 'D', 'O'];
  // edge midpoints of the center cell, in bake units relative to tile center
  const EXITS = { L: [-0.5, 0], R: [0.5, 0], U: [0, -0.5], D: [0, 0.5] };

  function bakeTrailTile(cell, color, key) {
    const canvas = makeTile(cell, 3), ctx = canvas.getContext('2d');
    const u = cell * SCALE, cx = canvas.width / 2, cy = cx;
    const pts = [...key].filter((k) => EXITS[k]).map((k) => [cx + EXITS[k][0] * u, cy + EXITS[k][1] * u]);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const path = () => {
      ctx.beginPath();
      if (pts.length === 2) { ctx.moveTo(...pts[0]); ctx.quadraticCurveTo(cx, cy, ...pts[1]); }
      else if (pts.length === 1) { ctx.moveTo(...pts[0]); ctx.lineTo(cx, cy); }
      else { ctx.moveTo(cx - u * 0.01, cy); ctx.lineTo(cx + u * 0.01, cy); }
    };
    // layered strokes: wide soft glow -> colored body -> white-hot core
    const layers = [
      { w: 0.95, a: 0.22, c: color, blur: 0.8 },
      { w: 0.55, a: 0.85, c: color, blur: 0.3 },
      { w: 0.20, a: 0.90, c: '#ffffff', blur: 0 },
    ];
    for (const l of layers) {
      ctx.globalAlpha = l.a; ctx.strokeStyle = l.c; ctx.lineWidth = u * l.w;
      ctx.shadowColor = l.c; ctx.shadowBlur = u * l.blur;
      path(); ctx.stroke();
    }
    return canvas;
  }

  // --- cycle: baked facing right, rotated at blit time -------------------
  function bakeCycle(cell, color) {
    const canvas = makeTile(cell, 3), ctx = canvas.getContext('2d');
    const u = cell * SCALE, cx = canvas.width / 2, cy = cx;
    ctx.translate(cx, cy);
    // glow halo
    let g = ctx.createRadialGradient(0, 0, 0, 0, 0, u * 1.3);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.30; ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, u * 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // rear wheel: glowing disc, dark hub
    const wheel = (x, r) => {
      const wg = ctx.createRadialGradient(x, 0, r * 0.2, x, 0, r);
      wg.addColorStop(0, '#0a0d14'); wg.addColorStop(0.75, color); wg.addColorStop(1, '#ffffff');
      ctx.fillStyle = wg;
      ctx.shadowColor = color; ctx.shadowBlur = u * 0.5;
      ctx.beginPath(); ctx.arc(x, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#05060a';
      ctx.beginPath(); ctx.arc(x, 0, r * 0.35, 0, Math.PI * 2); ctx.fill();
    };
    wheel(-u * 0.48, u * 0.27);
    wheel(u * 0.52, u * 0.19);
    // fairing: smooth teardrop, gradient nose->tail, drawn over the wheel edges
    const body = () => {
      ctx.beginPath();
      ctx.moveTo(u * 0.66, 0);
      ctx.bezierCurveTo(u * 0.45, -u * 0.30, -u * 0.10, -u * 0.34, -u * 0.46, -u * 0.22);
      ctx.bezierCurveTo(-u * 0.60, -u * 0.10, -u * 0.60, u * 0.10, -u * 0.46, u * 0.22);
      ctx.bezierCurveTo(-u * 0.10, u * 0.34, u * 0.45, u * 0.30, u * 0.66, 0);
      ctx.closePath();
    };
    const bg = ctx.createLinearGradient(u * 0.66, 0, -u * 0.6, 0);
    bg.addColorStop(0, '#ffffff'); bg.addColorStop(0.25, color); bg.addColorStop(1, '#101624');
    ctx.fillStyle = bg;
    ctx.shadowColor = color; ctx.shadowBlur = u * 0.6;
    body(); ctx.fill();
    // rim light outline
    ctx.shadowBlur = 0; ctx.strokeStyle = color; ctx.lineWidth = u * 0.05;
    ctx.globalAlpha = 0.9; body(); ctx.stroke(); ctx.globalAlpha = 1;
    // canopy slit + specular
    ctx.fillStyle = '#05060a';
    ctx.beginPath();
    ctx.roundRect(-u * 0.14, -u * 0.09, u * 0.34, u * 0.18, u * 0.08);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = u * 0.03;
    ctx.beginPath(); ctx.moveTo(-u * 0.10, -u * 0.05); ctx.lineTo(u * 0.14, -u * 0.05); ctx.stroke();
    return canvas;
  }

  // --- bolt: elongated plasma round, 3 flicker variants, facing right ----
  function bakeBolt(cell, color, seed) {
    const canvas = makeTile(cell, 3), ctx = canvas.getContext('2d');
    const u = cell * SCALE, cx = canvas.width / 2, cy = cx;
    ctx.translate(cx, cy);
    const flick = 1 + 0.12 * Math.sin(seed * 2.4); // per-variant size jitter
    // tail streak: tapered, fading behind the round
    const tg = ctx.createLinearGradient(-u * 1.1 * flick, 0, u * 0.2, 0);
    tg.addColorStop(0, 'rgba(0,0,0,0)'); tg.addColorStop(1, color);
    ctx.fillStyle = tg; ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(-u * 1.1 * flick, 0);
    ctx.quadraticCurveTo(-u * 0.3, -u * 0.14, u * 0.15, -u * 0.10);
    ctx.lineTo(u * 0.15, u * 0.10);
    ctx.quadraticCurveTo(-u * 0.3, u * 0.14, -u * 1.1 * flick, 0);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    // plasma sheath
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = u * 0.8;
    ctx.beginPath(); ctx.ellipse(u * 0.12, 0, u * 0.42 * flick, u * 0.20, 0, 0, Math.PI * 2); ctx.fill();
    // white-hot core
    ctx.fillStyle = '#ffffff'; ctx.shadowBlur = u * 0.4;
    ctx.beginPath(); ctx.ellipse(u * 0.16, 0, u * 0.26 * flick, u * 0.11, 0, 0, Math.PI * 2); ctx.fill();
    return canvas;
  }

  // --- wall: beveled dark slab with glowing seams -------------------------
  function bakeWall(cell, borderColor) {
    const canvas = makeTile(cell, 2), ctx = canvas.getContext('2d');
    const u = cell * SCALE, o = (canvas.width - u) / 2; // slab covers the center cell
    const inset = u * 0.06;
    // slab body with subtle depth gradient
    const g = ctx.createLinearGradient(o, o, o + u, o + u);
    g.addColorStop(0, '#131a26'); g.addColorStop(1, '#070a10');
    ctx.fillStyle = g;
    ctx.fillRect(o + inset, o + inset, u - inset * 2, u - inset * 2);
    // bevel: light top-left, dark bottom-right
    ctx.lineWidth = u * 0.045;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.moveTo(o + inset, o + u - inset); ctx.lineTo(o + inset, o + inset); ctx.lineTo(o + u - inset, o + inset); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.moveTo(o + u - inset, o + inset); ctx.lineTo(o + u - inset, o + u - inset); ctx.lineTo(o + inset, o + u - inset); ctx.stroke();
    // glowing edge seam in the arena border color
    ctx.strokeStyle = borderColor; ctx.lineWidth = u * 0.06;
    ctx.shadowColor = borderColor; ctx.shadowBlur = u * 0.45;
    ctx.globalAlpha = 0.9;
    ctx.strokeRect(o + inset * 2, o + inset * 2, u - inset * 4, u - inset * 4);
    return canvas;
  }

  // --- pickups: hex badge + drawn icon ------------------------------------
  const PICKUP_COLORS = { shield: '#66e0ff', freeze: '#bdeeff', ammo: '#ff9d2b', phase: '#b06bff' };

  function hexPath(ctx, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  const ICONS = {
    shield(ctx, u) { // classic shield outline
      ctx.beginPath();
      ctx.moveTo(0, -u * 0.26);
      ctx.lineTo(u * 0.20, -u * 0.18);
      ctx.lineTo(u * 0.20, u * 0.02);
      ctx.quadraticCurveTo(u * 0.20, u * 0.20, 0, u * 0.30);
      ctx.quadraticCurveTo(-u * 0.20, u * 0.20, -u * 0.20, u * 0.02);
      ctx.lineTo(-u * 0.20, -u * 0.18);
      ctx.closePath();
      ctx.stroke();
    },
    freeze(ctx, u) { // six-spoke snowflake with ticks
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        const dx = Math.cos(a), dy = Math.sin(a);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(dx * u * 0.28, dy * u * 0.28); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(dx * u * 0.18 - dy * u * 0.07, dy * u * 0.18 + dx * u * 0.07);
        ctx.lineTo(dx * u * 0.28, dy * u * 0.28);
        ctx.lineTo(dx * u * 0.18 + dy * u * 0.07, dy * u * 0.18 - dx * u * 0.07);
        ctx.stroke();
      }
    },
    ammo(ctx, u) { // lightning bolt, filled
      ctx.beginPath();
      ctx.moveTo(u * 0.08, -u * 0.30);
      ctx.lineTo(-u * 0.14, u * 0.04);
      ctx.lineTo(-u * 0.01, u * 0.04);
      ctx.lineTo(-u * 0.08, u * 0.30);
      ctx.lineTo(u * 0.14, -u * 0.04);
      ctx.lineTo(u * 0.01, -u * 0.04);
      ctx.closePath();
      ctx.fill();
    },
    phase(ctx, u) { // little ghost
      ctx.beginPath();
      ctx.arc(0, -u * 0.06, u * 0.20, Math.PI, 0);
      ctx.lineTo(u * 0.20, u * 0.22);
      ctx.lineTo(u * 0.10, u * 0.14);
      ctx.lineTo(0, u * 0.22);
      ctx.lineTo(-u * 0.10, u * 0.14);
      ctx.lineTo(-u * 0.20, u * 0.22);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath(); ctx.arc(-u * 0.07, -u * 0.08, u * 0.03, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(u * 0.07, -u * 0.08, u * 0.03, 0, Math.PI * 2); ctx.fill();
    },
  };

  function bakePickup(cell, type) {
    const canvas = makeTile(cell, 3), ctx = canvas.getContext('2d');
    const u = cell * SCALE, color = PICKUP_COLORS[type];
    ctx.translate(canvas.width / 2, canvas.height / 2);
    // soft inner glow
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, u * 0.55);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.25; ctx.fillStyle = g;
    hexPath(ctx, u * 0.55); ctx.fill();
    ctx.globalAlpha = 1;
    // hex frame
    ctx.strokeStyle = color; ctx.lineWidth = u * 0.06;
    ctx.shadowColor = color; ctx.shadowBlur = u * 0.7;
    hexPath(ctx, u * 0.52); ctx.stroke();
    // icon
    ctx.shadowBlur = u * 0.3;
    ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff'; ctx.lineWidth = u * 0.05;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ICONS[type](ctx, u);
    return canvas;
  }

  const BOLT_FRAMES = 3;

  // Bake the full atlas for the current cell size / colors / border color.
  // Rebake whenever any of those change (round start, resize).
  function bake({ cell, colors, borderColor }) {
    const uniq = [...new Set(colors)];
    const atlas = {
      cell, cycles: {}, bolts: {}, trails: {}, pickups: {},
      wall: bakeWall(cell, borderColor),
      spans: { cycle: 3, bolt: 3, trail: 3, wall: 2, pickup: 3 },
    };
    for (const color of uniq) {
      atlas.cycles[color] = bakeCycle(cell, color);
      atlas.bolts[color] = Array.from({ length: BOLT_FRAMES }, (_, i) => bakeBolt(cell, color, i));
      atlas.trails[color] = {};
      for (const key of TRAIL_KEYS) atlas.trails[color][key] = bakeTrailTile(cell, color, key);
    }
    for (const type of Object.keys(PICKUP_COLORS)) atlas.pickups[type] = bakePickup(cell, type);
    return atlas;
  }
```

Extend the return: `return { __name: 'Sprites', trailKey, bake, TRAIL_KEYS, BOLT_FRAMES };`

**Step 2:** `node --test` — all still pass (bake is never called under Node; `document` is only touched inside functions).

**Step 3: Commit** — `feat: bake sprite atlas (cycles, bolts, trails, walls, pickups)`

---

### Task 3: renderer blits from the atlas

**Files:**
- Modify: `src/renderer.js`

`render` gains a trailing `atlas` param; all callers (main.js, updated in Task 4) always provide it. `drawGrid`, `drawFlashes`, `drawShieldRing`, `drawFrostOverlay`, `fadeAlpha`, colors API: unchanged.

**Step 1: Add a centered-blit helper** near the top of the factory:

```js
  // Sprites are baked on padded square canvases; blit centered on the cell.
  function blit(ctx, img, cellX, cellY, cell, span) {
    const d = (span - 1) / 2;
    ctx.drawImage(img, (cellX - d) * cell, (cellY - d) * cell, span * cell, span * cell);
  }
```

**Step 2: Replace `drawCycle`** (keep name/signature + `atlas` param):

```js
  function drawCycle(ctx, snake, color, cell, atlas) {
    const head = snake.body[snake.body.length - 1];
    const img = atlas.cycles[color];
    const span = atlas.spans.cycle;
    ctx.save();
    ctx.translate((head.x + 0.5) * cell, (head.y + 0.5) * cell);
    ctx.rotate(ANGLES[snake.direction]);
    ctx.drawImage(img, -span * cell / 2, -span * cell / 2, span * cell, span * cell);
    ctx.restore();
  }
```

**Step 3: Replace `drawWalls` / `drawBolts`:**

```js
  function drawWalls(ctx, walls, cell, atlas) {
    if (!walls || !walls.length) return;
    for (const c of walls) blit(ctx, atlas.wall, c.x, c.y, cell, atlas.spans.wall);
  }

  function drawBolts(ctx, bolts, colors, cell, atlas, elapsedSec) {
    if (!bolts || !bolts.length) return;
    const span = atlas.spans.bolt;
    for (const b of bolts) {
      const frames = atlas.bolts[colors[b.ownerIndex]] || atlas.bolts[colors[0]];
      const img = frames[((elapsedSec * 20) | 0) % frames.length];
      ctx.save();
      ctx.translate((b.pos.x + 0.5) * cell, (b.pos.y + 0.5) * cell);
      ctx.rotate(Math.atan2(b.dir.y, b.dir.x)); // spray bolts travel diagonally
      ctx.drawImage(img, -span * cell / 2, -span * cell / 2, span * cell, span * cell);
      ctx.restore();
    }
  }
```

**Step 4: Replace the trail loop in `drawSnake`** (shield/frost calls unchanged):

```js
  function drawSnake(ctx, snake, color, cell, trailMode, elapsedSec, frozen, atlas) {
    const tiles = atlas.trails[color];
    const span = atlas.spans.trail;
    const baseAlpha = snake.phase ? 0.5 : 1; // ghosted-once charge still armed
    ctx.save();
    for (let i = 0; i < snake.body.length; i++) {
      const c = snake.body[i];
      let a = baseAlpha;
      if (trailMode === 'fade') a *= fadeAlpha(elapsedSec - c.t, T.FADE_SECONDS);
      ctx.globalAlpha = a;
      const key = Sprites.trailKey(snake.body[i - 1] || null, c, snake.body[i + 1] || null);
      blit(ctx, tiles[key], c.x, c.y, cell, span);
    }
    ctx.restore();
    drawCycle(ctx, snake, color, cell, atlas);
    if (snake.shield) drawShieldRing(ctx, snake, cell, elapsedSec);
    if (frozen) drawFrostOverlay(ctx, snake, cell);
  }
```

`Sprites` comes in through the UMD deps: change the wrapper's deps to
`{ T: require('./trail'), S: require('./sprites') }` / `{ T: window.Trail, S: window.Sprites }`, destructure `({ T, S })`, and use `S.trailKey`.

**Step 5: Replace `drawPickups`:**

```js
  function drawPickups(ctx, pickups, cell, elapsedSec, atlas) {
    if (!pickups || !pickups.length) return;
    const span = atlas.spans.pickup;
    for (const p of pickups) {
      const img = atlas.pickups[p.type] || atlas.pickups.ammo;
      const bob = Math.sin(elapsedSec * 3 + p.spawnedAt) * cell * 0.08;
      const d = (span - 1) / 2;
      ctx.drawImage(img, (p.pos.x - d) * cell, (p.pos.y - d) * cell + bob, span * cell, span * cell);
    }
  }
```

Delete the now-unused `PICKUP_STYLE` table.

**Step 6: Thread `atlas` through `render`:**

```js
  function render(ctx, round, cell, colors = COLORS, borderColor = '#ff2b4a', elapsedSec = 0, flashes = [], atlas) {
    const { board, snakes, bolts, pickups, frozenUntil } = round;
    drawGrid(ctx, board.width, board.height, cell, borderColor);
    drawWalls(ctx, board.walls, cell, atlas);
    drawPickups(ctx, pickups, cell, elapsedSec, atlas);
    drawBolts(ctx, bolts, colors, cell, atlas, elapsedSec);
    drawFlashes(ctx, flashes, cell, elapsedSec);
    snakes.forEach((s, i) =>
      drawSnake(ctx, s, colors[i], cell, round.trailMode, elapsedSec, !!frozenUntil && elapsedSec < frozenUntil[i], atlas));
  }
```

**Step 7:** `node --test` — all pass (renderer has no unit tests; sprites requires cleanly under Node).

**Step 8: Commit** — `feat: renderer blits baked sprites instead of procedural drawing`

---

### Task 4: wire baking into main.js, load sprites.js, bump version

**Files:**
- Modify: `src/main.js` (`newRound` ~line 81, resize handler ~line 464, 4 `Renderer.render` call sites: lines ~308, ~331, ~352, ~363)
- Modify: `index.html` (new script tag; all `?v=` + `#version` → 0.9.0)
- Modify: `package.json` (version → 0.9.0)

**Step 1:** In `newRound()`, after `const f = Renderer.fit(...)`:

```js
    state.atlas = Sprites.bake({ cell, colors: state.colors, borderColor: state.borderColor });
```

Add `atlas: null` to the initial `state` object literal.

**Step 2:** In the resize handler, rebake after refit:

```js
  window.addEventListener('resize', () => {
    if (state.round) {
      const f = Renderer.fit(canvas, COLS, ROWS); cell = f.cell; ctx = f.ctx;
      state.atlas = Sprites.bake({ cell, colors: state.colors, borderColor: state.borderColor });
    }
  });
```

**Step 3:** Append `state.atlas` to all 4 `Renderer.render(...)` calls (each currently ends with `state.flashes`).

**Step 4:** In `index.html`, add `<script src="src/sprites.js?v=0.9.0"></script>` on the line **before** the `renderer.js` tag (renderer now depends on it). Bump every `?v=0.8.0` → `?v=0.9.0` (stylesheet + all scripts), `#version` text → `v0.9.0`.

**Step 5:** `package.json` version → `0.9.0`.

**Step 6:** `node --test` — all pass.

**Step 7: Commit** — `feat: wire sprite atlas into game loop; bump to 0.9.0`

---

### Task 5: browser verification

Use the `neon-cycles-static` preview server (port 8734).

1. Load the page fresh; confirm zero console errors on the menu.
2. Start **1P Survival**, trail TRON: screenshot — cycle sprite oriented correctly for all 4 directions, trail ribbons continuous with rounded corners on turns.
3. Fire (`/` key): bolts show elongated plasma rounds oriented along travel (including diagonal spray bolts); bounce/cut flashes still render.
4. Start **vs CPU** with walls HIGH: beveled wall slabs with glowing seams; rival cycle in its signature color.
5. Trail **FADE** mode: trail tiles fade out (alpha applies to blits).
6. Pickups: wait for spawns; hex badges with icons bob; shield ring / frost overlay / phase transparency still visible when triggered.
7. Resize the window mid-round: sprites stay crisp (rebake fired).
8. Every player color in the palette: pick each swatch, confirm cycle/trail/bolt take the color.
9. `node --test` one final time.

Fix anything found (tuning bake constants is expected), then commit any fixes — `fix: sprite tuning from browser verification`.

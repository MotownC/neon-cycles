const assert = require('node:assert');
const { test } = require('node:test');
const Renderer = require('../src/renderer');

test('opponent gets the default P2 color when the player picks something else', () => {
  assert.strictEqual(Renderer.pickOpponentColor('#39ff6a'), Renderer.PALETTE[1]);
});

test('opponent falls back to a different color when the player picks the P2 default', () => {
  const chosen = Renderer.PALETTE[1];
  const opponent = Renderer.pickOpponentColor(chosen);
  assert.notStrictEqual(opponent, chosen);
});

test('every palette entry yields a distinct opponent color', () => {
  for (const color of Renderer.PALETTE) {
    assert.notStrictEqual(Renderer.pickOpponentColor(color), color);
  }
});

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

// Minimal mock 2D context: no-op stubs for everything drawGrid/drawWalls/
// drawSnake/drawCycle touch, plus a recorded log of drawImage calls so we can
// assert on what render() actually blitted from the sprite atlas.
function mockCtx() {
  const drawImageCalls = [];
  return {
    drawImageCalls,
    save() {}, restore() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, closePath() {}, fill() {},
    clearRect() {}, strokeRect() {}, translate() {}, rotate() {}, fillRect() {},
    rect() {}, clip() {}, createLinearGradient() { return { addColorStop() {} }; },
    drawImage(...args) { drawImageCalls.push(args); },
    set fillStyle(v) {}, get fillStyle() { return ''; },
    set strokeStyle(v) {}, get strokeStyle() { return ''; },
    set lineWidth(v) {}, get lineWidth() { return 0; },
    set shadowColor(v) {}, get shadowColor() { return ''; },
    set shadowBlur(v) {}, get shadowBlur() { return 0; },
    set globalAlpha(v) {}, get globalAlpha() { return 1; },
  };
}

// Fake atlas with tagged sprite entries; no real canvases needed since the
// mock context just records drawImage arguments.
function fakeAtlas(colors) {
  const atlas = {
    cycles: {}, bolts: {}, trails: {}, wall: { id: 'wall' },
    pickups: { shield: {}, freeze: {}, ammo: {}, phase: {} },
    spans: { cycle: 3, bolt: 3, trail: 3, wall: 2, pickup: 3 },
  };
  for (const color of colors) {
    atlas.cycles[color] = { id: `cycle-${color}` };
    atlas.bolts[color] = [{ id: `bolt-${color}-0` }, { id: `bolt-${color}-1` }, { id: `bolt-${color}-2` }];
    atlas.trails[color] = {};
  }
  return atlas;
}

test('render draws each active bolt', () => {
  const ctx = mockCtx();
  const colors = ['#00f0ff', '#ff2bd6'];
  const round = {
    board: { width: 10, height: 10, walls: [] },
    snakes: [],
    bolts: [{ ownerIndex: 0, pos: { x: 3, y: 3 }, dir: { x: 1, y: 0 } }],
    trailMode: 'tron',
  };
  Renderer.render(ctx, round, 10, colors, '#ff2b4a', 0, [], fakeAtlas(colors));
  assert.strictEqual(ctx.drawImageCalls.length, 1);
  const [img, , , w, h] = ctx.drawImageCalls[0];
  assert.match(img.id, /^bolt-#00f0ff/);
  assert.ok(w > 0 && h > 0);
});

test('render draws nothing extra when there are no bolts', () => {
  const ctx = mockCtx();
  const colors = ['#00f0ff', '#ff2bd6'];
  const round = {
    board: { width: 5, height: 5, walls: [] },
    snakes: [],
    bolts: [],
    trailMode: 'tron',
  };
  Renderer.render(ctx, round, 10, colors, '#ff2b4a', 0, [], fakeAtlas(colors));
  assert.strictEqual(ctx.drawImageCalls.length, 0); // no bolts, walls, or snakes to blit
});

const oneCellSnake = (extra) => ({ body: [{ x: 2, y: 3, t: 0 }], direction: 'right', ...extra });

function logTranslates(ctx) {
  const log = [];
  ctx.translate = (x, y) => log.push([x, y]);
  return log;
}

test('drawSnake draws no cycle for a wrecked snake', () => {
  const ctx = mockCtx();
  const color = '#00f0ff';
  Renderer.drawSnake(ctx, oneCellSnake({ wrecked: true }), color, 10, 'tron', 0, false, fakeAtlas([color]));
  assert.ok(!ctx.drawImageCalls.some(([img]) => img && img.id === `cycle-${color}`));
});

test('drawSnake puts the cycle at cycleAt when a replay supplies one', () => {
  const ctx = mockCtx();
  const color = '#00f0ff';
  const translates = logTranslates(ctx);
  Renderer.drawSnake(ctx, oneCellSnake({ cycleAt: { x: 2.5, y: 3 } }), color, 10, 'tron', 0, false, fakeAtlas([color]));
  assert.deepStrictEqual(translates[0], [30, 35]);
});

test('drawDebris cuts fragments from the sprite of the dead snake only', () => {
  const ctx = mockCtx();
  const colors = ['#00f0ff', '#ff2bd6'];
  const atlas = fakeAtlas(colors);
  atlas.cycles[colors[1]].width = 120;
  const piece = { kind: 'fragment', ox: 0, oy: 0, size: 0.5, x0: 1, y0: 1, vx: 0, vy: 0, rot0: 0, spin: 0, life: 1 };
  Renderer.drawDebris(ctx, [{ snakeIndex: 1, pieces: [piece] }], 0.1, colors, 10, atlas);
  assert.strictEqual(ctx.drawImageCalls.length, 1);
  const [img, sx, , sw] = ctx.drawImageCalls[0];
  assert.strictEqual(img.id, `cycle-${colors[1]}`);
  assert.strictEqual(sx, 50); // (0 - 0.25 + 1.5) cells * 40 px per cell
  assert.strictEqual(sw, 20);
});

test('drawDebris skips pieces that have burned out', () => {
  const ctx = mockCtx();
  const colors = ['#00f0ff', '#ff2bd6'];
  const piece = { kind: 'fragment', ox: 0, oy: 0, size: 0.5, x0: 1, y0: 1, vx: 0, vy: 0, rot0: 0, spin: 0, life: 0.2 };
  Renderer.drawDebris(ctx, [{ snakeIndex: 0, pieces: [piece] }], 0.5, colors, 10, fakeAtlas(colors));
  assert.strictEqual(ctx.drawImageCalls.length, 0);
});

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
// drawSnake/drawCycle touch, plus a recorded log of fillRect calls so we can
// assert on what render() actually drew.
function mockCtx() {
  const fillRectCalls = [];
  return {
    fillRectCalls,
    save() {}, restore() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, closePath() {}, fill() {},
    clearRect() {}, strokeRect() {}, translate() {}, rotate() {},
    fillRect(...args) { fillRectCalls.push(args); },
    set fillStyle(v) {}, get fillStyle() { return ''; },
    set strokeStyle(v) {}, get strokeStyle() { return ''; },
    set lineWidth(v) {}, get lineWidth() { return 0; },
    set shadowColor(v) {}, get shadowColor() { return ''; },
    set shadowBlur(v) {}, get shadowBlur() { return 0; },
    set globalAlpha(v) {}, get globalAlpha() { return 1; },
  };
}

test('render draws each active bolt', () => {
  const ctx = mockCtx();
  const round = {
    board: { width: 10, height: 10, walls: [] },
    snakes: [],
    bolts: [{ ownerIndex: 0, pos: { x: 3, y: 3 }, dir: 'right' }],
    trailMode: 'tron',
  };
  Renderer.render(ctx, round, 10, ['#00f0ff', '#ff2bd6']);
  // drawGrid's background fill is fillRectCalls[0]; the bolt is the second call.
  assert.strictEqual(ctx.fillRectCalls.length, 2);
  const [x, y, w, h] = ctx.fillRectCalls[1];
  assert.ok(x > 30 && x < 40 && y > 30 && y < 40, `expected bolt cell coords, got ${x},${y}`);
  assert.ok(w > 0 && h > 0);
});

test('render draws nothing extra when there are no bolts', () => {
  const ctx = mockCtx();
  const round = {
    board: { width: 5, height: 5, walls: [] },
    snakes: [],
    bolts: [],
    trailMode: 'tron',
  };
  Renderer.render(ctx, round, 10, ['#00f0ff', '#ff2bd6']);
  assert.strictEqual(ctx.fillRectCalls.length, 1); // just drawGrid's background fill, no bolts
});

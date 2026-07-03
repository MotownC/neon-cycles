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

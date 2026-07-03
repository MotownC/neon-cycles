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

const { test } = require('node:test');
const assert = require('node:assert');
const Sprites = require('../src/sprites');

test('trailKey: straight horizontal', () => {
  assert.equal(Sprites.trailKey({ x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 }), 'LR');
});

test('trailKey: straight vertical', () => {
  assert.equal(Sprites.trailKey({ x: 2, y: 4 }, { x: 2, y: 5 }, { x: 2, y: 6 }), 'UD');
});

test('trailKey: corner (came from left, turned up)', () => {
  assert.equal(Sprites.trailKey({ x: 1, y: 5 }, { x: 2, y: 5 }, { x: 2, y: 4 }), 'LU');
});

test('trailKey: canonical order regardless of prev/next roles', () => {
  assert.equal(Sprites.trailKey({ x: 2, y: 4 }, { x: 2, y: 5 }, { x: 1, y: 5 }), 'LU');
});

test('trailKey: end cell (only one neighbor)', () => {
  assert.equal(Sprites.trailKey(null, { x: 2, y: 5 }, { x: 3, y: 5 }), 'R');
});

test('trailKey: lone cell', () => {
  assert.equal(Sprites.trailKey(null, { x: 2, y: 5 }, null), 'O');
});

test('trailKey: non-adjacent neighbor ignored (cut trail)', () => {
  assert.equal(Sprites.trailKey({ x: 9, y: 9 }, { x: 2, y: 5 }, { x: 3, y: 5 }), 'R');
});

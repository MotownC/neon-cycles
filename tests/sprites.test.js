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

const CPU = require('../src/cpu');

test('every CPU rival has its own bike shape, and humans have the classic', () => {
  assert.ok(Sprites.SHAPES.classic);
  for (const rival of Object.keys(CPU.PERSONALITIES)) assert.ok(Sprites.SHAPES[rival], `no bike for ${rival}`);
});

test('every bike fits inside its sprite tile and between its own wheels', () => {
  for (const [name, shape] of Object.entries(Sprites.SHAPES)) {
    const pts = [...shape.outline, ...shape.extras.flat()];
    for (const [x, y] of pts) assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 0.5, `${name} point ${x},${y} is out of range`);
    assert.strictEqual(shape.outline[0][1], 0, `${name} nose must sit on the centre line`);
    assert.strictEqual(shape.outline[shape.outline.length - 1][1], 0, `${name} tail must sit on the centre line`);
    assert.ok(shape.rear.x < shape.canopy.x && shape.canopy.x < shape.front.x, `${name} canopy must sit between the wheels`);
  }
});

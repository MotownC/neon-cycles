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

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

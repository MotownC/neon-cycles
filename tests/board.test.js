const assert = require('node:assert');
const { test } = require('node:test');
const B = require('../src/board');

test('inBounds respects edges', () => {
  const board = B.createBoard(10, 8);
  assert.strictEqual(B.inBounds(board, { x: 0, y: 0 }), true);
  assert.strictEqual(B.inBounds(board, { x: 9, y: 7 }), true);
  assert.strictEqual(B.inBounds(board, { x: -1, y: 0 }), false);
  assert.strictEqual(B.inBounds(board, { x: 10, y: 0 }), false);
  assert.strictEqual(B.inBounds(board, { x: 0, y: 8 }), false);
});

test('lit cells are tracked and detected', () => {
  const board = B.createBoard(10, 8);
  B.light(board, { x: 3, y: 3 });
  assert.strictEqual(B.isLit(board, { x: 3, y: 3 }), true);
  assert.strictEqual(B.isLit(board, { x: 4, y: 3 }), false);
});

test('wouldCollide is true off-board or onto a lit cell', () => {
  const board = B.createBoard(10, 8);
  B.light(board, { x: 5, y: 5 });
  assert.strictEqual(B.wouldCollide(board, { x: 5, y: 5 }), true);
  assert.strictEqual(B.wouldCollide(board, { x: -1, y: 0 }), true);
  assert.strictEqual(B.wouldCollide(board, { x: 6, y: 5 }), false);
});

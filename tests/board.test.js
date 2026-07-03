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

test('unlight clears a previously lit cell', () => {
  const board = B.createBoard(10, 8);
  B.light(board, { x: 3, y: 3 });
  B.unlight(board, { x: 3, y: 3 });
  assert.strictEqual(B.isLit(board, { x: 3, y: 3 }), false);
});

test('distanceMap holds BFS distances to reachable open cells', () => {
  const board = B.createBoard(5, 5);
  const dist = B.distanceMap(board, { x: 0, y: 0 });
  assert.strictEqual(dist.get('1,0'), 1);
  assert.strictEqual(dist.get('1,1'), 2);
  assert.strictEqual(dist.get('4,4'), 8);
  assert.strictEqual(dist.has('0,0'), false); // start excluded
  assert.strictEqual(dist.size, 24);
});

test('openArea counts reachable open cells from a point, excluding the point itself', () => {
  const board = B.createBoard(5, 5);
  assert.strictEqual(B.openArea(board, { x: 2, y: 2 }), 24);
});

test('openArea stops at lit cells and the board edge', () => {
  const board = B.createBoard(5, 5);
  // Wall off a single-cell pocket at (0,0), reachable only from (0,1) and (1,0).
  B.light(board, { x: 0, y: 1 });
  B.light(board, { x: 1, y: 0 });
  assert.strictEqual(B.openArea(board, { x: 0, y: 0 }), 0);
});

test('openArea measures the size of an enclosed region', () => {
  const board = B.createBoard(10, 10);
  // Seal a 3x3 room (interior x=3..5,y=3..5) with a full perimeter.
  for (let x = 2; x <= 6; x++) { B.light(board, { x, y: 2 }); B.light(board, { x, y: 6 }); }
  for (let y = 2; y <= 6; y++) { B.light(board, { x: 2, y }); B.light(board, { x: 6, y }); }
  assert.strictEqual(B.openArea(board, { x: 4, y: 4 }), 8);
});

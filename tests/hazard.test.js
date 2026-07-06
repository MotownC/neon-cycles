const assert = require('node:assert');
const { test } = require('node:test');
const H = require('../src/hazard');

test('borderRing at margin 0 is the full outer perimeter', () => {
  const cells = H.borderRing(6, 4, 0);
  const set = new Set(cells.map((c) => c.x + ',' + c.y));
  assert.strictEqual(cells.length, 2 * 6 + 2 * 4 - 4); // perimeter, no double-counted corners
  for (let x = 0; x < 6; x++) { assert.ok(set.has(`${x},0`)); assert.ok(set.has(`${x},3`)); }
  for (let y = 0; y < 4; y++) { assert.ok(set.has(`0,${y}`)); assert.ok(set.has(`5,${y}`)); }
  assert.ok(!set.has('1,1')); // interior cell not included
});

test('borderRing at margin 1 is one ring further in', () => {
  const cells = H.borderRing(6, 4, 1);
  const set = new Set(cells.map((c) => c.x + ',' + c.y));
  assert.ok(set.has('1,1'));
  assert.ok(set.has('4,1'));
  assert.ok(!set.has('0,0')); // outermost ring not re-included
});

test('squareRing at radius 1 is the 8-cell ring around the center', () => {
  const cells = H.squareRing(20, 14, 10, 7, 1);
  const set = new Set(cells.map((c) => c.x + ',' + c.y));
  assert.strictEqual(cells.length, 8);
  for (const [x, y] of [[9,6],[10,6],[11,6],[9,7],[11,7],[9,8],[10,8],[11,8]]) {
    assert.ok(set.has(`${x},${y}`), `missing ${x},${y}`);
  }
});

test('squareRing clips cells outside the board', () => {
  const cells = H.squareRing(6, 4, 0, 0, 1); // center at corner, ring mostly off-board
  for (const c of cells) {
    assert.ok(c.x >= 0 && c.x < 6 && c.y >= 0 && c.y < 4);
  }
  assert.ok(cells.length > 0 && cells.length < 8);
});

const assert = require('node:assert');
const { test } = require('node:test');
const Glide = require('../src/glide');

const snake = (cells, direction, alive = true) => ({ body: cells.map(([x, y]) => ({ x, y })), direction, alive });

test('a one-cell move starts a glide from the cell it left', () => {
  const before = Glide.snapshot(snake([[4, 5]], 'right'));
  const g = Glide.note(before, snake([[4, 5], [5, 5]], 'right'));
  assert.deepStrictEqual(g.from, { x: 4, y: 5 });
  assert.strictEqual(g.fromDir, 'right');
});

test('no glide when the snake held still or died', () => {
  const before = Glide.snapshot(snake([[4, 5]], 'right'));
  assert.strictEqual(Glide.note(before, snake([[4, 5]], 'right')), null);
  assert.strictEqual(Glide.note(before, snake([[4, 5], [5, 5]], 'right', false)), null);
});

test('a fresh glide starts at the accumulator remainder, then runs on frame time', () => {
  const g = { from: { x: 0, y: 0 }, fromDir: 'right', ms: null };
  Glide.advance(g, 12, 16);
  assert.strictEqual(g.ms, 12);
  Glide.advance(g, 999, 16);
  assert.strictEqual(g.ms, 28);
  Glide.advance(null, 1, 1); // no glide: nothing to do
});

test('view places the cycle part-way between the two cells', () => {
  const s = snake([[4, 5], [5, 5]], 'right');
  const v = Glide.view(s, { from: { x: 4, y: 5 }, fromDir: 'right', ms: 25 }, 100);
  assert.deepStrictEqual(v.cycleAt, { x: 4.25, y: 5 });
  assert.strictEqual(v.turnFrom, undefined);
  assert.strictEqual(s.cycleAt, undefined); // the sim's snake is never touched
});

test('view returns the snake itself once the glide is over or absent', () => {
  const s = snake([[4, 5], [5, 5]], 'right');
  assert.strictEqual(Glide.view(s, { from: { x: 4, y: 5 }, fromDir: 'right', ms: 100 }, 100), s);
  assert.strictEqual(Glide.view(s, null, 100), s);
});

test('after a turn the nose swings round during the first part of the glide', () => {
  const s = snake([[4, 5], [4, 6]], 'down');
  const g = { from: { x: 4, y: 5 }, fromDir: 'right', ms: 100 * Glide.TURN_PORTION / 2 };
  const v = Glide.view(s, g, 100);
  assert.strictEqual(v.turnFrom, 'right');
  assert.ok(Math.abs(v.turnT - 0.5) < 1e-9);
  assert.ok(Math.abs(v.leanT - Glide.TURN_PORTION / 2) < 1e-9, 'the lean runs over the whole glide');
  g.ms = 90;
  assert.strictEqual(Glide.view(s, g, 100).turnT, 1);
});

const assert = require('node:assert');
const { test } = require('node:test');
const R = require('../src/round');
const S = require('../src/snake');

function setup(width, height, specs) {
  // specs: [{start, direction}] -> round state
  return R.createRound(width, height, specs);
}

test('a snake dies when it hits an edge', () => {
  const round = setup(5, 5, [{ start: { x: 4, y: 2 }, direction: 'right' }]);
  R.tick(round);
  assert.strictEqual(round.snakes[0].alive, false);
  assert.strictEqual(round.over, true);
});

test('a snake dies when it hits an existing trail', () => {
  const round = setup(10, 10, [{ start: { x: 5, y: 5 }, direction: 'right' }]);
  // manually lay a wall directly ahead
  round.board.lit.add('6,5');
  R.tick(round);
  assert.strictEqual(round.snakes[0].alive, false);
});

test('head-on into the same empty cell kills both (draw)', () => {
  const round = setup(10, 10, [
    { start: { x: 4, y: 5 }, direction: 'right' },
    { start: { x: 6, y: 5 }, direction: 'left' },
  ]);
  R.tick(round); // both target {5,5}
  assert.strictEqual(round.snakes[0].alive, false);
  assert.strictEqual(round.snakes[1].alive, false);
  assert.strictEqual(round.winnerIndex, null); // draw
});

test('tick consumes one buffered direction per tick', () => {
  const round = setup(10, 10, [{ start: { x: 5, y: 5 }, direction: 'right' }]);
  S.bufferDirection(round.snakes[0], 'up');
  S.bufferDirection(round.snakes[0], 'left');
  R.tick(round);
  assert.deepStrictEqual(round.snakes[0].body[round.snakes[0].body.length - 1], { x: 5, y: 4 });
  R.tick(round);
  assert.deepStrictEqual(round.snakes[0].body[round.snakes[0].body.length - 1], { x: 4, y: 4 });
});

test('last snake alive wins the round', () => {
  const round = setup(10, 10, [
    { start: { x: 0, y: 0 }, direction: 'up' },   // dies immediately (edge)
    { start: { x: 5, y: 5 }, direction: 'right' },
  ]);
  R.tick(round);
  assert.strictEqual(round.over, true);
  assert.strictEqual(round.winnerIndex, 1);
});

const assert = require('node:assert');
const { test } = require('node:test');
const R = require('../src/round');
const S = require('../src/snake');
const B = require('../src/board');
const Trail = require('../src/trail');

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
  assert.deepStrictEqual(round.snakes[0].body[round.snakes[0].body.length - 1], { x: 5, y: 4, t: 0 });
  R.tick(round);
  assert.deepStrictEqual(round.snakes[0].body[round.snakes[0].body.length - 1], { x: 4, y: 4, t: 0 });
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

test('createRound defaults to tron trail mode', () => {
  const round = setup(10, 10, [{ start: { x: 5, y: 5 }, direction: 'right' }]);
  assert.strictEqual(round.trailMode, 'tron');
});

test('createRound stores the requested trail mode', () => {
  const round = R.createRound(10, 10, [{ start: { x: 5, y: 5 }, direction: 'right' }], [], 'fade');
  assert.strictEqual(round.trailMode, 'fade');
});

test('classic mode trims the tail as the snake advances', () => {
  const round = R.createRound(50, 50, [{ start: { x: 25, y: 25 }, direction: 'right' }], [], 'classic');
  for (let i = 0; i < Trail.CLASSIC_LENGTH + 10; i++) R.tick(round, i);
  assert.strictEqual(round.snakes[0].body.length, Trail.CLASSIC_LENGTH);
});

test('fade mode unlights trail cells once they expire', () => {
  const round = R.createRound(50, 50, [{ start: { x: 5, y: 5 }, direction: 'right' }], [], 'fade');
  // initial cell (5,5) stamped t=0 at creation
  R.tick(round, 1); // head -> (6,5) at t=1; (5,5) is only 1s old
  assert.strictEqual(B.isLit(round.board, { x: 5, y: 5 }), true);
  R.tick(round, Trail.FADE_SECONDS); // (5,5) now FADE_SECONDS old -> popped
  assert.strictEqual(B.isLit(round.board, { x: 5, y: 5 }), false);
  assert.strictEqual(B.isLit(round.board, { x: 6, y: 5 }), true);
});

test('createRound initializes empty bolts and per-snake firedCount', () => {
  const round = setup(10, 10, [{ start: { x: 5, y: 5 }, direction: 'right' }, { start: { x: 6, y: 5 }, direction: 'left' }]);
  assert.deepStrictEqual(round.bolts, []);
  assert.deepStrictEqual(round.firedCount, [0, 0]);
});

test('a frozen snake does not move this tick while another snake advances normally', () => {
  const round = setup(10, 10, [
    { start: { x: 5, y: 5 }, direction: 'right' },
    { start: { x: 1, y: 1 }, direction: 'right' },
  ]);
  R.tick(round, 0, [0]); // freeze snake 0
  assert.deepStrictEqual(round.snakes[0].body[round.snakes[0].body.length - 1], { x: 5, y: 5, t: 0 });
  assert.strictEqual(round.snakes[0].body.length, 1); // no new head appended
  assert.deepStrictEqual(round.snakes[1].body[round.snakes[1].body.length - 1], { x: 2, y: 1, t: 0 });
  assert.strictEqual(round.snakes[1].body.length, 2);
});

test('a frozen snake does not consume its buffered direction queue', () => {
  const round = setup(10, 10, [{ start: { x: 5, y: 5 }, direction: 'right' }]);
  S.bufferDirection(round.snakes[0], 'up');
  R.tick(round, 0, [0]); // freeze snake 0
  assert.deepStrictEqual(round.snakes[0].queue, ['up']); // still buffered, not popped
  assert.strictEqual(round.snakes[0].body.length, 1); // did not move
});

test('a shielded snake survives a trail hit, consumes the shield, and holds position', () => {
  const round = setup(10, 10, [{ start: { x: 5, y: 5 }, direction: 'right' }]);
  round.snakes[0].shield = true;
  round.board.lit.add('6,5'); // wall directly ahead
  R.tick(round, 1);
  assert.strictEqual(round.snakes[0].alive, true);
  assert.strictEqual(round.snakes[0].shield, false);
  assert.strictEqual(round.snakes[0].body.length, 1); // did not advance
});

test('a shielded snake survives hitting the boundary', () => {
  const round = setup(5, 5, [{ start: { x: 4, y: 2 }, direction: 'right' }]);
  round.snakes[0].shield = true;
  R.tick(round);
  assert.strictEqual(round.snakes[0].alive, true);
  assert.strictEqual(round.snakes[0].shield, false);
});

test('an unshielded snake still dies as before', () => {
  const round = setup(10, 10, [{ start: { x: 5, y: 5 }, direction: 'right' }]);
  round.board.lit.add('6,5');
  R.tick(round);
  assert.strictEqual(round.snakes[0].alive, false);
});

test('a shielded snake absorbing a head-on saves the other snake too', () => {
  const round = setup(10, 10, [
    { start: { x: 4, y: 5 }, direction: 'right' },
    { start: { x: 6, y: 5 }, direction: 'left' },
  ]);
  round.snakes[0].shield = true;
  R.tick(round); // both target {5,5}
  assert.strictEqual(round.snakes[0].alive, true);
  assert.strictEqual(round.snakes[0].shield, false);
  assert.strictEqual(round.snakes[1].alive, true); // its target cell never got occupied
});

test('a phased snake ghosts through one trail cell and keeps moving', () => {
  const round = setup(10, 10, [{ start: { x: 5, y: 5 }, direction: 'right' }]);
  round.snakes[0].phase = true;
  round.board.lit.add('6,5');
  R.tick(round, 1);
  assert.strictEqual(round.snakes[0].alive, true);
  assert.strictEqual(round.snakes[0].phase, false);
  assert.deepStrictEqual(round.snakes[0].body[round.snakes[0].body.length - 1], { x: 6, y: 5, t: 1 });
});

test('phase does not save a snake from going out of bounds', () => {
  const round = setup(5, 5, [{ start: { x: 4, y: 2 }, direction: 'right' }]);
  round.snakes[0].phase = true;
  R.tick(round);
  assert.strictEqual(round.snakes[0].alive, false);
  assert.strictEqual(round.snakes[0].phase, true); // never consumed; boundary isn't phaseable
});

test('tickSingle: a shielded snake survives a collision, consumes shield, stays put', () => {
  const round = setup(10, 10, [{ start: { x: 5, y: 5 }, direction: 'right' }]);
  round.snakes[0].shield = true;
  round.board.lit.add('6,5');
  R.tickSingle(round, 0, 1);
  assert.strictEqual(round.snakes[0].alive, true);
  assert.strictEqual(round.snakes[0].shield, false);
  assert.strictEqual(round.snakes[0].body.length, 1);
});

test('tickSingle: a phased snake ghosts through another snake\'s trail', () => {
  const round = setup(10, 10, [
    { start: { x: 5, y: 5 }, direction: 'right' },
    { start: { x: 6, y: 8 }, direction: 'right' },
  ]);
  round.snakes[0].phase = true;
  round.snakes[1].body.push({ x: 6, y: 5, t: 0 }); // opponent trail directly ahead
  R.tickSingle(round, 0, 1);
  assert.strictEqual(round.snakes[0].alive, true);
  assert.strictEqual(round.snakes[0].phase, false);
  assert.deepStrictEqual(round.snakes[0].body[round.snakes[0].body.length - 1], { x: 6, y: 5, t: 1 });
});

test('tick with no frozenIndices argument behaves exactly as before (regression)', () => {
  const round = setup(10, 10, [
    { start: { x: 5, y: 5 }, direction: 'right' },
    { start: { x: 1, y: 1 }, direction: 'right' },
  ]);
  R.tick(round, 0);
  assert.deepStrictEqual(round.snakes[0].body[round.snakes[0].body.length - 1], { x: 6, y: 5, t: 0 });
  assert.deepStrictEqual(round.snakes[1].body[round.snakes[1].body.length - 1], { x: 2, y: 1, t: 0 });
  assert.strictEqual(round.snakes[0].alive, true);
  assert.strictEqual(round.snakes[1].alive, true);
});

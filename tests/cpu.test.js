const assert = require('node:assert');
const { test } = require('node:test');
const R = require('../src/round');
const CPU = require('../src/cpu');
const P = require('../src/projectile');

test('avoids a wall directly ahead', () => {
  const round = R.createRound(5, 5, [{ start: { x: 4, y: 2 }, direction: 'right' }]);
  const dir = CPU.chooseDirection(round, 0, () => 0);
  assert.notStrictEqual(dir, 'right');
});

test('avoids its own trail', () => {
  const round = R.createRound(10, 10, [{ start: { x: 5, y: 5 }, direction: 'right' }]);
  round.board.lit.add('6,5'); // straight ahead is blocked
  const dir = CPU.chooseDirection(round, 0, () => 0);
  assert.notStrictEqual(dir, 'right');
});

test('holds a straight line on an open board regardless of rand', () => {
  const round = R.createRound(20, 20, [{ start: { x: 10, y: 10 }, direction: 'right' }]);
  for (const r of [0, 0.5, 0.99]) {
    assert.strictEqual(CPU.chooseDirection(round, 0, () => r), 'right');
  }
});

test('goes straight into a crash when every option is unsafe', () => {
  const round = R.createRound(5, 5, [{ start: { x: 2, y: 2 }, direction: 'right' }]);
  round.board.lit.add('3,2'); // straight
  round.board.lit.add('2,1'); // left turn
  round.board.lit.add('2,3'); // right turn
  const dir = CPU.chooseDirection(round, 0, () => 0);
  assert.strictEqual(dir, 'right');
});

test('prefers open space over a cramped dead end', () => {
  const round = R.createRound(20, 20, [{ start: { x: 5, y: 5 }, direction: 'right' }]);
  // Wall off a tiny pocket to the right (straight ahead) leaving only one
  // free cell in that direction, while up/down lead into the open board.
  round.board.lit.add('7,5');
  round.board.lit.add('6,4');
  round.board.lit.add('6,6');
  const dir = CPU.chooseDirection(round, 0, () => 0.99);
  assert.notStrictEqual(dir, 'right');
});

test('turns toward the opponent to claim territory', () => {
  const round = R.createRound(64, 40, [
    { start: { x: 32, y: 35 }, direction: 'right' }, // CPU, low on the board
    { start: { x: 32, y: 5 }, direction: 'right' },  // opponent, high on the board
  ]);
  // Turning up shifts the Voronoi frontier toward the opponent, claiming far
  // more than the straight-line bonus protects.
  const dir = CPU.chooseDirection(round, 0, () => 0);
  assert.strictEqual(dir, 'up');
});

test('sidesteps an imminent head-on trade', () => {
  const round = R.createRound(20, 20, [
    { start: { x: 10, y: 10 }, direction: 'right' }, // CPU
    { start: { x: 12, y: 10 }, direction: 'left' },  // opponent, 2 cells away, closing
  ]);
  // Going straight enters (11,10), which the opponent can also enter this
  // tick — a mutual kill. The CPU should swerve instead of trading.
  const dir = CPU.chooseDirection(round, 0, () => 0);
  assert.notStrictEqual(dir, 'right');
});

test('fires when boxed in with ammo available', () => {
  const round = R.createRound(5, 5, [{ start: { x: 2, y: 2 }, direction: 'right' }]);
  round.board.lit.add('3,2'); // straight
  round.board.lit.add('2,1'); // left turn
  round.board.lit.add('2,3'); // right turn
  round.firedCount = [0];
  assert.strictEqual(CPU.shouldFire(round, 0, 0), true);
});

test('does not fire when boxed in but ammo is exhausted', () => {
  const round = R.createRound(5, 5, [{ start: { x: 2, y: 2 }, direction: 'right' }]);
  round.board.lit.add('3,2'); // straight
  round.board.lit.add('2,1'); // left turn
  round.board.lit.add('2,3'); // right turn
  round.firedCount = [P.AMMO_CAP];
  assert.strictEqual(CPU.shouldFire(round, 0, 0), false);
});

test('favors sealing the opponent into a room over grazing past it', () => {
  const round = R.createRound(20, 20, [
    { start: { x: 8, y: 4 }, direction: 'left' }, // CPU, approaching a room's only gap
    { start: { x: 4, y: 4 }, direction: 'up' },   // opponent, sealed inside the room
  ]);
  const board = round.board;
  // Wall off a 3x3 room (interior x=3..5,y=3..5) with a single gap at (6,4).
  for (let x = 3; x <= 5; x++) { board.lit.add(`${x},2`); board.lit.add(`${x},6`); }
  board.lit.add('2,3'); board.lit.add('2,4'); board.lit.add('2,5');
  board.lit.add('6,3'); board.lit.add('6,5');
  // Stepping onto (7,4) claims the gap's outside exit, so the opponent's
  // territory collapses to the room while the CPU keeps the whole board.
  const dir = CPU.chooseDirection(round, 0, () => 0.99);
  assert.strictEqual(dir, 'left');
});

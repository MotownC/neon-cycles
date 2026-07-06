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
  assert.strictEqual(CPU.shouldFire(round, 0, P.FIRE_DELAY_SEC), true);
});

test('does not fire when boxed in but ammo is exhausted', () => {
  const round = R.createRound(5, 5, [{ start: { x: 2, y: 2 }, direction: 'right' }]);
  round.board.lit.add('3,2'); // straight
  round.board.lit.add('2,1'); // left turn
  round.board.lit.add('2,3'); // right turn
  round.firedCount = [P.AMMO_CAP];
  assert.strictEqual(CPU.shouldFire(round, 0, P.FIRE_DELAY_SEC), false);
});

test('does not fire during the start-of-round lockout, even boxed in with ammo', () => {
  const round = R.createRound(5, 5, [{ start: { x: 2, y: 2 }, direction: 'right' }]);
  round.board.lit.add('3,2'); // straight
  round.board.lit.add('2,1'); // left turn
  round.board.lit.add('2,3'); // right turn
  round.firedCount = [0];
  assert.strictEqual(CPU.shouldFire(round, 0, P.FIRE_DELAY_SEC - 0.1), false);
});

test('PERSONALITIES exposes the five rivals with complete behavior knobs', () => {
  const keys = ['drifter', 'survivor', 'aggressor', 'ambusher', 'grandmaster'];
  assert.deepStrictEqual(Object.keys(CPU.PERSONALITIES), keys);
  for (const key of keys) {
    const p = CPU.PERSONALITIES[key];
    for (const field of ['straightBonus', 'headonPenalty', 'oppWeight', 'blunder', 'lookahead']) {
      assert.ok(field in p, `${key} missing ${field}`);
    }
    assert.ok(['boxed', 'losing', 'ambush'].includes(p.fire.mode), `${key} has unknown fire mode`);
  }
});

test('a blunder-prone personality can pick a non-optimal safe move', () => {
  const round = R.createRound(20, 20, [{ start: { x: 10, y: 10 }, direction: 'right' }]);
  // rand: 0.5 < blunder(1) triggers the mistake; 0.9 picks safe[2] (right turn)
  const seq = [0.5, 0.9];
  const rand = () => seq.shift();
  const dir = CPU.chooseDirection(round, 0, rand, { ...CPU.DEFAULT_PERSONALITY, blunder: 1 });
  assert.strictEqual(dir, 'down'); // baseline holds straight here; the blunder turned
});

test('a blundering personality still only picks from safe moves', () => {
  const round = R.createRound(10, 10, [{ start: { x: 5, y: 5 }, direction: 'right' }]);
  round.board.lit.add('6,5'); // straight blocked: safe = [up, down]
  for (const pick of [0, 0.5, 0.99]) {
    const seq = [0, pick];
    const dir = CPU.chooseDirection(round, 0, () => seq.shift(), { ...CPU.DEFAULT_PERSONALITY, blunder: 1 });
    assert.notStrictEqual(dir, 'right');
  }
});

// Split the board with a full-height wall so the CPU's side is slightly
// smaller: the best move scores a little below zero — losing, but not by much.
function slightlyLosingRound() {
  const round = R.createRound(20, 20, [
    { start: { x: 4, y: 10 }, direction: 'right' },  // CPU, smaller left side
    { start: { x: 15, y: 10 }, direction: 'left' },  // opponent, larger right side
  ]);
  for (let y = 0; y < 20; y++) round.board.lit.add(`9,${y}`);
  return round;
}

test('losing-mode fire thresholds gate the same position differently', () => {
  const round = slightlyLosingRound();
  round.firedCount = [0, 0];
  const t = P.FIRE_DELAY_SEC;
  const at = (threshold) =>
    CPU.shouldFire(round, 0, t, { ...CPU.DEFAULT_PERSONALITY, fire: { mode: 'losing', threshold } });
  assert.strictEqual(at(0), true);    // default: any losing position fires
  assert.strictEqual(at(-80), false); // hoarder: not losing badly enough yet
});

test('boxed-mode never fires from a losing but open position', () => {
  const round = slightlyLosingRound();
  round.firedCount = [0, 0];
  const fired = CPU.shouldFire(round, 0, P.FIRE_DELAY_SEC, { ...CPU.DEFAULT_PERSONALITY, fire: { mode: 'boxed' } });
  assert.strictEqual(fired, false);
});

test('ambush-mode fires when the opponent\'s escape area shrinks below its trigger', () => {
  const round = R.createRound(20, 20, [
    { start: { x: 15, y: 15 }, direction: 'right' }, // CPU, in the open (winning)
    { start: { x: 4, y: 4 }, direction: 'up' },      // opponent, sealed in a room
  ]);
  const board = round.board;
  for (let x = 2; x <= 6; x++) { board.lit.add(`${x},2`); board.lit.add(`${x},6`); }
  for (let y = 3; y <= 5; y++) { board.lit.add(`2,${y}`); board.lit.add(`6,${y}`); }
  round.firedCount = [0, 0];
  const t = P.FIRE_DELAY_SEC;
  const ambush = (openBelow) =>
    CPU.shouldFire(round, 0, t, { ...CPU.DEFAULT_PERSONALITY, fire: { mode: 'ambush', openBelow } });
  assert.strictEqual(ambush(60), true);  // room is tiny: strike now
  assert.strictEqual(ambush(5), false);  // trigger tighter than the room: hold
  // Winning position, so the default losing-mode CPU would hold its ammo here.
  assert.strictEqual(CPU.shouldFire(round, 0, t), false);
});

test('grandmaster lookahead holds a straight line on an open board', () => {
  const round = R.createRound(20, 20, [
    { start: { x: 5, y: 10 }, direction: 'right' },
    { start: { x: 15, y: 10 }, direction: 'left' },
  ]);
  // Deterministic and sane: 2-ply scoring should not invent a reason to swerve.
  assert.strictEqual(CPU.chooseDirection(round, 0, () => 0, CPU.PERSONALITIES.grandmaster), 'right');
});

test('grandmaster still avoids a wall directly ahead', () => {
  const round = R.createRound(10, 10, [
    { start: { x: 5, y: 5 }, direction: 'right' },
    { start: { x: 2, y: 2 }, direction: 'left' },
  ]);
  round.board.lit.add('6,5');
  const dir = CPU.chooseDirection(round, 0, () => 0, CPU.PERSONALITIES.grandmaster);
  assert.notStrictEqual(dir, 'right');
});

test('grandmaster sidesteps an imminent head-on trade', () => {
  const round = R.createRound(20, 20, [
    { start: { x: 10, y: 10 }, direction: 'right' },
    { start: { x: 12, y: 10 }, direction: 'left' },
  ]);
  const dir = CPU.chooseDirection(round, 0, () => 0, CPU.PERSONALITIES.grandmaster);
  assert.notStrictEqual(dir, 'right');
});

test('every rival yields the symmetric opening standoff instead of forcing a draw', () => {
  // Recreate the live round opening: 64x40, both cycles on the center row
  // driving at each other. After 15 ticks the heads sit two cells apart, both
  // targeting the middle cell next tick. Yielding costs ~650 Voronoi cells
  // (the yielder cedes the center junction), which is why any headonPenalty
  // below that made the old CPU draw every round against a player who held
  // straight. All rivals must swerve here.
  for (const key of Object.keys(CPU.PERSONALITIES)) {
    const round = R.createRound(64, 40, [
      { start: { x: 16, y: 20 }, direction: 'right' },
      { start: { x: 48, y: 20 }, direction: 'left' },
    ]);
    for (let t = 1; t <= 15; t++) R.tick(round, t);
    const dir = CPU.chooseDirection(round, 1, () => 0.6, CPU.PERSONALITIES[key]);
    assert.notStrictEqual(dir, 'left', `${key} drove into the head-on trade`);
  }
});

test('default parameters keep the original constants (regression guard)', () => {
  assert.strictEqual(CPU.DEFAULT_PERSONALITY.straightBonus, 10);
  assert.strictEqual(CPU.DEFAULT_PERSONALITY.headonPenalty, 200);
  assert.strictEqual(CPU.DEFAULT_PERSONALITY.oppWeight, 1);
  assert.strictEqual(CPU.DEFAULT_PERSONALITY.blunder, 0);
  assert.strictEqual(CPU.DEFAULT_PERSONALITY.lookahead, false);
  assert.deepStrictEqual(CPU.DEFAULT_PERSONALITY.fire, { mode: 'losing', threshold: 0 });
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

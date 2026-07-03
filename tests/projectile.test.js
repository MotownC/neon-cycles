const assert = require('node:assert');
const { test } = require('node:test');
const P = require('../src/projectile');
const B = require('../src/board');

test('createBolt spawns one cell ahead of the head in the travel direction', () => {
  const bolt = P.createBolt(0, { x: 5, y: 5 }, 'right');
  assert.deepStrictEqual(bolt, { ownerIndex: 0, pos: { x: 6, y: 5 }, dir: 'right' });
});

test('createBolt works for all four directions', () => {
  assert.deepStrictEqual(P.createBolt(1, { x: 3, y: 3 }, 'up').pos, { x: 3, y: 2 });
  assert.deepStrictEqual(P.createBolt(1, { x: 3, y: 3 }, 'down').pos, { x: 3, y: 4 });
  assert.deepStrictEqual(P.createBolt(1, { x: 3, y: 3 }, 'left').pos, { x: 2, y: 3 });
});

test('ammoAvailable starts at 1 and is unaffected before the first regen', () => {
  assert.strictEqual(P.ammoAvailable(0, 0), 1);
  assert.strictEqual(P.ammoAvailable(14.9, 0), 1);
});

test('ammoAvailable grants +1 every 15 seconds survived', () => {
  assert.strictEqual(P.ammoAvailable(15, 0), 2);
  assert.strictEqual(P.ammoAvailable(30, 0), 3);
});

test('ammoAvailable caps at 3 no matter how long the round runs', () => {
  assert.strictEqual(P.ammoAvailable(999, 0), 3);
});

test('ammoAvailable subtracts bolts already fired', () => {
  assert.strictEqual(P.ammoAvailable(30, 2), 1);
  assert.strictEqual(P.ammoAvailable(0, 1), 0);
});

test('advanceBolts moves a bolt one cell forward through open space', () => {
  const round = { board: B.createBoard(10, 10), bolts: [P.createBolt(0, { x: 5, y: 5 }, 'right')], snakes: [] };
  P.advanceBolts(round, 0);
  assert.strictEqual(round.bolts.length, 1);
  assert.deepStrictEqual(round.bolts[0].pos, { x: 7, y: 5 });
});

test('advanceBolts despawns a bolt that would leave the board', () => {
  const round = { board: B.createBoard(10, 10), bolts: [{ ownerIndex: 0, pos: { x: 9, y: 5 }, dir: 'right' }], snakes: [] };
  P.advanceBolts(round, 0);
  assert.strictEqual(round.bolts.length, 0);
});

test('advanceBolts cuts a 3-cell gap starting at a lit cell it hits', () => {
  const board = B.createBoard(10, 10);
  [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }].forEach((c) => B.light(board, c));
  const round = { board, bolts: [{ ownerIndex: 0, pos: { x: 5, y: 5 }, dir: 'right' }], snakes: [] };
  P.advanceBolts(round, 0);
  assert.strictEqual(round.bolts.length, 0); // consumed on impact
  assert.strictEqual(B.isLit(board, { x: 6, y: 5 }), false);
  assert.strictEqual(B.isLit(board, { x: 7, y: 5 }), false);
  assert.strictEqual(B.isLit(board, { x: 8, y: 5 }), false);
  assert.strictEqual(B.isLit(board, { x: 9, y: 5 }), true); // beyond the 3-cell gap
});

test('advanceBolts clips the gap at the board edge instead of erroring', () => {
  const board = B.createBoard(10, 10);
  [{ x: 8, y: 5 }, { x: 9, y: 5 }].forEach((c) => B.light(board, c));
  const round = { board, bolts: [{ ownerIndex: 0, pos: { x: 7, y: 5 }, dir: 'right' }], snakes: [] };
  P.advanceBolts(round, 0);
  assert.strictEqual(B.isLit(board, { x: 8, y: 5 }), false);
  assert.strictEqual(B.isLit(board, { x: 9, y: 5 }), false);
});

test('a wall cell is cut exactly like a trail cell (same lit Set)', () => {
  const board = B.createBoard(10, 10, [{ x: 6, y: 5 }]);
  const round = { board, bolts: [{ ownerIndex: 0, pos: { x: 5, y: 5 }, dir: 'right' }], snakes: [] };
  P.advanceBolts(round, 0);
  assert.strictEqual(B.isLit(board, { x: 6, y: 5 }), false);
});

test('advanceBolts stuns a snake hit directly in the head instead of cutting a gap', () => {
  const board = B.createBoard(10, 10);
  B.light(board, { x: 6, y: 5 }); // cell is lit too — proves stun is checked first, not just "happens to be unlit"
  const victim = { alive: true, body: [{ x: 6, y: 5, t: 0 }] };
  const round = { board, bolts: [{ ownerIndex: 0, pos: { x: 5, y: 5 }, dir: 'right' }], snakes: [victim] };
  P.advanceBolts(round, 10);
  assert.strictEqual(round.bolts.length, 0);
  assert.strictEqual(victim.stunnedUntil, 12);
  assert.strictEqual(B.isLit(board, { x: 6, y: 5 }), true); // gap-cut did NOT run; cell stays lit
});

test('advanceBolts ignores dead snakes when checking for a head hit', () => {
  const board = B.createBoard(10, 10);
  const victim = { alive: false, body: [{ x: 6, y: 5, t: 0 }] };
  const round = { board, bolts: [{ ownerIndex: 0, pos: { x: 5, y: 5 }, dir: 'right' }], snakes: [victim] };
  P.advanceBolts(round, 10);
  assert.strictEqual(round.bolts.length, 1); // passed through the empty (unlit) cell
  assert.strictEqual(victim.stunnedUntil, undefined);
});

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

const B = require('../src/board');

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function makeRound(width, height, headPos) {
  const board = B.createBoard(width, height, []);
  const snake = { alive: true, body: [headPos] };
  return { board, snakes: [snake] };
}

test('createHazard starts with no telegraph, first event at 15s', () => {
  const hz = H.createHazard(20, 14);
  assert.strictEqual(hz.telegraph, null);
  assert.strictEqual(hz.nextEventAt, 15);
  assert.strictEqual(hz.frozen, false);
});

test('advance schedules a telegraph at the event time but does not solidify yet', () => {
  const round = makeRound(20, 14, { x: 0, y: 0 });
  const hz = H.createHazard(20, 14);
  H.advance(round, hz, 15, () => 0.9); // 0.9 >= 0.5 -> 'square'
  assert.ok(hz.telegraph);
  assert.strictEqual(hz.telegraph.type, 'square');
  assert.strictEqual(round.board.walls.length, 0); // not solid yet
});

test('advance solidifies the telegraphed cells one second later', () => {
  const round = makeRound(20, 14, { x: 0, y: 0 });
  const hz = H.createHazard(20, 14);
  H.advance(round, hz, 15, () => 0.1); // 0.1 < 0.5 -> 'border'
  H.advance(round, hz, 16, () => 0.1);
  assert.strictEqual(hz.telegraph, null);
  assert.ok(round.board.walls.length > 0);
  assert.ok(B.isLit(round.board, { x: 0, y: 0 }));
});

test('a snake head on a solidifying cell dies and is flagged', () => {
  const round = makeRound(20, 14, { x: 0, y: 0 }); // corner is on the border ring at margin 0
  const hz = H.createHazard(20, 14);
  H.advance(round, hz, 15, () => 0.1); // border
  H.advance(round, hz, 16, () => 0.1); // solidify
  assert.strictEqual(round.snakes[0].alive, false);
  assert.strictEqual(round.snakes[0].crushedByHazard, true);
});

test('a snake head elsewhere survives the same event', () => {
  const round = makeRound(20, 14, { x: 10, y: 7 }); // dead center, far from the border ring
  const hz = H.createHazard(20, 14);
  H.advance(round, hz, 15, () => 0.1);
  H.advance(round, hz, 16, () => 0.1);
  assert.strictEqual(round.snakes[0].alive, true);
});

test('advance freezes once the safety floor is reached and stops changing the board', () => {
  const round = makeRound(20, 14, { x: 10, y: 7 });
  const hz = H.createHazard(20, 14);
  let t = 15;
  const rand = seeded(1);
  for (let i = 0; i < 50 && !hz.frozen; i++) {
    H.advance(round, hz, t, rand);      // schedule (or freeze)
    if (hz.telegraph) H.advance(round, hz, t + 1, rand); // solidify
    t += 15;
  }
  assert.strictEqual(hz.frozen, true);
  const wallsBefore = round.board.walls.length;
  H.advance(round, hz, t + 100, rand);
  assert.strictEqual(round.board.walls.length, wallsBefore); // no further changes
});

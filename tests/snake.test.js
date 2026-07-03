const assert = require('node:assert');
const { test } = require('node:test');
const S = require('../src/snake');
const G = require('../src/geometry');

test('createSnake seeds a one-cell body facing a direction', () => {
  const s = S.createSnake({ x: 5, y: 5 }, 'right');
  assert.deepStrictEqual(s.body, [{ x: 5, y: 5 }]);
  assert.strictEqual(s.direction, 'right');
  assert.strictEqual(s.alive, true);
});

test('bufferDirection ignores 180-degree reversals', () => {
  const s = S.createSnake({ x: 5, y: 5 }, 'right');
  S.bufferDirection(s, 'left');
  S.stepSnake(s);
  assert.strictEqual(s.direction, 'right'); // reversal dropped, kept moving right
});

test('stepSnake applies a buffered direction and appends new head', () => {
  const s = S.createSnake({ x: 5, y: 5 }, 'right');
  S.bufferDirection(s, 'up');
  const head = S.stepSnake(s);
  assert.deepStrictEqual(head, { x: 5, y: 4 });
  assert.strictEqual(s.direction, 'up');
  assert.deepStrictEqual(s.body[s.body.length - 1], { x: 5, y: 4 });
});

test('a rapid S-turn executes both presses over successive steps', () => {
  const s = S.createSnake({ x: 5, y: 5 }, 'right');
  // both keys pressed within one tick window
  S.bufferDirection(s, 'up');
  S.bufferDirection(s, 'left');
  assert.deepStrictEqual(S.stepSnake(s), { x: 5, y: 4 }); // first press: up
  assert.deepStrictEqual(S.stepSnake(s), { x: 4, y: 4 }); // second press: left
});

test('a queued turn cannot be overwritten into its own reversal', () => {
  const s = S.createSnake({ x: 5, y: 5 }, 'right');
  S.bufferDirection(s, 'up');
  S.bufferDirection(s, 'down'); // legal vs 'right', but a 180 of the queued 'up'
  assert.deepStrictEqual(S.stepSnake(s), { x: 5, y: 4 }); // up happens
  assert.deepStrictEqual(S.stepSnake(s), { x: 5, y: 3 }); // still up, down was dropped
});

test('buffered turns are capped so mashed keys cannot pile up', () => {
  const s = S.createSnake({ x: 10, y: 10 }, 'right');
  for (const d of ['up', 'right', 'down', 'left']) S.bufferDirection(s, d);
  S.stepSnake(s); S.stepSnake(s); S.stepSnake(s);
  assert.strictEqual(s.direction, 'down'); // first three queued
  S.stepSnake(s);
  assert.strictEqual(s.direction, 'down'); // fourth press was dropped
});

test('fuzz: rapid random input never produces a 180-degree move', () => {
  let seed = 42;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const DIRS = ['up', 'down', 'left', 'right'];
  for (let trial = 0; trial < 200; trial++) {
    const s = S.createSnake({ x: 0, y: 0 }, DIRS[(rand() * 4) | 0]);
    for (let t = 0; t < 50; t++) {
      const presses = (rand() * 4) | 0;
      for (let p = 0; p < presses; p++) S.bufferDirection(s, DIRS[(rand() * 4) | 0]);
      const before = s.direction;
      S.stepSnake(s);
      assert.strictEqual(G.isReversal(before, s.direction), false,
        `reversed ${before} -> ${s.direction} on trial ${trial} tick ${t}`);
    }
  }
});

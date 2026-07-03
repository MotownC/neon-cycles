const assert = require('node:assert');
const { test } = require('node:test');
const T = require('../src/trail');
const B = require('../src/board');

test('tron mode never trims regardless of age or length', () => {
  const board = B.createBoard(50, 50);
  const body = [];
  for (let i = 0; i < 30; i++) body.push({ x: i, y: 0, t: i });
  body.forEach((c) => B.light(board, c));
  const snake = { body, alive: true };
  T.trim(snake, board, 'tron', 1000);
  assert.strictEqual(snake.body.length, 30);
  assert.strictEqual(B.isLit(board, { x: 0, y: 0 }), true);
});

test('classic mode caps body length by popping the oldest cell', () => {
  const board = B.createBoard(50, 50);
  const body = [];
  for (let i = 0; i < T.CLASSIC_LENGTH + 5; i++) body.push({ x: i, y: 0, t: i });
  body.forEach((c) => B.light(board, c));
  const snake = { body, alive: true };
  T.trim(snake, board, 'classic', 1000);
  assert.strictEqual(snake.body.length, T.CLASSIC_LENGTH);
  assert.strictEqual(snake.body[0].x, 5); // oldest 5 cells popped
  assert.strictEqual(B.isLit(board, { x: 0, y: 0 }), false); // popped, unlit
  assert.strictEqual(B.isLit(board, { x: 5, y: 0 }), true);  // kept, still lit
});

test('classic mode is a no-op when already at or under the cap', () => {
  const board = B.createBoard(50, 50);
  const body = [{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: 1 }];
  body.forEach((c) => B.light(board, c));
  const snake = { body, alive: true };
  T.trim(snake, board, 'classic', 1000);
  assert.strictEqual(snake.body.length, 2);
});

test('fade mode pops cells once they reach FADE_SECONDS old', () => {
  const board = B.createBoard(50, 50);
  const body = [{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: 3 }, { x: 2, y: 0, t: 6 }];
  body.forEach((c) => B.light(board, c));
  const snake = { body, alive: true };
  T.trim(snake, board, 'fade', T.FADE_SECONDS); // elapsed = 8
  assert.deepStrictEqual(snake.body.map((c) => c.x), [1, 2]);
  assert.strictEqual(B.isLit(board, { x: 0, y: 0 }), false);
  assert.strictEqual(B.isLit(board, { x: 1, y: 0 }), true);
});

test('fade mode leaves fresh cells untouched', () => {
  const board = B.createBoard(50, 50);
  const body = [{ x: 0, y: 0, t: 0 }];
  B.light(board, body[0]);
  const snake = { body, alive: true };
  T.trim(snake, board, 'fade', T.FADE_SECONDS - 0.01);
  assert.strictEqual(snake.body.length, 1);
});

test('fade mode always leaves at least the head cell', () => {
  const board = B.createBoard(50, 50);
  const body = [{ x: 0, y: 0, t: 0 }]; // only cell, very old
  B.light(board, body[0]);
  const snake = { body, alive: true };
  T.trim(snake, board, 'fade', 1000);
  assert.strictEqual(snake.body.length, 1);
});

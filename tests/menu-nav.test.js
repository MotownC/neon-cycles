const assert = require('node:assert');
const { test } = require('node:test');
const MenuNav = require('../src/menu-nav');

// A column of two buttons above a row of three, like the main menu.
const items = [
  { x: 100, y: 0 },
  { x: 100, y: 60 },
  { x: 0, y: 120 },
  { x: 100, y: 124 },
  { x: 200, y: 120 },
];

test('up and down step between rows', () => {
  assert.strictEqual(MenuNav.move(items, 0, 'down'), 1);
  assert.strictEqual(MenuNav.move(items, 1, 'up'), 0);
});

test('moving into a row lands on the item closest in x', () => {
  assert.strictEqual(MenuNav.move(items, 1, 'down'), 3);
});

test('moving out of a row lands on the row above', () => {
  assert.strictEqual(MenuNav.move(items, 4, 'up'), 1);
});

test('up and down wrap around the ends', () => {
  assert.strictEqual(MenuNav.move(items, 0, 'up'), 3);
  assert.strictEqual(MenuNav.move(items, 3, 'down'), 0);
});

test('left and right stay in the row and stop at its ends', () => {
  assert.strictEqual(MenuNav.move(items, 3, 'left'), 2);
  assert.strictEqual(MenuNav.move(items, 3, 'right'), 4);
  assert.strictEqual(MenuNav.move(items, 2, 'left'), 2);
  assert.strictEqual(MenuNav.move(items, 0, 'right'), 0);
});

test('a single item has nowhere to go', () => {
  assert.strictEqual(MenuNav.move([{ x: 0, y: 0 }], 0, 'down'), 0);
});

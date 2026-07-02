const assert = require('node:assert');
const { test } = require('node:test');
const L = require('../src/leaderboard');

function fakeStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
}

test('empty storage yields an empty board', () => {
  assert.deepStrictEqual(L.load(fakeStorage()), []);
});

test('qualifies when board not full or score beats the lowest', () => {
  assert.strictEqual(L.qualifies([], 5), true);
  const full = Array.from({ length: 10 }, (_, i) => ({ name: 'X', time: 10 - i }));
  assert.strictEqual(L.qualifies(full, 0.5), false);
  assert.strictEqual(L.qualifies(full, 5.5), true);
});

test('insert keeps top 10 sorted descending by time', () => {
  const store = fakeStorage();
  let board = [];
  for (let t = 1; t <= 12; t++) board = L.insert(store, board, 'P' + t, t);
  assert.strictEqual(board.length, 10);
  assert.strictEqual(board[0].time, 12);
  assert.strictEqual(board[9].time, 3);
  // persisted round-trip
  assert.deepStrictEqual(L.load(store), board);
});

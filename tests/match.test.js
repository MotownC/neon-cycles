const assert = require('node:assert');
const { test } = require('node:test');
const M = require('../src/match');

test('new match starts 0-0 and not over', () => {
  const m = M.createMatch(10);
  assert.deepStrictEqual(m.scores, [0, 0]);
  assert.strictEqual(m.over, false);
});

test('awarding a round increments the winner and detects match end', () => {
  const m = M.createMatch(2);
  M.awardRound(m, 0);
  assert.deepStrictEqual(m.scores, [1, 0]);
  assert.strictEqual(m.over, false);
  M.awardRound(m, 0);
  assert.deepStrictEqual(m.scores, [2, 0]);
  assert.strictEqual(m.over, true);
  assert.strictEqual(m.winnerIndex, 0);
});

test('a draw (null winner) awards no point', () => {
  const m = M.createMatch(10);
  M.awardRound(m, null);
  assert.deepStrictEqual(m.scores, [0, 0]);
  assert.strictEqual(m.over, false);
});

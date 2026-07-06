const assert = require('node:assert');
const { test } = require('node:test');
const P = require('../src/powerups');
const R = require('../src/round');
const B = require('../src/board');

test('TYPES lists all four pickup kinds', () => {
  assert.deepStrictEqual(P.TYPES, ['shield', 'freeze', 'ammo', 'phase']);
});

test('maybeSpawn does nothing before the start delay', () => {
  const round = R.createRound(20, 20, [{ start: { x: 10, y: 10 }, direction: 'right' }]);
  P.maybeSpawn(round, 0, Math.random);
  assert.deepStrictEqual(round.pickups, []);
});

test('maybeSpawn places a pickup once past the start delay, reachable and unlit', () => {
  const round = R.createRound(20, 20, [{ start: { x: 10, y: 10 }, direction: 'right' }]);
  P.maybeSpawn(round, P.SPAWN_START_SEC, () => 0.42);
  assert.strictEqual(round.pickups.length, 1);
  const p = round.pickups[0];
  assert.strictEqual(B.isLit(round.board, p.pos), false);
  assert.ok(P.TYPES.includes(p.type));
});

test('maybeSpawn never spawns freeze in solo (no opponent to freeze)', () => {
  const round = R.createRound(20, 20, [{ start: { x: 10, y: 10 }, direction: 'right' }]);
  for (let i = 0; i < 200; i++) {
    round.pickups = [];
    round.nextSpawnAt = 0;
    P.maybeSpawn(round, P.SPAWN_START_SEC, () => i / 200);
    if (round.pickups.length) assert.notStrictEqual(round.pickups[0].type, 'freeze');
  }
});

test('maybeSpawn respects MAX_ACTIVE and does not exceed it', () => {
  const round = R.createRound(30, 30, [{ start: { x: 15, y: 15 }, direction: 'right' }]);
  let t = P.SPAWN_START_SEC;
  for (let i = 0; i < 50; i++) { P.maybeSpawn(round, t, Math.random); t += 1; }
  assert.ok(round.pickups.length <= P.MAX_ACTIVE);
});

test('claim removes a pickup when a snake head lands on it and applies the effect', () => {
  const round = R.createRound(20, 20, [{ start: { x: 5, y: 5 }, direction: 'right' }]);
  round.pickups = [{ pos: { x: 6, y: 5 }, type: 'shield', spawnedAt: 0 }];
  R.tick(round, 1); // head moves to (6,5)
  const claimed = P.claim(round, 1);
  assert.strictEqual(round.pickups.length, 0);
  assert.strictEqual(round.snakes[0].shield, true);
  assert.deepStrictEqual(claimed, [{ pos: { x: 6, y: 5 }, type: 'shield', index: 0 }]);
});

test('claim leaves unclaimed pickups alone', () => {
  const round = R.createRound(20, 20, [{ start: { x: 5, y: 5 }, direction: 'right' }]);
  round.pickups = [{ pos: { x: 15, y: 15 }, type: 'ammo', spawnedAt: 0 }];
  P.claim(round, 0);
  assert.strictEqual(round.pickups.length, 1);
});

test('claiming ammo refunds one shot (firedCount decremented, floored at 0)', () => {
  const round = R.createRound(20, 20, [{ start: { x: 5, y: 5 }, direction: 'right' }]);
  round.firedCount[0] = 2;
  round.pickups = [{ pos: { x: 5, y: 5 }, type: 'ammo', spawnedAt: 0 }];
  P.claim(round, 0);
  assert.strictEqual(round.firedCount[0], 1);
  round.pickups = [{ pos: { x: 5, y: 5 }, type: 'ammo', spawnedAt: 0 }];
  round.firedCount[0] = 0;
  P.claim(round, 0);
  assert.strictEqual(round.firedCount[0], 0); // floored, never negative
});

test('claiming phase sets the phase flag', () => {
  const round = R.createRound(20, 20, [{ start: { x: 5, y: 5 }, direction: 'right' }]);
  round.pickups = [{ pos: { x: 5, y: 5 }, type: 'phase', spawnedAt: 0 }];
  P.claim(round, 0);
  assert.strictEqual(round.snakes[0].phase, true);
});

test('claiming freeze freezes every other alive snake for FREEZE_SEC, not the picker', () => {
  const round = R.createRound(20, 20, [
    { start: { x: 5, y: 5 }, direction: 'right' },
    { start: { x: 15, y: 15 }, direction: 'left' },
  ]);
  round.pickups = [{ pos: { x: 5, y: 5 }, type: 'freeze', spawnedAt: 0 }];
  P.claim(round, 2);
  assert.deepStrictEqual(P.frozenIndices(round, 2.5), [1]);
  assert.deepStrictEqual(P.frozenIndices(round, 7), []);
  assert.deepStrictEqual(P.frozenIndices(round, 6.99), [1]);
});

test('frozenIndices returns [] when nothing has ever been frozen', () => {
  const round = R.createRound(20, 20, [{ start: { x: 5, y: 5 }, direction: 'right' }]);
  assert.deepStrictEqual(P.frozenIndices(round, 100), []);
});

test('a dead snake cannot claim a pickup', () => {
  const round = R.createRound(20, 20, [{ start: { x: 5, y: 5 }, direction: 'right' }]);
  round.snakes[0].alive = false;
  round.pickups = [{ pos: { x: 5, y: 5 }, type: 'shield', spawnedAt: 0 }];
  const claimed = P.claim(round, 0);
  assert.strictEqual(claimed.length, 0);
  assert.strictEqual(round.pickups.length, 1);
});

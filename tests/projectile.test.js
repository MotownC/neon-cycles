const assert = require('node:assert');
const { test } = require('node:test');
const P = require('../src/projectile');

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

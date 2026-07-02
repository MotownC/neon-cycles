const assert = require('node:assert');
const { test } = require('node:test');
const Sp = require('../src/speed');

test('interval starts at the base value at t=0', () => {
  assert.strictEqual(Sp.tickInterval(0), Sp.BASE_MS);
});

test('interval decreases as time passes', () => {
  assert.ok(Sp.tickInterval(30) < Sp.tickInterval(0));
});

test('interval never drops below the floor', () => {
  assert.strictEqual(Sp.tickInterval(100000), Sp.FLOOR_MS);
});

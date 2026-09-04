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

test('skill level 3 is the unscaled default pace', () => {
  assert.strictEqual(Sp.tickInterval(0, Sp.DEFAULT_SKILL), Sp.BASE_MS);
  assert.strictEqual(Sp.tickInterval(20, 3), Sp.tickInterval(20));
});

test('lower skill levels tick slower, higher levels faster', () => {
  const at = (lvl) => Sp.tickInterval(20, lvl);
  for (let lvl = 2; lvl <= 5; lvl++) assert.ok(at(lvl) < at(lvl - 1),
    `level ${lvl} should tick faster than level ${lvl - 1}`);
  assert.ok(at(1) > at(3));
});

test('the speed floor is scaled by skill level too', () => {
  assert.strictEqual(Sp.tickInterval(100000, 1), Sp.FLOOR_MS * Sp.SKILL_SCALE[1]);
  assert.ok(Sp.tickInterval(100000, 1) > Sp.tickInterval(100000, 5));
});

test('an unknown or missing skill level falls back to the base pace', () => {
  assert.strictEqual(Sp.skillScale(undefined), 1);
  assert.strictEqual(Sp.skillScale(99), 1);
  assert.strictEqual(Sp.tickInterval(20, undefined), Sp.tickInterval(20, 3));
});

test('turbo stays proportionally faster at every skill level', () => {
  for (const lvl of Sp.SKILL_LEVELS) {
    assert.ok(Sp.turboInterval(10, lvl) < Sp.tickInterval(10, lvl));
  }
});

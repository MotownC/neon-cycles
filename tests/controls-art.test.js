const assert = require('node:assert');
const { test } = require('node:test');
const ControlsArt = require('../src/controls-art');
const Input = require('../src/input');

test('every steering key in input.js is lit for the right player', () => {
  Object.keys(Input.P1).forEach((code) => assert.strictEqual(ControlsArt.ROLES[code], 'p1', code));
  Object.keys(Input.P2).forEach((code) => assert.strictEqual(ControlsArt.ROLES[code], 'p2', code));
});

test('every highlighted key is drawn exactly once on the keyboard', () => {
  const svg = ControlsArt.keyboardSvg();
  Object.keys(ControlsArt.ROLES).forEach((code) => {
    assert.strictEqual(svg.split(`data-code="${code}"`).length - 1, 1, code);
  });
});

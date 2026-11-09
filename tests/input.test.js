const assert = require('node:assert');
const { test } = require('node:test');

// input.js binds to a window global at load; stub one before requiring
let keyHandler;
global.window = {
  addEventListener: (type, fn) => { if (type === 'keydown') keyHandler = fn; },
};
const Input = require('../src/input');

function press(code, repeat = false) {
  keyHandler({ code, repeat, preventDefault() {} });
}

test('forwards fresh presses to onDirection and onAction', () => {
  const dirs = []; let actions = 0;
  Input.attach({ onDirection: (i, d) => dirs.push([i, d]), onAction: () => actions++ });
  press('ArrowUp');
  press('KeyA');
  press('Enter');
  assert.deepStrictEqual(dirs, [[0, 'up'], [1, 'left']]);
  assert.strictEqual(actions, 1);
});

test('ignores held-key autorepeat events', () => {
  const dirs = []; let actions = 0;
  Input.attach({ onDirection: (i, d) => dirs.push([i, d]), onAction: () => actions++ });
  press('ArrowLeft', true); // autorepeat from a held key must not steer
  press('Enter', true);
  assert.deepStrictEqual(dirs, []);
  assert.strictEqual(actions, 0);
});

test('forwards Escape to onQuit, ignoring autorepeat', () => {
  let quits = 0;
  Input.attach({ onDirection: () => {}, onAction: () => {}, onQuit: () => quits++ });
  press('Escape', true);
  assert.strictEqual(quits, 0);
  press('Escape');
  assert.strictEqual(quits, 1);
});

test('letters typed in a text box are left alone, but arrows still navigate', () => {
  const dirs = []; let prevented = 0;
  Input.attach({ onDirection: (i, d) => dirs.push([i, d]), onAction: () => {} });
  const typeKey = (code) => keyHandler({ code, repeat: false, target: { tagName: 'INPUT' }, preventDefault() { prevented++; } });
  typeKey('KeyW');
  assert.deepStrictEqual(dirs, []);
  assert.strictEqual(prevented, 0);
  typeKey('ArrowDown');
  assert.deepStrictEqual(dirs, [[0, 'down']]);
});

test('controller Menu quits once per press, even when held', () => {
  const pad = { index: 0, axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) };
  Object.defineProperty(global, 'navigator', { value: { getGamepads: () => [pad] }, configurable: true });
  let quits = 0;
  const handlers = { onDirection: () => {}, onAction: () => {}, onQuit: () => quits++ };
  Input.pollGamepads(handlers);
  assert.strictEqual(quits, 0);
  pad.buttons[9].pressed = true;
  Input.pollGamepads(handlers);
  Input.pollGamepads(handlers);
  assert.strictEqual(quits, 1);
  pad.buttons[9].pressed = false;
  Input.pollGamepads(handlers);
  pad.buttons[9].pressed = true;
  Input.pollGamepads(handlers);
  assert.strictEqual(quits, 2);
  pad.buttons[9].pressed = false;
  Input.pollGamepads(handlers);
});

test('controller X no longer quits', () => {
  const pad = { index: 0, axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) };
  Object.defineProperty(global, 'navigator', { value: { getGamepads: () => [pad] }, configurable: true });
  let quits = 0;
  const handlers = { onDirection: () => {}, onAction: () => {}, onQuit: () => quits++ };
  pad.buttons[2].pressed = true;
  Input.pollGamepads(handlers);
  pad.buttons[2].pressed = false;
  Input.pollGamepads(handlers);
  assert.strictEqual(quits, 0);
});

// Drives pollGamepads through a sequence of pad states and returns the turns
// it reported. Ends on a neutral poll so module-level pad state can't leak.
function turnsFrom(states) {
  const pad = { index: 0, axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) };
  Object.defineProperty(global, 'navigator', { value: { getGamepads: () => [pad] }, configurable: true });
  const turns = [];
  const handlers = { onDirection: (i, d) => turns.push(d), onAction: () => {} };
  for (const { stick = [0, 0], dpad = [] } of [...states, {}]) {
    pad.axes = stick;
    pad.buttons.forEach((b, code) => { b.pressed = dpad.includes(code); });
    Input.pollGamepads(handlers);
  }
  return turns;
}
const UP = 12, RIGHT = 15;

test('a stick wobbling around a diagonal does not alternate turns', () => {
  const wobble = [[0.72, -0.7], [0.7, -0.72], [0.73, -0.69], [0.69, -0.73], [0.72, -0.71]];
  const turns = turnsFrom([{ stick: [1, 0] }, ...wobble.map((stick) => ({ stick }))]);
  assert.deepStrictEqual(turns, ['right']);
});

test('rolling the stick from one direction to another still turns', () => {
  const turns = turnsFrom([{ stick: [0, -1] }, { stick: [0.5, -0.8] }, { stick: [0.8, -0.5] }, { stick: [1, 0] }]);
  assert.deepStrictEqual(turns, ['up', 'right']);
});

test('a stick hovering at the deadzone edge does not re-trigger', () => {
  const turns = turnsFrom([{ stick: [0.55, 0] }, { stick: [0.45, 0] }, { stick: [0.55, 0] }, { stick: [0.45, 0] }, { stick: [0.55, 0] }]);
  assert.deepStrictEqual(turns, ['right']);
});

test('brushing a second d-pad button while holding one does not turn', () => {
  const turns = turnsFrom([{ dpad: [RIGHT] }, { dpad: [RIGHT, UP] }, { dpad: [RIGHT] }]);
  assert.deepStrictEqual(turns, ['right']);
});

test('rolling across the d-pad turns once the old button lifts', () => {
  const turns = turnsFrom([{ dpad: [RIGHT] }, { dpad: [RIGHT, UP] }, { dpad: [UP] }]);
  assert.deepStrictEqual(turns, ['right', 'up']);
});

test('forwards fire keys to onFire for each player', () => {
  const fires = [];
  Input.attach({ onDirection: () => {}, onAction: () => {}, onFire: (i) => fires.push(i) });
  press('Slash');
  press('KeyQ');
  assert.deepStrictEqual(fires, [0, 1]);
});

test('ignores held-key autorepeat for fire keys', () => {
  const fires = [];
  Input.attach({ onDirection: () => {}, onAction: () => {}, onFire: (i) => fires.push(i) });
  press('Slash', true);
  assert.deepStrictEqual(fires, []);
});

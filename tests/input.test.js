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

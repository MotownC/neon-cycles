const assert = require('node:assert');
const { test } = require('node:test');
const Attract = require('../src/attract');

const BOX = { left: 10, top: 5, right: 20, bottom: 15 };

test('corners are ordered clockwise from top-left', () => {
  assert.deepStrictEqual(Attract.corners(BOX), [
    { x: 10, y: 5 }, { x: 20, y: 5 }, { x: 20, y: 15 }, { x: 10, y: 15 },
  ]);
});

test('steps rightward across the top edge toward the top-right corner', () => {
  const corners = Attract.corners(BOX);
  // starting at corner 0, approaching corner 1
  const { head, direction, targetIndex, completedLap } = Attract.step(corners, { x: 10, y: 5 }, 1);
  assert.deepStrictEqual(head, { x: 11, y: 5 });
  assert.strictEqual(direction, 'right');
  assert.strictEqual(targetIndex, 1, 'still approaching the same corner');
  assert.strictEqual(completedLap, false);
});

test('turns at a corner instead of overshooting it', () => {
  const corners = Attract.corners(BOX);
  // one cell away from the top-right corner, still approaching corner 1
  const { head, direction, targetIndex, completedLap } = Attract.step(corners, { x: 19, y: 5 }, 1);
  assert.deepStrictEqual(head, { x: 20, y: 5 }, 'lands exactly on the corner');
  assert.strictEqual(direction, 'right', 'the step that lands on the corner keeps the edge heading');
  assert.strictEqual(targetIndex, 2, 'now approaching the next corner');
  assert.strictEqual(completedLap, false, 'only landing back on corner 0 counts as a lap');
});

test('the next step after landing on a corner turns onto the new edge', () => {
  const corners = Attract.corners(BOX);
  // just landed on corner 1, now approaching corner 2 (down the right edge)
  const { head, direction, targetIndex } = Attract.step(corners, { x: 20, y: 5 }, 2);
  assert.deepStrictEqual(head, { x: 20, y: 6 });
  assert.strictEqual(direction, 'down');
  assert.strictEqual(targetIndex, 2, 'still approaching the same corner');
});

test('completing the loop back to the top-left corner reports a lap', () => {
  const corners = Attract.corners(BOX);
  // one cell above the top-left corner, approaching corner 0 to close the loop
  const { head, direction, targetIndex, completedLap } = Attract.step(corners, { x: 10, y: 6 }, 0);
  assert.deepStrictEqual(head, { x: 10, y: 5 });
  assert.strictEqual(direction, 'up');
  assert.strictEqual(targetIndex, 1, 'wraps to approaching corner 1 again');
  assert.strictEqual(completedLap, true);
});

test('a full circuit returns to the start having completed exactly one lap', () => {
  const corners = Attract.corners(BOX);
  let head = { x: 10, y: 5 }, targetIndex = 1, laps = 0;
  for (let i = 0; i < 1000 && laps === 0; i++) {
    const result = Attract.step(corners, head, targetIndex);
    head = result.head; targetIndex = result.targetIndex;
    if (result.completedLap) laps++;
  }
  assert.strictEqual(laps, 1);
  assert.deepStrictEqual(head, { x: 10, y: 5 });
});

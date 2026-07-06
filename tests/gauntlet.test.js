const assert = require('node:assert');
const { test } = require('node:test');
const G = require('../src/gauntlet');

function fakeStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, v) };
}

test('STAGES runs the rival ladder easiest to hardest', () => {
  assert.deepStrictEqual(G.STAGES, ['drifter', 'survivor', 'aggressor', 'ambusher', 'grandmaster']);
});

test('createGauntlet starts at the first rival, not over', () => {
  assert.deepStrictEqual(G.createGauntlet(), { stage: 0, over: false, victory: false });
});

test('a player match win advances to the next rival', () => {
  const g = G.createGauntlet();
  G.resolveMatch(g, 0);
  assert.deepStrictEqual(g, { stage: 1, over: false, victory: false });
});

test('winning every stage ends the gauntlet in victory', () => {
  const g = G.createGauntlet();
  for (let i = 0; i < G.STAGES.length; i++) {
    assert.strictEqual(g.over, false);
    G.resolveMatch(g, 0);
  }
  assert.strictEqual(g.over, true);
  assert.strictEqual(g.victory, true);
  assert.strictEqual(g.stage, G.STAGES.length);
});

test('a rival match win ends the gauntlet in defeat, preserving the stage reached', () => {
  const g = G.createGauntlet();
  G.resolveMatch(g, 0); // beat drifter
  G.resolveMatch(g, 0); // beat survivor
  G.resolveMatch(g, 1); // lost to aggressor
  assert.deepStrictEqual(g, { stage: 2, over: true, victory: false });
});

test('loadBest returns 0 on empty or corrupt storage', () => {
  assert.strictEqual(G.loadBest(fakeStorage()), 0);
  const s = fakeStorage();
  s.setItem(G.KEY, 'garbage');
  assert.strictEqual(G.loadBest(s), 0);
  assert.strictEqual(G.loadBest({ getItem: () => { throw new Error('blocked'); } }), 0);
});

test('saveBest keeps the high-water mark, never regressing', () => {
  const s = fakeStorage();
  assert.strictEqual(G.saveBest(s, 3), 3);
  assert.strictEqual(G.loadBest(s), 3);
  assert.strictEqual(G.saveBest(s, 1), 3); // a worse run does not overwrite
  assert.strictEqual(G.loadBest(s), 3);
  assert.strictEqual(G.saveBest(s, 5), 5);
  assert.strictEqual(G.loadBest(s), 5);
});

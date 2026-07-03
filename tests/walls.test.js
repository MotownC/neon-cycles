const assert = require('node:assert');
const { test } = require('node:test');
const W = require('../src/walls');

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

test('none density produces no walls', () => {
  assert.deepStrictEqual(W.generate(64, 40, 'none', seeded(1)), []);
});

test('higher density produces more wall cells than lower density', () => {
  const low = W.generate(64, 40, 'low', seeded(1)).length;
  const med = W.generate(64, 40, 'med', seeded(1)).length;
  const high = W.generate(64, 40, 'high', seeded(1)).length;
  assert.ok(low > 0, 'low should place at least one wall pair');
  assert.ok(med > low, `med (${med}) should exceed low (${low})`);
  assert.ok(high > med, `high (${high}) should exceed med (${med})`);
});

test('walls are symmetric about the vertical centerline', () => {
  for (const density of ['low', 'med', 'high']) {
    const cells = W.generate(64, 40, density, seeded(7));
    const set = new Set(cells.map((c) => c.x + ',' + c.y));
    for (const c of cells) {
      const mirroredKey = (64 - 1 - c.x) + ',' + c.y;
      assert.ok(set.has(mirroredKey), `${density}: (${c.x},${c.y}) has no mirror at ${mirroredKey}`);
    }
  }
});

test('walls stay clear of the board edge and spawn columns', () => {
  const cells = W.generate(64, 40, 'high', seeded(3));
  const spawnCols = [16, 32, 48];
  for (const c of cells) {
    assert.ok(c.x >= 3 && c.x < 61 && c.y >= 3 && c.y < 37, `edge margin violated at (${c.x},${c.y})`);
    const nearSpawn = spawnCols.some((sx) => Math.abs(c.x - sx) <= 6 && Math.abs(c.y - 20) <= 7);
    assert.strictEqual(nearSpawn, false, `(${c.x},${c.y}) is inside a spawn safe zone`);
  }
});

test('generation is deterministic for a given rand function', () => {
  const a = W.generate(64, 40, 'med', seeded(42));
  const b = W.generate(64, 40, 'med', seeded(42));
  assert.deepStrictEqual(a, b);
});

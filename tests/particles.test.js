const assert = require('node:assert');
const { test } = require('node:test');
const Particles = require('../src/particles');

// Deterministic stand-in for Math.random.
function seeded(seed = 7) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

test('particles move, slow down and then expire', () => {
  const sys = Particles.createSystem();
  Particles.add(sys, { x: 0, y: 0, vx: 10, vy: 0, life: 0.5, size: 0.1, color: '#fff' });
  Particles.step(sys, 0.1);
  const p = sys.items[0];
  assert.ok(p.x > 0 && p.x < 1, 'moved forward, but less than undamped speed would carry it');
  assert.ok(p.vx < 10);
  Particles.step(sys, 0.5);
  assert.strictEqual(sys.items.length, 0);
});

test('the system never grows past its cap, dropping the oldest first', () => {
  const sys = Particles.createSystem(3);
  for (let i = 0; i < 5; i++) Particles.add(sys, { x: i, y: 0, vx: 0, vy: 0, life: 1, size: 0.1, color: '#fff' });
  assert.deepStrictEqual(sys.items.map((p) => p.x), [2, 3, 4]);
});

test('howMany averages out to the requested rate at any frame rate', () => {
  const rand = seeded();
  let total = 0;
  for (let i = 0; i < 6000; i++) total += Particles.howMany(30, 1 / 144, rand);
  const perSec = total / (6000 / 144);
  assert.ok(Math.abs(perSec - 30) < 2, `got ${perSec}/s`);
});

test('turn sparks fly the way the cycle was heading', () => {
  const sys = Particles.createSystem();
  Particles.turnSparks(sys, { x: 5, y: 5 }, 'right', '#0ff', seeded());
  assert.ok(sys.items.length > 0);
  assert.ok(sys.items.every((p) => p.vx > 0 && p.x === 5 && p.y === 5));
});

test('exhaust starts behind the cycle and blows backwards', () => {
  const sys = Particles.createSystem();
  Particles.exhaust(sys, { x: 10, y: 4 }, 'up', '#0ff', 6, seeded());
  assert.strictEqual(sys.items.length, 6);
  assert.ok(sys.items.every((p) => p.y > 4 && p.vy > 0 && p.kind === 'flame'));
});

test('scrape sparks start on the side that is being scraped', () => {
  const sys = Particles.createSystem();
  Particles.scrape(sys, { x: 10, y: 4 }, 'right', { x: 0, y: -1 }, 3, seeded());
  assert.ok(sys.items.every((p) => p.y === 3.5 && p.vx < 0));
});

test('a ring spreads in every direction', () => {
  const sys = Particles.createSystem();
  Particles.ring(sys, { x: 0, y: 0 }, '#0f0', 40, seeded());
  const vx = sys.items.map((p) => p.vx), vy = sys.items.map((p) => p.vy);
  assert.ok(Math.min(...vx) < 0 && Math.max(...vx) > 0 && Math.min(...vy) < 0 && Math.max(...vy) > 0);
});

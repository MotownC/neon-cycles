(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  // Cosmetic particles: sparks, exhaust flame, bursts. Positions are in cell
  // units (a cell's centre is its integer coordinate), speeds in cells per
  // second. Purely visual: nothing here is read by the sim, so the `rand`
  // passed in can be Math.random even online.
  const MAX = 500;
  const ANGLES = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
  const HOT = '#ffd9a0'; // metal-on-wall spark colour

  function createSystem(max = MAX) { return { items: [], max }; }

  function add(sys, p) {
    if (sys.items.length >= sys.max) sys.items.shift(); // oldest goes first
    sys.items.push({ age: 0, drag: 3, kind: 'spark', ...p });
  }

  function step(sys, dtSec) {
    const keep = [];
    for (const p of sys.items) {
      p.age += dtSec;
      if (p.age >= p.life) continue;
      const slow = Math.exp(-p.drag * dtSec);
      p.vx *= slow; p.vy *= slow;
      p.x += p.vx * dtSec; p.y += p.vy * dtSec;
      keep.push(p);
    }
    sys.items = keep;
  }

  const between = (rand, [lo, hi]) => lo + rand() * (hi - lo);

  // How many to emit this frame for a steady per-second rate, at any frame rate.
  function howMany(ratePerSec, dtSec, rand) { return Math.floor(ratePerSec * dtSec + rand()); }

  // count particles thrown around `angle` (radians) within `spread` radians.
  function burst(sys, { x, y, count, angle = 0, spread = Math.PI * 2, speed, life, size, color, kind, drag }, rand) {
    for (let i = 0; i < count; i++) {
      const a = angle + (rand() - 0.5) * spread, v = between(rand, speed);
      const p = { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: between(rand, life), size: between(rand, size), color };
      if (kind) p.kind = kind;
      if (drag !== undefined) p.drag = drag;
      add(sys, p);
    }
  }

  // Carving a corner: momentum throws sparks the way the cycle WAS heading.
  function turnSparks(sys, corner, fromDir, color, rand) {
    const base = { x: corner.x, y: corner.y, angle: ANGLES[fromDir], spread: 1.3, life: [0.15, 0.4], size: [0.06, 0.12] };
    burst(sys, { ...base, count: 9, speed: [4, 13], color }, rand);
    burst(sys, { ...base, count: 4, speed: [6, 16], color: '#ffffff' }, rand);
  }

  // Turbo flame out of the back of the cycle.
  function exhaust(sys, pos, dir, color, count, rand) {
    const a = ANGLES[dir];
    burst(sys, {
      x: pos.x - Math.cos(a) * 0.75, y: pos.y - Math.sin(a) * 0.75,
      count, angle: a + Math.PI, spread: 0.5, speed: [3, 9],
      life: [0.12, 0.3], size: [0.14, 0.26], color, kind: 'flame', drag: 4,
    }, rand);
  }

  // Riding right alongside a wall or trail: sparks off that side, thrown back.
  function scrape(sys, pos, dir, side, count, rand) {
    burst(sys, {
      x: pos.x + side.x * 0.5, y: pos.y + side.y * 0.5,
      count, angle: ANGLES[dir] + Math.PI, spread: 1.0, speed: [3, 10],
      life: [0.15, 0.35], size: [0.05, 0.1], color: HOT,
    }, rand);
  }

  // Bolt leaving the nose.
  function muzzle(sys, pos, dir, color, rand) {
    burst(sys, {
      x: pos.x, y: pos.y, count: 8, angle: ANGLES[dir], spread: 0.7, speed: [8, 18],
      life: [0.08, 0.2], size: [0.06, 0.12], color,
    }, rand);
  }

  // Even burst in every direction: pickups, bolt hits.
  function ring(sys, pos, color, count, rand) {
    burst(sys, { x: pos.x, y: pos.y, count, speed: [3, 9], life: [0.25, 0.5], size: [0.07, 0.14], color }, rand);
  }

  return { __name: 'Particles', MAX, createSystem, add, step, howMany, burst, turnSparks, exhaust, scrape, muzzle, ring };
});

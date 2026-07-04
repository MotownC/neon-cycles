const assert = require('node:assert');
const { test } = require('node:test');
const P = require('../src/projectile');
const B = require('../src/board');

test('createBolt spawns one cell ahead of the head along its velocity', () => {
  const bolt = P.createBolt(0, { x: 5, y: 5 }, { x: 1, y: 0 }, 3);
  assert.deepStrictEqual(bolt, { ownerIndex: 0, pos: { x: 6, y: 5 }, dir: { x: 1, y: 0 }, spawnedAt: 3 });
});

test('createBolt handles cardinal and diagonal velocities', () => {
  assert.deepStrictEqual(P.createBolt(1, { x: 3, y: 3 }, { x: 0, y: -1 }, 0).pos, { x: 3, y: 2 });
  assert.deepStrictEqual(P.createBolt(1, { x: 3, y: 3 }, { x: -1, y: 0 }, 0).pos, { x: 2, y: 3 });
  assert.deepStrictEqual(P.createBolt(1, { x: 3, y: 3 }, { x: 1, y: 1 }, 0).pos, { x: 4, y: 4 });
});

test('sprayVectors yields straight, +45°, and -45° for each facing', () => {
  assert.deepStrictEqual(P.sprayVectors('right'), [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: -1 }]);
  assert.deepStrictEqual(P.sprayVectors('up'), [{ x: 0, y: -1 }, { x: 1, y: -1 }, { x: -1, y: -1 }]);
});

test('ammoAvailable starts at 1 and is unaffected before the first regen', () => {
  assert.strictEqual(P.ammoAvailable(0, 0), 1);
  assert.strictEqual(P.ammoAvailable(14.9, 0), 1);
});

test('ammoAvailable grants +1 every 15 seconds survived', () => {
  assert.strictEqual(P.ammoAvailable(15, 0), 2);
  assert.strictEqual(P.ammoAvailable(30, 0), 3);
});

test('ammoAvailable caps at 3 no matter how long the round runs', () => {
  assert.strictEqual(P.ammoAvailable(999, 0), 3);
});

test('ammoAvailable subtracts bolts already fired', () => {
  assert.strictEqual(P.ammoAvailable(30, 2), 1);
  assert.strictEqual(P.ammoAvailable(0, 1), 0);
});

test('advanceBolts moves a bolt one cell forward through open space', () => {
  const round = { board: B.createBoard(10, 10), bolts: [P.createBolt(0, { x: 5, y: 5 }, { x: 1, y: 0 }, 0)], snakes: [] };
  P.advanceBolts(round, 0);
  assert.strictEqual(round.bolts.length, 1);
  assert.deepStrictEqual(round.bolts[0].pos, { x: 7, y: 5 });
});

test('advanceBolts bounces off the boundary instead of despawning', () => {
  const round = { board: B.createBoard(10, 10), bolts: [{ ownerIndex: 0, pos: { x: 9, y: 5 }, dir: { x: 1, y: 0 }, spawnedAt: 0 }], snakes: [] };
  const outcomes = P.advanceBolts(round, 0);
  assert.strictEqual(round.bolts.length, 1);
  assert.deepStrictEqual(round.bolts[0].dir, { x: -1, y: 0 });
  assert.deepStrictEqual(round.bolts[0].pos, { x: 8, y: 5 });
  assert.deepStrictEqual(outcomes, [{ type: 'bounce', pos: { x: 8, y: 5 } }]);
});

test('advanceBolts bounces off every edge of the boundary', () => {
  const cases = [
    { pos: { x: 0, y: 5 }, dir: { x: -1, y: 0 }, wantDir: { x: 1, y: 0 }, wantPos: { x: 1, y: 5 } },
    { pos: { x: 5, y: 0 }, dir: { x: 0, y: -1 }, wantDir: { x: 0, y: 1 }, wantPos: { x: 5, y: 1 } },
    { pos: { x: 5, y: 9 }, dir: { x: 0, y: 1 }, wantDir: { x: 0, y: -1 }, wantPos: { x: 5, y: 8 } },
  ];
  for (const c of cases) {
    const round = { board: B.createBoard(10, 10), bolts: [{ ownerIndex: 0, pos: c.pos, dir: c.dir, spawnedAt: 0 }], snakes: [] };
    P.advanceBolts(round, 0);
    assert.deepStrictEqual(round.bolts[0].dir, c.wantDir);
    assert.deepStrictEqual(round.bolts[0].pos, c.wantPos);
  }
});

test('a diagonal bolt mirror-bounces: only the offending axis flips', () => {
  const round = { board: B.createBoard(10, 10), bolts: [{ ownerIndex: 0, pos: { x: 5, y: 9 }, dir: { x: 1, y: 1 }, spawnedAt: 0 }], snakes: [] };
  P.advanceBolts(round, 0); // would exit the bottom edge
  assert.deepStrictEqual(round.bolts[0].dir, { x: 1, y: -1 }); // x carries on, y reflects
  assert.deepStrictEqual(round.bolts[0].pos, { x: 6, y: 8 });
});

test('a diagonal bolt entering a corner reflects both axes', () => {
  const round = { board: B.createBoard(10, 10), bolts: [{ ownerIndex: 0, pos: { x: 9, y: 9 }, dir: { x: 1, y: 1 }, spawnedAt: 0 }], snakes: [] };
  P.advanceBolts(round, 0);
  assert.deepStrictEqual(round.bolts[0].dir, { x: -1, y: -1 });
  assert.deepStrictEqual(round.bolts[0].pos, { x: 8, y: 8 });
});

test('advanceBolts expires a bolt once its 15s lifetime is up, even mid-flight in open space', () => {
  const round = { board: B.createBoard(10, 10), bolts: [{ ownerIndex: 0, pos: { x: 5, y: 5 }, dir: { x: 1, y: 0 }, spawnedAt: 0 }], snakes: [] };
  const outcomes = P.advanceBolts(round, 15);
  assert.strictEqual(round.bolts.length, 0);
  assert.deepStrictEqual(outcomes, []); // silent, no SFX-triggering outcome
});

test('advanceBolts leaves a bolt alone just under its 15s lifetime', () => {
  const round = { board: B.createBoard(10, 10), bolts: [{ ownerIndex: 0, pos: { x: 5, y: 5 }, dir: { x: 1, y: 0 }, spawnedAt: 0 }], snakes: [] };
  P.advanceBolts(round, 14.9);
  assert.strictEqual(round.bolts.length, 1);
});

test('BOLT_LIFETIME_SEC is a hard cap from firing, unaffected by bounces', () => {
  // Spawned at t=10, bounced immediately off the boundary; should still expire at t=25, not later.
  const round = { board: B.createBoard(10, 10), bolts: [{ ownerIndex: 0, pos: { x: 9, y: 5 }, dir: { x: 1, y: 0 }, spawnedAt: 10 }], snakes: [] };
  P.advanceBolts(round, 10); // bounces
  assert.strictEqual(round.bolts.length, 1);
  P.advanceBolts(round, 25); // 15s after spawn, regardless of the bounce
  assert.strictEqual(round.bolts.length, 0);
});

test('advanceBolts cuts a 3-cell gap starting at a lit cell it hits', () => {
  const board = B.createBoard(10, 10);
  [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }].forEach((c) => B.light(board, c));
  const round = { board, bolts: [{ ownerIndex: 0, pos: { x: 5, y: 5 }, dir: { x: 1, y: 0 }, spawnedAt: 0 }], snakes: [] };
  P.advanceBolts(round, 0);
  assert.strictEqual(round.bolts.length, 0); // consumed on impact
  assert.strictEqual(B.isLit(board, { x: 6, y: 5 }), false);
  assert.strictEqual(B.isLit(board, { x: 7, y: 5 }), false);
  assert.strictEqual(B.isLit(board, { x: 8, y: 5 }), false);
  assert.strictEqual(B.isLit(board, { x: 9, y: 5 }), true); // beyond the 3-cell gap
});

test('advanceBolts clips the gap at the board edge instead of erroring', () => {
  const board = B.createBoard(10, 10);
  [{ x: 8, y: 5 }, { x: 9, y: 5 }].forEach((c) => B.light(board, c));
  const round = { board, bolts: [{ ownerIndex: 0, pos: { x: 7, y: 5 }, dir: { x: 1, y: 0 }, spawnedAt: 0 }], snakes: [] };
  P.advanceBolts(round, 0);
  assert.strictEqual(B.isLit(board, { x: 8, y: 5 }), false);
  assert.strictEqual(B.isLit(board, { x: 9, y: 5 }), false);
});

test('a wall cell is cut exactly like a trail cell (same lit Set)', () => {
  const board = B.createBoard(10, 10, [{ x: 6, y: 5 }]);
  const round = { board, bolts: [{ ownerIndex: 0, pos: { x: 5, y: 5 }, dir: { x: 1, y: 0 }, spawnedAt: 0 }], snakes: [] };
  P.advanceBolts(round, 0);
  assert.strictEqual(B.isLit(board, { x: 6, y: 5 }), false);
});

test('a cut blasts a 3-wide hole across a perpendicular wall, not just the impact cell', () => {
  const board = B.createBoard(10, 10);
  // vertical wall segment at x=6, y=3..7, hit broadside by a rightward bolt
  [3, 4, 5, 6, 7].forEach((y) => B.light(board, { x: 6, y }));
  const round = { board, bolts: [{ ownerIndex: 0, pos: { x: 5, y: 5 }, dir: { x: 1, y: 0 }, spawnedAt: 0 }], snakes: [] };
  P.advanceBolts(round, 0);
  assert.strictEqual(B.isLit(board, { x: 6, y: 4 }), false); // side of impact
  assert.strictEqual(B.isLit(board, { x: 6, y: 5 }), false); // impact
  assert.strictEqual(B.isLit(board, { x: 6, y: 6 }), false); // side of impact
  assert.strictEqual(B.isLit(board, { x: 6, y: 3 }), true);  // beyond the 3-wide swath
  assert.strictEqual(B.isLit(board, { x: 6, y: 7 }), true);
});

test('a cut removes trail cells from the owning snake body so the hole is visible', () => {
  const board = B.createBoard(10, 10);
  const body = [3, 4, 5, 6, 7].map((y) => ({ x: 6, y, t: 0 })); // head is (6,7)
  body.forEach((c) => B.light(board, c));
  const victim = { alive: true, body, direction: 'down' };
  const round = { board, bolts: [{ ownerIndex: 0, pos: { x: 5, y: 5 }, dir: { x: 1, y: 0 }, spawnedAt: 0 }], snakes: [victim] };
  P.advanceBolts(round, 0);
  const cells = victim.body.map((c) => `${c.x},${c.y}`);
  assert.deepStrictEqual(cells, ['6,3', '6,7']); // (6,4),(6,5),(6,6) blasted out; head intact
});

test('a cut prunes destroyed cells from the walls array so the hole is visible', () => {
  const board = B.createBoard(10, 10, [{ x: 6, y: 4 }, { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 6, y: 3 }]);
  const round = { board, bolts: [{ ownerIndex: 0, pos: { x: 5, y: 5 }, dir: { x: 1, y: 0 }, spawnedAt: 0 }], snakes: [] };
  P.advanceBolts(round, 0);
  assert.deepStrictEqual(board.walls, [{ x: 6, y: 3 }]); // only the cell outside the swath survives
});

test('the blast never destroys a living snake head caught in the swath', () => {
  const board = B.createBoard(10, 10);
  B.light(board, { x: 6, y: 5 }); // impact cell (plain trail)
  B.light(board, { x: 6, y: 6 }); // side cell, occupied by a living head
  const bystander = { alive: true, body: [{ x: 6, y: 6, t: 0 }], direction: 'down' };
  const round = { board, bolts: [{ ownerIndex: 0, pos: { x: 5, y: 5 }, dir: { x: 1, y: 0 }, spawnedAt: 0 }], snakes: [bystander] };
  P.advanceBolts(round, 0);
  assert.strictEqual(B.isLit(board, { x: 6, y: 6 }), true); // head cell untouched
  assert.strictEqual(bystander.body.length, 1);
  assert.strictEqual(B.isLit(board, { x: 6, y: 5 }), false); // impact cell still cut
});

test('a head shot from an opponent bolt kills the victim instead of cutting a gap', () => {
  const board = B.createBoard(10, 10);
  B.light(board, { x: 6, y: 5 }); // cell is lit too — proves the kill is checked first, not treated as trail
  const victim = { alive: true, body: [{ x: 6, y: 5, t: 0 }] };
  const round = { board, bolts: [{ ownerIndex: 1, pos: { x: 5, y: 5 }, dir: { x: 1, y: 0 }, spawnedAt: 0 }], snakes: [victim] };
  const outcomes = P.advanceBolts(round, 10);
  assert.strictEqual(round.bolts.length, 0);
  assert.strictEqual(victim.alive, false);
  assert.strictEqual(victim.shotBy, 1);
  assert.deepStrictEqual(outcomes, [{ type: 'kill', pos: { x: 6, y: 5 } }]);
  assert.strictEqual(B.isLit(board, { x: 6, y: 5 }), true); // gap-cut did NOT run; cell stays lit
});

test('a bolt flies over its own firer\'s head harmlessly', () => {
  const board = B.createBoard(10, 10);
  const owner = { alive: true, body: [{ x: 6, y: 5, t: 0 }] };
  B.light(board, { x: 6, y: 5 }); // head cell is lit, but must not be cut or kill
  const round = { board, bolts: [{ ownerIndex: 0, pos: { x: 5, y: 5 }, dir: { x: 1, y: 0 }, spawnedAt: 0 }], snakes: [owner] };
  const outcomes = P.advanceBolts(round, 10);
  assert.strictEqual(owner.alive, true);
  assert.strictEqual(round.bolts.length, 1); // still flying
  assert.deepStrictEqual(round.bolts[0].pos, { x: 6, y: 5 }); // passed onto the head cell
  assert.deepStrictEqual(outcomes, []);
  assert.strictEqual(B.isLit(board, { x: 6, y: 5 }), true);
});

test('advanceBolts ignores dead snakes when checking for a head hit', () => {
  const board = B.createBoard(10, 10);
  const victim = { alive: false, body: [{ x: 6, y: 5, t: 0 }] };
  // ownerIndex 1 so owner immunity can't be what spares the corpse
  const round = { board, bolts: [{ ownerIndex: 1, pos: { x: 5, y: 5 }, dir: { x: 1, y: 0 }, spawnedAt: 0 }], snakes: [victim] };
  P.advanceBolts(round, 10);
  assert.strictEqual(round.bolts.length, 1); // passed through the empty (unlit) cell
  assert.strictEqual(victim.shotBy, undefined); // a corpse can't be shot again
});

test('fire sprays three bolts (straight, ±45°) for one ammo', () => {
  const round = {
    board: B.createBoard(10, 10),
    bolts: [],
    firedCount: [0],
    snakes: [{ alive: true, body: [{ x: 5, y: 5, t: 0 }], direction: 'right' }],
  };
  P.fire(round, 0, 5); // at the edge of the start-of-round lockout
  assert.strictEqual(round.bolts.length, 3);
  assert.strictEqual(round.firedCount[0], 1); // the whole spray costs one ammo
  assert.deepStrictEqual(round.bolts.map((b) => b.dir), [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: -1 }]);
  assert.deepStrictEqual(round.bolts.map((b) => b.pos), [{ x: 6, y: 5 }, { x: 6, y: 6 }, { x: 6, y: 4 }]);
});

test('a diagonal bolt cuts a swath oriented along its travel', () => {
  const board = B.createBoard(10, 10);
  [{ x: 6, y: 6 }, { x: 5, y: 7 }, { x: 7, y: 5 }].forEach((c) => B.light(board, c));
  const round = { board, bolts: [{ ownerIndex: 0, pos: { x: 5, y: 5 }, dir: { x: 1, y: 1 }, spawnedAt: 0 }], snakes: [] };
  P.advanceBolts(round, 0);
  assert.strictEqual(round.bolts.length, 0); // consumed on impact
  assert.strictEqual(B.isLit(board, { x: 6, y: 6 }), false); // impact
  assert.strictEqual(B.isLit(board, { x: 5, y: 7 }), false); // one side of the diagonal swath
  assert.strictEqual(B.isLit(board, { x: 7, y: 5 }), false); // other side
});

test('fire is a no-op when ammo is exhausted', () => {
  const round = {
    board: B.createBoard(10, 10),
    bolts: [],
    firedCount: [1], // already spent the starting bolt
    snakes: [{ alive: true, body: [{ x: 5, y: 5, t: 0 }], direction: 'right' }],
  };
  P.fire(round, 0, 5); // elapsedSec=5, still under the 15s regen mark
  assert.strictEqual(round.bolts.length, 0);
  assert.strictEqual(round.firedCount[0], 1);
});

test('fire while facing the adjacent boundary bounces the whole spray at the muzzle', () => {
  const round = {
    board: B.createBoard(10, 10),
    bolts: [],
    firedCount: [0],
    snakes: [{ alive: true, body: [{ x: 9, y: 5, t: 0 }], direction: 'right' }], // nose against the right wall
  };
  P.fire(round, 0, 5);
  assert.strictEqual(round.bolts.length, 3);
  // every spawn is in bounds, heading away from the wall (x component reflected)
  assert.deepStrictEqual(round.bolts.map((b) => b.pos), [{ x: 8, y: 5 }, { x: 8, y: 6 }, { x: 8, y: 4 }]);
  assert.deepStrictEqual(round.bolts.map((b) => b.dir), [{ x: -1, y: 0 }, { x: -1, y: 1 }, { x: -1, y: -1 }]);
});

test('a muzzle-bounced spray never harms its own firer', () => {
  const firer = { alive: true, body: [{ x: 8, y: 5, t: 0 }, { x: 9, y: 5, t: 0 }], direction: 'right' };
  const round = { board: B.createBoard(10, 10), bolts: [], firedCount: [0], snakes: [firer] };
  P.fire(round, 0, 5); // spray reflected off the right wall, heading back over the firer
  P.advanceBolts(round, 5);
  P.advanceBolts(round, 5);
  assert.strictEqual(firer.alive, true);
});

test('fire is a no-op during the 5s start-of-round lockout, even with ammo available', () => {
  const round = {
    board: B.createBoard(10, 10),
    bolts: [],
    firedCount: [0],
    snakes: [{ alive: true, body: [{ x: 5, y: 5, t: 0 }], direction: 'right' }],
  };
  P.fire(round, 0, 4.9);
  assert.strictEqual(round.bolts.length, 0);
  assert.strictEqual(round.firedCount[0], 0);
});

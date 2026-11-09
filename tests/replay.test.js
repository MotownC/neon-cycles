const assert = require('node:assert');
const { test } = require('node:test');
const Replay = require('../src/replay');
const Round = require('../src/round');
const Net = require('../src/net');

const seeded = () => { let n = 0; return () => ((n = (n * 7 + 3) % 101) / 101); };

function duelRound() {
  return Round.createRound(40, 20,
    [{ start: { x: 5, y: 5 }, direction: 'right' }, { start: { x: 30, y: 15 }, direction: 'left' }]);
}

function recordTicks(round, count, dt = 0.1, startT = 0) {
  const rec = Replay.createRecorder();
  Replay.record(rec, round, startT);
  for (let i = 1; i <= count; i++) {
    Round.tick(round, startT + i * dt);
    Replay.record(rec, round, startT + i * dt);
  }
  return rec;
}

test('recording leaves the sim untouched, so the desync hash is unchanged', () => {
  const round = duelRound();
  Round.tick(round, 0.1);
  const before = Net.stateHash(round);
  const json = JSON.stringify({ snakes: round.snakes, bolts: round.bolts });
  Replay.record(Replay.createRecorder(), round, 0.1);
  assert.strictEqual(Net.stateHash(round), before);
  assert.strictEqual(JSON.stringify({ snakes: round.snakes, bolts: round.bolts }), json);
});

test('a captured frame is not changed by later ticks', () => {
  const round = duelRound();
  const rec = Replay.createRecorder();
  Replay.record(rec, round, 0);
  Round.tick(round, 0.1);
  assert.strictEqual(rec.frames[0].snakes[0].body.length, 1);
});

test('a captured frame can be drawn like a round', () => {
  const round = duelRound();
  round.bolts.push({ ownerIndex: 0, pos: { x: 1, y: 1 }, dir: { x: 1, y: 0 }, spawnedAt: 0 });
  const rec = Replay.createRecorder();
  Replay.record(rec, round, 0, [{ pos: { x: 2, y: 2 }, type: 'cut', start: 0 }]);
  const f = rec.frames[0];
  assert.strictEqual(f.board.width, 40);
  assert.strictEqual(f.board.height, 20);
  assert.deepStrictEqual(f.bolts[0].pos, { x: 1, y: 1 });
  assert.strictEqual(f.trailMode, round.trailMode);
  assert.strictEqual(f.flashes.length, 1);
});

test('a bounced bolt does not rewrite the velocity in older frames', () => {
  const round = duelRound();
  const bolt = { ownerIndex: 0, pos: { x: 1, y: 1 }, dir: { x: 1, y: 0 }, spawnedAt: 0 };
  round.bolts.push(bolt);
  const rec = Replay.createRecorder();
  Replay.record(rec, round, 0);
  bolt.dir.x = -1; // Projectile's reflect() mutates dir in place
  assert.strictEqual(rec.frames[0].bolts[0].dir.x, 1);
});

test('the recorder keeps only the replay window, plus one frame to start from', () => {
  const round = duelRound();
  const rec = recordTicks(round, 25, 0.1);
  const newest = rec.frames[rec.frames.length - 1].t;
  assert.ok(rec.frames[1].t > newest - Replay.WINDOW_SEC);
  assert.ok(rec.frames[0].t <= newest - Replay.WINDOW_SEC);
});

test('frames recorded at the same sim time still get increasing timestamps', () => {
  const round = duelRound();
  const rec = Replay.createRecorder();
  Replay.record(rec, round, 1);
  Replay.record(rec, round, 1);
  assert.ok(rec.frames[1].t > rec.frames[0].t);
});

test('a snake that hit something noses into it on the final frame', () => {
  const round = Round.createRound(40, 20, [{ start: { x: 39, y: 5 }, direction: 'right' }]);
  const rec = recordTicks(round, 1);
  const last = rec.frames[rec.frames.length - 1].snakes[0];
  assert.strictEqual(last.alive, false);
  assert.ok(last.impact.x > 39 && last.impact.x < 40);
  assert.strictEqual(last.impact.y, 5);
});

test('the final frame faces the turn a snake died attempting', () => {
  const round = Round.createRound(40, 20, [{ start: { x: 20, y: 0 }, direction: 'right' }]);
  round.snakes[0].queue.push('up');
  const rec = recordTicks(round, 1);
  const last = rec.frames[rec.frames.length - 1].snakes[0];
  assert.strictEqual(last.direction, 'up');
});

test('a snake shot or crushed where it stood has no impact nudge', () => {
  for (const cause of [{ shotBy: 1 }, { crushedByHazard: true }]) {
    const round = duelRound();
    Object.assign(round.snakes[0], cause, { alive: false });
    const rec = Replay.createRecorder();
    Replay.record(rec, round, 0);
    assert.strictEqual(rec.frames[0].snakes[0].impact, null);
  }
});

test('playback runs explode, then replay, then impact, then done', () => {
  const round = duelRound();
  const pb = Replay.createPlayback(recordTicks(round, 5), seeded());
  assert.strictEqual(Replay.stageAt(pb, 0).stage, 'explode');
  assert.strictEqual(Replay.stageAt(pb, Replay.EXPLODE_SEC - 0.01).stage, 'explode');
  const replay = Replay.stageAt(pb, Replay.EXPLODE_SEC + 0.01);
  assert.strictEqual(replay.stage, 'replay');
  assert.ok(Math.abs(replay.simT - (pb.startT + 0.01 * Replay.SLOWMO)) < 1e-9);
  assert.strictEqual(Replay.stageAt(pb, Replay.EXPLODE_SEC + pb.replaySec + 0.01).stage, 'impact');
  assert.strictEqual(Replay.stageAt(pb, Replay.EXPLODE_SEC + pb.replaySec + Replay.IMPACT_SEC + 0.01).stage, 'done');
});

test('the replay plays slower than real time', () => {
  const pb = Replay.createPlayback(recordTicks(duelRound(), 5), seeded());
  assert.ok(pb.replaySec > 0.5 / 1);
  assert.ok(Math.abs(pb.replaySec - 0.5 / Replay.SLOWMO) < 1e-6);
});

test('with nothing to replay, the explosion goes straight to done', () => {
  const rec = Replay.createRecorder();
  Replay.record(rec, duelRound(), 0);
  const pb = Replay.createPlayback(rec, seeded());
  assert.strictEqual(pb.replaySec, 0);
  assert.strictEqual(Replay.stageAt(pb, Replay.EXPLODE_SEC + 0.01).stage, 'done');
});

test('viewAt glides the cycle between cells while the trail lags', () => {
  const pb = Replay.createPlayback(recordTicks(duelRound(), 2), seeded());
  const view = Replay.viewAt(pb, 0.15);
  assert.ok(Math.abs(view.snakes[0].cycleAt.x - 6.5) < 1e-6);
  assert.strictEqual(view.snakes[0].cycleAt.y, 5);
  assert.strictEqual(view.snakes[0].body.length, 2); // frame 0.1's body
});

test('viewAt holds a stationary cycle until its next step begins', () => {
  // A frozen snake: same head across frames, then one move at the end.
  const round = duelRound();
  const rec = Replay.createRecorder();
  for (let i = 0; i <= 8; i++) { Round.tick(round, i * 0.1, [0]); Replay.record(rec, round, i * 0.1); }
  Round.tick(round, 0.9);
  Replay.record(rec, round, 0.9);
  const pb = Replay.createPlayback(rec, seeded());
  assert.strictEqual(Replay.viewAt(pb, 0.4).snakes[0].cycleAt.x, 5);
  const moving = Replay.viewAt(pb, 0.85).snakes[0].cycleAt.x;
  assert.ok(moving > 5 && moving < 6, `expected mid-step, got ${moving}`);
});

test('viewAt turns the cycle as soon as the step into the new direction starts', () => {
  const round = duelRound();
  const rec = Replay.createRecorder();
  Replay.record(rec, round, 0);
  round.snakes[0].queue.push('up');
  Round.tick(round, 0.1);
  Replay.record(rec, round, 0.1);
  const pb = Replay.createPlayback(rec, seeded());
  assert.strictEqual(Replay.viewAt(pb, 0.05).snakes[0].direction, 'up');
});

test('viewAt past the end shows the final frame', () => {
  const pb = Replay.createPlayback(recordTicks(duelRound(), 2), seeded());
  const view = Replay.viewAt(pb, 99);
  assert.strictEqual(view.snakes[0].body.length, 3);
  assert.deepStrictEqual(view.snakes[0].cycleAt, { x: 7, y: 5 });
});

test('wreckedView hides only the dead cycles', () => {
  const round = duelRound();
  round.snakes[1].alive = false;
  const rec = Replay.createRecorder();
  Replay.record(rec, round, 0);
  const view = Replay.wreckedView(Replay.createPlayback(rec, seeded()));
  assert.ok(!view.snakes[0].wrecked);
  assert.strictEqual(view.snakes[1].wrecked, true);
});

test('debris is created for each dead snake, tagged with its index', () => {
  const round = duelRound();
  round.snakes[0].alive = false;
  round.snakes[1].alive = false;
  const rec = Replay.createRecorder();
  Replay.record(rec, round, 0);
  const pb = Replay.createPlayback(rec, seeded());
  assert.deepStrictEqual(pb.debris.map((d) => d.snakeIndex), [0, 1]);
  assert.ok(pb.debris[0].pieces.some((p) => p.kind === 'fragment'));
  assert.ok(pb.debris[0].pieces.some((p) => p.kind === 'spark'));
});

test('a survivor gets no debris', () => {
  const round = duelRound();
  round.snakes[1].alive = false;
  const rec = Replay.createRecorder();
  Replay.record(rec, round, 0);
  assert.deepStrictEqual(Replay.createPlayback(rec, seeded()).debris.map((d) => d.snakeIndex), [1]);
});

test('explode is deterministic for a given rand', () => {
  const center = { x: 10, y: 10 };
  assert.deepStrictEqual(Replay.explode(center, 'right', seeded()), Replay.explode(center, 'right', seeded()));
});

test('fragments start assembled around the wreck, rotated with the cycle', () => {
  const right = Replay.explode({ x: 10, y: 10 }, 'right', seeded()).filter((p) => p.kind === 'fragment');
  const down = Replay.explode({ x: 10, y: 10 }, 'down', seeded()).filter((p) => p.kind === 'fragment');
  right.forEach((p, i) => {
    assert.ok(Math.abs(p.x0 - (10 + p.ox)) < 1e-9);
    assert.ok(Math.abs(p.y0 - (10 + p.oy)) < 1e-9);
    assert.ok(Math.abs(down[i].x0 - (10 - p.oy)) < 1e-9);
    assert.ok(Math.abs(down[i].y0 - (10 + p.ox)) < 1e-9);
  });
  assert.ok(Math.abs(down[0].rot0 - Math.PI / 2) < 1e-9);
});

test('pieces fly apart and then expire', () => {
  const center = { x: 10, y: 10 };
  for (const p of Replay.explode(center, 'right', seeded())) {
    const dist = (s) => Math.hypot(s.x - center.x, s.y - center.y);
    const early = Replay.pieceAt(p, 0.01), late = Replay.pieceAt(p, p.life * 0.9);
    assert.ok(dist(late) > dist(early), 'a piece must move away from the blast');
    assert.ok(late.alpha < early.alpha, 'a piece must fade as it flies');
    assert.strictEqual(Replay.pieceAt(p, p.life + 0.01), null);
    assert.ok(p.life <= Replay.EXPLODE_SEC, 'debris has to finish inside the explosion stage');
  }
});

const trailOf = (n) => Array.from({ length: n }, (_, i) => ({ x: i, y: 5 }));

test('a dead trail dissolves from the crash point back, and is gone inside the explosion stage', () => {
  const round = duelRound();
  round.snakes[1].alive = false;
  round.snakes[1].body = trailOf(40);
  const rec = Replay.createRecorder();
  Replay.record(rec, round, 0);
  const pb = Replay.createPlayback(rec, seeded());
  const alive = Replay.wreckedView(pb, 0.2).snakes[0];
  assert.strictEqual(alive.body.length, round.snakes[0].body.length, "the survivor's trail is untouched");
  const early = Replay.wreckedView(pb, 0.1).snakes[1].body;
  assert.ok(early.length > 0 && early.length < 40);
  assert.deepStrictEqual(early[0], { x: 0, y: 5 }, 'the tail end is the last to go');
  assert.strictEqual(Replay.wreckedView(pb, Replay.EXPLODE_SEC).snakes[1].body.length, 0);
  assert.strictEqual(Replay.wreckedView(pb).snakes[1].body.length, 40, 'no age: the trail is left whole');
});

test('each trail cell sheds one shard, released as the dissolve reaches it', () => {
  const body = trailOf(40);
  const shards = Replay.shatter(body, seeded());
  assert.strictEqual(shards.length, 40);
  const head = shards[39], tail = shards[0];
  assert.strictEqual(head.delay, 0);
  assert.ok(tail.delay > head.delay);
  assert.strictEqual(Replay.pieceAt(tail, tail.delay - 0.01), null, 'not loose yet');
  assert.ok(Replay.pieceAt(tail, tail.delay + 0.01));
  for (const s of shards) {
    assert.ok(s.delay + s.life <= Replay.EXPLODE_SEC, 'shards have to finish inside the explosion stage');
  }
});

test('a very long trail still dissolves in time', () => {
  const shards = Replay.shatter(trailOf(1500), seeded());
  assert.ok(Math.max(...shards.map((s) => s.delay)) <= Replay.DEREZ_SEC + 1e-9);
});

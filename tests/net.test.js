const assert = require('node:assert');
const { test } = require('node:test');
const Net = require('../src/net');
const Round = require('../src/round');

test('mulberry32 is deterministic per seed and emits [0,1)', () => {
  const a = Net.mulberry32(42), b = Net.mulberry32(42), c = Net.mulberry32(43);
  const seqA = [a(), a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b(), b()];
  const seqC = [c(), c(), c(), c(), c()];
  assert.deepStrictEqual(seqA, seqB);
  assert.notDeepStrictEqual(seqA, seqC);
  seqA.forEach((v) => assert.ok(v >= 0 && v < 1, `${v} out of range`));
});

test('a fresh session can execute the pre-seeded delay ticks immediately', () => {
  const s = Net.createSession(0);
  for (let t = 0; t < Net.INPUT_DELAY; t++) {
    assert.ok(Net.canTick(s), `tick ${t} should be executable`);
    Net.localTurns(s, []);
    const got = Net.takeTick(s);
    assert.strictEqual(got.tick, t);
    assert.deepStrictEqual(got.turns, [[], []]);
  }
  assert.strictEqual(Net.canTick(s), false, 'first non-preseeded tick needs remote input');
});

test('remote input unblocks the next tick', () => {
  const s = Net.createSession(0);
  for (let t = 0; t < Net.INPUT_DELAY; t++) { Net.localTurns(s, []); Net.takeTick(s); }
  Net.remoteInput(s, { type: 'input', t: Net.INPUT_DELAY, turns: ['up'] });
  assert.ok(Net.canTick(s));
  const got = Net.takeTick(s);
  assert.strictEqual(got.tick, Net.INPUT_DELAY);
  assert.deepStrictEqual(got.turns[1], ['up'], 'player 1 turns come from the remote side');
});

test('localTurns schedules INPUT_DELAY ahead and copies the array', () => {
  const s = Net.createSession(0);
  const dirs = ['left'];
  const msg = Net.localTurns(s, dirs);
  assert.deepStrictEqual(msg, { type: 'input', t: Net.INPUT_DELAY, turns: ['left'] });
  dirs.push('up'); // caller mutation must not leak into the session or message
  assert.deepStrictEqual(msg.turns, ['left']);
  Net.takeTick(s); Net.localTurns(s, []); Net.takeTick(s);
  Net.remoteInput(s, { type: 'input', t: Net.INPUT_DELAY, turns: [] });
  assert.deepStrictEqual(Net.takeTick(s).turns[0], ['left']);
});

test('turns always come back in [player0, player1] order for the joiner too', () => {
  const s = Net.createSession(1); // local player is index 1
  const msg = Net.localTurns(s, ['down']);
  Net.remoteInput(s, { type: 'input', t: Net.INPUT_DELAY, turns: ['up'] });
  Net.takeTick(s); Net.localTurns(s, []); Net.takeTick(s);
  assert.strictEqual(msg.t, Net.INPUT_DELAY);
  const got = Net.takeTick(s);
  assert.deepStrictEqual(got.turns, [['up'], ['down']]);
});

test('paired sessions produce identical tick/turn streams', () => {
  const sA = Net.createSession(0), sB = Net.createSession(1);
  const wireAtoB = [], wireBtoA = [], gotA = [], gotB = [];
  const localA = { 0: ['up'], 4: ['left', 'down'] };
  const localB = { 2: ['down'] };
  for (let step = 0; step < 12; step++) {
    while (wireBtoA.length) Net.remoteInput(sA, wireBtoA.shift());
    while (wireAtoB.length) Net.remoteInput(sB, wireAtoB.shift());
    if (Net.canTick(sA)) { wireAtoB.push(Net.localTurns(sA, localA[sA.next] || [])); gotA.push(Net.takeTick(sA)); }
    if (Net.canTick(sB)) { wireBtoA.push(Net.localTurns(sB, localB[sB.next] || [])); gotB.push(Net.takeTick(sB)); }
  }
  const shared = Math.min(gotA.length, gotB.length);
  assert.ok(shared >= 8, `expected at least 8 shared ticks, got ${shared}`);
  assert.deepStrictEqual(gotA.slice(0, shared), gotB.slice(0, shared));
});

test('stateHash matches for identical rounds and diverges after a tick', () => {
  const specs = [
    { start: { x: 16, y: 20 }, direction: 'right' },
    { start: { x: 48, y: 20 }, direction: 'left' },
  ];
  const a = Round.createRound(64, 40, specs);
  const b = Round.createRound(64, 40, specs);
  assert.strictEqual(Net.stateHash(a), Net.stateHash(b));
  Round.tick(a, 0);
  assert.notStrictEqual(Net.stateHash(a), Net.stateHash(b));
});

test('hash notes are pending until both sides report, then compare', () => {
  const s = Net.createSession(0);
  assert.strictEqual(Net.noteLocalHash(s, 60, 123), 'pending');
  assert.strictEqual(Net.noteRemoteHash(s, 60, 123), 'ok');
  // arrival order must not matter
  assert.strictEqual(Net.noteRemoteHash(s, 120, 5), 'pending');
  assert.strictEqual(Net.noteLocalHash(s, 120, 5), 'ok');
  // mismatch flags a desync
  assert.strictEqual(Net.noteLocalHash(s, 180, 1), 'pending');
  assert.strictEqual(Net.noteRemoteHash(s, 180, 2), 'desync');
});

test('localTurns embeds the optional hash in the message', () => {
  const s = Net.createSession(0);
  assert.strictEqual(Net.localTurns(s, []).hash, undefined);
  Net.takeTick(s);
  assert.strictEqual(Net.localTurns(s, [], 999).hash, 999);
});

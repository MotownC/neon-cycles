const assert = require('node:assert');
const { test } = require('node:test');
const { createRooms, ALPHABET } = require('../server/rooms');

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

test('host creates a 4-letter code from the unambiguous alphabet', () => {
  const rooms = createRooms(seeded(1));
  const { code } = rooms.host('h1', { wallDensity: 'low', trailMode: 'tron' });
  assert.strictEqual(code.length, 4);
  for (const ch of code) assert.ok(ALPHABET.includes(ch), `${ch} not in alphabet`);
  assert.ok(!ALPHABET.includes('I') && !ALPHABET.includes('O'), 'ambiguous letters excluded');
});

test('join pairs both players with the same seed and correct youAre', () => {
  const rooms = createRooms(seeded(2));
  const settings = { wallDensity: 'high', trailMode: 'fade' };
  const { code } = rooms.host('h1', settings);
  const res = rooms.join(code, 'j1');
  assert.strictEqual(res.error, undefined);
  assert.strictEqual(res.hostId, 'h1');
  const [toHost, toJoiner] = res.start;
  assert.strictEqual(toHost.type, 'start');
  assert.strictEqual(toHost.youAre, 0);
  assert.strictEqual(toJoiner.youAre, 1);
  assert.strictEqual(toHost.seed, toJoiner.seed);
  assert.ok(Number.isInteger(toHost.seed) && toHost.seed >= 0);
  assert.deepStrictEqual(toHost.settings, settings);
});

test('join is case-insensitive', () => {
  const rooms = createRooms(seeded(3));
  const { code } = rooms.host('h1', {});
  assert.strictEqual(rooms.join(code.toLowerCase(), 'j1').error, undefined);
});

test('join errors: unknown code, full room, own room', () => {
  const rooms = createRooms(seeded(4));
  assert.strictEqual(rooms.join('ZZZZ', 'j1').error, 'ROOM NOT FOUND');
  const { code } = rooms.host('h1', {});
  assert.strictEqual(rooms.join(code, 'h1').error, 'THAT IS YOUR OWN ROOM');
  rooms.join(code, 'j1');
  assert.strictEqual(rooms.join(code, 'j2').error, 'ROOM FULL');
});

test('opponentOf resolves both directions and null when unpaired', () => {
  const rooms = createRooms(seeded(5));
  const { code } = rooms.host('h1', {});
  assert.strictEqual(rooms.opponentOf('h1'), null, 'no opponent before join');
  rooms.join(code, 'j1');
  assert.strictEqual(rooms.opponentOf('h1'), 'j1');
  assert.strictEqual(rooms.opponentOf('j1'), 'h1');
  assert.strictEqual(rooms.opponentOf('stranger'), null);
});

test('leave tears down the room and reports the abandoned opponent', () => {
  const rooms = createRooms(seeded(6));
  const { code } = rooms.host('h1', {});
  rooms.join(code, 'j1');
  assert.strictEqual(rooms.leave('h1'), 'j1');
  assert.strictEqual(rooms.join(code, 'j2').error, 'ROOM NOT FOUND', 'room deleted');
  assert.strictEqual(rooms.leave('j1'), null, 'already torn down');
});

test('hosting again abandons the previous room', () => {
  const rooms = createRooms(seeded(7));
  const first = rooms.host('h1', {});
  const second = rooms.host('h1', {});
  assert.strictEqual(rooms.join(first.code, 'j1').error, 'ROOM NOT FOUND');
  assert.strictEqual(rooms.join(second.code, 'j1').error, undefined);
});

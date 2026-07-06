const assert = require('node:assert');
const { test } = require('node:test');
const { createRooms, ALPHABET } = require('../server/rooms');
const Net = require('../src/net');
const WebSocket = require('ws');
const { createGameServer } = require('../server/server');

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

test('two clients pair, relay inputs, and get disconnect notice', async () => {
  const server = createGameServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const open = (ws) => new Promise((resolve) => ws.on('open', resolve));
  const next = (ws) => new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(d))));
  const say = (ws, msg) => ws.send(JSON.stringify(msg));

  const a = new WebSocket(`ws://127.0.0.1:${port}`);
  const b = new WebSocket(`ws://127.0.0.1:${port}`);
  await Promise.all([open(a), open(b)]);
  say(a, { type: 'hello', v: Net.PROTOCOL_VERSION });
  say(b, { type: 'hello', v: Net.PROTOCOL_VERSION });

  say(a, { type: 'host', settings: { wallDensity: 'low', trailMode: 'tron' } });
  const hosted = await next(a);
  assert.strictEqual(hosted.type, 'hosted');

  const startA = next(a);
  say(b, { type: 'join', code: hosted.code });
  const [sA, sB] = await Promise.all([startA, next(b)]);
  assert.strictEqual(sA.type, 'start');
  assert.strictEqual(sA.youAre, 0);
  assert.strictEqual(sB.youAre, 1);
  assert.strictEqual(sA.seed, sB.seed);
  assert.deepStrictEqual(sA.settings, { wallDensity: 'low', trailMode: 'tron' });

  const relayed = next(b);
  say(a, { type: 'input', t: 2, turns: ['up'] });
  assert.deepStrictEqual(await relayed, { type: 'input', t: 2, turns: ['up'] });

  const left = next(b);
  a.close();
  assert.strictEqual((await left).type, 'opponentLeft');
  b.close();
  await new Promise((resolve) => server.close(resolve));
});

test('stale protocol version gets versionMismatch', async () => {
  const server = createGameServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  await new Promise((resolve) => ws.on('open', resolve));
  const reply = new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(d))));
  ws.send(JSON.stringify({ type: 'hello', v: -1 }));
  assert.strictEqual((await reply).type, 'versionMismatch');
  ws.close();
  await new Promise((resolve) => server.close(resolve));
});

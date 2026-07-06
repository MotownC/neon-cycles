# Online Multiplayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two players in different locations play the existing versus rules over the internet via server-sequenced deterministic lockstep.

**Architecture:** Both browsers run the identical pure simulation from a shared seed; a dumb Node server pairs room codes and relays per-tick input messages. A client executes tick N only when it holds both players' inputs for N. New pure module `src/net.js` (lockstep brain), pure `server/rooms.js` (pairing), thin shells `server/server.js` and `src/online.js`, plus `main.js` wiring.

**Tech Stack:** Vanilla JS UMD modules, `node:test`, `ws` (server-only dependency), Render free tier for hosting.

**Spec:** `docs/superpowers/specs/2026-07-05-online-multiplayer-design.md`

**Repo caution:** The working tree has unrelated uncommitted WIP in `styles.css`, `src/round.js`, `src/cpu.js`, `src/audio.js`, `src/powerups.js`, `src/gauntlet.js`, `tests/cpu.test.js`, `tests/round.test.js`, `tests/powerups.test.js`, `tests/gauntlet.test.js`. **Never modify or `git add` those files.** Always commit with explicit paths, never `git add -A`.

---

### Task 1: `src/net.js` — lockstep core

**Files:**
- Create: `src/net.js`
- Test: `tests/net.test.js` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/net.test.js`:

```js
const assert = require('node:assert');
const { test } = require('node:test');
const Net = require('../src/net');

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/net.test.js`
Expected: FAIL — `Cannot find module '../src/net'`

- [ ] **Step 3: Write the implementation**

Create `src/net.js`:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const PROTOCOL_VERSION = 1;
  const INPUT_DELAY = 2;   // ticks between scheduling a turn and it taking effect
  const HASH_EVERY = 60;   // ticks between desync-tripwire hash exchanges

  // Small seeded PRNG. Both clients feed the server's shared seed through
  // this so wall generation is identical on both machines.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Lockstep state: tick N may only execute once both players' turn lists
  // for N are present. Ticks 0..INPUT_DELAY-1 are pre-seeded empty so the
  // pipeline can start before the first messages cross the wire.
  function createSession(playerIndex) {
    const inputs = [new Map(), new Map()];
    for (let t = 0; t < INPUT_DELAY; t++) { inputs[0].set(t, []); inputs[1].set(t, []); }
    return { playerIndex, next: 0, inputs, hashes: new Map() };
  }

  // Schedule the local player's turns INPUT_DELAY ahead of the tick about to
  // execute and build the wire message. Call exactly once per executed tick
  // (with [] when no keys were pressed) so the opponent can always advance.
  function localTurns(session, dirs, hash) {
    const t = session.next + INPUT_DELAY;
    session.inputs[session.playerIndex].set(t, dirs.slice());
    const msg = { type: 'input', t, turns: dirs.slice() };
    if (hash !== undefined) msg.hash = hash;
    return msg;
  }

  function remoteInput(session, msg) {
    session.inputs[1 - session.playerIndex].set(msg.t, (msg.turns || []).slice());
  }

  function canTick(session) {
    return session.inputs[0].has(session.next) && session.inputs[1].has(session.next);
  }

  function takeTick(session) {
    const t = session.next;
    const turns = [session.inputs[0].get(t), session.inputs[1].get(t)];
    session.inputs[0].delete(t);
    session.inputs[1].delete(t);
    session.next = t + 1;
    return { tick: t, turns };
  }

  return { __name: 'Net', PROTOCOL_VERSION, INPUT_DELAY, HASH_EVERY,
    mulberry32, createSession, localTurns, remoteInput, canTick, takeTick };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/net.test.js` — Expected: all pass.
Run: `node --test` — Expected: no existing test broken.

- [ ] **Step 5: Commit**

```bash
git add src/net.js tests/net.test.js
git commit -m "feat: lockstep session core (net.js) with seeded PRNG"
```

---

### Task 2: `src/net.js` — desync tripwire hashes

**Files:**
- Modify: `src/net.js`
- Test: `tests/net.test.js` (append)

- [ ] **Step 1: Write the failing tests** (append to `tests/net.test.js`; also add the requires at the top of the file)

```js
const Round = require('../src/round');
```

```js
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test tests/net.test.js`
Expected: the three new tests FAIL (`Net.stateHash is not a function`).

- [ ] **Step 3: Implement** (add to the factory body in `src/net.js`, before the return; add the new names to the return object)

```js
  // Desync tripwire: each side records its own hash for a tick and the
  // opponent's when it arrives; once both exist they are compared exactly
  // once. 'pending' until then. This should never fire in practice — it
  // exists so a nondeterminism bug fails loudly instead of silently playing
  // two different games.
  function noteHash(session, tick, hash, slot) {
    const entry = session.hashes.get(tick) || {};
    entry[slot] = hash;
    if (entry.mine === undefined || entry.theirs === undefined) {
      session.hashes.set(tick, entry);
      return 'pending';
    }
    session.hashes.delete(tick);
    return entry.mine === entry.theirs ? 'ok' : 'desync';
  }
  function noteLocalHash(session, tick, hash) { return noteHash(session, tick, hash, 'mine'); }
  function noteRemoteHash(session, tick, hash) { return noteHash(session, tick, hash, 'theirs'); }

  // Cheap FNV-1a digest of the parts of sim state that would drift first if
  // the machines ever disagreed: heads, headings, alive flags, trail sizes.
  function stateHash(round) {
    let str = '';
    for (const s of round.snakes) {
      const h = s.body[s.body.length - 1];
      str += h.x + ',' + h.y + ',' + s.direction + ',' + (s.alive ? 1 : 0) + ',' + s.body.length + ';';
    }
    str += round.board.lit.size;
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }
```

Return object becomes:

```js
  return { __name: 'Net', PROTOCOL_VERSION, INPUT_DELAY, HASH_EVERY,
    mulberry32, createSession, localTurns, remoteInput, canTick, takeTick,
    noteLocalHash, noteRemoteHash, stateHash };
```

- [ ] **Step 4: Run tests** — `node --test tests/net.test.js` all pass; `node --test` stays green.

- [ ] **Step 5: Commit**

```bash
git add src/net.js tests/net.test.js
git commit -m "feat: desync tripwire hashes in net.js"
```

---

### Task 3: determinism proof test

Proves the lockstep premise: same seed + same input log ⇒ bit-identical rounds, using the exact tick recipe `main.js` will use online (simulated elapsed, not wall clock).

**Files:**
- Test: `tests/net.test.js` (append; add requires)

- [ ] **Step 1: Write the test** (append; add these requires at the top)

```js
const Snake = require('../src/snake');
const Walls = require('../src/walls');
const Speed = require('../src/speed');
```

```js
// Mirrors the online tick recipe in main.js: walls from the shared seed,
// elapsed derived from tick count (never wall clock), turns applied via
// bufferDirection before each tick.
function playScripted(seed, script, trailMode) {
  const rand = Net.mulberry32(seed);
  const walls = Walls.generate(64, 40, 'med', rand);
  const specs = [
    { start: { x: 16, y: 20 }, direction: 'right' },
    { start: { x: 48, y: 20 }, direction: 'left' },
  ];
  const round = Round.createRound(64, 40, specs, walls, trailMode);
  let elapsed = 0;
  for (let tick = 0; tick < 400 && !round.over; tick++) {
    (script[tick] || []).forEach(([player, dir]) => Snake.bufferDirection(round.snakes[player], dir));
    Round.tick(round, elapsed);
    elapsed += Speed.tickInterval(elapsed) / 1000;
  }
  return round;
}

test('same seed and input log produce bit-identical rounds', () => {
  for (const trailMode of ['tron', 'fade', 'classic']) {
    const script = { 3: [[0, 'up']], 5: [[1, 'down']], 9: [[0, 'right']], 12: [[1, 'left'], [0, 'down']], 20: [[0, 'up']] };
    const a = playScripted(1234, script, trailMode);
    const b = playScripted(1234, script, trailMode);
    assert.deepStrictEqual(a.snakes.map((s) => s.body), b.snakes.map((s) => s.body), trailMode);
    assert.deepStrictEqual([...a.board.lit].sort(), [...b.board.lit].sort(), trailMode);
    assert.strictEqual(a.winnerIndex, b.winnerIndex, trailMode);
    assert.strictEqual(Net.stateHash(a), Net.stateHash(b), trailMode);
  }
});
```

- [ ] **Step 2: Run** — `node --test tests/net.test.js` — Expected: PASS immediately (the pure modules are already deterministic; this is a regression tripwire, so a pass is the result, not a red flag).

- [ ] **Step 3: Commit**

```bash
git add tests/net.test.js
git commit -m "test: determinism proof for online lockstep tick recipe"
```

---

### Task 4: `server/rooms.js` — pure room manager

**Files:**
- Create: `server/rooms.js`
- Test: `tests/server.test.js` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/server.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify failure** — `node --test tests/server.test.js` — Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

Create `server/rooms.js` (plain CommonJS — server-only, never loaded in the browser):

```js
// Pure room bookkeeping for the online server: codes, seeds, pairing,
// teardown. No sockets here so it is unit-testable (tests/server.test.js);
// server.js is a thin socket shell around this.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O — unambiguous when texted

function createRooms(rand = Math.random) {
  const rooms = new Map(); // code -> { code, seed, settings, players: [hostId, joinerId|null] }

  function freshCode() {
    let code;
    do {
      code = '';
      for (let i = 0; i < 4; i++) code += ALPHABET[(rand() * ALPHABET.length) | 0];
    } while (rooms.has(code));
    return code;
  }

  function roomOf(id) {
    for (const room of rooms.values()) if (room.players.includes(id)) return room;
    return null;
  }

  function host(hostId, settings) {
    leave(hostId); // hosting again abandons any previous room
    const code = freshCode();
    rooms.set(code, { code, seed: (rand() * 0x100000000) >>> 0, settings: settings || {}, players: [hostId, null] });
    return { code };
  }

  function join(rawCode, joinerId) {
    const room = rooms.get(String(rawCode || '').toUpperCase());
    if (!room) return { error: 'ROOM NOT FOUND' };
    if (room.players[0] === joinerId) return { error: 'THAT IS YOUR OWN ROOM' };
    if (room.players[1] !== null) return { error: 'ROOM FULL' };
    room.players[1] = joinerId;
    return {
      hostId: room.players[0],
      start: [
        { type: 'start', seed: room.seed, settings: room.settings, youAre: 0 },
        { type: 'start', seed: room.seed, settings: room.settings, youAre: 1 },
      ],
    };
  }

  function opponentOf(id) {
    const room = roomOf(id);
    if (!room) return null;
    const other = room.players[0] === id ? room.players[1] : room.players[0];
    return other === null ? null : other;
  }

  function leave(id) {
    const room = roomOf(id);
    if (!room) return null;
    rooms.delete(room.code);
    return room.players[0] === id ? room.players[1] : room.players[0];
  }

  return { host, join, opponentOf, leave, roomOf };
}

module.exports = { createRooms, ALPHABET };
```

- [ ] **Step 4: Run tests** — `node --test tests/server.test.js` all pass; `node --test` green.

- [ ] **Step 5: Commit**

```bash
git add server/rooms.js tests/server.test.js
git commit -m "feat: pure room manager for online pairing"
```

---

### Task 5: `server/server.js` + `ws` dependency + integration test

**Files:**
- Create: `server/server.js`, `.gitignore`
- Modify: `package.json`
- Test: `tests/server.test.js` (append)

- [ ] **Step 1: Install `ws` and add the start script**

```bash
npm install ws
```

Then edit `package.json` scripts (keep everything else):

```json
  "scripts": {
    "test": "node --test",
    "start": "node server/server.js"
  }
```

Create `.gitignore`:

```
node_modules/
```

- [ ] **Step 2: Write the failing integration test** (append to `tests/server.test.js`; add requires at top)

```js
const Net = require('../src/net');
const WebSocket = require('ws');
const { createGameServer } = require('../server/server');
```

```js
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
```

- [ ] **Step 3: Run to verify failure** — `node --test tests/server.test.js` — Expected: FAIL, cannot find `../server/server`.

- [ ] **Step 4: Implement**

Create `server/server.js`:

```js
// Thin shell: static files over HTTP, lockstep relay over WebSocket.
// All pairing decisions live in rooms.js; nothing in here parses game state.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const Net = require('../src/net.js'); // UMD modules load fine under CommonJS
const { createRooms } = require('./rooms.js');

const PORT = process.env.PORT || 8735;
const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/plain',
};

function createGameServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const filePath = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });

  const wss = new WebSocketServer({ server });
  const rooms = createRooms();
  const sockets = new Map(); // id -> ws
  let nextId = 1;
  const send = (id, obj) => {
    const ws = sockets.get(id);
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  };

  wss.on('connection', (ws) => {
    const id = nextId++;
    sockets.set(id, ws);
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'hello') {
        if (msg.v !== Net.PROTOCOL_VERSION) send(id, { type: 'versionMismatch' });
      } else if (msg.type === 'host') {
        send(id, { type: 'hosted', code: rooms.host(id, msg.settings).code });
      } else if (msg.type === 'join') {
        const res = rooms.join(msg.code, id);
        if (res.error) { send(id, { type: 'joinError', reason: res.error }); return; }
        send(res.hostId, res.start[0]);
        send(id, res.start[1]);
      } else if (msg.type === 'input' || msg.type === 'ready') {
        const opponent = rooms.opponentOf(id);
        if (opponent !== null) send(opponent, msg);
      }
    });
    ws.on('close', () => {
      sockets.delete(id);
      const opponent = rooms.leave(id);
      if (opponent !== null) send(opponent, { type: 'opponentLeft' });
    });
  });

  return server;
}

if (require.main === module) {
  createGameServer().listen(PORT, () => console.log(`neon-cycles online server on :${PORT}`));
}

module.exports = { createGameServer };
```

- [ ] **Step 5: Run tests** — `node --test tests/server.test.js` all pass; `node --test` green.

- [ ] **Step 6: Commit** (explicit paths — package-lock.json is new and safe; node_modules is ignored)

```bash
git add server/server.js tests/server.test.js package.json package-lock.json .gitignore
git commit -m "feat: online server — static files, room pairing, input relay"
```

---

### Task 6: `src/online.js` + `index.html` menu/scripts + version bump to 0.10.0

**Files:**
- Create: `src/online.js`
- Modify: `index.html`, `package.json`

`online.js` is browser-only shell (no unit tests, like `input.js`/`audio.js`).

- [ ] **Step 1: Create `src/online.js`**

```js
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./net') : window.Net);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function (Net) {
  // Browser-only shell bridging main.js to the WebSocket server. All lockstep
  // logic lives in net.js; this file only moves messages.
  let ws = null;
  let handlers = {};

  const ROUTES = {
    hosted: 'onHosted', start: 'onStart', input: 'onInput', ready: 'onReady',
    joinError: 'onJoinError', opponentLeft: 'onOpponentLeft', versionMismatch: 'onVersionMismatch',
  };

  function connect(h) {
    handlers = h;
    return new Promise((resolve, reject) => {
      if (ws && ws.readyState === 1) return resolve();
      if (window.location.protocol === 'file:') {
        return reject(new Error('ONLINE NEEDS THE HOSTED URL, NOT A LOCAL FILE'));
      }
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(proto + '//' + window.location.host);
      ws = socket;
      socket.onopen = () => { send({ type: 'hello', v: Net.PROTOCOL_VERSION }); resolve(); };
      socket.onerror = () => { if (ws === socket) { ws = null; reject(new Error('COULD NOT REACH SERVER')); } };
      socket.onclose = () => {
        if (ws !== socket) return; // deliberate disconnect() already cleaned up
        ws = null;
        if (handlers.onClosed) handlers.onClosed();
      };
      socket.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        const fn = handlers[ROUTES[msg.type]];
        if (fn) fn(msg);
      };
    });
  }

  function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

  function disconnect() {
    const socket = ws;
    ws = null;          // clear first so onclose doesn't fire onClosed
    handlers = {};
    if (socket) socket.close();
  }

  function connected() { return !!ws && ws.readyState === 1; }

  return { __name: 'Online', connect, send, disconnect, connected };
});
```

- [ ] **Step 2: Edit `index.html`**

(a) Inside `<div class="menu-buttons">`, after the gauntlet button, add:

```html
        <button id="online-toggle" class="neon-btn cyan">ONLINE — PLAY A FRIEND</button>
```

(b) Immediately after the closing `</div>` of `.menu-buttons`, add (outer div has no inline `display` so the `.hidden` class still wins; the inner div carries the layout):

```html
      <div id="online-panel" class="hidden">
        <div style="display:flex;flex-direction:column;gap:8px;align-items:center;margin:8px 0">
          <button id="online-host" class="neon-btn cyan">HOST — GET A ROOM CODE</button>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="online-code-input" maxlength="4" placeholder="CODE" autocapitalize="characters"
              autocomplete="off" spellcheck="false"
              style="width:7ch;background:#0a0a14;border:1px solid #2de2e6;color:#2de2e6;font:inherit;text-align:center;text-transform:uppercase;padding:6px" />
            <button id="online-join" class="neon-btn magenta">JOIN</button>
          </div>
          <p class="hint" id="online-status"></p>
        </div>
      </div>
```

(c) Add script tags between `input.js` and `main.js`:

```html
  <script src="src/net.js?v=0.10.0"></script>
  <script src="src/online.js?v=0.10.0"></script>
```

(d) Version bump: every `?v=0.9.0` → `?v=0.10.0` (stylesheet + all scripts), and `<p class="hint" id="version">v0.9.0</p>` → `v0.10.0`. In `package.json`, `"version": "0.9.0"` → `"0.10.0"`.

- [ ] **Step 3: Sanity check** — `node --test` still green; `node -e "console.log(require('./src/online.js').__name)"` prints `Online`.

- [ ] **Step 4: Commit**

```bash
git add src/online.js index.html package.json
git commit -m "feat: online socket shell, menu markup; bump to 0.10.0"
```

---

### Task 7: `main.js` online mode wiring

**Files:**
- Modify: `src/main.js`

All edits below; no unit tests (browser shell), verified end-to-end in Task 9.

- [ ] **Step 1: State + helper.** In the `state` object, after `gauntlet: null,` add:

```js
    online: null, // { seed, settings, youAre, session, pending, roundNumber, localReady, remoteReady, stallSince, lagging }
```

After the `rivalKey()` function add:

```js
  // Online mode is only live once a start message has populated state.online
  // (after an abort we can be back at the menu with mode still 'online').
  function isOnline() { return state.mode === 'online' && state.online !== null; }
```

- [ ] **Step 2: `newRound()` — seeded walls, host settings, per-round session, colors.** Replace the two lines

```js
    const walls = Walls.generate(COLS, ROWS, state.wallDensity);
    state.round = Round.createRound(COLS, ROWS, specs, walls, state.trailMode);
```

with:

```js
    const online = isOnline() ? state.online : null;
    const walls = Walls.generate(COLS, ROWS,
      online ? online.settings.wallDensity : state.wallDensity,
      online ? Net.mulberry32((online.seed + online.roundNumber) >>> 0) : Math.random);
    state.round = Round.createRound(COLS, ROWS, specs, walls,
      online ? online.settings.trailMode : state.trailMode);
    if (online) {
      online.session = Net.createSession(online.youAre);
      online.pending = [];
      online.stallSince = null;
      online.lagging = false;
    }
```

Replace the colors block

```js
    const rivalColor = vsCpu() ? RIVALS[rivalKey()].color : null;
    state.colors = [state.playerColor,
      rivalColor && rivalColor !== state.playerColor ? rivalColor : Renderer.pickOpponentColor(state.playerColor)];
```

with:

```js
    const rivalColor = vsCpu() ? RIVALS[rivalKey()].color : null;
    state.colors = [state.playerColor,
      rivalColor && rivalColor !== state.playerColor ? rivalColor : Renderer.pickOpponentColor(state.playerColor)];
    if (online && online.youAre === 1) {
      // Colors are local cosmetics: your menu pick always paints YOUR snake.
      state.colors = [Renderer.pickOpponentColor(state.playerColor), state.playerColor];
    }
```

- [ ] **Step 3: `loop()` — online tick path.** Replace `state.elapsed += dtSec;` with:

```js
    if (!isOnline()) state.elapsed += dtSec; // online: elapsed advances per confirmed tick below
```

Wrap the bolt accumulator block and the powerup lines in a guard. The section from `const boltInt = ...` through `const frozen = Powerups.frozenIndices(...)` becomes:

```js
    let frozen = [];
    if (!isOnline()) {
      const boltInt = Speed.tickInterval(state.elapsed) / 3;
      state.boltAcc += dt;
      while (state.boltAcc >= boltInt) {
        state.boltAcc -= boltInt;
        const outcomes = Projectile.advanceBolts(state.round, state.elapsed);
        outcomes.forEach((o) => {
          state.flashes.push({ pos: o.pos, type: o.type, start: state.elapsed });
          o.type === 'bounce' ? Audio.bounceSfx() : Audio.derezSfx();
        });
      }
      state.flashes = state.flashes.filter((f) => state.elapsed - f.start < Renderer.FLASH_DURATION_SEC);
      Powerups.maybeSpawn(state.round, state.elapsed);
      frozen = Powerups.frozenIndices(state.round, state.elapsed);
    }
```

Then change the ticking section. Before `if (!state.turboEnabled) {` insert the online branch so the structure is `if (isOnline()) { ... } else if (!state.turboEnabled) { ... } else { ... }`:

```js
    if (isOnline()) {
      const o = state.online;
      // Cap the accumulator so a long stall doesn't fast-forward a burst of
      // ticks when input resumes (both sides stall together within INPUT_DELAY).
      state.acc = Math.min(state.acc + dt, 4 * Speed.BASE_MS);
      let interval = Speed.tickInterval(state.elapsed);
      while (state.acc >= interval && Net.canTick(o.session)) {
        state.acc -= interval;
        const tickNum = o.session.next;
        let hash;
        if (tickNum > 0 && tickNum % Net.HASH_EVERY === 0) {
          hash = Net.stateHash(state.round);
          if (Net.noteLocalHash(o.session, tickNum, hash) === 'desync') return onlineAbort('GAME OUT OF SYNC — PLEASE REFRESH');
        }
        Online.send(Net.localTurns(o.session, o.pending.splice(0), hash));
        const { turns } = Net.takeTick(o.session);
        turns.forEach((dirs, i) => dirs.forEach((d) => Snake.bufferDirection(state.round.snakes[i], d)));
        Round.tick(state.round, state.elapsed);
        state.elapsed += interval / 1000; // simulated time: identical on both machines
        interval = Speed.tickInterval(state.elapsed);
        tr({ t: now | 0,
          tick: state.round.snakes.map((s) => (s.alive ? s.direction : 'dead')),
          pos: state.round.snakes.map((s) => { const h = s.body[s.body.length - 1]; return `${h.x},${h.y}`; }) });
        if (state.round.over) { Renderer.render(ctx, state.round, cell, state.colors, state.borderColor, state.elapsed, state.flashes, state.atlas); return endRound(); }
      }
      if (state.acc >= interval && !Net.canTick(o.session)) {
        if (o.stallSince === null) o.stallSince = now;
        o.lagging = now - o.stallSince > 500;
      } else { o.stallSince = null; o.lagging = false; }
    } else if (!state.turboEnabled) {
```

Note: in the non-online paths the existing `state.acc += dt;` line stays where it is (inside the `!state.turboEnabled` branch).

Wrap the claim block after ticking:

```js
    if (!isOnline()) {
      Powerups.claim(state.round, state.elapsed).forEach((c) => {
        state.flashes.push({ pos: c.pos, type: 'pickup', start: state.elapsed });
        Audio.pickupSfx();
      });
    }
```

- [ ] **Step 4: labels + HUD.** Replace `label()`:

```js
  function label(index) {
    if (isOnline()) return index === state.online.youAre ? 'YOU' : 'FRIEND';
    if (!vsCpu()) return `PLAYER ${index + 1}`;
    return index === 0 ? 'YOU' : RIVALS[rivalKey()].name;
  }
```

In `updateHud()`, insert an online branch after the `vsCpu()` branch (before the final `else`):

```js
    else if (isOnline()) {
      const y = state.online.youAre;
      const lag = state.online.lagging ? ` <span style="opacity:.5;font-size:14px">CONNECTION LAGGING…</span>` : '';
      hud.innerHTML = `<span style="color:${state.colors[y]}">YOU ${state.match.scores[y]}</span>`
        + `<span style="color:${state.colors[1 - y]}">FRIEND ${state.match.scores[1 - y]}${lag}</span>`;
    }
```

- [ ] **Step 5: input handlers.** In `Input.attach({...})`, at the top of `onDirection`:

```js
    onDirection: (i, dir) => {
      if (isOnline()) {
        // Both key sets steer the local snake online; turns are queued for
        // the lockstep pipeline instead of touching the snake directly.
        if (state.phase !== 'playing') return;
        const p = state.online.pending;
        if (p.length < 3 && p[p.length - 1] !== dir) p.push(dir);
        tr({ t: performance.now() | 0, key: dir, online: true, pending: p.join('<') });
        return;
      }
```

At the top of `onTurbo` and `onFire` bodies add: `if (isOnline()) return;`

- [ ] **Step 6: round flow — ready handshake, begin, abort.** Replace `onAction()`:

```js
  function onAction() {
    if (isOnline()) {
      if (state.phase === 'gameover') { showMenu(); }
      else if (state.phase === 'roundover' && !state.online.localReady) {
        state.online.localReady = true;
        Online.send({ type: 'ready' });
        goTitle.textContent = 'WAITING FOR OPPONENT…';
        maybeStartNextOnlineRound();
      }
      return;
    }
    if (state.phase === 'gameover') { showMenu(); }
    else if (state.phase === 'roundover') { newRound(); startCountdown(); }
  }

  function maybeStartNextOnlineRound() {
    const o = state.online;
    if (!o || !o.localReady || !o.remoteReady) return;
    o.localReady = o.remoteReady = false;
    o.roundNumber += 1;
    newRound(); startCountdown();
  }

  function beginOnlineGame(start) {
    state.mode = 'online';
    state.gauntlet = null;
    state.online = { seed: start.seed >>> 0, settings: start.settings, youAre: start.youAre,
      session: null, pending: [], roundNumber: 0, localReady: false, remoteReady: false,
      stallSince: null, lagging: false };
    state.match = Match.createMatch(MATCH_TARGET);
    newRound(); startCountdown();
  }

  function onlineAbort(message) {
    Online.disconnect();
    state.online = null;
    if (state.phase === 'menu') { setOnlineStatus(message); return; }
    Audio.stop();
    show(gameover);
    goTitle.textContent = message;
    goBody.innerHTML = '';
    el('go-continue').textContent = 'PRESS ENTER FOR MENU';
    state.phase = 'gameover';
  }
```

In `showMenu()`, at the top add:

```js
    if (state.online) { Online.disconnect(); state.online = null; }
```

- [ ] **Step 7: menu wiring + socket handlers.** After the existing `colorButtons` wiring block, add:

```js
  // --- online menu wiring ---
  const setOnlineStatus = (text) => { el('online-status').textContent = text; };

  const onlineHandlers = {
    onHosted: (msg) => setOnlineStatus(`ROOM CODE: ${msg.code} — SEND IT TO YOUR FRIEND`),
    onStart: (msg) => beginOnlineGame(msg),
    onInput: (msg) => {
      if (!isOnline() || !state.online.session) return;
      Net.remoteInput(state.online.session, msg);
      if (msg.hash !== undefined
        && Net.noteRemoteHash(state.online.session, msg.t - Net.INPUT_DELAY, msg.hash) === 'desync') {
        onlineAbort('GAME OUT OF SYNC — PLEASE REFRESH');
      }
    },
    onReady: () => { if (isOnline()) { state.online.remoteReady = true; maybeStartNextOnlineRound(); } },
    onJoinError: (msg) => setOnlineStatus(msg.reason),
    onOpponentLeft: () => { if (isOnline() && state.phase !== 'gameover') onlineAbort('OPPONENT DISCONNECTED'); },
    onVersionMismatch: () => setOnlineStatus('NEW VERSION AVAILABLE — REFRESH THE PAGE'),
    onClosed: () => {
      if (isOnline() && state.phase !== 'gameover') onlineAbort('CONNECTION LOST');
      else setOnlineStatus('');
    },
  };

  async function onlineConnectAnd(action) {
    setOnlineStatus('CONNECTING…');
    const slow = setTimeout(() => setOnlineStatus('WAKING UP SERVER… (CAN TAKE ~30S)'), 3000);
    try {
      await Online.connect(onlineHandlers);
      action();
    } catch (err) {
      setOnlineStatus(err.message);
    } finally {
      clearTimeout(slow);
    }
  }

  el('online-toggle').addEventListener('click', () => el('online-panel').classList.toggle('hidden'));
  el('online-host').addEventListener('click', () => onlineConnectAnd(() =>
    Online.send({ type: 'host', settings: { wallDensity: state.wallDensity, trailMode: state.trailMode } })));
  el('online-join').addEventListener('click', () => {
    const code = el('online-code-input').value.trim().toUpperCase();
    if (code.length !== 4) return setOnlineStatus('ENTER THE 4-LETTER CODE');
    onlineConnectAnd(() => Online.send({ type: 'join', code }));
  });
```

- [ ] **Step 8: Sanity + commit.** Run `node --test` (green — main.js isn't under test, this catches accidental damage elsewhere).

```bash
git add src/main.js
git commit -m "feat: online lockstep mode in main game loop"
```

---

### Task 8: docs + launch config

**Files:**
- Create: `docs/deploy.md`
- Modify: `CLAUDE.md`, `.claude/launch.json`

- [ ] **Step 1: Create `docs/deploy.md`**

```markdown
# Deploying the online server (Render free tier)

One-time setup:

1. Push this repo to GitHub.
2. At https://dashboard.render.com create a **Web Service** from the repo.
   - Runtime: Node. Build command: `npm install`. Start command: `npm start`.
   - Instance type: Free.
3. Done. Every push to the default branch auto-deploys.

Both players open the service URL (e.g. `https://<name>.onrender.com`) —
the Node server serves the game files and the WebSocket relay on one port.

Notes:
- The free tier sleeps after ~15 min idle; the first visit cold-starts in
  ~30 s (the game shows "WAKING UP SERVER…" during connect).
- Local testing: `npm start`, then open two windows at
  `http://localhost:8735` — host in one, join with the code in the other.
```

- [ ] **Step 2: Update `CLAUDE.md`** — make these edits:

1. Commands section, add after the test lines:

```
npm start                        # online server (serves the game + WebSocket relay, port 8735)
```

2. In "Pure, DOM-free, tested modules" add: `` `net.js` (online lockstep: seeded PRNG, per-tick input pipeline with a 2-tick input delay, desync hashes) `` and mention `server/rooms.js` (pure room pairing, tested in `tests/server.test.js`).

3. In "Browser-only modules" add: `` `online.js` (WebSocket shell) ``; also note `server/server.js` (Node static+relay shell, `ws` is the only dependency and it is server-only — the browser game remains dependency-free).

4. Add a short "Online mode" subsection under Architecture:

```markdown
### Online mode (server-sequenced lockstep)

The `online` mode runs the same deterministic sim on both browsers from a
server-chosen seed; the server (`server/server.js`) only pairs 4-letter room
codes and relays per-tick `input` messages. A client executes tick N only
when both players' inputs for N are present (`Net.canTick`), with a 2-tick
input delay. **Online `state.elapsed` is simulated time** (advanced by
`Speed.tickInterval` per executed tick, never wall clock) — anything fed
into the sim must stay a pure function of seed + tick inputs. Turbo, bolts,
and powerups are disabled online (v1). Deploy notes: `docs/deploy.md`.
```

- [ ] **Step 3: Add a launch config** to `.claude/launch.json` `configurations` array (read the file first, keep the existing static entry):

```json
    {
      "name": "neon-cycles-server",
      "runtimeExecutable": "node",
      "runtimeArgs": ["server/server.js"],
      "port": 8735
    }
```

- [ ] **Step 4: Commit**

```bash
git add docs/deploy.md CLAUDE.md .claude/launch.json
git commit -m "docs: online mode architecture notes and Render deploy guide"
```

---

### Task 9: end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite** — `node --test` → everything green.

- [ ] **Step 2: Browser verification via preview tools.** Read the memory file `preview-harness-quirks.md` first (rAF throttling / input synthesis quirks). Start the `neon-cycles-server` launch config, then in the page:

1. Snapshot the menu; click `ONLINE — PLAY A FRIEND`; click `HOST — GET A ROOM CODE`; confirm the status shows a 4-letter room code.
2. Inject a fake joiner over a raw WebSocket via `preview_eval` (echoes the host's tick pacing with empty inputs, answers ready):

```js
(() => {
  const code = document.getElementById('online-status').textContent.match(/[A-Z]{4}/)[0];
  const ws = new WebSocket(`ws://${location.host}`);
  window.__bot = ws;
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'hello', v: window.Net.PROTOCOL_VERSION }));
    ws.send(JSON.stringify({ type: 'join', code }));
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'input') ws.send(JSON.stringify({ type: 'input', t: m.t, turns: [] }));
    if (m.type === 'ready') ws.send(JSON.stringify({ type: 'ready' }));
  };
  return 'bot joining ' + code;
})()
```

3. Confirm countdown starts, then gameplay: snapshot/screenshot shows two snakes advancing; HUD shows `YOU 0` / `FRIEND 0`.
4. Steer the host snake with synthesized ArrowUp/ArrowDown keydowns (use `e.code`, per the memory file); verify the turn lands after the input delay and the game keeps running.
5. Let the FRIEND snake (going straight) hit the far wall → round ends, `YOU WINS ROUND` overlay, score updates; press Enter → `WAITING FOR OPPONENT…` flips to countdown (bot answers ready) and round 2 begins with fresh identical-seed walls.
6. Close the bot (`window.__bot.close()`) mid-round → `OPPONENT DISCONNECTED` overlay; Enter returns to menu.
7. Check `preview_console_logs` for errors throughout.

- [ ] **Step 3: Fix anything found** (diagnose via source, re-verify), then final commit if fixes were needed.

---

## Self-review notes

- Spec coverage: determinism model → Tasks 1–3; rooms/server/protocol → Tasks 4–5; browser glue/menu/version → Task 6; game-loop lockstep, HUD, ready handshake, aborts, stall indicator → Task 7; deploy + CLAUDE.md → Task 8; verification → Task 9.
- Hash tick convention: sender attaches `stateHash` computed **before** executing tick K (K % 60 == 0) to the message for tick K+INPUT_DELAY; receiver maps it back via `msg.t - Net.INPUT_DELAY`. Both sides compute at the same sim point. Consistent across Tasks 2 and 7.
- `state.acc` is reused as the online accumulator; the non-online `state.acc += dt` line stays inside the turbo-off branch only, so there is no double-add.

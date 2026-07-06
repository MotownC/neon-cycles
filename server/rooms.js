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

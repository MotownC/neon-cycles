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

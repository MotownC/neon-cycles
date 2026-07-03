(function (root, factory) {
  const deps = typeof require === 'function'
    ? { G: require('./geometry'), B: require('./board') }
    : { G: window.Geometry, B: window.Board };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function ({ G, B }) {
  const REGEN_SEC = 15;   // seconds between +1 ammo
  const AMMO_CAP = 3;
  const GAP_CELLS = 3;    // cells unlit on a successful trail/wall hit
  const STUN_SEC = 2;

  function createBolt(ownerIndex, head, dir) {
    return { ownerIndex, pos: G.nextHead(head, dir), dir };
  }

  function ammoAvailable(elapsedSec, firedCount) {
    const earned = Math.min(AMMO_CAP, 1 + Math.floor(elapsedSec / REGEN_SEC));
    return Math.max(0, earned - firedCount);
  }

  function advanceBolts(round, elapsedSec) {
    const { board } = round;
    round.bolts = round.bolts.filter((bolt) => {
      const next = G.nextHead(bolt.pos, bolt.dir);
      if (!B.inBounds(board, next)) return false; // despawn at the boundary
      bolt.pos = next;
      return true;
    });
  }

  return {
    __name: 'Projectile',
    REGEN_SEC, AMMO_CAP, GAP_CELLS, STUN_SEC,
    createBolt, ammoAvailable, advanceBolts,
  };
});

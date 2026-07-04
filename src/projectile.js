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
  const GAP_CELLS = 3;    // blast depth along the bolt's travel; the swath is also 3 cells wide
  const STUN_SEC = 2;
  const FIRE_DELAY_SEC = 5; // no firing until this long into the round
  const BOLT_LIFETIME_SEC = 15; // hard cap from firing, regardless of bounces

  function createBolt(ownerIndex, head, dir, spawnedAt) {
    return { ownerIndex, pos: G.nextHead(head, dir), dir, spawnedAt };
  }

  function ammoAvailable(elapsedSec, firedCount) {
    const earned = Math.min(AMMO_CAP, 1 + Math.floor(elapsedSec / REGEN_SEC));
    return Math.max(0, earned - firedCount);
  }

  function advanceBolts(round, elapsedSec) {
    const { board, snakes = [] } = round;
    const outcomes = [];
    round.bolts = round.bolts.filter((bolt) => {
      if (elapsedSec - bolt.spawnedAt >= BOLT_LIFETIME_SEC) return false; // expire silently

      let next = G.nextHead(bolt.pos, bolt.dir);
      if (!B.inBounds(board, next)) {
        // Bounce off the arena boundary instead of despawning: reverse
        // direction and step back toward the cell the bolt already
        // legally occupied (always in bounds).
        bolt.dir = G.opposite(bolt.dir);
        next = G.nextHead(bolt.pos, bolt.dir);
        outcomes.push({ type: 'bounce', pos: next });
      }

      // No owner exclusion: a bolt can stun its own firer if its straight-line
      // path re-crosses their own head (self-stun is an accepted risk of firing).
      const victim = snakes.find((s) => s.alive
        && s.body[s.body.length - 1].x === next.x && s.body[s.body.length - 1].y === next.y);
      if (victim) { victim.stunnedUntil = elapsedSec + STUN_SEC; outcomes.push({ type: 'stun', pos: next }); return false; }

      if (B.isLit(board, next)) {
        // Blast a 3-wide, GAP_CELLS-deep hole. Cells must be removed from
        // their owners (snake body, walls array), not just unlit: the
        // renderer draws from those arrays, and tickSingle collides against
        // body arrays, so an unlight-only cut leaves an invisible hole.
        const isLiveHead = (c) => snakes.some((s) => {
          if (!s.alive) return false;
          const h = s.body[s.body.length - 1];
          return h.x === c.x && h.y === c.y;
        });
        const blast = (c) => {
          if (!B.inBounds(board, c) || isLiveHead(c)) return;
          B.unlight(board, c);
          if (board.walls) board.walls = board.walls.filter((w) => w.x !== c.x || w.y !== c.y);
          for (const s of snakes) {
            for (let i = s.body.length - 2; i >= 0; i--) { // never the head
              if (s.body[i].x === c.x && s.body[i].y === c.y) s.body.splice(i, 1);
            }
          }
        };
        const sides = [G.leftOf(bolt.dir), G.rightOf(bolt.dir)];
        let gap = next;
        for (let i = 0; i < GAP_CELLS; i++) {
          if (!B.inBounds(board, gap)) break;
          blast(gap);
          sides.forEach((d) => blast(G.nextHead(gap, d)));
          gap = G.nextHead(gap, bolt.dir);
        }
        outcomes.push({ type: 'cut', pos: next });
        return false;
      }

      bolt.pos = next;
      return true;
    });
    return outcomes;
  }

  function fire(round, index, elapsedSec) {
    if (elapsedSec < FIRE_DELAY_SEC) return;
    const available = ammoAvailable(elapsedSec, round.firedCount[index]);
    if (available <= 0) return;
    const snake = round.snakes[index];
    const head = snake.body[snake.body.length - 1];
    const bolt = createBolt(index, head, snake.direction, elapsedSec);
    if (!B.inBounds(round.board, bolt.pos)) {
      // Point-blank shot into the boundary: bounce at the muzzle. Without
      // this the bolt spawns out of bounds and the reflection lands on the
      // firer's own head — a guaranteed self-stun for firing near a wall.
      bolt.pos = { x: head.x, y: head.y };
      bolt.dir = G.opposite(bolt.dir);
    }
    round.bolts.push(bolt);
    round.firedCount[index] += 1;
  }

  return {
    __name: 'Projectile',
    REGEN_SEC, AMMO_CAP, GAP_CELLS, STUN_SEC, FIRE_DELAY_SEC, BOLT_LIFETIME_SEC,
    createBolt, ammoAvailable, advanceBolts, fire,
  };
});

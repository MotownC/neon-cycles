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
  const FIRE_DELAY_SEC = 5; // no firing until this long into the round
  const BOLT_LIFETIME_SEC = 15; // hard cap from firing, regardless of bounces

  // Bolt direction is a velocity vector {x, y}, not a cardinal string, so a
  // trigger pull can spray diagonals: straight plus ±45°.
  const step = (c, v) => ({ x: c.x + v.x, y: c.y + v.y });

  function createBolt(ownerIndex, head, vel, spawnedAt) {
    return { ownerIndex, pos: step(head, vel), dir: { ...vel }, spawnedAt };
  }

  // Straight, +45°, and -45° relative to a cardinal facing.
  function sprayVectors(direction) {
    const v = G.vector(direction);
    const p = { x: -v.y, y: v.x }; // perpendicular
    return [v, { x: v.x + p.x, y: v.y + p.y }, { x: v.x - p.x, y: v.y - p.y }];
  }

  function ammoAvailable(elapsedSec, firedCount) {
    const earned = Math.min(AMMO_CAP, 1 + Math.floor(elapsedSec / REGEN_SEC));
    return Math.max(0, earned - firedCount);
  }

  // Reflect any velocity component that would carry the cell out of bounds.
  // Mutates vel; returns the recomputed destination. Diagonals get proper
  // mirror physics: only the offending axis flips (both at a corner).
  function reflect(board, from, vel) {
    let next = step(from, vel);
    let bounced = false;
    if (next.x < 0 || next.x >= board.width) { vel.x = -vel.x; bounced = true; }
    if (next.y < 0 || next.y >= board.height) { vel.y = -vel.y; bounced = true; }
    if (bounced) next = step(from, vel);
    return { next, bounced };
  }

  function advanceBolts(round, elapsedSec) {
    const { board, snakes = [] } = round;
    const outcomes = [];
    round.bolts = round.bolts.filter((bolt) => {
      if (elapsedSec - bolt.spawnedAt >= BOLT_LIFETIME_SEC) return false; // expire silently

      const { next, bounced } = reflect(board, bolt.pos, bolt.dir);
      if (bounced) outcomes.push({ type: 'bounce', pos: next });

      // A head hit is lethal — round win for the shooter. Checked before the
      // lit-cell cut so a head is never treated as plain trail. A bolt flies
      // over its own firer's head harmlessly (sprays and bounces would make
      // self-kills constant otherwise).
      const hit = snakes.findIndex((s) => s.alive
        && s.body[s.body.length - 1].x === next.x && s.body[s.body.length - 1].y === next.y);
      if (hit >= 0) {
        if (hit === bolt.ownerIndex) { bolt.pos = next; return true; }
        snakes[hit].alive = false;
        snakes[hit].shotBy = bolt.ownerIndex; // lets crash verdicts name the real cause
        outcomes.push({ type: 'kill', pos: next });
        return false;
      }

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
        const perp = { x: -bolt.dir.y, y: bolt.dir.x };
        let gap = next;
        for (let i = 0; i < GAP_CELLS; i++) {
          if (!B.inBounds(board, gap)) break;
          blast(gap);
          blast(step(gap, perp));
          blast(step(gap, { x: -perp.x, y: -perp.y }));
          gap = step(gap, bolt.dir);
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
    for (const vel of sprayVectors(snake.direction)) {
      // Point-blank shot into the boundary: bounce at the muzzle rather than
      // spawning out of bounds (which would reflect onto the firer's head).
      const { next } = reflect(round.board, head, vel);
      round.bolts.push({ ownerIndex: index, pos: next, dir: vel, spawnedAt: elapsedSec });
    }
    round.firedCount[index] += 1; // the whole spray costs one ammo
  }

  return {
    __name: 'Projectile',
    REGEN_SEC, AMMO_CAP, GAP_CELLS, FIRE_DELAY_SEC, BOLT_LIFETIME_SEC,
    createBolt, sprayVectors, ammoAvailable, advanceBolts, fire,
  };
});

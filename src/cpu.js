(function (root, factory) {
  const deps = typeof require === 'function'
    ? { G: require('./geometry'), B: require('./board'), P: require('./projectile') }
    : { G: window.Geometry, B: window.Board, P: window.Projectile };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function ({ G, B, P }) {
  // Turning costs this many territory cells: keeps lines straight unless a
  // turn wins meaningfully more of the board.
  const STRAIGHT_BONUS = 10;
  // Docked from moves the opponent could enter on the same tick (mutual
  // death): a trade is never a win, so only take it when every alternative
  // is a catastrophic loss.
  const HEADON_PENALTY = 200;

  // Voronoi territory: cells we reach strictly before the opponent, minus
  // cells they reach strictly first. Maximizing it both claims open space
  // and walls the opponent into ever-smaller regions.
  function scoreMove(round, index, head, dir) {
    const board = round.board;
    const newHead = G.nextHead(head, dir);
    B.light(board, newHead);
    const opp = round.snakes.find((s, i) => i !== index && s.alive);
    let score;
    if (opp) {
      const oppHead = opp.body[opp.body.length - 1];
      const mine = B.distanceMap(board, newHead);
      const theirs = B.distanceMap(board, oppHead);
      score = 0;
      for (const [k, d] of mine) {
        const od = theirs.get(k);
        if (od === undefined || d < od) score += 1;
      }
      for (const [k, od] of theirs) {
        const d = mine.get(k);
        if (d === undefined || od < d) score -= 1;
      }
      // The opponent could step into this cell on the same tick, killing
      // both snakes. Docking the move by its own upside as well means a
      // winning position is never gambled on a trade, while a doomed one
      // can still rationally take the opponent down with it.
      if (Math.abs(newHead.x - oppHead.x) + Math.abs(newHead.y - oppHead.y) === 1) {
        score -= HEADON_PENALTY + Math.max(0, score);
      }
    } else {
      score = B.openArea(board, newHead);
    }
    B.unlight(board, newHead);
    return score;
  }

  // Candidate directions for a snake: straight/left/right relative to its
  // pending direction, filtered to those that don't immediately collide.
  function safeMoves(round, index) {
    const snake = round.snakes[index];
    const dir = snake.pendingDirection;
    const head = snake.body[snake.body.length - 1];
    const dirs = [dir, G.leftOf(dir), G.rightOf(dir)];
    const safe = dirs.filter((d) => !B.wouldCollide(round.board, G.nextHead(head, d)));
    return { dir, head, dirs, safe };
  }

  function chooseDirection(round, index, rand = Math.random) {
    const { dir, head, safe } = safeMoves(round, index);
    if (!safe.length) return dir; // boxed in: crash forward
    const scored = safe.map((d) => ({
      dir: d,
      score: scoreMove(round, index, head, d) + (d === dir ? STRAIGHT_BONUS : 0),
    }));
    const best = Math.max(...scored.map((c) => c.score));
    const top = scored.filter((c) => c.score === best);
    return top[(rand() * top.length) | 0].dir;
  }

  // Fire when boxed in (nothing left to lose) or when the best safe move
  // still loses territory, as long as ammo is available. Ammo exhaustion
  // always suppresses firing, even from a hopeless position.
  function shouldFire(round, index, elapsedSec) {
    if (P.ammoAvailable(elapsedSec, round.firedCount[index]) <= 0) return false;
    const { head, safe } = safeMoves(round, index);
    if (!safe.length) return true; // boxed in entirely: always worth a desperation shot
    const best = Math.max(...safe.map((d) => scoreMove(round, index, head, d)));
    return best < 0;
  }

  return { __name: 'CPU', chooseDirection, shouldFire };
});

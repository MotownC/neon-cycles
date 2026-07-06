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

  // Behavior knobs for a rival. Weights change what the Voronoi score values,
  // blunder injects mistakes for the easy tier, lookahead enables 2-ply
  // scoring, and fire selects a trigger policy:
  //   boxed  — fire only with no safe move left
  //   losing — fire when the best safe move's score drops below `threshold`
  //   ambush — fire when the opponent's escape area shrinks below `openBelow`
  const DEFAULT_PERSONALITY = {
    straightBonus: STRAIGHT_BONUS, headonPenalty: HEADON_PENALTY,
    oppWeight: 1, blunder: 0, lookahead: false,
    fire: { mode: 'losing', threshold: 0 },
  };

  // headonPenalty note: in the symmetric round opening, yielding the center
  // row costs ~650 Voronoi cells (the yielder cedes the junction), so any
  // penalty below that makes a rival force a draw against a player who holds
  // straight. Every rival sits above it — how far above is the chicken knob:
  // the aggressor trades when moderately behind, the survivor almost never.
  const PERSONALITIES = {
    drifter: { ...DEFAULT_PERSONALITY, straightBonus: 25, headonPenalty: 2000, blunder: 0.15, fire: { mode: 'boxed' } },
    survivor: { ...DEFAULT_PERSONALITY, headonPenalty: 2500, oppWeight: 0.8, fire: { mode: 'losing', threshold: -80 } },
    // oppWeight scales every deficit, so the aggressor's penalty must be read
    // on its own inflated scale: 1300 here trades sooner than 1200 at weight 1.
    aggressor: { ...DEFAULT_PERSONALITY, straightBonus: 6, headonPenalty: 1300, oppWeight: 1.6, fire: { mode: 'losing', threshold: 40 } },
    ambusher: { ...DEFAULT_PERSONALITY, headonPenalty: 1200, fire: { mode: 'ambush', openBelow: 60 } },
    grandmaster: { ...DEFAULT_PERSONALITY, straightBonus: 5, headonPenalty: 1500, oppWeight: 1.2, lookahead: true },
  };

  // Voronoi territory: cells we reach strictly before the opponent, minus
  // (weighted) cells they reach strictly first. Maximizing it both claims
  // open space and walls the opponent into ever-smaller regions. Both head
  // cells must already be lit by the caller.
  function voronoi(board, myHead, oppHead, oppWeight) {
    const mine = B.distanceMap(board, myHead);
    const theirs = B.distanceMap(board, oppHead);
    let score = 0;
    for (const [k, d] of mine) {
      const od = theirs.get(k);
      if (od === undefined || d < od) score += 1;
    }
    for (const [k, od] of theirs) {
      const d = mine.get(k);
      if (d === undefined || od < d) score -= oppWeight;
    }
    return score;
  }

  function scoreMove(round, index, head, dir, p = DEFAULT_PERSONALITY) {
    const board = round.board;
    const newHead = G.nextHead(head, dir);
    B.light(board, newHead);
    const opp = round.snakes.find((s, i) => i !== index && s.alive);
    let score;
    if (opp) {
      const oppHead = opp.body[opp.body.length - 1];
      score = p.lookahead
        ? scoreAgainstBestReply(board, newHead, opp, p)
        : voronoi(board, newHead, oppHead, p.oppWeight);
      // The opponent could step into this cell on the same tick, killing
      // both snakes. Docking the move by its own upside as well means a
      // winning position is never gambled on a trade, while a doomed one
      // can still rationally take the opponent down with it.
      if (Math.abs(newHead.x - oppHead.x) + Math.abs(newHead.y - oppHead.y) === 1) {
        score -= p.headonPenalty + Math.max(0, score);
      }
    } else {
      score = B.openArea(board, newHead);
    }
    B.unlight(board, newHead);
    return score;
  }

  // 2-ply: assume the opponent answers with whichever of its own three moves
  // hurts us most, and score this move against that reply. Sees one-tick
  // traps (a gap the opponent can seal next move) that 1-ply scoring misses.
  function scoreAgainstBestReply(board, newHead, opp, p) {
    const oppHead = opp.body[opp.body.length - 1];
    const replies = [opp.pendingDirection, G.leftOf(opp.pendingDirection), G.rightOf(opp.pendingDirection)]
      .map((d) => G.nextHead(oppHead, d))
      .filter((h) => !B.wouldCollide(board, h) && !(h.x === newHead.x && h.y === newHead.y));
    if (!replies.length) return voronoi(board, newHead, oppHead, p.oppWeight);
    let worst = Infinity;
    for (const reply of replies) {
      B.light(board, reply);
      const s = voronoi(board, newHead, reply, p.oppWeight);
      B.unlight(board, reply);
      if (s < worst) worst = s;
    }
    return worst;
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

  function chooseDirection(round, index, rand = Math.random, p = DEFAULT_PERSONALITY) {
    const { dir, head, safe } = safeMoves(round, index);
    if (!safe.length) return dir; // boxed in: crash forward
    // Easy-tier mistake: occasionally take a random safe move instead of the
    // best one. Guarded so a zero-blunder personality never consumes rand,
    // keeping default decisions bit-identical to the unparameterized CPU.
    if (p.blunder && rand() < p.blunder) return safe[(rand() * safe.length) | 0];
    const scored = safe.map((d) => ({
      dir: d,
      score: scoreMove(round, index, head, d, p) + (d === dir ? p.straightBonus : 0),
    }));
    const best = Math.max(...scored.map((c) => c.score));
    const top = scored.filter((c) => c.score === best);
    return top[(rand() * top.length) | 0].dir;
  }

  // Fire policy per personality (see DEFAULT_PERSONALITY): all modes fire
  // when boxed in (nothing left to lose), and ammo exhaustion always
  // suppresses firing, even from a hopeless position.
  function shouldFire(round, index, elapsedSec, p = DEFAULT_PERSONALITY) {
    // During the start-of-round lockout fire() no-ops, so skip the expensive
    // Voronoi scoring below rather than "deciding" to take an impossible shot.
    if (elapsedSec < P.FIRE_DELAY_SEC) return false;
    if (P.ammoAvailable(elapsedSec, round.firedCount[index]) <= 0) return false;
    const { head, safe } = safeMoves(round, index);
    if (!safe.length) return true; // boxed in entirely: always worth a desperation shot
    if (p.fire.mode === 'boxed') return false;
    if (p.fire.mode === 'ambush') {
      const opp = round.snakes.find((s, i) => i !== index && s.alive);
      if (!opp) return false;
      return B.openArea(round.board, opp.body[opp.body.length - 1]) < p.fire.openBelow;
    }
    const best = Math.max(...safe.map((d) => scoreMove(round, index, head, d, p)));
    return best < p.fire.threshold;
  }

  return { __name: 'CPU', PERSONALITIES, DEFAULT_PERSONALITY, chooseDirection, shouldFire };
});

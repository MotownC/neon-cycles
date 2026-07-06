(function (root, factory) {
  const deps = typeof require === 'function'
    ? { S: require('./snake'), B: require('./board'), G: require('./geometry'), T: require('./trail') }
    : { S: window.Snake, B: window.Board, G: window.Geometry, T: window.Trail };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function ({ S, B, G, T }) {
  function createRound(width, height, specs, walls = [], trailMode = 'tron') {
    const board = B.createBoard(width, height, walls);
    const snakes = specs.map((s) => S.createSnake(s.start, s.direction));
    snakes.forEach((snake) => B.light(board, snake.body[0]));
    return { board, snakes, over: false, winnerIndex: null, trailMode, bolts: [], firedCount: specs.map(() => 0) };
  }

  function tick(round, elapsedSec = 0, frozenIndices = []) {
    const frozen = new Set(frozenIndices);
    const { board, snakes } = round;
    // 1. Consume one buffered turn and compute each living, non-frozen snake's next head.
    //    Frozen snakes must not have S.nextDirection called on them (it pops the turn
    //    queue), or a buffered turn would be dropped a tick early.
    const intended = snakes.map((snake, i) =>
      snake.alive && !frozen.has(i) ? G.nextHead(snake.body[snake.body.length - 1], S.nextDirection(snake)) : null
    );

    // Shield absorbs one hit by canceling the move (snake holds position,
    // stays alive); phase ghosts through a lit cell (trail/wall) but can't
    // save a snake from leaving the board. Both are single-use.
    const absorb = (i) => {
      if (!snakes[i].shield) return false;
      snakes[i].shield = false;
      intended[i] = null;
      return true;
    };

    // 2. Kill snakes colliding with board/edge/existing trail.
    intended.forEach((head, i) => {
      if (!snakes[i].alive || !head) return;
      if (!B.wouldCollide(board, head)) return;
      if (B.inBounds(board, head) && snakes[i].phase) { snakes[i].phase = false; return; }
      if (!absorb(i)) snakes[i].alive = false;
    });

    // 3. Kill snakes targeting the same cell as another living snake this tick.
    intended.forEach((head, i) => {
      if (!snakes[i].alive || !head) return;
      for (let j = 0; j < intended.length; j++) {
        if (j === i || !snakes[j].alive || !intended[j]) continue;
        if (head.x === intended[j].x && head.y === intended[j].y) {
          const iSaved = absorb(i);
          const jSaved = absorb(j);
          // A shield dodges the whole collision: the shielded snake holds
          // position, so the other's target cell is never actually occupied.
          if (!iSaved && !jSaved) { snakes[i].alive = false; snakes[j].alive = false; }
        }
      }
    });

    // 4. Advance survivors: apply direction, append head, light the cell,
    //    then trim the trail per the round's trail mode. Frozen snakes, and
    //    any snake whose move was absorbed by a shield, are skipped so they
    //    stay put for this tick.
    snakes.forEach((snake, i) => {
      if (!snake.alive || frozen.has(i) || !intended[i]) return;
      snake.direction = snake.pendingDirection;
      const head = { ...intended[i], t: elapsedSec };
      snake.body.push(head);
      B.light(board, head);
      T.trim(snake, board, round.trailMode, elapsedSec);
    });

    resolve(round);
  }

  function resolve(round) {
    const alive = round.snakes.filter((s) => s.alive);
    if (round.snakes.length === 1) {
      // Solo: round ends when the snake dies.
      if (!round.snakes[0].alive) { round.over = true; round.winnerIndex = null; }
      return;
    }
    if (alive.length <= 1) {
      round.over = true;
      round.winnerIndex = alive.length === 1 ? round.snakes.indexOf(alive[0]) : null;
    }
  }

  // Advance a single snake (used for turbo bonus ticks).
  // Collision is checked for this snake only; the other snake doesn't move.
  function tickSingle(round, index, elapsedSec = 0) {
    const { board, snakes } = round;
    const snake = snakes[index];
    if (!snake || !snake.alive) return;
    const nextHead = G.nextHead(snake.body[snake.body.length - 1], S.nextDirection(snake));
    const outOfBounds = !B.inBounds(board, nextHead);
    const hitsTrail = !outOfBounds && (B.isLit(board, nextHead)
      || snakes.some((s, j) => j !== index && s.body.some((c) => c.x === nextHead.x && c.y === nextHead.y)));
    if (outOfBounds || hitsTrail) {
      if (hitsTrail && snake.phase) { snake.phase = false; }
      else if (snake.shield) { snake.shield = false; return; }
      else { snake.alive = false; resolve(round); return; }
    }
    snake.direction = snake.pendingDirection;
    const head = { ...nextHead, t: elapsedSec };
    snake.body.push(head);
    B.light(board, head);
    T.trim(snake, board, round.trailMode, elapsedSec);
    resolve(round);
  }

  return { __name: 'Round', createRound, tick, tickSingle, resolve };
});

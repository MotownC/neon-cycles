(function (root, factory) {
  const deps = typeof require === 'function'
    ? { S: require('./snake'), B: require('./board'), G: require('./geometry') }
    : { S: window.Snake, B: window.Board, G: window.Geometry };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function ({ S, B, G }) {
  function createRound(width, height, specs, walls = []) {
    const board = B.createBoard(width, height, walls);
    const snakes = specs.map((s) => S.createSnake(s.start, s.direction));
    snakes.forEach((snake) => B.light(board, snake.body[0]));
    return { board, snakes, over: false, winnerIndex: null };
  }

  function tick(round) {
    const { board, snakes } = round;
    // 1. Consume one buffered turn and compute each living snake's next head.
    const intended = snakes.map((snake) =>
      snake.alive ? G.nextHead(snake.body[snake.body.length - 1], S.nextDirection(snake)) : null
    );

    // 2. Kill snakes colliding with board/edge/existing trail.
    intended.forEach((head, i) => {
      if (!snakes[i].alive) return;
      if (B.wouldCollide(board, head)) snakes[i].alive = false;
    });

    // 3. Kill snakes targeting the same cell as another living snake this tick.
    intended.forEach((head, i) => {
      if (!snakes[i].alive) return;
      for (let j = 0; j < intended.length; j++) {
        if (j === i || !snakes[j].alive) continue;
        if (intended[j] && head.x === intended[j].x && head.y === intended[j].y) {
          snakes[i].alive = false;
          snakes[j].alive = false;
        }
      }
    });

    // 4. Advance survivors: apply direction, append head, light the cell.
    snakes.forEach((snake, i) => {
      if (!snake.alive) return;
      snake.direction = snake.pendingDirection;
      snake.body.push(intended[i]);
      B.light(board, intended[i]);
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
  function tickSingle(round, index) {
    const { board, snakes } = round;
    const snake = snakes[index];
    if (!snake || !snake.alive) return;
    const head = G.nextHead(snake.body[snake.body.length - 1], S.nextDirection(snake));
    if (B.wouldCollide(board, head)) { snake.alive = false; resolve(round); return; }
    // Also check collision with other snakes' current trails
    for (let j = 0; j < snakes.length; j++) {
      if (j === index) continue;
      if (snakes[j].body.some((c) => c.x === head.x && c.y === head.y)) {
        snake.alive = false; resolve(round); return;
      }
    }
    snake.direction = snake.pendingDirection;
    snake.body.push(head);
    B.light(board, head);
    resolve(round);
  }

  return { __name: 'Round', createRound, tick, tickSingle, resolve };
});

(function (root, factory) {
  const deps = typeof require === 'function'
    ? { S: require('./snake'), B: require('./board'), G: require('./geometry') }
    : { S: window.Snake, B: window.Board, G: window.Geometry };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function ({ S, B, G }) {
  function createRound(width, height, specs) {
    const board = B.createBoard(width, height);
    const snakes = specs.map((s) => S.createSnake(s.start, s.direction));
    snakes.forEach((snake) => B.light(board, snake.body[0]));
    return { board, snakes, over: false, winnerIndex: null };
  }

  function tick(round) {
    const { board, snakes } = round;
    // 1. Compute intended next head for each living snake.
    const intended = snakes.map((snake) =>
      snake.alive ? G.nextHead(snake.body[snake.body.length - 1], snake.pendingDirection) : null
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

  return { __name: 'Round', createRound, tick, resolve };
});

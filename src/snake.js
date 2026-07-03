(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./geometry') : window.Geometry);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function (G) {
  function createSnake(start, direction) {
    return {
      body: [{ ...start, t: 0 }],
      direction,
      pendingDirection: direction,
      queue: [],
      alive: true,
    };
  }

  // Queue up to 3 turns, each validated against the direction the snake will
  // actually be traveling when it takes effect. Quick multi-key sequences
  // (S-turns) execute in order instead of overwriting or wrongly blocking
  // each other, and a 180 can never reach the board.
  function bufferDirection(snake, dir) {
    const base = snake.queue.length ? snake.queue[snake.queue.length - 1] : snake.direction;
    if (!dir || dir === base || G.isReversal(base, dir)) return;
    if (snake.queue.length < 3) snake.queue.push(dir);
  }

  function nextDirection(snake) {
    if (snake.queue.length) snake.pendingDirection = snake.queue.shift();
    return snake.pendingDirection;
  }

  function stepSnake(snake) {
    snake.direction = nextDirection(snake);
    const head = G.nextHead(snake.body[snake.body.length - 1], snake.direction);
    snake.body.push(head);
    return head;
  }

  return { __name: 'Snake', createSnake, bufferDirection, nextDirection, stepSnake };
});

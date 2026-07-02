(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./geometry') : window.Geometry);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function (G) {
  function createSnake(start, direction) {
    return {
      body: [{ ...start }],
      direction,
      pendingDirection: direction,
      alive: true,
    };
  }

  function bufferDirection(snake, dir) {
    if (!dir || G.isReversal(snake.direction, dir)) return;
    snake.pendingDirection = dir;
  }

  function stepSnake(snake) {
    snake.direction = snake.pendingDirection;
    const head = G.nextHead(snake.body[snake.body.length - 1], snake.direction);
    snake.body.push(head);
    return head;
  }

  return { __name: 'Snake', createSnake, bufferDirection, stepSnake };
});

(function (root, factory) {
  const deps = typeof require === 'function'
    ? { B: require('./board') }
    : { B: window.Board };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function ({ B }) {
  const FADE_SECONDS = 8;
  const CLASSIC_LENGTH = 20;

  // Pop cells from the oldest end of a snake's own trail per the active
  // mode. Always leaves at least the head cell. Never touches board.walls,
  // since it only ever pops from a snake's own body array.
  function trim(snake, board, mode, elapsedSec) {
    if (mode === 'classic') {
      while (snake.body.length > CLASSIC_LENGTH) {
        B.unlight(board, snake.body.shift());
      }
    } else if (mode === 'fade') {
      while (snake.body.length > 1 && elapsedSec - snake.body[0].t >= FADE_SECONDS) {
        B.unlight(board, snake.body.shift());
      }
    }
    // 'tron' (or anything unrecognized): no-op.
  }

  return { __name: 'Trail', MODES: ['tron', 'fade', 'classic'], FADE_SECONDS, CLASSIC_LENGTH, trim };
});

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const key = (c) => c.x + ',' + c.y;

  function createBoard(width, height) {
    return { width, height, lit: new Set() };
  }
  function inBounds(board, c) {
    return c.x >= 0 && c.y >= 0 && c.x < board.width && c.y < board.height;
  }
  function light(board, c) { board.lit.add(key(c)); }
  function isLit(board, c) { return board.lit.has(key(c)); }
  function wouldCollide(board, c) { return !inBounds(board, c) || isLit(board, c); }

  return { __name: 'Board', createBoard, inBounds, light, isLit, wouldCollide };
});

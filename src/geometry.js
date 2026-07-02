(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const VECTORS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

  function vector(dir) { return { ...VECTORS[dir] }; }
  function opposite(dir) { return OPPOSITE[dir]; }
  function isReversal(current, next) { return OPPOSITE[current] === next; }
  function nextHead(cell, dir) {
    const v = VECTORS[dir];
    return { x: cell.x + v.x, y: cell.y + v.y };
  }

  return { __name: 'Geometry', vector, opposite, isReversal, nextHead };
});

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const key = (c) => c.x + ',' + c.y;

  function createBoard(width, height, walls = []) {
    const board = { width, height, lit: new Set(), walls };
    walls.forEach((c) => light(board, c));
    return board;
  }
  function inBounds(board, c) {
    return c.x >= 0 && c.y >= 0 && c.x < board.width && c.y < board.height;
  }
  function light(board, c) { board.lit.add(key(c)); }
  function unlight(board, c) { board.lit.delete(key(c)); }
  function isLit(board, c) { return board.lit.has(key(c)); }
  function wouldCollide(board, c) { return !inBounds(board, c) || isLit(board, c); }

  const NEIGHBOR_OFFSETS = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];

  // BFS distances to every open cell reachable from start (start itself excluded,
  // since it's the point a snake head occupies rather than floor space).
  function distanceMap(board, start) {
    const dist = new Map();
    const seen = new Set([key(start)]);
    let frontier = [start], d = 0;
    while (frontier.length) {
      d += 1;
      const next = [];
      for (const c of frontier) {
        for (const o of NEIGHBOR_OFFSETS) {
          const n = { x: c.x + o.x, y: c.y + o.y };
          const k = key(n);
          if (seen.has(k)) continue;
          seen.add(k);
          if (!inBounds(board, n) || isLit(board, n)) continue;
          dist.set(k, d);
          next.push(n);
        }
      }
      frontier = next;
    }
    return dist;
  }

  function openArea(board, start) { return distanceMap(board, start).size; }

  return { __name: 'Board', createBoard, inBounds, light, unlight, isLit, wouldCollide, distanceMap, openArea };
});

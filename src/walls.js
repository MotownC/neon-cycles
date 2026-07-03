(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const LEVELS = ['none', 'low', 'med', 'high'];
  const PAIR_COUNT = { none: 0, low: 3, med: 6, high: 10 };
  const MIN_LEN = 4, MAX_LEN = 10;
  const EDGE_MARGIN = 3;      // keep walls off the boundary wall
  const SPAWN_MARGIN = 6;     // horizontal clearance around any spawn column
  const SPAWN_ROW_MARGIN = 7; // vertical clearance around the spawn row

  const key = (c) => c.x + ',' + c.y;

  // Spawns can land at 25%/50%/75% width depending on mode; excluding all
  // three keeps walls safe regardless of which mode generated the round.
  function spawnColumns(width) {
    return [0.25, 0.5, 0.75].map((f) => (f * width) | 0);
  }

  function inSafeZone(c, width, height, spawnCols) {
    if (c.x < EDGE_MARGIN || c.y < EDGE_MARGIN
      || c.x >= width - EDGE_MARGIN || c.y >= height - EDGE_MARGIN) return true;
    const midRow = height / 2;
    if (Math.abs(c.y - midRow) > SPAWN_ROW_MARGIN) return false;
    return spawnCols.some((sx) => Math.abs(c.x - sx) <= SPAWN_MARGIN);
  }

  function segment(x, y, len, horizontal) {
    const cells = [];
    for (let i = 0; i < len; i++) cells.push(horizontal ? { x: x + i, y } : { x, y: y + i });
    return cells;
  }

  function fitsBoard(cells, width, height, spawnCols, occupied) {
    return cells.every((c) =>
      c.x >= 0 && c.y >= 0 && c.x < width && c.y < height
      && !inSafeZone(c, width, height, spawnCols)
      && !occupied.has(key(c)));
  }

  // Mirror across the vertical centerline (x=0 reflects to x=width-1, etc.)
  // so every wall placed left of center has a matching twin on the right.
  function mirror(cells, width) {
    return cells.map((c) => ({ x: width - 1 - c.x, y: c.y }));
  }

  function generate(width, height, density, rand = Math.random) {
    const pairs = PAIR_COUNT[density] || 0;
    if (!pairs) return [];
    const spawnCols = spawnColumns(width);
    const halfWidth = (width / 2) | 0;
    const occupied = new Set();
    const cells = [];
    const maxAttempts = pairs * 40;

    for (let attempt = 0, placed = 0; placed < pairs && attempt < maxAttempts; attempt++) {
      const horizontal = rand() < 0.5;
      const len = MIN_LEN + ((rand() * (MAX_LEN - MIN_LEN + 1)) | 0);
      const xSpan = horizontal ? halfWidth - len - EDGE_MARGIN : halfWidth - EDGE_MARGIN;
      const ySpan = height - len - EDGE_MARGIN;
      if (xSpan <= EDGE_MARGIN || ySpan <= EDGE_MARGIN) continue;
      const x = EDGE_MARGIN + ((rand() * (xSpan - EDGE_MARGIN)) | 0);
      const y = EDGE_MARGIN + ((rand() * (ySpan - EDGE_MARGIN)) | 0);
      const piece = segment(x, y, len, horizontal);
      if (!fitsBoard(piece, width, height, spawnCols, occupied)) continue;
      const mirrored = mirror(piece, width);
      if (!fitsBoard(mirrored, width, height, spawnCols, occupied)) continue;
      if (piece.some((c) => mirrored.some((m) => m.x === c.x && m.y === c.y))) continue;

      piece.forEach((c) => occupied.add(key(c)));
      mirrored.forEach((c) => occupied.add(key(c)));
      cells.push(...piece, ...mirrored);
      placed++;
    }
    return cells;
  }

  return { __name: 'Walls', LEVELS, generate };
});

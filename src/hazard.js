(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  // Perimeter of the rectangle inset by `m` cells on every side — i.e. the
  // ring that becomes solid on the (m+1)th border-shrink event.
  function borderRing(width, height, m) {
    const cells = [];
    for (let x = m; x < width - m; x++) {
      cells.push({ x, y: m });
      cells.push({ x, y: height - 1 - m });
    }
    for (let y = m + 1; y < height - 1 - m; y++) {
      cells.push({ x: m, y });
      cells.push({ x: width - 1 - m, y });
    }
    return cells;
  }

  // Outline of the square at Chebyshev distance `r` from (cx, cy), clipped
  // to the board. r must be >= 1 (r = 0 would just be the center point).
  function squareRing(width, height, cx, cy, r) {
    const cells = [];
    const inBounds = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
    for (let x = cx - r; x <= cx + r; x++) {
      if (inBounds(x, cy - r)) cells.push({ x, y: cy - r });
      if (inBounds(x, cy + r)) cells.push({ x, y: cy + r });
    }
    for (let y = cy - r + 1; y <= cy + r - 1; y++) {
      if (inBounds(cx - r, y)) cells.push({ x: cx - r, y });
      if (inBounds(cx + r, y)) cells.push({ x: cx + r, y });
    }
    return cells;
  }

  return { __name: 'Hazard', borderRing, squareRing };
});

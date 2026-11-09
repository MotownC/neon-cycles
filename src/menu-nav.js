(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  // Spatial menu navigation over item centers ({ x, y } in pixels), so it
  // follows the layout as panels open and rows wrap. Up/down steps between
  // rows and wraps around; left/right stays within the row and stops at its ends.
  const ROW_TOLERANCE = 12;

  const closestX = (pool, x) => pool.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));

  // Returns the index to move to, or current if there is nowhere to go.
  function move(items, current, dir) {
    const me = items[current];
    const sign = dir === 'up' || dir === 'left' ? -1 : 1;
    const others = items.map((it, i) => ({ x: it.x, y: it.y, i })).filter((it) => it.i !== current);

    if (dir === 'left' || dir === 'right') {
      const row = others.filter((it) => Math.abs(it.y - me.y) <= ROW_TOLERANCE && (it.x - me.x) * sign > 0);
      return row.length ? closestX(row, me.x).i : current;
    }

    const ahead = others.filter((it) => (it.y - me.y) * sign > ROW_TOLERANCE);
    const pool = ahead.length ? ahead : others.filter((it) => (it.y - me.y) * sign < -ROW_TOLERANCE);
    if (!pool.length) return current;
    const pick = ahead.length ? Math.min : Math.max; // nearest row ahead, or the far end when wrapping
    const rowDist = pick(...pool.map((it) => Math.abs(it.y - me.y)));
    return closestX(pool.filter((it) => Math.abs(Math.abs(it.y - me.y) - rowDist) <= ROW_TOLERANCE), me.x).i;
  }

  return { __name: 'MenuNav', move };
});

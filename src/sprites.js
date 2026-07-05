(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const ORDER = 'LRUD';

  // Which trail tile a body cell needs, from its neighbors in the body array.
  // Neighbors that aren't 4-adjacent (e.g. across a derezzer cut) are ignored.
  function trailKey(prev, cur, next) {
    const letters = [];
    for (const n of [prev, next]) {
      if (!n) continue;
      const dx = n.x - cur.x, dy = n.y - cur.y;
      if (dx === -1 && dy === 0) letters.push('L');
      else if (dx === 1 && dy === 0) letters.push('R');
      else if (dy === -1 && dx === 0) letters.push('U');
      else if (dy === 1 && dx === 0) letters.push('D');
    }
    const uniq = [...new Set(letters)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    return uniq.join('') || 'O';
  }

  return { __name: 'Sprites', trailKey };
});

(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./geometry') : window.Geometry);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function (G) {
  // Decorative menu-screen loop: a cycle tracing the perimeter of a box
  // (drawn around the mode buttons), clockwise from the top-left corner.
  // No collision logic — a closed rectangle can never self-intersect.
  function corners(box) {
    return [
      { x: box.left, y: box.top },
      { x: box.right, y: box.top },
      { x: box.right, y: box.bottom },
      { x: box.left, y: box.bottom },
    ];
  }

  // Advance one cell toward corners[targetIndex]. `targetIndex` names the
  // corner currently being approached; it only advances (wrapping around)
  // once that corner is actually reached. completedLap fires the instant
  // the step lands back on corner 0 (a full clockwise circuit).
  function step(cornerList, head, targetIndex) {
    const target = cornerList[targetIndex];
    const dx = target.x - head.x, dy = target.y - head.y;
    const direction = dx !== 0 ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    const next = G.nextHead(head, direction);
    const arrived = next.x === target.x && next.y === target.y;
    return {
      head: next,
      direction,
      targetIndex: arrived ? (targetIndex + 1) % cornerList.length : targetIndex,
      completedLap: arrived && targetIndex === 0,
    };
  }

  return { __name: 'Attract', corners, step };
});

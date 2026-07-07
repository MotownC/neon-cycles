(function (root, factory) {
  const deps = typeof require === 'function'
    ? { B: require('./board') }
    : { B: window.Board };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function ({ B }) {
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

  const EVENT_INTERVAL_SEC = 15;
  const TELEGRAPH_SEC = 1;
  const SAFETY_FLOOR_GAP = 6;

  function createHazard(width, height) {
    return {
      margin: 0,
      squareRadius: 0,
      cx: (width / 2) | 0,
      cy: (height / 2) | 0,
      nextEventAt: EVENT_INTERVAL_SEC,
      telegraph: null,
      frozen: false,
    };
  }

  // Conservative approximation of "how much open space is left between the
  // shrinking border and the growing square" — not exact geometry, just
  // enough to stop before the two can plausibly meet.
  function computeGap(width, height, margin, squareRadius) {
    const innerHalfWidth = width / 2 - margin;
    const innerHalfHeight = height / 2 - margin;
    return Math.min(innerHalfWidth, innerHalfHeight) - squareRadius;
  }

  function solidify(round, hazard) {
    const { board, snakes } = round;
    const { cells } = hazard.telegraph;
    for (const c of cells) {
      // Light unconditionally (idempotent) so a hazard ring permanently
      // claims the cell even if it was previously just trail (which can
      // later be trimmed/unlit); only guard against duplicate wall entries.
      B.light(board, c);
      if (!board.walls.some((w) => w.x === c.x && w.y === c.y)) board.walls.push(c);
    }
    hazard.telegraph = null;
    if (round.pickups) {
      round.pickups = round.pickups.filter((p) => !cells.some((c) => c.x === p.pos.x && c.y === p.pos.y));
    }
    for (const snake of snakes) {
      if (!snake.alive) continue;
      const head = snake.body[snake.body.length - 1];
      if (cells.some((c) => c.x === head.x && c.y === head.y)) {
        snake.alive = false;
        snake.crushedByHazard = true;
      }
    }
  }

  function scheduleNext(round, hazard, elapsedSec, rand) {
    const { board } = round;
    const gap = computeGap(board.width, board.height, hazard.margin, hazard.squareRadius);
    if (gap <= SAFETY_FLOOR_GAP) { hazard.frozen = true; return; }
    const type = rand() < 0.5 ? 'border' : 'square';
    let cells;
    if (type === 'border') {
      cells = borderRing(board.width, board.height, hazard.margin);
      hazard.margin += 1;
    } else {
      const r = hazard.squareRadius + 1;
      cells = squareRing(board.width, board.height, hazard.cx, hazard.cy, r);
      hazard.squareRadius = r;
    }
    hazard.telegraph = { cells, type, solidifyAt: elapsedSec + TELEGRAPH_SEC };
    hazard.nextEventAt = elapsedSec + EVENT_INTERVAL_SEC;
  }

  function advance(round, hazard, elapsedSec, rand = Math.random) {
    if (hazard.frozen) return;
    if (hazard.telegraph) {
      if (elapsedSec >= hazard.telegraph.solidifyAt) solidify(round, hazard);
      return;
    }
    if (elapsedSec >= hazard.nextEventAt) scheduleNext(round, hazard, elapsedSec, rand);
  }

  return {
    __name: 'Hazard',
    EVENT_INTERVAL_SEC, TELEGRAPH_SEC, SAFETY_FLOOR_GAP,
    borderRing, squareRing, createHazard, advance,
  };
});

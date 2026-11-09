(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  // Render-side smoothing only. The sim moves a cycle one whole cell per
  // tick; a glide draws it sliding from the cell it just left to its head
  // cell over the following tick interval. Nothing here feeds back into the sim.
  const TURN_PORTION = 0.35; // share of a glide spent swinging the nose around after a turn

  const head = (snake) => snake.body[snake.body.length - 1];

  // Take before a tick, hand to note() after it.
  function snapshot(snake) {
    const h = head(snake);
    return { x: h.x, y: h.y, direction: snake.direction };
  }

  // A new glide if the tick moved the snake one cell, else null (held, frozen, dead).
  function note(before, snake) {
    const h = head(snake);
    if (!snake.alive || Math.abs(h.x - before.x) + Math.abs(h.y - before.y) !== 1) return null;
    return { from: { x: before.x, y: before.y }, fromDir: before.direction, ms: null };
  }

  // Once per rendered frame. A fresh glide starts at the tick accumulator's
  // remainder (how long ago its tick really happened), then runs on frame time
  // so it still finishes if the snake stops ticking.
  function advance(glide, accMs, dtMs) {
    if (glide) glide.ms = glide.ms === null ? accMs : glide.ms + dtMs;
  }

  // The snake as it should be drawn: the same object once the glide is done,
  // otherwise a copy carrying cycleAt (fractional cell) and turn-in progress.
  function view(snake, glide, intervalMs) {
    if (!glide) return snake;
    const a = Math.max(0, glide.ms / intervalMs);
    if (a >= 1) return snake;
    const h = head(snake), f = glide.from;
    const out = { ...snake, cycleAt: { x: f.x + (h.x - f.x) * a, y: f.y + (h.y - f.y) * a } };
    if (glide.fromDir !== snake.direction) {
      out.turnFrom = glide.fromDir;
      out.turnT = Math.min(1, a / TURN_PORTION);
    }
    return out;
  }

  return { __name: 'Glide', TURN_PORTION, snapshot, note, advance, view };
});

(function (root, factory) {
  const deps = typeof require === 'function'
    ? { G: require('./geometry') }
    : { G: window.Geometry };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function ({ G }) {
  // Round-end presentation: a read-only recording of the last moments of a
  // round, the slow-motion timeline that plays it back, and the debris of the
  // wrecked cycles. Nothing here writes to a round, so it cannot affect the
  // sim or desync online play. Random numbers are purely cosmetic.
  const WINDOW_SEC = 1.2;    // sim time shown by the replay
  const SLOWMO = 0.33;       // replay speed relative to real time
  const EXPLODE_SEC = 0.8;   // real-time blast before the replay starts
  const IMPACT_SEC = 1.2;    // the blast again, at the end of the replay...
  const IMPACT_RATE = 0.6;   // ...also in slow motion
  const RAM_DEPTH = 0.45;    // how far (in cells) a dead cycle noses into what it hit
  const MAX_STEP_SEC = 0.125; // longest a single cell move can take (Speed.BASE_MS, plus slack)
  const DEREZ_SEC = 0.35;    // a dead cycle's trail dissolves, crash point first, over this long
  const DEREZ_MIN_RATE = 60; // cells per second, so a short trail doesn't vanish in a blink

  function createRecorder() { return { frames: [] }; }

  function headOf(snake) { return snake.body[snake.body.length - 1]; }

  // Where a dead cycle ends up: nosed into whatever it drove at. A snake shot
  // or crushed in place wasn't moving into anything, so it stays put.
  function impactPoint(s) {
    if (s.alive || s.shotBy !== undefined || s.crushedByHazard) return null;
    const h = headOf(s), v = G.vector(s.pendingDirection);
    return { x: h.x + v.x * RAM_DEPTH, y: h.y + v.y * RAM_DEPTH };
  }

  // Shaped like a round, so Renderer.render can draw it directly. Body cells,
  // pickups and flashes are never mutated once created, so sharing them with
  // the live round is safe; the arrays holding them, and a bolt's velocity
  // (reflected in place), are not, and get copied.
  function capture(round, t, flashes) {
    const { board, snakes, bolts = [], pickups = [], frozenUntil, hazard, trailMode } = round;
    return {
      t, trailMode, flashes: flashes.slice(),
      board: { width: board.width, height: board.height, walls: (board.walls || []).slice() },
      snakes: snakes.map((s) => ({
        body: s.body.slice(),
        direction: s.alive ? s.direction : s.pendingDirection,
        alive: s.alive, shield: s.shield, phase: s.phase, impact: impactPoint(s),
      })),
      bolts: bolts.map((b) => ({ ownerIndex: b.ownerIndex, pos: b.pos, dir: { ...b.dir } })),
      pickups: pickups.slice(),
      frozenUntil: frozenUntil ? frozenUntil.slice() : frozenUntil,
      hazard: hazard ? { telegraph: hazard.telegraph } : null,
    };
  }

  function record(recorder, round, elapsedSec, flashes = []) {
    const { frames } = recorder;
    const prev = frames[frames.length - 1];
    // Several sim steps can share one animation frame's timestamp.
    const t = prev ? Math.max(elapsedSec, prev.t + 0.001) : elapsedSec;
    frames.push(capture(round, t, flashes));
    while (frames.length > 1 && frames[1].t <= t - WINDOW_SEC) frames.shift();
  }

  function cyclePos(s) {
    if (s.impact) return s.impact;
    const h = headOf(s);
    return { x: h.x, y: h.y };
  }

  function createPlayback(recorder, rand) {
    const { frames } = recorder;
    const last = frames[frames.length - 1];
    const startT = Math.max(frames[0].t, last.t - WINDOW_SEC);
    const debris = [];
    last.snakes.forEach((s, snakeIndex) => {
      if (!s.alive) {
        const center = cyclePos(s);
        debris.push({ snakeIndex, center, pieces: explode(center, s.direction, rand), shards: shatter(s.body, rand) });
      }
    });
    return { frames, startT, replaySec: (last.t - startT) / SLOWMO, debris };
  }

  // What to show `sec` real seconds after the crash.
  function stageAt(playback, sec) {
    if (sec < EXPLODE_SEC) return { stage: 'explode', age: sec };
    if (playback.replaySec <= 0) return { stage: 'done' };
    const s = sec - EXPLODE_SEC;
    if (s < playback.replaySec) return { stage: 'replay', simT: playback.startT + s * SLOWMO };
    const after = s - playback.replaySec;
    if (after < IMPACT_SEC) return { stage: 'impact', age: after * IMPACT_RATE };
    return { stage: 'done' };
  }

  const same = (a, b) => a.x === b.x && a.y === b.y;

  // Frames arrive per sim step, and each snake steps at its own moments (turbo,
  // freeze), so a cycle's glide is worked out per snake: from the frame its
  // head reached this cell to the next frame its head changes.
  function motion(frames, i, n, simT) {
    const at = (k) => cyclePos(frames[k].snakes[n]);
    const here = at(i);
    let p = i;
    while (p > 0 && same(at(p - 1), here)) p--;
    let q = i + 1;
    while (q < frames.length && same(at(q), here)) q++;
    if (q >= frames.length) return { cycleAt: here };
    const to = at(q);
    // A held cycle (frozen, shield) sits still, then takes one normal step.
    const from = Math.max(frames[p].t, frames[q].t - MAX_STEP_SEC);
    const alpha = Math.min(1, Math.max(0, (simT - from) / (frames[q].t - from)));
    const cycleAt = { x: here.x + (to.x - here.x) * alpha, y: here.y + (to.y - here.y) * alpha };
    return alpha > 0 ? { cycleAt, direction: frames[q].snakes[n].direction } : { cycleAt };
  }

  // The round as it looked at sim time simT, with cycles between cells.
  function viewAt(playback, simT) {
    const { frames } = playback;
    let i = 0;
    while (i < frames.length - 1 && frames[i + 1].t <= simT) i++;
    const frame = frames[i];
    return { ...frame, snakes: frame.snakes.map((s, n) => ({ ...s, ...motion(frames, i, n, simT) })) };
  }

  // The final frame, with the crashed cycles gone: debris is drawn instead.
  // Given the blast's age, a dead cycle's trail has also dissolved that far
  // back from the crash point (its shards are drawn in its place).
  function wreckedView(playback, age) {
    const frame = playback.frames[playback.frames.length - 1];
    return { ...frame, snakes: frame.snakes.map((s) => {
      if (s.alive) return s;
      if (age === undefined) return { ...s, wrecked: true };
      const gone = Math.floor(age * derezRate(s.body.length));
      return { ...s, wrecked: true, body: s.body.slice(0, Math.max(0, s.body.length - gone)) };
    }) };
  }

  // --- debris ---------------------------------------------------------------
  const DRAG = 3;
  // The cycle sprite is cut into a grid of tiles around its center, in cell
  // units on the sprite (nose along +x), so the first frame still reads as
  // the whole cycle.
  const FRAG_COLS = 5, FRAG_ROWS = 2, FRAG_SIZE = 0.36;
  const SPARK_COUNT = 30;

  function explode(center, direction, rand) {
    const v = G.vector(direction);
    const perp = { x: -v.y, y: v.x };
    const rot0 = Math.atan2(v.y, v.x);
    const pieces = [];
    for (let row = 0; row < FRAG_ROWS; row++) {
      for (let col = 0; col < FRAG_COLS; col++) {
        const ox = (col - (FRAG_COLS - 1) / 2) * FRAG_SIZE;
        const oy = (row - (FRAG_ROWS - 1) / 2) * FRAG_SIZE;
        const wx = ox * v.x + oy * perp.x, wy = ox * v.y + oy * perp.y;
        const heading = Math.atan2(wy, wx) + (rand() - 0.5);
        const speed = 5 + rand() * 7;
        pieces.push({
          kind: 'fragment', ox, oy, size: FRAG_SIZE,
          x0: center.x + wx, y0: center.y + wy,
          vx: Math.cos(heading) * speed + v.x * 2.5, // keeps some of the cycle's momentum
          vy: Math.sin(heading) * speed + v.y * 2.5,
          rot0, spin: (rand() < 0.5 ? -1 : 1) * (4 + rand() * 8),
          life: 0.55 + rand() * 0.25,
        });
      }
    }
    for (let i = 0; i < SPARK_COUNT; i++) {
      const heading = rand() * Math.PI * 2;
      const speed = 8 + rand() * 18;
      pieces.push({
        kind: 'spark', size: 0.08 + rand() * 0.12,
        x0: center.x, y0: center.y,
        vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed,
        rot0: heading, spin: 0,
        life: 0.25 + rand() * 0.35,
      });
    }
    return pieces;
  }

  function derezRate(cells) { return Math.max(DEREZ_MIN_RATE, cells / DEREZ_SEC); }

  // One shard per trail cell (the head is last in `body`), each set loose as
  // the dissolve reaches it.
  function shatter(body, rand) {
    const n = body.length, rate = derezRate(n);
    return body.map((c, i) => {
      const heading = rand() * Math.PI * 2, speed = 1.5 + rand() * 4;
      return {
        kind: 'shard', size: 0.3 + rand() * 0.25,
        x0: c.x, y0: c.y,
        vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed,
        rot0: rand() * Math.PI, spin: (rand() - 0.5) * 14,
        life: 0.25 + rand() * 0.2,
        delay: (n - 1 - i) / rate,
      };
    });
  }

  // Closed form rather than stepped, so the same debris can replay at any speed.
  function pieceAt(piece, sinceBlast) {
    const age = sinceBlast - (piece.delay || 0);
    if (age < 0 || age > piece.life) return null;
    const travel = (1 - Math.exp(-DRAG * age)) / DRAG;
    const p = age / piece.life;
    return {
      x: piece.x0 + piece.vx * travel,
      y: piece.y0 + piece.vy * travel,
      rot: piece.rot0 + piece.spin * age,
      alpha: 1 - p * p,
    };
  }

  return {
    __name: 'Replay',
    WINDOW_SEC, SLOWMO, EXPLODE_SEC, IMPACT_SEC, DEREZ_SEC,
    createRecorder, record, createPlayback, stageAt, viewAt, wreckedView, explode, shatter, pieceAt,
  };
});

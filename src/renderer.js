(function (root, factory) {
  const deps = typeof require === 'function'
    ? { T: require('./trail'), S: require('./sprites') }
    : { T: window.Trail, S: window.Sprites };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function ({ T, S }) {
  const COLORS = ['#00f0ff', '#ff2bd6'];
  const PALETTE = ['#00f0ff', '#ff2bd6', '#39ff6a', '#ff9d2b', '#fff23b', '#b06bff', '#ff3b3b', '#f2f6ff'];

  // 1.0 until the last telegraphSeconds of life, then linearly down to a
  // dim floor so an about-to-vanish cell is never fully invisible mid-fade.
  function fadeAlpha(age, fadeSeconds, telegraphSeconds = 1.5, floor = 0.15) {
    const remaining = fadeSeconds - age;
    if (remaining >= telegraphSeconds) return 1;
    if (remaining <= 0) return floor;
    const p = remaining / telegraphSeconds;
    return floor + (1 - floor) * p;
  }

  // Never let the opponent land on the color the player just picked: prefer
  // the palette's own P2 default, and only fall back further if that also
  // collides (i.e. the player picked the default P2 color itself).
  function pickOpponentColor(chosen, palette = PALETTE) {
    if (palette[1] !== chosen) return palette[1];
    return palette.find((c) => c !== chosen) || palette[0];
  }

  function fit(canvas, cols, rows) {
    const dpr = window.devicePixelRatio || 1;
    const cell = Math.floor(Math.min(window.innerWidth / cols, window.innerHeight / rows));
    canvas.width = cols * cell * dpr;
    canvas.height = rows * cell * dpr;
    canvas.style.width = cols * cell + 'px';
    canvas.style.height = rows * cell + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { cell, ctx };
  }

  function drawGrid(ctx, cols, rows, cell, borderColor) {
    ctx.clearRect(0, 0, cols * cell, rows * cell);
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, cols * cell, rows * cell);
    ctx.strokeStyle = 'rgba(60,90,140,0.12)'; ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x++) { ctx.beginPath(); ctx.moveTo(x*cell, 0); ctx.lineTo(x*cell, rows*cell); ctx.stroke(); }
    for (let y = 0; y <= rows; y++) { ctx.beginPath(); ctx.moveTo(0, y*cell); ctx.lineTo(cols*cell, y*cell); ctx.stroke(); }
    // arena boundary: the outer wall kills, so it must be unmistakable
    ctx.save();
    ctx.strokeStyle = borderColor; ctx.lineWidth = 2;
    ctx.shadowColor = borderColor; ctx.shadowBlur = cell * 0.8;
    ctx.strokeRect(1, 1, cols * cell - 2, rows * cell - 2);
    ctx.restore();
  }

  const ANGLES = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

  // Sprites are baked on padded square canvases; blit centered on the cell.
  function blit(ctx, img, cellX, cellY, cell, span) {
    const d = (span - 1) / 2;
    ctx.drawImage(img, (cellX - d) * cell, (cellY - d) * cell, span * cell, span * cell);
  }

  // Baked light cycle at the head cell, nose pointing along travel direction.
  function drawCycle(ctx, snake, color, cell, atlas) {
    const head = snake.body[snake.body.length - 1];
    const img = atlas.cycles[color];
    const span = atlas.spans.cycle;
    ctx.save();
    ctx.translate((head.x + 0.5) * cell, (head.y + 0.5) * cell);
    ctx.rotate(ANGLES[snake.direction]);
    ctx.drawImage(img, -span * cell / 2, -span * cell / 2, span * cell, span * cell);
    ctx.restore();
  }

  function drawWalls(ctx, walls, cell, atlas) {
    if (!walls || !walls.length) return;
    for (const c of walls) blit(ctx, atlas.wall, c.x, c.y, cell, atlas.spans.wall);
  }

  function drawBolts(ctx, bolts, colors, cell, atlas, elapsedSec) {
    if (!bolts || !bolts.length) return;
    const span = atlas.spans.bolt;
    for (const b of bolts) {
      const frames = atlas.bolts[colors[b.ownerIndex]] || atlas.bolts[colors[0]];
      const img = frames[((elapsedSec * 20) | 0) % frames.length];
      ctx.save();
      ctx.translate((b.pos.x + 0.5) * cell, (b.pos.y + 0.5) * cell);
      ctx.rotate(Math.atan2(b.dir.y, b.dir.x)); // spray bolts travel diagonally
      ctx.drawImage(img, -span * cell / 2, -span * cell / 2, span * cell, span * cell);
      ctx.restore();
    }
  }

  const FLASH_DURATION_SEC = 0.3;
  // Hot ember for a cut, red for a lethal head shot, cool ping for a bounce.
  const FLASH_COLORS = { cut: '#ffcc33', kill: '#ff4b4b', bounce: '#66ccff', pickup: '#39ff6a' };

  // Brief expanding, fading ring marking where a bolt outcome landed, so a
  // cut/kill/bounce reads visually and isn't sound-only (a bolt that's been
  // bouncing for a while can land far from where it was fired).
  function drawFlashes(ctx, flashes, cell, elapsedSec) {
    if (!flashes || !flashes.length) return;
    ctx.save();
    for (const f of flashes) {
      const age = elapsedSec - f.start;
      if (age < 0 || age >= FLASH_DURATION_SEC) continue;
      const p = age / FLASH_DURATION_SEC;
      const color = FLASH_COLORS[f.type] || '#ffffff';
      const cx = (f.pos.x + 0.5) * cell, cy = (f.pos.y + 0.5) * cell;
      const radius = cell * (0.3 + p * 0.7);
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = color;
      ctx.shadowColor = color; ctx.shadowBlur = cell * 1.2;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSnake(ctx, snake, color, cell, trailMode, elapsedSec, frozen, atlas) {
    const tiles = atlas.trails[color];
    const span = atlas.spans.trail;
    const baseAlpha = snake.phase ? 0.5 : 1; // ghosted-once charge still armed: read as semi-transparent
    ctx.save();
    for (let i = 0; i < snake.body.length; i++) {
      const c = snake.body[i];
      let a = baseAlpha;
      if (trailMode === 'fade') a *= fadeAlpha(elapsedSec - c.t, T.FADE_SECONDS);
      ctx.globalAlpha = a;
      const key = S.trailKey(snake.body[i - 1] || null, c, snake.body[i + 1] || null);
      blit(ctx, tiles[key], c.x, c.y, cell, span);
    }
    ctx.restore();
    drawCycle(ctx, snake, color, cell, atlas);
    if (snake.shield) drawShieldRing(ctx, snake, cell, elapsedSec);
    if (frozen) drawFrostOverlay(ctx, snake, cell);
  }

  // A pulsing cyan ring around the head signals an armed, single-use shield.
  function drawShieldRing(ctx, snake, cell, elapsedSec) {
    const h = snake.body[snake.body.length - 1];
    const pulse = 0.75 + 0.25 * Math.sin(elapsedSec * 6);
    ctx.save();
    ctx.strokeStyle = '#66e0ff';
    ctx.shadowColor = '#66e0ff'; ctx.shadowBlur = cell * 0.6;
    ctx.lineWidth = 2;
    ctx.globalAlpha = pulse;
    ctx.beginPath();
    ctx.arc((h.x + 0.5) * cell, (h.y + 0.5) * cell, cell * 0.75, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // An icy tint over a frozen snake's head makes the stall readable at a glance.
  function drawFrostOverlay(ctx, snake, cell) {
    const h = snake.body[snake.body.length - 1];
    ctx.save();
    ctx.fillStyle = 'rgba(150,220,255,0.55)';
    ctx.shadowColor = '#bdeeff'; ctx.shadowBlur = cell * 1.1;
    ctx.beginPath();
    ctx.arc((h.x + 0.5) * cell, (h.y + 0.5) * cell, cell * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPickups(ctx, pickups, cell, elapsedSec, atlas) {
    if (!pickups || !pickups.length) return;
    const span = atlas.spans.pickup;
    for (const p of pickups) {
      const img = atlas.pickups[p.type] || atlas.pickups.ammo;
      const bob = Math.sin(elapsedSec * 3 + p.spawnedAt) * cell * 0.08;
      const d = (span - 1) / 2;
      ctx.drawImage(img, (p.pos.x - d) * cell, (p.pos.y - d) * cell + bob, span * cell, span * cell);
    }
  }

  // Generate a vivid random HSL color suitable for neon borders/walls.
  function randomBorderColor() {
    const h = Math.floor(Math.random() * 360);
    return `hsl(${h}, 100%, 55%)`;
  }

  function render(ctx, round, cell, colors = COLORS, borderColor = '#ff2b4a', elapsedSec = 0, flashes = [], atlas) {
    const { board, snakes, bolts, pickups, frozenUntil } = round;
    drawGrid(ctx, board.width, board.height, cell, borderColor);
    drawWalls(ctx, board.walls, cell, atlas);
    drawPickups(ctx, pickups, cell, elapsedSec, atlas);
    drawBolts(ctx, bolts, colors, cell, atlas, elapsedSec);
    drawFlashes(ctx, flashes, cell, elapsedSec);
    snakes.forEach((s, i) =>
      drawSnake(ctx, s, colors[i], cell, round.trailMode, elapsedSec, !!frozenUntil && elapsedSec < frozenUntil[i], atlas));
  }

  return {
    __name: 'Renderer', COLORS, PALETTE, FLASH_DURATION_SEC,
    pickOpponentColor, randomBorderColor, fadeAlpha, fit,
    drawGrid, drawWalls, drawBolts, drawFlashes, drawPickups, drawSnake, render,
  };
});

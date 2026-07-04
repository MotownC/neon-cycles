(function (root, factory) {
  const deps = typeof require === 'function'
    ? { T: require('./trail') }
    : { T: window.Trail };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function ({ T }) {
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

  // Top-down light cycle at the head cell, nose pointing along travel direction.
  function drawCycle(ctx, snake, color, cell) {
    const head = snake.body[snake.body.length - 1];
    ctx.save();
    ctx.translate((head.x + 0.5) * cell, (head.y + 0.5) * cell);
    ctx.rotate(ANGLES[snake.direction]);
    ctx.shadowColor = color; ctx.shadowBlur = cell * 1.4;
    ctx.fillStyle = '#ffffff';
    // front wheel, protruding past the fairing
    ctx.fillRect(cell * 0.34, -cell * 0.09, cell * 0.32, cell * 0.18);
    // rear wheel, wider
    ctx.fillRect(-cell * 0.66, -cell * 0.13, cell * 0.3, cell * 0.26);
    // fairing: widest at the rider, tapering toward both wheels
    ctx.beginPath();
    ctx.moveTo(cell * 0.4, 0);
    ctx.lineTo(cell * 0.05, -cell * 0.3);
    ctx.lineTo(-cell * 0.42, -cell * 0.24);
    ctx.lineTo(-cell * 0.42, cell * 0.24);
    ctx.lineTo(cell * 0.05, cell * 0.3);
    ctx.closePath();
    ctx.fill();
    // dark cockpit slit
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#05060a';
    ctx.fillRect(-cell * 0.22, -cell * 0.08, cell * 0.34, cell * 0.16);
    ctx.restore();
  }

  function drawWalls(ctx, walls, cell, borderColor) {
    if (!walls || !walls.length) return;
    ctx.save();
    ctx.fillStyle = borderColor;
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = borderColor; ctx.lineWidth = 1;
    ctx.shadowColor = borderColor; ctx.shadowBlur = cell * 0.5;
    for (const c of walls) {
      ctx.fillRect(c.x * cell + 1, c.y * cell + 1, cell - 2, cell - 2);
      ctx.strokeRect(c.x * cell + 1.5, c.y * cell + 1.5, cell - 3, cell - 3);
    }
    ctx.restore();
  }

  function drawBolts(ctx, bolts, colors, cell) {
    if (!bolts || !bolts.length) return;
    ctx.save();
    for (const b of bolts) {
      const color = colors[b.ownerIndex] || '#ffffff';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = color; ctx.shadowBlur = cell * 1.2;
      ctx.fillRect(b.pos.x * cell + cell * 0.3, b.pos.y * cell + cell * 0.3, cell * 0.4, cell * 0.4);
    }
    ctx.restore();
  }

  const FLASH_DURATION_SEC = 0.3;
  // Hot ember for a destructive hit (cut/stun), cool ping for a harmless bounce.
  const FLASH_COLORS = { cut: '#ffcc33', stun: '#ffcc33', bounce: '#66ccff' };

  // Brief expanding, fading ring marking where a bolt outcome landed, so a
  // cut/stun/bounce reads visually and isn't sound-only (a bolt that's been
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

  function drawSnake(ctx, snake, color, cell, trailMode, elapsedSec) {
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = cell * 0.9;
    ctx.fillStyle = color;
    for (const c of snake.body) {
      if (trailMode === 'fade') ctx.globalAlpha = fadeAlpha(elapsedSec - c.t, T.FADE_SECONDS);
      ctx.fillRect(c.x * cell + 1, c.y * cell + 1, cell - 2, cell - 2);
    }
    ctx.restore();
    drawCycle(ctx, snake, color, cell);
  }

  // Generate a vivid random HSL color suitable for neon borders/walls.
  function randomBorderColor() {
    const h = Math.floor(Math.random() * 360);
    return `hsl(${h}, 100%, 55%)`;
  }

  function render(ctx, round, cell, colors = COLORS, borderColor = '#ff2b4a', elapsedSec = 0, flashes = []) {
    const { board, snakes, bolts } = round;
    drawGrid(ctx, board.width, board.height, cell, borderColor);
    drawWalls(ctx, board.walls, cell, borderColor);
    drawBolts(ctx, bolts, colors, cell);
    drawFlashes(ctx, flashes, cell, elapsedSec);
    snakes.forEach((s, i) => drawSnake(ctx, s, colors[i], cell, round.trailMode, elapsedSec));
  }

  return {
    __name: 'Renderer', COLORS, PALETTE, FLASH_DURATION_SEC,
    pickOpponentColor, randomBorderColor, fadeAlpha, fit,
    drawGrid, drawWalls, drawBolts, drawFlashes, drawSnake, render,
  };
});

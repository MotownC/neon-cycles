(function (root, factory) {
  const deps = typeof require === 'function'
    ? { T: require('./trail'), S: require('./sprites'), R: require('./replay') }
    : { T: window.Trail, S: window.Sprites, R: window.Replay };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function ({ T, S, R }) {
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

  function clearBackground(ctx, cols, rows, cell) {
    ctx.clearRect(0, 0, cols * cell, rows * cell);
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, cols * cell, rows * cell);
  }

  function drawGrid(ctx, cols, rows, cell, borderColor, atlas) {
    if (atlas && atlas.arena) { ctx.drawImage(atlas.arena, 0, 0, cols * cell, rows * cell); return; }
    clearBackground(ctx, cols, rows, cell);
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

  // A soft band of light drifting down the floor, so the arena is never static.
  const SWEEP_PERIOD_SEC = 7;
  function drawSweep(ctx, cols, rows, cell, elapsedSec) {
    const band = cell * 6, H = rows * cell;
    const y = ((elapsedSec % SWEEP_PERIOD_SEC) / SWEEP_PERIOD_SEC) * (H + band * 2) - band;
    const g = ctx.createLinearGradient(0, y - band, 0, y + band);
    g.addColorStop(0, 'rgba(90,170,255,0)'); g.addColorStop(0.5, 'rgba(90,170,255,0.08)'); g.addColorStop(1, 'rgba(90,170,255,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(0, y - band, cols * cell, band * 2);
    ctx.restore();
  }

  // The arena wall breathing: an extra glow over the baked border.
  function drawBorderPulse(ctx, cols, rows, cell, borderColor, elapsedSec) {
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.3 * Math.sin(elapsedSec * 2.2);
    ctx.strokeStyle = borderColor; ctx.lineWidth = 2;
    ctx.shadowColor = borderColor; ctx.shadowBlur = cell * 1.4;
    ctx.strokeRect(1, 1, cols * cell - 2, rows * cell - 2);
    ctx.restore();
  }

  // Each live cycle lights the floor around it in its own colour.
  const POOL_RADIUS_CELLS = 4.5;
  function drawLightPools(ctx, snakes, colors, cell, atlas) {
    const r = POOL_RADIUS_CELLS * cell;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    snakes.forEach((s, i) => {
      const img = atlas.pools && atlas.pools[colors[i]];
      if (!img || s.wrecked || s.alive === false) return;
      const p = cyclePos(s);
      ctx.drawImage(img, (p.x + 0.5) * cell - r, (p.y + 0.5) * cell - r, r * 2, r * 2);
    });
    ctx.restore();
  }

  // Bloom: bright pixels bleed light onto their surroundings. The frame is
  // shrunk, squared against itself (so dark areas drop out and only the
  // bright ones survive), blurred, and added back on top.
  let bloomBuf = null;
  function bloom(ctx) {
    const src = ctx.canvas, w = src.width, h = src.height;
    if (!bloomBuf || bloomBuf.w !== w || bloomBuf.h !== h) {
      const make = (cw, ch) => {
        const c = document.createElement('canvas');
        c.width = Math.max(1, cw); c.height = Math.max(1, ch);
        return c;
      };
      bloomBuf = { w, h, near: make(w >> 2, h >> 2), far: make(w >> 3, h >> 3) };
    }
    const { near, far } = bloomBuf;
    const nctx = near.getContext('2d'), fctx = far.getContext('2d');
    nctx.imageSmoothingQuality = 'high';
    nctx.globalCompositeOperation = 'copy';
    nctx.drawImage(src, 0, 0, near.width, near.height);
    nctx.globalCompositeOperation = 'multiply';
    nctx.drawImage(near, 0, 0);
    fctx.globalCompositeOperation = 'copy';
    if ('filter' in fctx) fctx.filter = 'blur(2px)'; // browsers without it still get the soft upscale
    fctx.drawImage(near, 0, 0, far.width, far.height);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.3; ctx.drawImage(near, 0, 0, w, h);
    ctx.globalAlpha = 0.55; ctx.drawImage(far, 0, 0, w, h);
    ctx.restore();
  }

  const ANGLES = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
  const VECTORS = { right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, up: { x: 0, y: -1 } };

  // Nose angle, swinging round from the old heading just after a turn.
  function cycleAngle(snake) {
    const to = ANGLES[snake.direction];
    if (!snake.turnFrom || !(snake.turnT < 1)) return to;
    let d = to - ANGLES[snake.turnFrom];
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return to - d * (1 - snake.turnT);
  }

  // Clip to everything behind a gliding cycle, so its trail ends at the
  // cycle and not at the head cell it hasn't visibly reached yet.
  function clipBehind(ctx, pos, v, cell) {
    const px = (pos.x + 0.5) * cell, py = (pos.y + 0.5) * cell, far = 1e5;
    ctx.beginPath();
    if (v.x) ctx.rect(v.x > 0 ? -far : px, -far, far + (v.x > 0 ? px : 0), far * 2);
    else ctx.rect(-far, v.y > 0 ? -far : py, far * 2, far + (v.y > 0 ? py : 0));
    ctx.clip();
  }

  // Sprites are baked on padded square canvases; blit centered on the cell.
  function blit(ctx, img, cellX, cellY, cell, span) {
    const d = (span - 1) / 2;
    ctx.drawImage(img, (cellX - d) * cell, (cellY - d) * cell, span * cell, span * cell);
  }

  // A replay glides the cycle between cells via cycleAt; live play sits on the head.
  function cyclePos(snake) { return snake.cycleAt || snake.body[snake.body.length - 1]; }

  // Baked light cycle at the head cell, nose pointing along travel direction.
  function drawCycle(ctx, snake, color, cell, atlas) {
    const pos = cyclePos(snake);
    const img = atlas.cycles[color];
    const span = atlas.spans.cycle;
    ctx.save();
    ctx.translate((pos.x + 0.5) * cell, (pos.y + 0.5) * cell);
    ctx.rotate(cycleAngle(snake));
    ctx.drawImage(img, -span * cell / 2, -span * cell / 2, span * cell, span * cell);
    ctx.restore();
  }

  function drawWalls(ctx, walls, cell, atlas) {
    if (!walls || !walls.length) return;
    for (const c of walls) blit(ctx, atlas.wall, c.x, c.y, cell, atlas.spans.wall);
  }

  // Cells about to become permanent walls pulse in warning amber for the
  // ~1s telegraph window, distinguishing "incoming" from "already solid".
  function drawHazardTelegraph(ctx, hazard, cell, elapsedSec) {
    if (!hazard || !hazard.telegraph) return;
    const pulse = 0.4 + 0.4 * Math.abs(Math.sin(elapsedSec * 10));
    ctx.save();
    ctx.fillStyle = '#ff9933';
    ctx.shadowColor = '#ff9933';
    ctx.shadowBlur = cell * 1.2;
    ctx.globalAlpha = pulse;
    for (const c of hazard.telegraph.cells) ctx.fillRect(c.x * cell, c.y * cell, cell, cell);
    ctx.restore();
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
    const n = snake.body.length, head = snake.body[n - 1], at = snake.cycleAt, v = VECTORS[snake.direction];
    // live glide: the cycle is still short of its head cell
    const trailing = !!at && (head.x - at.x) * v.x + (head.y - at.y) * v.y > 0.001;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const c = snake.body[i];
      if (trailing && i === Math.max(0, n - 2)) clipBehind(ctx, at, v, cell); // newest two tiles only
      let a = baseAlpha;
      if (trailMode === 'fade') a *= fadeAlpha(elapsedSec - c.t, T.FADE_SECONDS);
      ctx.globalAlpha = a;
      const key = S.trailKey(snake.body[i - 1] || null, c, snake.body[i + 1] || null);
      blit(ctx, tiles[key], c.x, c.y, cell, span);
    }
    ctx.restore();
    if (snake.wrecked) return;
    drawCycle(ctx, snake, color, cell, atlas);
    if (snake.shield) drawShieldRing(ctx, snake, cell, elapsedSec);
    if (frozen) drawFrostOverlay(ctx, snake, cell);
  }

  // A pulsing cyan ring around the head signals an armed, single-use shield.
  function drawShieldRing(ctx, snake, cell, elapsedSec) {
    const h = cyclePos(snake);
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
    const h = cyclePos(snake);
    ctx.save();
    ctx.fillStyle = 'rgba(150,220,255,0.55)';
    ctx.shadowColor = '#bdeeff'; ctx.shadowBlur = cell * 1.1;
    ctx.beginPath();
    ctx.arc((h.x + 0.5) * cell, (h.y + 0.5) * cell, cell * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // A crashed cycle's pieces: tiles cut from its own sprite over a glowing
  // backing in the snake's color (the sprite has dark panels that would
  // vanish against the grid), plus thin sparks.
  function drawDebris(ctx, debris, ageSec, colors, cell, atlas) {
    for (const { snakeIndex, pieces } of debris) {
      const color = colors[snakeIndex];
      const img = atlas.cycles[color];
      const perCell = img.width / atlas.spans.cycle;
      for (const piece of pieces) {
        const at = R.pieceAt(piece, ageSec);
        if (!at) continue;
        const d = piece.size * cell;
        ctx.save();
        ctx.globalAlpha = at.alpha;
        ctx.translate((at.x + 0.5) * cell, (at.y + 0.5) * cell);
        ctx.rotate(at.rot);
        ctx.fillStyle = color;
        ctx.shadowColor = color; ctx.shadowBlur = cell * 0.6;
        if (piece.kind === 'spark') {
          ctx.fillRect(-d * 1.5, -d / 2, d * 3, d);
        } else {
          ctx.fillRect(-d * 0.4, -d * 0.4, d * 0.8, d * 0.8);
          ctx.shadowBlur = 0;
          const srcX = (piece.ox - piece.size / 2 + atlas.spans.cycle / 2) * perCell;
          const srcY = (piece.oy - piece.size / 2 + atlas.spans.cycle / 2) * perCell;
          const srcSize = piece.size * perCell;
          ctx.drawImage(img, srcX, srcY, srcSize, srcSize, -d / 2, -d / 2, d, d);
        }
        ctx.restore();
      }
    }
  }

  function drawReplayBanner(ctx, cols, rows, cell) {
    ctx.save();
    ctx.font = `bold ${cell}px "Trebuchet MS", "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#eaf6ff';
    ctx.shadowColor = '#00f0ff'; ctx.shadowBlur = cell * 0.6;
    ctx.fillText('SLOW-MO REPLAY \u2014 PRESS ENTER TO SKIP', cols * cell / 2, (rows - 1.5) * cell);
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

  // gfx 'low' skips the per-frame lighting extras (and the caller skips bloom).
  function render(ctx, round, cell, colors = COLORS, borderColor = '#ff2b4a', elapsedSec = 0, flashes = [], atlas, gfx = 'high') {
    const { board, snakes, bolts, pickups, frozenUntil, hazard } = round;
    const fancy = gfx !== 'low';
    drawGrid(ctx, board.width, board.height, cell, borderColor, atlas);
    if (fancy) {
      drawSweep(ctx, board.width, board.height, cell, elapsedSec);
      drawBorderPulse(ctx, board.width, board.height, cell, borderColor, elapsedSec);
      drawLightPools(ctx, snakes, colors, cell, atlas);
    }
    drawWalls(ctx, board.walls, cell, atlas);
    drawHazardTelegraph(ctx, hazard, cell, elapsedSec);
    drawPickups(ctx, pickups, cell, elapsedSec, atlas);
    drawBolts(ctx, bolts, colors, cell, atlas, elapsedSec);
    drawFlashes(ctx, flashes, cell, elapsedSec);
    snakes.forEach((s, i) =>
      drawSnake(ctx, s, colors[i], cell, round.trailMode, elapsedSec, !!frozenUntil && elapsedSec < frozenUntil[i], atlas));
  }

  return {
    __name: 'Renderer', COLORS, PALETTE, FLASH_DURATION_SEC,
    pickOpponentColor, randomBorderColor, fadeAlpha, fit,
    bloom, clearBackground, drawGrid, drawWalls, drawBolts, drawFlashes, drawPickups, drawSnake, drawDebris, drawReplayBanner, render,
  };
});

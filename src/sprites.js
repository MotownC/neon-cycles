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

  const SCALE = 4; // bake resolution multiplier: crisp when downscaled to cell size

  function makeTile(cell, span) {
    const c = document.createElement('canvas');
    c.width = c.height = span * cell * SCALE;
    return c;
  }

  // --- trail tiles: light-ribbon segments -----------------------------------
  const TRAIL_KEYS = ['LR', 'UD', 'LU', 'LD', 'RU', 'RD', 'L', 'R', 'U', 'D', 'O'];
  // edge midpoints of the center cell, in cell units relative to tile center
  const EXITS = { L: [-0.5, 0], R: [0.5, 0], U: [0, -0.5], D: [0, 0.5] };

  function bakeTrailTile(cell, color, key) {
    const canvas = makeTile(cell, 3), ctx = canvas.getContext('2d');
    const u = cell * SCALE, cx = canvas.width / 2, cy = cx;
    const pts = [...key].filter((k) => EXITS[k]).map((k) => [cx + EXITS[k][0] * u, cy + EXITS[k][1] * u]);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const path = () => {
      ctx.beginPath();
      if (pts.length === 2) { ctx.moveTo(...pts[0]); ctx.quadraticCurveTo(cx, cy, ...pts[1]); }
      else if (pts.length === 1) { ctx.moveTo(...pts[0]); ctx.lineTo(cx, cy); }
      else { ctx.moveTo(cx - u * 0.01, cy); ctx.lineTo(cx + u * 0.01, cy); }
    };
    // layered strokes: wide soft glow -> colored body -> white-hot core
    const layers = [
      { w: 0.95, a: 0.22, c: color, blur: 0.8 },
      { w: 0.55, a: 0.85, c: color, blur: 0.3 },
      { w: 0.20, a: 0.90, c: '#ffffff', blur: 0 },
    ];
    for (const l of layers) {
      ctx.globalAlpha = l.a; ctx.strokeStyle = l.c; ctx.lineWidth = u * l.w;
      ctx.shadowColor = l.c; ctx.shadowBlur = u * l.blur;
      path(); ctx.stroke();
    }
    return canvas;
  }

  // --- cycle: baked facing right, rotated at blit time ----------------------
  function bakeCycle(cell, color) {
    const canvas = makeTile(cell, 3), ctx = canvas.getContext('2d');
    const u = cell * SCALE, cx = canvas.width / 2, cy = cx;
    ctx.translate(cx, cy);
    // glow halo, kept faint so it doesn't swallow the wheel/canopy detail
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, u * 1.1);
    halo.addColorStop(0, color); halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.16; ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, u * 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // glowing wheel discs with dark hubs, protruding past the fairing
    const wheel = (x, r) => {
      const wg = ctx.createRadialGradient(x, 0, r * 0.2, x, 0, r);
      wg.addColorStop(0, '#0a0d14'); wg.addColorStop(0.7, color); wg.addColorStop(1, '#ffffff');
      ctx.fillStyle = wg;
      ctx.shadowColor = color; ctx.shadowBlur = u * 0.35;
      ctx.beginPath(); ctx.arc(x, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#05060a';
      ctx.beginPath(); ctx.arc(x, 0, r * 0.4, 0, Math.PI * 2); ctx.fill();
    };
    wheel(-u * 0.54, u * 0.30);
    wheel(u * 0.58, u * 0.22);
    // fairing: slim teardrop, bright nose fading to a dark tail
    const body = () => {
      ctx.beginPath();
      ctx.moveTo(u * 0.66, 0);
      ctx.bezierCurveTo(u * 0.45, -u * 0.26, -u * 0.10, -u * 0.28, -u * 0.42, -u * 0.18);
      ctx.bezierCurveTo(-u * 0.54, -u * 0.08, -u * 0.54, u * 0.08, -u * 0.42, u * 0.18);
      ctx.bezierCurveTo(-u * 0.10, u * 0.28, u * 0.45, u * 0.26, u * 0.66, 0);
      ctx.closePath();
    };
    const bg = ctx.createLinearGradient(u * 0.66, 0, -u * 0.6, 0);
    bg.addColorStop(0, '#ffffff'); bg.addColorStop(0.25, color); bg.addColorStop(1, '#101624');
    ctx.fillStyle = bg;
    ctx.shadowColor = color; ctx.shadowBlur = u * 0.35;
    body(); ctx.fill();
    // rim light outline
    ctx.shadowBlur = 0; ctx.strokeStyle = color; ctx.lineWidth = u * 0.05;
    ctx.globalAlpha = 0.9; body(); ctx.stroke(); ctx.globalAlpha = 1;
    // canopy slit + specular line
    ctx.fillStyle = '#05060a';
    ctx.beginPath();
    ctx.roundRect(-u * 0.14, -u * 0.09, u * 0.34, u * 0.18, u * 0.08);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = u * 0.03;
    ctx.beginPath(); ctx.moveTo(-u * 0.10, -u * 0.05); ctx.lineTo(u * 0.14, -u * 0.05); ctx.stroke();
    return canvas;
  }

  // --- bolt: jagged high-voltage lightning, flicker variants, facing right --
  const BOLT_FRAMES = 3;

  // Tiny deterministic PRNG so each flicker variant gets a stable zigzag
  // shape instead of a new random jitter every bake.
  function seededRand(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  }

  function bakeBolt(cell, color, seed) {
    const canvas = makeTile(cell, 3), ctx = canvas.getContext('2d');
    const u = cell * SCALE, cx = canvas.width / 2, cy = cx;
    ctx.translate(cx, cy);
    const rand = seededRand(seed * 97 + 13);
    // zigzag spine from tail to nose; nose stays at the +x end so the
    // existing atan2(dir)-based rotation at blit time still points it forward
    const tailX = -u * 0.95, noseX = u * 0.4, segments = 6;
    const spine = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const jitter = (i === 0 || i === segments) ? 0 : (rand() - 0.5) * u * 0.32;
      spine.push([tailX + (noseX - tailX) * t, jitter]);
    }
    const path = (points) => {
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // layered strokes: wide colored glow -> tighter glow -> white-hot core
    const layers = [
      { w: 0.42, a: 0.28, c: color, blur: 1.0 },
      { w: 0.22, a: 0.75, c: color, blur: 0.5 },
      { w: 0.09, a: 1.0, c: '#ffffff', blur: 0.15 },
    ];
    for (const l of layers) {
      ctx.globalAlpha = l.a; ctx.strokeStyle = l.c; ctx.lineWidth = u * l.w;
      ctx.shadowColor = l.c; ctx.shadowBlur = u * l.blur;
      path(spine); ctx.stroke();
    }
    // one small fork branching off the spine, like a real strike's offshoot
    const forkFrom = spine[2 + (seed % 2)];
    const forkAngle = (rand() - 0.5) * Math.PI * 0.6;
    const forkLen = u * (0.18 + rand() * 0.12);
    const fork = [forkFrom, [forkFrom[0] + Math.cos(forkAngle) * forkLen, forkFrom[1] + Math.sin(forkAngle) * forkLen]];
    ctx.globalAlpha = 0.85; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = u * 0.05;
    ctx.shadowColor = color; ctx.shadowBlur = u * 0.35;
    path(fork); ctx.stroke();
    ctx.globalAlpha = 1;
    return canvas;
  }

  // --- wall: beveled dark slab with glowing seams ----------------------------
  function bakeWall(cell, borderColor) {
    const canvas = makeTile(cell, 2), ctx = canvas.getContext('2d');
    const u = cell * SCALE, o = (canvas.width - u) / 2; // slab covers the center cell
    const inset = u * 0.06;
    // slab body with subtle depth gradient
    const g = ctx.createLinearGradient(o, o, o + u, o + u);
    g.addColorStop(0, '#131a26'); g.addColorStop(1, '#070a10');
    ctx.fillStyle = g;
    ctx.fillRect(o + inset, o + inset, u - inset * 2, u - inset * 2);
    // bevel: light top-left edge, dark bottom-right edge
    ctx.lineWidth = u * 0.045;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(o + inset, o + u - inset); ctx.lineTo(o + inset, o + inset); ctx.lineTo(o + u - inset, o + inset);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.moveTo(o + u - inset, o + inset); ctx.lineTo(o + u - inset, o + u - inset); ctx.lineTo(o + inset, o + u - inset);
    ctx.stroke();
    // glowing edge seam in the arena border color
    ctx.strokeStyle = borderColor; ctx.lineWidth = u * 0.06;
    ctx.shadowColor = borderColor; ctx.shadowBlur = u * 0.45;
    ctx.globalAlpha = 0.9;
    ctx.strokeRect(o + inset * 2, o + inset * 2, u - inset * 4, u - inset * 4);
    return canvas;
  }

  // --- pickups: hex badge + drawn icon ---------------------------------------
  const PICKUP_COLORS = { shield: '#66e0ff', freeze: '#bdeeff', ammo: '#ff9d2b', phase: '#b06bff' };

  function hexPath(ctx, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  const ICONS = {
    shield(ctx, u) { // classic shield outline
      ctx.beginPath();
      ctx.moveTo(0, -u * 0.26);
      ctx.lineTo(u * 0.20, -u * 0.18);
      ctx.lineTo(u * 0.20, u * 0.02);
      ctx.quadraticCurveTo(u * 0.20, u * 0.20, 0, u * 0.30);
      ctx.quadraticCurveTo(-u * 0.20, u * 0.20, -u * 0.20, u * 0.02);
      ctx.lineTo(-u * 0.20, -u * 0.18);
      ctx.closePath();
      ctx.stroke();
    },
    freeze(ctx, u) { // six-spoke snowflake with tip ticks
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        const dx = Math.cos(a), dy = Math.sin(a);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(dx * u * 0.28, dy * u * 0.28); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(dx * u * 0.18 - dy * u * 0.07, dy * u * 0.18 + dx * u * 0.07);
        ctx.lineTo(dx * u * 0.28, dy * u * 0.28);
        ctx.lineTo(dx * u * 0.18 + dy * u * 0.07, dy * u * 0.18 - dx * u * 0.07);
        ctx.stroke();
      }
    },
    ammo(ctx, u) { // lightning bolt, filled
      ctx.beginPath();
      ctx.moveTo(u * 0.08, -u * 0.30);
      ctx.lineTo(-u * 0.14, u * 0.04);
      ctx.lineTo(-u * 0.01, u * 0.04);
      ctx.lineTo(-u * 0.08, u * 0.30);
      ctx.lineTo(u * 0.14, -u * 0.04);
      ctx.lineTo(u * 0.01, -u * 0.04);
      ctx.closePath();
      ctx.fill();
    },
    phase(ctx, u) { // little ghost
      ctx.beginPath();
      ctx.arc(0, -u * 0.06, u * 0.20, Math.PI, 0);
      ctx.lineTo(u * 0.20, u * 0.22);
      ctx.lineTo(u * 0.10, u * 0.14);
      ctx.lineTo(0, u * 0.22);
      ctx.lineTo(-u * 0.10, u * 0.14);
      ctx.lineTo(-u * 0.20, u * 0.22);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath(); ctx.arc(-u * 0.07, -u * 0.08, u * 0.03, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(u * 0.07, -u * 0.08, u * 0.03, 0, Math.PI * 2); ctx.fill();
    },
  };

  function bakePickup(cell, type) {
    const canvas = makeTile(cell, 3), ctx = canvas.getContext('2d');
    const u = cell * SCALE, color = PICKUP_COLORS[type];
    ctx.translate(canvas.width / 2, canvas.height / 2);
    // soft inner glow
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, u * 0.55);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.25; ctx.fillStyle = g;
    hexPath(ctx, u * 0.55); ctx.fill();
    ctx.globalAlpha = 1;
    // hex frame
    ctx.strokeStyle = color; ctx.lineWidth = u * 0.06;
    ctx.shadowColor = color; ctx.shadowBlur = u * 0.7;
    hexPath(ctx, u * 0.52); ctx.stroke();
    // icon
    ctx.shadowBlur = u * 0.3;
    ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff'; ctx.lineWidth = u * 0.05;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ICONS[type](ctx, u);
    return canvas;
  }

  // Bake the full atlas for the current cell size / colors / border color.
  // Rebake whenever any of those change (round start, resize).
  function bake({ cell, colors, borderColor }) {
    const atlas = {
      cell, cycles: {}, bolts: {}, trails: {}, pickups: {},
      wall: bakeWall(cell, borderColor),
      spans: { cycle: 3, bolt: 3, trail: 3, wall: 2, pickup: 3 },
    };
    for (const color of new Set(colors)) {
      atlas.cycles[color] = bakeCycle(cell, color);
      atlas.bolts[color] = Array.from({ length: BOLT_FRAMES }, (_, i) => bakeBolt(cell, color, i));
      atlas.trails[color] = {};
      for (const key of TRAIL_KEYS) atlas.trails[color][key] = bakeTrailTile(cell, color, key);
    }
    for (const type of Object.keys(PICKUP_COLORS)) atlas.pickups[type] = bakePickup(cell, type);
    return atlas;
  }

  return { __name: 'Sprites', trailKey, bake, TRAIL_KEYS, BOLT_FRAMES };
});

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
  // Each shape is a top-down silhouette in cell units, nose at +x. `outline`
  // is the upper half from nose to tail and is mirrored; `extras` are mirrored
  // add-on panels (prongs, fins, pods) drawn under the body. `rear`/`front`
  // are the two light-rotor wheels, `canopy` the cockpit glass.
  const SHAPES = {
    // the player's bike: a balanced teardrop
    classic: { smooth: true,
      outline: [[0.92, 0], [0.55, -0.22], [0.05, -0.30], [-0.45, -0.24], [-0.80, -0.14], [-0.90, 0]],
      rear: { x: -0.60, r: 0.27 }, front: { x: 0.58, r: 0.20 },
      canopy: { x: 0.0, len: 0.40, wid: 0.20 }, extras: [] },
    // DRIFTER: a round, bubbly cruiser with a big dome
    drifter: { smooth: true,
      outline: [[0.80, 0], [0.62, -0.30], [0.10, -0.40], [-0.45, -0.36], [-0.78, -0.22], [-0.84, 0]],
      rear: { x: -0.56, r: 0.26 }, front: { x: 0.54, r: 0.24 },
      canopy: { x: 0.0, len: 0.46, wid: 0.34 }, extras: [] },
    // SURVIVOR: a slab-sided armoured brick with side skirts
    survivor: { smooth: false,
      outline: [[0.82, 0], [0.72, -0.24], [0.34, -0.34], [-0.62, -0.34], [-0.88, -0.22], [-0.88, 0]],
      rear: { x: -0.58, r: 0.28 }, front: { x: 0.52, r: 0.25 },
      canopy: { x: 0.02, len: 0.30, wid: 0.14 },
      extras: [[[0.26, -0.33], [0.18, -0.45], [-0.50, -0.45], [-0.58, -0.33]]] },
    // AGGRESSOR: an arrowhead with twin forward prongs
    aggressor: { smooth: false,
      outline: [[0.98, 0], [0.34, -0.16], [-0.22, -0.34], [-0.84, -0.40], [-0.64, -0.12], [-0.86, 0]],
      rear: { x: -0.56, r: 0.26 }, front: { x: 0.52, r: 0.18 },
      canopy: { x: -0.04, len: 0.32, wid: 0.16 },
      extras: [[[0.99, -0.20], [0.40, -0.30], [0.34, -0.18]]] },
    // AMBUSHER: a needle-thin dart with swept-back fins
    ambusher: { smooth: false,
      outline: [[0.99, 0], [0.42, -0.12], [-0.30, -0.16], [-0.72, -0.12], [-0.94, 0]],
      rear: { x: -0.64, r: 0.22 }, front: { x: 0.56, r: 0.17 },
      canopy: { x: -0.04, len: 0.38, wid: 0.12 },
      extras: [[[-0.14, -0.14], [-0.80, -0.44], [-0.62, -0.13]]] },
    // GRANDMASTER: long and regal, flanked by outrigger pods
    grandmaster: { smooth: true, crest: true,
      outline: [[0.97, 0], [0.62, -0.18], [0.10, -0.24], [-0.50, -0.22], [-0.86, -0.14], [-0.95, 0]],
      rear: { x: -0.64, r: 0.25 }, front: { x: 0.62, r: 0.21 },
      canopy: { x: -0.02, len: 0.40, wid: 0.16 },
      extras: [[[0.40, -0.31], [0.22, -0.44], [-0.46, -0.44], [-0.62, -0.31]]] },
  };
  const SHAPE_NAMES = Object.keys(SHAPES);
  const CYCLE_FRAMES = 4, ROTOR_ARCS = 2, ROTOR_ARC_SPAN = 1.15; // radians per arc

  // Closed path through pts: straight edges, or rounded through the midpoints.
  function ringPath(ctx, pts, smooth) {
    const n = pts.length;
    ctx.beginPath();
    if (!smooth) {
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    } else {
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      ctx.moveTo(...mid(pts[n - 1], pts[0]));
      for (let i = 0; i < n; i++) ctx.quadraticCurveTo(...pts[i], ...mid(pts[i], pts[(i + 1) % n]));
    }
    ctx.closePath();
  }

  // Everything on the bike that doesn't animate.
  function bakeCycleBase(cell, color, shape) {
    const canvas = makeTile(cell, 3), ctx = canvas.getContext('2d');
    const u = cell * SCALE;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    const scaled = (pts, kx = 1, ky = 1) => pts.map(([x, y]) => [x * u * kx, y * u * ky]);
    const nose = shape.outline[0][0], tail = shape.outline[shape.outline.length - 1][0];
    // full silhouette: upper half, then the lower half mirrored back to the nose
    const hull = [...shape.outline, ...shape.outline.slice(1, -1).reverse().map(([x, y]) => [x, -y])];

    // glow halo, kept faint so it doesn't swallow the detail
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, u * 1.2);
    halo.addColorStop(0, color); halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.16; ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, u * 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    const panel = ctx.createLinearGradient(nose * u, 0, tail * u, 0);
    panel.addColorStop(0, '#ffffff'); panel.addColorStop(0.22, color); panel.addColorStop(0.6, '#1b2740'); panel.addColorStop(1, '#0b101c');
    const plate = (pts, smooth) => {
      ringPath(ctx, pts, smooth);
      ctx.fillStyle = panel; ctx.shadowColor = color; ctx.shadowBlur = u * 0.3;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.22; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1; // a wash of the bike's colour
      ctx.strokeStyle = color; ctx.lineWidth = u * 0.045; ctx.lineJoin = 'round';
      ctx.stroke();
    };
    // add-on panels first, so the body overlaps their roots
    for (const extra of shape.extras) {
      plate(scaled(extra), false);
      plate(scaled(extra, 1, -1), false);
    }
    plate(scaled(hull), shape.smooth);

    // inner light strip following the hull, the signature neon line
    ringPath(ctx, scaled(hull, 0.84, 0.62), shape.smooth);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = u * 0.028; ctx.globalAlpha = 0.85;
    ctx.shadowColor = color; ctx.shadowBlur = u * 0.18;
    ctx.stroke();
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    if (shape.crest) { // a white-hot stripe down the spine
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = u * 0.05; ctx.lineCap = 'round';
      ctx.shadowColor = '#ffffff'; ctx.shadowBlur = u * 0.2;
      ctx.beginPath(); ctx.moveTo(nose * u * 0.8, 0); ctx.lineTo(tail * u * 0.8, 0); ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // cockpit: dark glass, a glint, and the rider's helmet
    const { x: cx, len, wid } = shape.canopy;
    ctx.fillStyle = '#05060a';
    ctx.beginPath(); ctx.roundRect((cx - len / 2) * u, -wid / 2 * u, len * u, wid * u, wid * u * 0.5); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = u * 0.02; ctx.globalAlpha = 0.7; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc((cx - len * 0.12) * u, 0, Math.min(wid, len) * u * 0.26, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = u * 0.025; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo((cx + len * 0.1) * u, -wid * 0.28 * u); ctx.lineTo((cx + len * 0.36) * u, -wid * 0.28 * u); ctx.stroke();

    // headlight at the nose, hot tail light at the back
    ctx.fillStyle = '#ffffff'; ctx.shadowColor = '#ffffff'; ctx.shadowBlur = u * 0.3;
    ctx.beginPath(); ctx.arc((nose - 0.07) * u, 0, u * 0.05, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = color;
    ctx.beginPath(); ctx.roundRect((tail + 0.02) * u, -u * 0.07, u * 0.05, u * 0.14, u * 0.02); ctx.fill();
    ctx.shadowBlur = 0;

    // wheel housings: a dark well ringed in light (spokes are added per frame)
    for (const w of [shape.rear, shape.front]) {
      ctx.fillStyle = '#05060a';
      ctx.beginPath(); ctx.arc(w.x * u, 0, w.r * u, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = u * 0.07; ctx.shadowColor = color; ctx.shadowBlur = u * 0.3;
      ctx.beginPath(); ctx.arc(w.x * u, 0, w.r * u * 0.9, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = u * 0.022; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(w.x * u, 0, w.r * u * 0.9, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    return canvas;
  }

  // The base plus spinning rotor spokes: one canvas per animation frame.
  function bakeCycleFrames(cell, color, shape) {
    const base = bakeCycleBase(cell, color, shape);
    const u = cell * SCALE;
    return Array.from({ length: CYCLE_FRAMES }, (_, f) => {
      const canvas = makeTile(cell, 3), ctx = canvas.getContext('2d');
      ctx.drawImage(base, 0, 0);
      ctx.translate(canvas.width / 2, canvas.height / 2);
      const turn = (f / CYCLE_FRAMES) * (Math.PI * 2 / ROTOR_ARCS);
      ctx.lineCap = 'round';
      for (const w of [shape.rear, shape.front]) {
        // bright arcs sweeping round inside the ring read as a spinning rotor
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = w.r * u * 0.2;
        ctx.shadowColor = color; ctx.shadowBlur = u * 0.12;
        for (let k = 0; k < ROTOR_ARCS; k++) {
          const a = turn + (k * Math.PI * 2) / ROTOR_ARCS;
          ctx.beginPath(); ctx.arc(w.x * u, 0, w.r * u * 0.52, a, a + ROTOR_ARC_SPAN); ctx.stroke();
        }
        ctx.shadowBlur = 0; ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(w.x * u, 0, w.r * u * 0.14, 0, Math.PI * 2); ctx.fill();
      }
      return canvas;
    });
  }

  // --- headlight: a cone of light thrown ahead of the cycle (additive) -------
  function bakeBeam(color) {
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 160, 0);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    if ('filter' in ctx) ctx.filter = 'blur(5px)'; // soft-edged where the browser allows
    const cone = (alpha, near, far) => {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(6, 48 - near); ctx.lineTo(150, 48 - far); ctx.lineTo(150, 48 + far); ctx.lineTo(6, 48 + near);
      ctx.closePath(); ctx.fill();
    };
    cone(0.16, 5, 40);
    cone(0.18, 3, 16);
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

  // --- arena: the whole static backdrop, drawn once per round ----------------
  const MAJOR_EVERY = 4; // cells between the brighter grid lines

  function bakeArena(cols, rows, cell, borderColor) {
    const dpr = window.devicePixelRatio || 1;
    const W = cols * cell, H = rows * cell;
    const canvas = document.createElement('canvas');
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const reach = Math.hypot(W, H) / 2;
    const radial = (stops) => {
      const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, reach);
      stops.forEach(([at, c]) => g.addColorStop(at, c));
      return g;
    };
    // floor: lit in the middle, falling off to near-black at the walls
    ctx.fillStyle = radial([[0, '#111c38'], [0.55, '#080d1b'], [1, '#030408']]);
    ctx.fillRect(0, 0, W, H);
    // a faint wash of this round's border colour so every arena feels different
    ctx.globalAlpha = 0.09;
    ctx.fillStyle = radial([[0, borderColor], [1, 'rgba(0,0,0,0)']]);
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    const lines = (every) => {
      ctx.beginPath();
      for (let x = 0; x <= cols; x += every) { ctx.moveTo(x * cell, 0); ctx.lineTo(x * cell, H); }
      for (let y = 0; y <= rows; y += every) { ctx.moveTo(0, y * cell); ctx.lineTo(W, y * cell); }
      ctx.stroke();
    };
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(80,130,210,0.10)';
    lines(1);
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(95,165,255,0.26)';
    ctx.shadowColor = '#3a8cff'; ctx.shadowBlur = cell * 0.35;
    lines(MAJOR_EVERY);
    // bright nodes where the major lines cross
    ctx.fillStyle = 'rgba(170,215,255,0.6)';
    ctx.beginPath();
    for (let x = MAJOR_EVERY; x < cols; x += MAJOR_EVERY) {
      for (let y = MAJOR_EVERY; y < rows; y += MAJOR_EVERY) {
        ctx.moveTo(x * cell, y * cell);
        ctx.arc(x * cell, y * cell, Math.max(1, cell * 0.07), 0, Math.PI * 2);
      }
    }
    ctx.fill();
    ctx.shadowBlur = 0;

    // vignette
    ctx.fillStyle = radial([[0.55, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.6)']]);
    ctx.fillRect(0, 0, W, H);

    // the outer wall kills, so it must be unmistakable: glowing line, inner
    // echo, and white-hot corner brackets
    ctx.strokeStyle = borderColor; ctx.shadowColor = borderColor;
    ctx.lineWidth = 2; ctx.shadowBlur = cell * 0.9;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.shadowBlur = 0;
    ctx.strokeRect(5, 5, W - 10, H - 10);
    ctx.globalAlpha = 1;
    const arm = cell * 1.6;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.shadowBlur = cell * 0.6; ctx.lineCap = 'square';
    ctx.beginPath();
    for (const [x, y, sx, sy] of [[2, 2, 1, 1], [W - 2, 2, -1, 1], [2, H - 2, 1, -1], [W - 2, H - 2, -1, -1]]) {
      ctx.moveTo(x + sx * arm, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * arm);
    }
    ctx.stroke();
    return canvas;
  }

  // --- light pool: the glow a cycle throws on the floor around it ------------
  function bakePool(color) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96; // a soft gradient survives being scaled up
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.22; ctx.fillStyle = g; // faint: it must never hide the cycle
    ctx.fillRect(0, 0, 96, 96);
    return canvas;
  }

  // Bake the full atlas for the current cell size / colors / border color.
  // Rebake whenever any of those change (round start, resize). Pass cols and
  // rows to also get the arena backdrop. `shapes` names a SHAPES entry per
  // colour, by index; anything missing rides the classic bike.
  function bake({ cell, colors, borderColor, cols, rows, shapes = [] }) {
    const atlas = {
      cell, cycles: {}, cycleFrames: {}, bolts: {}, trails: {}, pickups: {}, pools: {}, beams: {},
      wall: bakeWall(cell, borderColor),
      arena: cols && rows ? bakeArena(cols, rows, cell, borderColor) : null,
      spans: { cycle: 3, bolt: 3, trail: 3, wall: 2, pickup: 3 },
    };
    colors.forEach((color, i) => {
      if (atlas.cycles[color]) return; // same colour listed twice
      atlas.pools[color] = bakePool(color);
      atlas.beams[color] = bakeBeam(color);
      atlas.cycleFrames[color] = bakeCycleFrames(cell, color, SHAPES[shapes[i]] || SHAPES.classic);
      atlas.cycles[color] = atlas.cycleFrames[color][0]; // still image: debris is cut from it
      atlas.bolts[color] = Array.from({ length: BOLT_FRAMES }, (_, i) => bakeBolt(cell, color, i));
      atlas.trails[color] = {};
      for (const key of TRAIL_KEYS) atlas.trails[color][key] = bakeTrailTile(cell, color, key);
    });
    for (const type of Object.keys(PICKUP_COLORS)) atlas.pickups[type] = bakePickup(cell, type);
    return atlas;
  }

  return { __name: 'Sprites', trailKey, bake, TRAIL_KEYS, BOLT_FRAMES, PICKUP_COLORS, SHAPES, SHAPE_NAMES, CYCLE_FRAMES };
});

# Sprite Visual Overhaul — Design

**Date:** 2026-07-05
**Status:** Approved

## Goal

Raise the visual quality of Neon Cycles — cycles, bolts, trails, walls, pickups — using
sprite-style rendering, without adding image assets, a build step, or dependencies.

## Approach: baked procedural sprites

A new browser-only module, `src/sprites.js`, bakes high-detail artwork into offscreen
canvases once per bake (at game start and whenever the cell size changes on resize),
at 3–4× cell resolution so sprites stay crisp when blitted. `renderer.js` then draws
frames by blitting from this atlas with `drawImage` instead of building paths and rects
with per-frame `shadowBlur` (today's dominant canvas cost). Glow is baked into the
sprites, so per-frame shadow work almost disappears — this is a performance win, not
a cost.

## Sprite inventory

- **Cycles** (one per active color): dark body, color-gradient fairing, bright rim-light
  edge, glowing wheel discs with hub detail, canopy highlight, baked multi-layer glow
  halo. Baked once facing right; rotated at blit time via `ctx.rotate` (cheap for one
  sprite per snake per frame).
- **Bolts** (per color): elongated energy projectile — white-hot core, colored plasma
  sheath, tapered tail streak oriented along travel direction. 2–3 baked flicker
  variants cycled by elapsed time.
- **Trail cells** (per color): "light ribbon" tiles — bright core line with soft glow
  edges so trails read as continuous light walls. Straight and corner variants selected
  by neighboring body cells' relative positions.
- **Walls** (border color): beveled dark slab with glowing edge seams, replacing the
  flat 55%-alpha fill. Rebaked when the border color changes (it is random per game).
- **Pickups** (shield / freeze / ammo / phase): hexagonal badge frame with inner glow
  and a drawn icon (shield outline, snowflake, lightning bolt, ghost) replacing the
  monospace letter glyphs. Existing bob animation stays, applied at blit time.

## Renderer integration

`renderer.js` keeps its structure and exported function names. `drawCycle`,
`drawBolts`, `drawSnake` (trail portion), `drawWalls`, and `drawPickups` switch to
atlas blits. Dynamic effects stay procedural because they animate continuously:
flash rings, shield pulse ring, frost overlay, and fade-mode per-cell alpha
(fade alpha is applied via `globalAlpha` on the blit).

`sprites.js` follows the repo's UMD wrapper pattern and exposes a bake API keyed by
color, e.g. `Sprites.bake({ cell, colors, borderColor })` returning an atlas object the
renderer holds. Rebake triggers: round start, window resize (cell change), color or
border-color change.

## Out of scope / unchanged

- All pure logic modules (`geometry`, `snake`, `board`, `walls`, `round`, `match`,
  `cpu`, `speed`, `leaderboard`, `powerups`, `gauntlet`) and their tests.
- Game rules, input, audio, palette API (`COLORS`, `PALETTE`, `pickOpponentColor`).
- No external image files; everything is generated at runtime.

## Files touched

- **New:** `src/sprites.js`
- **Modified:** `src/renderer.js` (blit-based draw functions), `src/main.js` (bake
  wiring on start/resize/color change), `index.html` (new `<script>` tag for
  `sprites.js` before `renderer.js`; version bump), `package.json` (version bump).
- Version goes to **0.6.0** in all three places per the cache-busting rule.

## Testing & verification

`sprites.js` is DOM/canvas-dependent, so like `renderer.js` it gets no `node:test`
unit tests. Verification is visual, via the `neon-cycles-static` preview server:
screenshot cycles (all palette colors, all 4 directions), bolts in flight, trails
(permanent + fade modes, corners), walls at each density, and every pickup type;
confirm no console errors and smooth play in all three game modes. `node --test`
must still pass untouched.

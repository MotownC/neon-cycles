# Neon Light-Cycles ("Snake") — Design Spec

**Date:** 2026-07-01
**Status:** Approved design, pending implementation plan

## Concept

A grid-based light-cycle game with a neon-laser aesthetic. Snakes move
continuously and leave a permanent glowing trail. A snake dies by hitting a
board edge, its own trail, or the opponent's trail. The trail *is* the growing
barrier wall — it never shrinks. Built as a self-contained browser game
(HTML5 Canvas + JavaScript, no build step) with a procedurally generated,
accelerating synth soundtrack.

## Game Modes

### 1 Player — Survival
- One snake (Player 1).
- Objective: survive as long as possible.
- **Score = elapsed survival time** (seconds, shown with sub-second precision).
- Hazards: board edges and the snake's own permanent trail.
- **Leaderboard:** top 10 runs persisted in `localStorage`, ranked by survival
  time. On game over, if the run qualifies for the top 10, prompt for a
  name/initials and insert it. The board is shown on the menu and game-over
  screens.

### 2 Player — Versus (First to 10)
- Two snakes: Player 1 (cyan, WASD), Player 2 (magenta, arrow keys).
- Each round: last snake alive wins the round. Simultaneous crash = draw
  (no point awarded).
- **Match runs until one player reaches 10 round wins.** Match score is shown
  between rounds; reaching 10 triggers a match-over screen declaring the winner.
- Quick replay: brief countdown between rounds.

## Controls
- **Player 1:** W / A / S / D.
- **Player 2:** Arrow keys.
- A snake cannot reverse 180° into its own neck (input that reverses direction
  is ignored).
- Enter or Space: start from menu, advance countdown/round, and replay.
- Directional input is buffered and applied on the next tick (prevents
  double-turn-into-self within a single tick).

## Movement & Rules
- Fixed grid, approximately 64 x 40 cells (final value tuned during
  implementation to fit common screens while keeping cells crisp).
- Each tick a snake advances one cell in its current direction.
- **Speed ramp:** the tick interval starts at a comfortable pace and shortens
  slightly as round elapsed time grows, making snakes progressively faster.
  In 2-player both snakes share the same tick clock, so acceleration is equal
  and fair. Speed ramp is capped at a floor interval so it stays playable.
- Collision resolution per tick, computed on the cell a snake is *about to*
  enter:
  - Off-board (edge) → death.
  - Cell already lit by any trail (own or opponent) → death.
  - Both snakes entering the same empty cell on the same tick → mutual death
    (draw in 2P).
  - Otherwise the cell is lit permanently and the head advances.

## Visual Design (Neon Laser)
- Near-black background with a faint glowing grid.
- Trails drawn with canvas `shadowBlur` glow: a bright core stroke plus a
  colored halo. Distinct palette per player (Player 1 cyan `#00f0ff`,
  Player 2 magenta `#ff00d4` — final hexes tuned for glow).
- Glowing "head" node marks each snake's leading cell.
- Crash feedback: brief screen flash / shake and a neon game-over burst.
- Neon-styled menu, countdown, HUD (survival timer or match score), and
  game-over text.

## Audio (Accelerating Soundtrack)
- Web Audio API, fully procedural — no external audio files.
- A looping synth arpeggio (synthwave / chiptune character).
- **Tempo ramps up with round elapsed time**, rising alongside the snake speed
  ramp so audio tension and difficulty increase together.
- Crash sound effect.
- Audio context is created/resumed on the first user gesture (the Start
  button), satisfying browser autoplay restrictions.

## Screen Flow
1. **Menu:** title, mode select (1 Player / 2 Player), and the 1P leaderboard.
2. **Countdown:** 3-2-1 before each round.
3. **Play:** canvas + HUD (1P survival timer; 2P match score).
4. **Game over / round over:**
   - 1P: final time, leaderboard, name entry if qualifying, replay.
   - 2P: round result and updated match score; next round or, at 10 wins,
     match-over screen with the match winner and replay.

## Code Structure (no build step — open `index.html` directly)
Plain files loaded with regular `<script>` tags so the game runs from
`file://` without a bundler or dev server. Logic is split into focused,
independently understandable units:

- `index.html` — page shell, canvas, menu/overlay markup.
- `styles.css` — neon styling for shell and overlays.
- **Game logic (pure, unit-testable):** grid model, snake stepping, collision
  detection, and round/match/win-draw resolution — no DOM or canvas
  dependencies.
- **Renderer:** all canvas drawing and neon effects.
- **Input:** keyboard handling and direction buffering.
- **Audio:** synth engine, tempo ramp, and SFX.
- **Leaderboard:** `localStorage` read/write and ranking.
- **Main loop:** wires state, input, renderer, and audio together; owns the
  tick timing and speed ramp.

## Testing
Lightweight tests for the pure game-logic units:
- Collision detection (edge, self-trail, opponent-trail, mutual/draw).
- Snake stepping and direction/neck-reversal rules.
- Round-win and match-win (first-to-10) resolution.
- Leaderboard insertion, ranking, and top-10 truncation.

## Out of Scope for v1 (YAGNI)
- AI opponent for solo play.
- Online / networked multiplayer.
- Power-ups or items.
- Server-backed or cross-device leaderboard (local only).
- Configurable key remapping.

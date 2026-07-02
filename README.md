# Neon Cycles

A neon light-cycle game. Snakes leave permanent glowing trails — hit any wall,
your own trail, or your opponent's and you crash.

## Play

Open `index.html` in a modern browser (no build step, no server needed).

- **1 Player — Survival:** last as long as you can; times go on a local
  leaderboard.
- **2 Player — First to 10:** win rounds until someone reaches 10.

## Controls

- **Player 1:** W A S D
- **Player 2:** Arrow keys
- **Enter / Space:** start, next round, back to menu

Music and snake speed ramp up the longer a round lasts.

## Develop / Test

Pure game logic is in `src/*.js` (DOM-free) with tests under `tests/`:

    node --test

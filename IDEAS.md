# Neon Cycles — 10 Ideas to Take It to the Next Level

Based on a full review of the codebase (v0.4.4). The engine is well positioned for all of
these: the tick loop is deterministic and fixed-step, game logic lives in pure tested
modules, `Round.createRound` already accepts an arbitrary list of snake specs, and the
board is a sparse `Set` of lit cells — cheap to add and remove things from.

---

## 1. ⚡ Derezzer Cannon — projectile combat (the shooting mechanic)

Give each cycle a forward-firing energy bolt. This is the single biggest gameplay
transformer because it breaks the one thing that currently decides every duel: whoever
gets walled in first loses. Bullets create *counterplay*.

**How it plays:**
- Press a fire key (e.g. P1 `/`, P2 `Q`) to launch a bolt from the head, traveling in the
  snake's current direction at ~3× snake speed, one cell per bullet-tick.
- **Trail cutting, not instakill:** when a bolt hits a trail (yours, theirs, or an interior
  wall), it "derezzes" a 3-cell gap — unlighting those cells and opening an escape route.
  Suddenly being boxed in is survivable *if* you saved ammo, and you can carve shortcuts
  through the opponent's territory. This is far more interesting than a hit-scan kill.
- **Direct head hit = stun**, not death: the victim is locked to the slow tick for ~2s
  (reuse the turbo interval machinery in reverse). Kills still come from crashes — bullets
  set them up rather than replace them.
- **Ammo economy:** start each round with 1 bolt; earn another every N survived seconds or
  by claiming pickups (idea #3). Scarcity keeps it tactical, not a bullet-hell.

**Why the engine likes it:** `Board.unlight` already exists (currently only used by the
CPU's speculative scoring). Bullets are just `{pos, dir}` entities advanced in the tick
loop with `Geometry.nextHead` and collision-checked with `Board.isLit`. A pure
`projectile.js` module slots straight into the UMD pattern with `node:test` coverage. The
CPU can be taught to fire when `scoreMove` shows it's losing territory — a natural
extension of the existing Voronoi heuristic.

---

## 2. Trail decay modes (Classic / Tron / Fade)

Right now trails are permanent (pure Tron). Add a menu toggle:
- **Tron** — current behavior.
- **Fade** — trail cells expire after ~8s, so the arena keeps breathing and rounds are
  won by pressure, not just patience.
- **Classic Snake** — fixed trail length that follows you, for players who grew up on Nokia.

Cheap to build: store a timestamp/tick per lit cell (upgrade the `Set` to a `Map`) and
sweep expiries in `Round.tick`. Each mode radically changes optimal play, which multiplies
replay value for free. Fade mode also synergizes with the cannon — cut trails that also
heal creates territory that shifts constantly.

## 3. Power-up pickups on the grid

Glowing cells spawn periodically in open space; drive over one to claim it:
- **Phase Shift** — pass through one trail segment (ghost through walls once).
- **Shield** — survive one collision (bounce into the last-safe direction).
- **EMP** — opponent's steering is locked straight for 1.5s (terrifying at high speed).
- **Ammo cell** — +1 cannon bolt (ties into idea #1).
- **Trail eraser** — instantly derez the oldest 30% of your own trail.

Pickups are the standard tool great snake games (slither.io, Curve Fever) use to create
moment-to-moment decisions: "do I detour for that shield while it's near his wall?"
Spawn logic can reuse `Walls`' spawn-safe-zone code, and `Board.distanceMap` can verify a
pickup is actually reachable by both players (fairness).

## 4. Online multiplayer via lockstep WebRTC

The engine is *already* a deterministic fixed-tick simulation with buffered inputs — the
exact architecture lockstep netcode wants. Exchange only input events per tick over a
WebRTC data channel (peer-to-peer, no game server; a tiny signaling service or manual
copy-paste "join code" handles connection). Both clients run identical simulations, and
the existing trace ring buffer becomes your desync debugger. This is the feature that
turns a couch demo into a game people send links to.

## 5. CPU personalities and difficulty ladder

One Voronoi CPU is great; a *cast of rivals* is a campaign:
- **Difficulty knobs already in the code:** `STRAIGHT_BONUS`, `HEADON_PENALTY`, and how
  often the CPU gets to re-decide are all tunable. Add lookahead depth (score 2–3 plies
  of moves) for a "Grandmaster" tier.
- **Personalities:** an *Aggressor* that weights cutting off your reachable area, a
  *Survivor* that maximizes its own `openArea`, an *Ambusher* that hoards turbo/ammo and
  strikes when your escape routes drop below a threshold.
- Present them as named opponents with distinct cycle colors and taunt lines — a
  best-of-N gauntlet gives solo players a progression path beyond the survival timer.

## 6. Dynamic arenas and hazards

Wall density is a good start; make the board itself an opponent:
- **Shrinking ring** — after 30s the outer boundary starts closing in one ring at a time
  (battle-royale pressure; also caps round length).
- **Portals** — paired cells that teleport you across the map, preserving direction.
  Trivial in `Geometry.nextHead` terms, huge for strategy.
- **Wraparound mode** — edges connect (classic snake wrap); completely changes the
  Voronoi math and gives the CPU a fun new brain teaser.
- **Moving walls** — the mirrored wall generator already exists; let segments slide one
  cell every N ticks on a telegraphed track.

## 7. Juice pass: derez particles, kill-cam, and instant replay

The crash flash/shake and ducked audio are a great foundation. Next tier:
- **Derez explosion** — the losing trail shatters into particles that scatter and fade
  (iterate the body array; the renderer already knows every cell).
- **Slow-mo kill-cam** — on round end, replay the final 20 ticks at quarter speed with a
  zoom toward the crash cell. The `window.__trace` ring buffer *already records* recent
  directions/positions — it's 80% of a replay system that currently only prints JSON.
- **Ghost replay in Survival** — race the translucent ghost of your leaderboard best run.
  Record the input log (tiny), re-simulate it live alongside you. Deterministic engine
  makes this nearly free and it's the single best retention feature for solo mode.

## 8. Daily challenge with shareable seeds

`Walls.generate` and `CPU.chooseDirection` both already accept an injectable `rand` —
the codebase is one seeded PRNG away from reproducible rounds. Every day, everyone in
the world gets the same seed: same walls, same CPU behavior. Show your survival time
with a share string ("NEON CYCLES #147 — 73.2s 🏍️") Wordle-style. Add an all-time seed
input box so friends can duel the exact same arena. Zero backend required.

## 9. Touch and gamepad support

Right now the game is keyboard-only, which locks out phones/tablets and couch play:
- **Touch:** swipe anywhere to steer (map swipe vector to `Input.onDirection`), hold a
  second finger for turbo, tap a HUD button to fire. The canvas-fit code already handles
  arbitrary viewport sizes.
- **Gamepad API:** d-pad/stick steering, trigger for turbo, face button for the cannon.
  Two pads = proper couch versus without keyboard crowding.
`input.js` is already a clean abstraction boundary — new input sources plug into the same
three callbacks without touching game logic.

## 10. Party modes: 3–4 players and team battles

`Round.createRound` takes an arbitrary `specs` array and the tick engine iterates snakes
generically — the 2-player limit is purely a `main.js`/input decision. Add:
- **4-player free-for-all** (2 keyboards' worth of keys + gamepads from idea #9), last
  cycle riding wins, with the shrinking ring (idea #6) to force endings.
- **2v2 teams** — teammates' trails don't kill you (or better: you *can* pass through a
  teammate's trail once per round). The CPU already generalizes, so 1-3 humans + CPU
  fill-ins work.
- **Score modifiers** — king-of-the-hill zones worth bonus round points, or "longest
  trail at 60s wins" as an alternate victory condition.

---

## Suggested sequencing

| Phase | Ideas | Why first |
|-------|-------|-----------|
| 1 | #2 trail modes, #3 pickups, #7 juice | Pure-module work, immediate feel upgrade |
| 2 | #1 derezzer cannon, #5 CPU rivals | Builds on pickups + ammo economy; headline feature |
| 3 | #8 daily seed, #9 touch/gamepad | Distribution and audience growth |
| 4 | #6 dynamic arenas, #10 party modes | Content breadth |
| 5 | #4 online multiplayer | Biggest lift; land determinism-sensitive features first |

The through-line: every idea leans on strengths the codebase already has — deterministic
ticks, injectable randomness, pure tested modules, N-snake rounds, and an `unlight`
primitive that's been waiting for a reason to exist.

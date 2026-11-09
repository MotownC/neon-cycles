(function () {
  const COLS = 64, ROWS = 40, MATCH_TARGET = 5;
  const canvas = document.getElementById('game');
  const stage = document.getElementById('stage');
  let cell, ctx;

  function fitCanvas() {
    const f = Renderer.fit(canvas, COLS, ROWS); cell = f.cell; ctx = f.ctx;
    // the HUD lines up with the arena's top corners, not the window's
    hud.style.width = canvas.style.width;
    hud.style.top = `${Math.max(0, (window.innerHeight - ROWS * cell) / 2)}px`;
  }

  const el = (id) => document.getElementById(id);
  const menu = el('menu'), countdown = el('countdown'), hud = el('hud'),
        gameover = el('gameover'), countSpan = el('count'),
        titleScreen = el('title'), menuArt = el('menu-art'),
        goTitle = el('go-title'), goBody = el('go-body');

  function freshTurbo() {
    return {
      held: false,          // is the shift key currently pressed?
      fuel: Speed.TURBO_FUEL_SEC,  // seconds of turbo remaining
      cooldown: 0,          // seconds of cooldown remaining
      acc: 0,               // turbo tick accumulator (ms)
    };
  }

  // Presentation for each CPU rival; the matching behavior weights live in
  // CPU.PERSONALITIES under the same keys (pure logic stays DOM-free).
  const RIVALS = {
    drifter: { name: 'DRIFTER', color: '#39ff6a',
      win: 'DRIFTER: whoa, did I do that?', lose: 'DRIFTER: hey, I wasn’t even looking.' },
    survivor: { name: 'SURVIVOR', color: '#fff23b',
      win: 'SURVIVOR: outlast. outlive. outride.', lose: 'SURVIVOR: I’ll be back for the next one.' },
    aggressor: { name: 'AGGRESSOR', color: '#ff3b3b',
      win: 'AGGRESSOR: your grid. MY grid now.', lose: 'AGGRESSOR: lucky wall. rematch.' },
    ambusher: { name: 'AMBUSHER', color: '#b06bff',
      win: 'AMBUSHER: you never saw it coming.', lose: 'AMBUSHER: noted. adjusting the trap.' },
    grandmaster: { name: 'GRANDMASTER', color: '#f2f6ff',
      win: 'GRANDMASTER: I saw that twelve moves ago.', lose: 'GRANDMASTER: ...an inefficiency. corrected next round.' },
  };

  // The one setting that's remembered: it depends on the machine, not the mood.
  const GFX_KEY = 'neon-cycles-gfx';
  function savedGfx() {
    try { return window.localStorage.getItem(GFX_KEY) === 'low' ? 'low' : 'high'; } catch (e) { return 'high'; }
  }

  const state = {
    phase: 'title', mode: '1p', round: null, match: null,
    elapsed: 0, acc: 0, boltAcc: 0, last: 0, raf: null, wallDensity: 'low',
    matchTarget: MATCH_TARGET,
    skillLevel: 2, // menu default; Speed.DEFAULT_SKILL stays the baseline speed
    flashes: [], // transient visual markers for bolt cut/kill/bounce outcomes
    recorder: null, // recent sim frames, read back by the crash replay
    replay: null, // { playback, sec } while the 'replay' phase is running
    actionLockUntil: 0, // performance.now() before which Enter is ignored on a result screen
    countdownTimer: null, // so quitting mid-countdown can stop it starting the round
    trailMode: 'tron',
    musicTrack: 'sfx',
    playerColor: '#ff9d2b', colors: Renderer.COLORS,
    borderColor: '#ff2b4a',
    atlas: null, // baked sprite atlas, rebaked on round start and resize
    turbo: [freshTurbo(), freshTurbo()],
    rival: 'random',
    activeRival: null, // resolved rival key for the current round, when rival === 'random'
    gauntlet: null, // active Gauntlet run, only in gauntlet mode
    online: null, // { seed, settings, youAre, session, pending, roundNumber, localReady, remoteReady, stallSince, lagging }
    attract: null, // decorative menu-screen loop; see initAttract()
    menuSelected: null, // menu element highlighted for keyboard/controller selection
    particles: Particles.createSystem(), // cosmetic sparks and flame; see particles.js
    shapes: ['classic', 'classic'], // bike silhouette per snake; see Sprites.SHAPES
    gfx: savedGfx(), // 'high' adds bloom and per-frame lighting; 'low' is for slow machines
  };

  // Both CPU-driven modes share the same input/AI plumbing; they differ only
  // in which rival is at the controls and what happens when a match ends.
  function vsCpu() { return state.mode === 'cpu' || state.mode === 'gauntlet'; }
  function rivalKey() {
    if (state.mode === 'gauntlet') return Gauntlet.STAGES[state.gauntlet.stage];
    return state.rival === 'random' ? state.activeRival : state.rival;
  }

  // Reroll the CPU rival for a new round when the player picked RANDOM,
  // avoiding an immediate repeat so it actually reads as "a different rival".
  function rollRival() {
    const keys = Object.keys(RIVALS).filter((k) => k !== state.activeRival);
    state.activeRival = keys[(Math.random() * keys.length) | 0];
  }

  // Online mode is only live once a start message has populated state.online
  // (after an abort we can be back at the menu with mode still 'online').
  function isOnline() { return state.mode === 'online' && state.online !== null; }
  // Online: the host's skill level rides in the shared settings so both
  // machines run the sim at the same tick interval.
  function skillLevel() {
    return isOnline() ? state.online.settings.skillLevel : state.skillLevel;
  }

  // Field-debug ring buffer: recent inputs and applied directions, dumped to
  // the console on every crash so control issues can be diagnosed from a
  // pasted trace instead of guesswork.
  const trace = [];
  window.__trace = trace; // inspectable from the console at any time
  function tr(entry) { trace.push(entry); if (trace.length > 64) trace.shift(); }

  function show(node) { for (const o of [menu, countdown, gameover, titleScreen]) o.classList.add('hidden');
    if (node) node.classList.remove('hidden');
    menuArt.classList.toggle('hidden', node !== menu); }

  function newRound() {
    const specs = state.mode === '1p'
      ? [{ start: { x: (COLS/2)|0, y: (ROWS/2)|0 }, direction: 'right' }]
      : [{ start: { x: (COLS*0.25)|0, y: (ROWS/2)|0 }, direction: 'right' },
         { start: { x: (COLS*0.75)|0, y: (ROWS/2)|0 }, direction: 'left' }];
    const online = isOnline() ? state.online : null;
    const walls = Walls.generate(COLS, ROWS,
      online ? online.settings.wallDensity : state.wallDensity,
      online ? Net.mulberry32((online.seed + online.roundNumber) >>> 0) : Math.random);
    state.round = Round.createRound(COLS, ROWS, specs, walls,
      online ? online.settings.trailMode : state.trailMode);
    state.round.hazard = state.mode === '1p' ? Hazard.createHazard(COLS, ROWS) : null;
    if (online) {
      online.session = Net.createSession(online.youAre);
      online.pending = [];
      online.stallSince = null;
      online.lagging = false;
    }
    if (state.mode === 'cpu' && state.rival === 'random') rollRival();
    // A rival rides its signature color unless the player claimed it first.
    const rivalColor = vsCpu() ? RIVALS[rivalKey()].color : null;
    state.colors = [state.playerColor,
      rivalColor && rivalColor !== state.playerColor ? rivalColor : Renderer.pickOpponentColor(state.playerColor)];
    if (online && online.youAre === 1) {
      // Colors are local cosmetics: your menu pick always paints YOUR snake.
      state.colors = [Renderer.pickOpponentColor(state.playerColor), state.playerColor];
    }
    state.borderColor = Renderer.randomBorderColor();
    // Each CPU rival rides its own bike; humans ride the classic.
    state.shapes = ['classic', vsCpu() ? rivalKey() : 'classic'];
    state.elapsed = 0; state.acc = 0; state.boltAcc = 0; state.last = performance.now();
    state.flashes = [];
    state.recorder = Replay.createRecorder();
    state.replay = null;
    recordFrame();
    state.turbo = [freshTurbo(), freshTurbo()];
    glides = [null, null]; scrapes = [[], []];
    state.particles = Particles.createSystem();
    fitCanvas();
    state.atlas = Sprites.bake({ cell, colors: state.colors, borderColor: state.borderColor, cols: COLS, rows: ROWS, shapes: state.shapes });
    paint(); // the new arena shows behind the countdown
  }

  // One finished frame: the scene, then bloom over it on HIGH graphics.
  function paint(view = state.round, t = state.elapsed, flashes = state.flashes) {
    Renderer.render(ctx, view, cell, state.colors, state.borderColor, t, flashes, state.atlas, state.gfx);
    Renderer.drawParticles(ctx, state.particles.items, cell);
    if (state.gfx === 'high') Renderer.bloom(ctx);
  }

  // Per snake: the glide its last tick started, if it moved (see glide.js).
  let glides = [null, null];

  // Run a sim tick and note which snakes it moved; `only` limits that to one snake.
  function tickGliding(run, only) {
    const snakes = state.round.snakes;
    const indices = only === undefined ? snakes.map((_, i) => i) : [only];
    const before = indices.map((i) => Glide.snapshot(snakes[i]));
    run();
    indices.forEach((i, k) => {
      glides[i] = Glide.note(before[k], snakes[i]);
      scrapes[i] = glides[i] ? closeSides(snakes[i]) : [];
      if (glides[i] && before[k].direction !== snakes[i].direction) {
        Particles.turnSparks(state.particles, before[k], before[k].direction, state.colors[i], Math.random);
      }
    });
  }

  // Per snake: which of its two sides are right up against a wall or trail.
  let scrapes = [[], []];
  function closeSides(snake) {
    const h = snake.body[snake.body.length - 1], v = Geometry.vector(snake.direction);
    return [{ x: -v.y, y: v.x }, { x: v.y, y: -v.x }]
      .filter((side) => Board.wouldCollide(state.round.board, { x: h.x + side.x, y: h.y + side.y }));
  }

  // Sparks and flame that follow the cycles as drawn. Cosmetic only, so
  // Math.random is fine even online.
  const EXHAUST_PER_SEC = 110, SCRAPE_PER_SEC = 45;
  function emitCycleFx(view, dtSec, frozen) {
    view.snakes.forEach((s, i) => {
      if (!s.alive || frozen.includes(i)) return;
      const pos = s.cycleAt || s.body[s.body.length - 1];
      if (isBoosting(i)) {
        Particles.exhaust(state.particles, pos, s.direction, state.colors[i],
          Particles.howMany(EXHAUST_PER_SEC, dtSec, Math.random), Math.random);
      }
      scrapes[i].forEach((side) => Particles.scrape(state.particles, pos, s.direction, side,
        Particles.howMany(SCRAPE_PER_SEC, dtSec, Math.random), Math.random));
    });
  }

  function fireFx(i) {
    Audio.fireSfx();
    const s = state.round.snakes[i];
    Particles.muzzle(state.particles, s.body[s.body.length - 1], s.direction, state.colors[i], Math.random);
  }

  // The round as drawn this frame: cycles part-way between cells.
  function glidingRound(dt, normalInt, turboInt) {
    const snakes = state.round.snakes.map((s, i) => {
      Glide.advance(glides[i], isOnline() ? state.acc : state.turbo[i].acc, dt);
      const drawn = Glide.view(s, glides[i], isBoosting(i) ? turboInt : normalInt);
      return isBoosting(i) && s.alive ? { ...drawn, boosting: true } : drawn;
    });
    return { ...state.round, snakes };
  }

  // Decorative menu-screen loop: a cycle tracing a box around the mode
  // buttons, entirely separate from real game state (state.round). A closed
  // rectangle can never self-intersect, so there's no crash/respawn to
  // handle — it just loops forever while state.phase === 'menu'.
  const ATTRACT_BOX_PADDING = 2; // cells of clearance around the buttons
  const ATTRACT_TICK_MS = Speed.BASE_MS;

  function computeAttractBox() {
    const canvasRect = canvas.getBoundingClientRect();
    const btnRect = document.querySelector('.menu-buttons').getBoundingClientRect();
    const pad = ATTRACT_BOX_PADDING;
    return {
      left: Math.max(0, Math.floor((btnRect.left - canvasRect.left) / cell) - pad),
      top: Math.max(0, Math.floor((btnRect.top - canvasRect.top) / cell) - pad),
      right: Math.min(COLS - 1, Math.ceil((btnRect.right - canvasRect.left) / cell) + pad),
      bottom: Math.min(ROWS - 1, Math.ceil((btnRect.bottom - canvasRect.top) / cell) + pad),
    };
  }

  function initAttract() {
    if (!cell) fitCanvas();
    const corners = Attract.corners(computeAttractBox());
    const board = Board.createBoard(COLS, ROWS, []);
    const head = { ...corners[0], t: 0 };
    Board.light(board, head);
    state.attract = {
      board, corners, targetIndex: 1, colorIndex: 0, elapsed: 0, acc: 0,
      snake: { body: [head], direction: 'right' },
      // the menu cycle changes colour each lap, and shows off a different bike with it
      atlas: Sprites.bake({ cell, colors: Renderer.PALETTE, borderColor: '#000',
        shapes: Renderer.PALETTE.map((_, i) => Sprites.SHAPE_NAMES[i % Sprites.SHAPE_NAMES.length]) }),
    };
  }

  function advanceAttract(dtSec) {
    const a = state.attract;
    a.elapsed += dtSec;
    a.acc += dtSec * 1000;
    while (a.acc >= ATTRACT_TICK_MS) {
      a.acc -= ATTRACT_TICK_MS;
      const head = a.snake.body[a.snake.body.length - 1];
      const step = Attract.step(a.corners, head, a.targetIndex);
      a.snake.direction = step.direction;
      a.targetIndex = step.targetIndex;
      const nextCell = { ...step.head, t: a.elapsed };
      a.snake.body.push(nextCell);
      Board.light(a.board, nextCell);
      Trail.trim(a.snake, a.board, 'fade', a.elapsed);
      if (step.completedLap) a.colorIndex = (a.colorIndex + 1) % Renderer.PALETTE.length;
    }
  }

  function renderAttract() {
    const a = state.attract;
    Renderer.clearBackground(ctx, COLS, ROWS, cell);
    const body = a.snake.body;
    const snake = body.length > 1
      ? Glide.view(a.snake, { from: body[body.length - 2], fromDir: a.snake.direction, ms: a.acc }, ATTRACT_TICK_MS)
      : a.snake;
    Renderer.drawSnake(ctx, snake, Renderer.PALETTE[a.colorIndex], cell, 'fade', a.elapsed, false, a.atlas);
  }

  // The matchup shown over the countdown: who you're about to face.
  function matchupLine() {
    if (state.mode === '1p') return 'SURVIVE';
    if (state.mode === 'gauntlet') {
      return `RIVAL ${state.gauntlet.stage + 1} OF ${Gauntlet.STAGES.length} \u2014 ${RIVALS[rivalKey()].name}`;
    }
    return `${label(0)}  VS  ${label(1)}`;
  }

  // Restart a one-shot CSS animation on a node.
  function punch(node) {
    node.classList.remove('punch');
    void node.offsetWidth;
    node.classList.add('punch');
  }

  let goTimer = null;
  function flashGo() {
    const go = el('go-flash');
    go.classList.remove('hidden');
    punch(go);
    clearTimeout(goTimer);
    goTimer = setTimeout(() => go.classList.add('hidden'), 700);
  }

  function startCountdown() {
    state.phase = 'countdown'; hud.classList.add('hidden'); show(countdown);
    el('count-sub').textContent = matchupLine();
    let n = 3; countSpan.textContent = n; punch(countSpan);
    state.countdownTimer = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(state.countdownTimer); show(null); hud.classList.remove('hidden');
        state.phase = 'playing'; state.last = performance.now(); Audio.start(state.musicTrack); flashGo(); }
      else { countSpan.textContent = n; punch(countSpan); }
    }, 700);
  }

  // One player's HUD panel (markup from hud.js). Online has no turbo or
  // bolts, and CPU rivals never boost, so those bars are left out for them.
  function hudPanel(index, side, name, score, sub = '') {
    const snake = state.round.snakes[index];
    const chips = [];
    if (snake.shield) chips.push('SHIELD');
    if (snake.phase) chips.push('PHASE');
    const frozenUntil = state.round.frozenUntil && state.round.frozenUntil[index];
    if (frozenUntil && state.elapsed < frozenUntil) chips.push(`FROZEN ${Math.ceil(frozenUntil - state.elapsed)}s`);
    const extras = !isOnline();
    return Hud.panel({
      side, color: state.colors[index], name, score, chips, sub,
      rounds: state.mode === '1p' ? null : Hud.rounds(state.match.scores[index], state.match.target),
      turbo: extras && !(index === 1 && vsCpu())
        ? Hud.turboMeter(state.turbo[index], Speed.TURBO_FUEL_SEC, Speed.TURBO_COOLDOWN_SEC) : null,
      ammo: extras
        ? { have: Projectile.ammoAvailable(state.elapsed, state.round.firedCount[index]), cap: Projectile.AMMO_CAP } : null,
    });
  }

  function updateHud() {
    if (state.mode === '1p') { hud.innerHTML = hudPanel(0, 'left', 'TIME', state.elapsed.toFixed(1)); return; }
    const scores = state.match.scores;
    if (isOnline()) {
      const y = state.online.youAre;
      hud.innerHTML = hudPanel(y, 'left', 'YOU', scores[y])
        + hudPanel(1 - y, 'right', 'FRIEND', scores[1 - y], state.online.lagging ? 'CONNECTION LAGGING\u2026' : '');
      return;
    }
    const names = vsCpu() ? ['YOU', RIVALS[rivalKey()].name] : ['P1', 'P2'];
    const sub = state.mode === 'gauntlet' ? `RIVAL ${state.gauntlet.stage + 1}/${Gauntlet.STAGES.length}` : '';
    hud.innerHTML = hudPanel(0, 'left', names[0], scores[0]) + hudPanel(1, 'right', names[1], scores[1], sub);
  }

  // Results screen: the card glows in the winner's colour (pale on a draw).
  function resultTone(color) { gameover.style.setProperty('--win', color || '#eaf6ff'); }
  function scoreboard(caption) {
    return Hud.scoreboard(caption, [0, 1].map((i) => ({ name: label(i), score: state.match.scores[i], color: state.colors[i] })));
  }

  function label(index) {
    if (isOnline()) return index === state.online.youAre ? 'YOU' : 'FRIEND';
    if (!vsCpu()) return `PLAYER ${index + 1}`;
    return index === 0 ? 'YOU' : RIVALS[rivalKey()].name;
  }

  // Flavor line from the rival after a decided round; silent on draws.
  function tauntLine() {
    if (!vsCpu() || state.round.winnerIndex === null) return '';
    const rival = RIVALS[rivalKey()];
    const quip = state.round.winnerIndex === 1 ? rival.win : rival.lose;
    return `<p class="hint" style="color:${state.colors[1]}">${quip}</p>`;
  }

  // Name what actually killed each snake so a pasted trace settles it.
  function crashVerdicts() {
    return state.round.snakes.map((s) => {
      if (s.alive) return 'alive';
      if (s.crushedByHazard) return 'caught by the closing arena';
      if (s.shotBy !== undefined) return `shot down by ${label(s.shotBy)}'s bolt`;
      const head = s.body[s.body.length - 1];
      const target = Geometry.nextHead(head, s.pendingDirection);
      if (!Board.inBounds(state.round.board, target)) return 'hit boundary wall';
      const hit = (body) => body.some((c) => c.x === target.x && c.y === target.y);
      if (hit(s.body)) return 'hit own trail';
      if (hit(state.round.board.walls || [])) return 'hit interior wall';
      if (state.round.snakes.some((o) => o !== s && hit(o.body))) return 'hit opponent trail';
      return 'head-on collision';
    });
  }

  // Read-only snapshot for the crash replay; safe on the online path.
  function recordFrame() { Replay.record(state.recorder, state.round, state.elapsed, state.flashes); }

  function endRound() {
    const verdicts = crashVerdicts();
    // dump slightly late so presses arriving just after the crash are included
    // label with the live version from the menu so pasted traces can't lie about which build produced them
    setTimeout(() => console.log(`crash trace ${el('version').textContent}:`, JSON.stringify({ verdicts, trace })), 600);
    Audio.crash(); flashCrash();
    state.round.snakes.forEach((s, i) => {
      if (!s.alive) Input.rumble(i, { duration: 300, strong: 0.8, weak: 0.4 });
    });
    if (state.mode !== '1p') Match.awardRound(state.match, state.round.winnerIndex);
    updateHud();
    // Cosmetic debris only, so Math.random is fine even online.
    state.replay = { playback: Replay.createPlayback(state.recorder, Math.random), sec: 0 };
    state.phase = 'replay'; state.last = performance.now();
  }

  function advanceReplay(now) {
    const r = state.replay;
    const dtSec = Math.min(now - state.last, 250) / 1000; state.last = now;
    r.sec += dtSec;
    const at = Replay.stageAt(r.playback, r.sec);
    if (at.stage === 'done') return showResult();
    const replaying = at.stage === 'replay';
    const view = replaying ? Replay.viewAt(r.playback, at.simT) : Replay.wreckedView(r.playback, at.age);
    Renderer.render(ctx, view, cell, state.colors, state.borderColor, replaying ? at.simT : view.t,
      replaying ? view.flashes : [], state.atlas, state.gfx);
    if (!replaying) Renderer.drawDebris(ctx, r.playback.debris, at.age, state.colors, cell, state.atlas);
    // sparks still in the air when the crash hit finish their flight, then the replay runs clean
    if (at.stage === 'explode') {
      Particles.step(state.particles, dtSec);
      Renderer.drawParticles(ctx, state.particles.items, cell);
    } else state.particles.items = [];
    if (state.gfx === 'high') Renderer.bloom(ctx); // before the banner, so the text stays crisp
    if (at.stage !== 'explode') Renderer.drawReplayBanner(ctx, COLS, ROWS, cell);
  }

  // Past this delay a press is aimed at the screen; before it, it's a late
  // press meant for the replay that just ended.
  const RESULT_ACTION_LOCK_MS = 250;

  // The frame left behind the results card: the arena once the blast has
  // cleared (wreck and its trail gone), with no replay banner on it.
  function paintAftermath() {
    if (!state.replay) return;
    const view = Replay.wreckedView(state.replay.playback, Replay.IMPACT_SEC);
    Renderer.render(ctx, view, cell, state.colors, state.borderColor, view.t, [], state.atlas, state.gfx);
    if (state.gfx === 'high') Renderer.bloom(ctx);
  }

  function showResult() {
    paintAftermath();
    state.replay = null; state.phase = 'roundover';
    state.actionLockUntil = performance.now() + RESULT_ACTION_LOCK_MS;
    if (state.mode === '1p') return finishSolo();
    if (state.match.over) return state.mode === 'gauntlet' ? finishGauntletStage() : finishMatch();
    show(gameover);
    resultTone(state.round.winnerIndex === null ? null : state.colors[state.round.winnerIndex]);
    goTitle.textContent = state.round.winnerIndex === null ? 'DRAW'
      : `${label(state.round.winnerIndex)} WINS ROUND`;
    goBody.innerHTML = scoreboard('MATCH') + tauntLine();
    el('go-continue').textContent = 'PRESS ENTER FOR NEXT ROUND';
  }

  function finishMatch() {
    show(gameover);
    resultTone(state.colors[state.match.winnerIndex]);
    goTitle.textContent = `${label(state.match.winnerIndex)} WINS THE MATCH`;
    goBody.innerHTML = scoreboard('FINAL') + tauntLine();
    el('go-continue').textContent = 'PRESS ENTER FOR MENU';
    state.phase = 'gameover';
  }

  // A gauntlet stage match just ended: advance the ladder or end the run.
  // The beaten/beating rival is read before resolveMatch moves the stage.
  function finishGauntletStage() {
    const g = state.gauntlet;
    const fought = RIVALS[Gauntlet.STAGES[g.stage]];
    const stageNum = g.stage + 1;
    const total = Gauntlet.STAGES.length;
    Gauntlet.resolveMatch(g, state.match.winnerIndex);
    show(gameover);
    resultTone(state.colors[!g.over || g.victory ? 0 : 1]);
    if (!g.over) {
      const next = RIVALS[Gauntlet.STAGES[g.stage]];
      goTitle.textContent = `${fought.name} DEREZZED`;
      goBody.innerHTML = `<p>RIVAL ${stageNum} OF ${total} DEFEATED</p>`
        + `<p class="hint" style="color:${state.colors[1]}">${fought.lose}</p>`
        + `<p>NEXT: ${next.name}</p>`;
      el('go-continue').textContent = 'PRESS ENTER FOR NEXT RIVAL';
      state.match = Match.createMatch(Gauntlet.STAGE_TARGET);
      return; // phase stays roundover: Enter starts the next rival's match
    }
    const best = Gauntlet.saveBest(window.localStorage, g.stage);
    if (g.victory) {
      goTitle.textContent = 'GRID CHAMPION';
      goBody.innerHTML = `<p>ALL ${total} RIVALS DEREZZED</p>`;
    } else {
      goTitle.textContent = `DEREZZED BY ${fought.name}`;
      goBody.innerHTML = `<p>FELL AT RIVAL ${stageNum} OF ${total}</p>`
        + `<p class="hint" style="color:${state.colors[1]}">${fought.win}</p>`
        + `<p class="hint">BEST RUN: ${best} OF ${total} RIVALS DEFEATED</p>`;
    }
    el('go-continue').textContent = 'PRESS ENTER FOR MENU';
    state.phase = 'gameover';
  }

  function finishSolo() {
    const time = Number(state.elapsed.toFixed(1));
    let board = Leaderboard.load(window.localStorage);
    show(gameover); resultTone(state.colors[0]); goTitle.textContent = 'GAME OVER';
    const survived = `<p class="result-big">SURVIVED<b>${time.toFixed(1)}s</b></p>`;
    goBody.innerHTML = survived + renderBoard(board);
    el('go-continue').textContent = 'PRESS ENTER FOR MENU';
    state.phase = 'gameover';
    if (Leaderboard.qualifies(board, time)) {
      // prompt() blocks the tab until dismissed, which can stall the just-triggered
      // crash SFX in some browsers — delay it past the SFX's ~1.6s duration. Guard
      // against the player already having moved on (e.g. back to the menu) by then.
      setTimeout(() => {
        if (state.phase !== 'gameover') return;
        const name = (prompt(`New high score: ${time}s! Enter name:`, 'YOU') || 'YOU');
        board = Leaderboard.insert(window.localStorage, board, name, time);
        goBody.innerHTML = survived + renderBoard(board);
      }, 1600);
    }
  }

  function flashCrash() {
    stage.classList.remove('crash');
    void stage.offsetWidth; // restart the CSS animation even if triggered again quickly
    stage.classList.add('crash');
    setTimeout(() => stage.classList.remove('crash'), 350);
  }

  function renderBoard(board) {
    if (!board.length) return '';
    const rows = board.map((r, i) =>
      `<div class="row"><span>${i+1}. ${r.name}</span><span>${r.time.toFixed(1)}s</span></div>`).join('');
    return `<div class="leaderboard"><h3>LEADERBOARD</h3>${rows}</div>`;
  }

  function updateTurbo(dtSec) {
    for (let i = 0; i < state.turbo.length; i++) {
      const t = state.turbo[i];
      if (t.cooldown > 0) {
        t.cooldown = Math.max(0, t.cooldown - dtSec);
        t.held = false; // ignore held key during cooldown
        if (t.cooldown === 0) t.fuel = Speed.TURBO_FUEL_SEC; // refuel
        continue;
      }
      if (t.held && t.fuel > 0) {
        t.fuel = Math.max(0, t.fuel - dtSec);
        if (t.fuel === 0) {
          t.cooldown = Speed.TURBO_COOLDOWN_SEC;
          t.held = false;
        }
      }
    }
  }

  // Human steering only: the tick is the sound of a turn the snake accepted.
  function steer(snake, dir) {
    const queued = snake.queue.length;
    Snake.bufferDirection(snake, dir);
    if (snake.queue.length !== queued) Audio.turnSfx();
  }

  function isBoosting(playerIndex) {
    const t = state.turbo[playerIndex];
    return t.held && t.fuel > 0 && t.cooldown <= 0;
  }

  // Claim pickups right after each individual tick (not once per animation
  // frame) so a shield/phase grabbed on tick N is already active if the same
  // frame runs a colliding tick N+1 (happens once the tick interval shrinks
  // enough for a frame to cover more than one tick).
  function claimPickups() {
    Powerups.claim(state.round, state.elapsed).forEach((c) => {
      state.flashes.push({ pos: c.pos, type: 'pickup', start: state.elapsed });
      Particles.ring(state.particles, c.pos, Sprites.PICKUP_COLORS[c.type] || '#ffffff', 24, Math.random);
      Audio.pickupSfx();
    });
  }

  function loop(now) {
    state.raf = requestAnimationFrame(loop);
    Input.pollGamepads(inputHandlers);
    if (state.phase === 'menu') {
      const dtSec = Math.min(now - state.last, 250) / 1000; state.last = now;
      if (state.attract) { advanceAttract(dtSec); renderAttract(); }
      return;
    }
    if (state.phase === 'replay') return advanceReplay(now);
    if (state.phase !== 'playing') return;
    const dt = Math.min(now - state.last, 250); state.last = now;
    const dtSec = dt / 1000;
    if (!isOnline()) state.elapsed += dtSec; // online: elapsed advances per confirmed tick below
    updateTurbo(dtSec);
    Particles.step(state.particles, dtSec);
    Audio.setTurbo(isBoosting(0) || isBoosting(1));
    Audio.setIntensity(Math.min(1, state.elapsed / 45));

    let frozen = [];
    if (!isOnline()) {
      const boltInt = Speed.tickInterval(state.elapsed, skillLevel()) / 3;
      state.boltAcc += dt;
      while (state.boltAcc >= boltInt) {
        state.boltAcc -= boltInt;
        const outcomes = Projectile.advanceBolts(state.round, state.elapsed);
        outcomes.forEach((o) => {
          state.flashes.push({ pos: o.pos, type: o.type, start: state.elapsed });
          Particles.ring(state.particles, o.pos, Renderer.FLASH_COLORS[o.type], o.type === 'bounce' ? 8 : 20, Math.random);
          o.type === 'bounce' ? Audio.bounceSfx() : Audio.derezSfx();
        });
        if (state.round.bolts.length) recordFrame();
      }
      state.flashes = state.flashes.filter((f) => state.elapsed - f.start < Renderer.FLASH_DURATION_SEC);

      Powerups.maybeSpawn(state.round, state.elapsed);
      frozen = Powerups.frozenIndices(state.round, state.elapsed);
      if (state.mode === '1p') Hazard.advance(state.round, state.round.hazard, state.elapsed, Math.random);
    }

    // A head shot kills between snake ticks, so resolve it here rather than
    // waiting for the next tick's resolve.
    Round.resolve(state.round);
    if (state.round.over) { recordFrame(); paint(); return endRound(); }

    const normalInt = Speed.tickInterval(state.elapsed, skillLevel());
    const turboInt = Speed.turboInterval(state.elapsed, skillLevel());

    if (isOnline()) {
      const o = state.online;
      // Cap the accumulator so a long stall doesn't fast-forward a burst of
      // ticks when input resumes (both sides stall together within INPUT_DELAY).
      state.acc = Math.min(state.acc + dt, 4 * Speed.BASE_MS);
      let interval = Speed.tickInterval(state.elapsed, skillLevel());
      while (state.acc >= interval && Net.canTick(o.session)) {
        state.acc -= interval;
        const tickNum = o.session.next;
        let hash;
        if (tickNum > 0 && tickNum % Net.HASH_EVERY === 0) {
          hash = Net.stateHash(state.round);
          if (Net.noteLocalHash(o.session, tickNum, hash) === 'desync') return onlineAbort('GAME OUT OF SYNC — PLEASE REFRESH');
        }
        Online.send(Net.localTurns(o.session, o.pending.splice(0), hash));
        const { turns } = Net.takeTick(o.session);
        turns.forEach((dirs, i) => dirs.forEach((d) => steer(state.round.snakes[i], d)));
        tickGliding(() => Round.tick(state.round, state.elapsed));
        state.elapsed += interval / 1000; // simulated time: identical on both machines
        interval = Speed.tickInterval(state.elapsed, skillLevel());
        tr({ t: now | 0,
          tick: state.round.snakes.map((s) => (s.alive ? s.direction : 'dead')),
          pos: state.round.snakes.map((s) => { const h = s.body[s.body.length - 1]; return `${h.x},${h.y}`; }) });
        recordFrame();
        if (state.round.over) { paint(); return endRound(); }
      }
      if (state.acc >= interval && !Net.canTick(o.session)) {
        if (o.stallSince === null) o.stallSince = now;
        o.lagging = now - o.stallSince > 500;
      } else { o.stallSince = null; o.lagging = false; }
    } else if (!isBoosting(0) && !isBoosting(1)) {
      // Nobody boosting: one shared accumulator, so snakes step together and
      // an exact head-on is a draw rather than a win for whoever ticks first.
      state.acc += dt;
      while (state.acc >= normalInt) {
        state.acc -= normalInt;
        if (vsCpu() && state.round.snakes[1].alive && !frozen.includes(1)) {
          const brain = CPU.forSkill(CPU.PERSONALITIES[rivalKey()], skillLevel());
          Snake.bufferDirection(state.round.snakes[1], CPU.chooseDirection(state.round, 1, Math.random, brain));
          if (CPU.shouldFire(state.round, 1, state.elapsed, brain)) {
            const before = state.round.firedCount[1];
            Projectile.fire(state.round, 1, state.elapsed);
            if (state.round.firedCount[1] !== before) fireFx(1);
          }
        }
        tickGliding(() => Round.tick(state.round, state.elapsed, frozen));
        tr({ t: now | 0,
          tick: state.round.snakes.map((s) => (s.alive ? s.direction : 'dead')),
          pos: state.round.snakes.map((s) => { const h = s.body[s.body.length - 1]; return `${h.x},${h.y}`; }) });
        claimPickups();
        recordFrame();
        if (state.round.over) { paint(); return endRound(); }
      }
      state.turbo.forEach((t) => { t.acc = state.acc; }); // no hiccup if a boost starts
    } else {
      // Per-snake tick: each snake has its own interval based on boost state
      const snakes = state.round.snakes;
      for (let i = 0; i < snakes.length; i++) {
        if (!snakes[i].alive || frozen.includes(i)) continue;
        const interval = isBoosting(i) ? turboInt : normalInt;
        state.turbo[i].acc += dt;
        while (state.turbo[i].acc >= interval) {
          state.turbo[i].acc -= interval;
          if (vsCpu() && i === 1) {
            const brain = CPU.forSkill(CPU.PERSONALITIES[rivalKey()], skillLevel());
            Snake.bufferDirection(snakes[1], CPU.chooseDirection(state.round, 1, Math.random, brain));
            if (CPU.shouldFire(state.round, 1, state.elapsed, brain)) {
              const before = state.round.firedCount[1];
              Projectile.fire(state.round, 1, state.elapsed);
              if (state.round.firedCount[1] !== before) fireFx(1);
            }
          }
          tickGliding(() => Round.tickSingle(state.round, i, state.elapsed), i);
          claimPickups();
          recordFrame();
          if (state.round.over) { paint(); return endRound(); }
        }
      }
      state.acc = state.turbo[0].acc; // no hiccup when the boost ends
    }

    updateHud();
    const view = glidingRound(dt, normalInt, turboInt);
    emitCycleFx(view, dtSec, frozen);
    paint(view);
  }

  function beginGame(mode) {
    state.mode = mode;
    state.gauntlet = mode === 'gauntlet' ? Gauntlet.createGauntlet() : null;
    state.match = Match.createMatch(mode === 'gauntlet' ? Gauntlet.STAGE_TARGET : state.matchTarget);
    newRound(); startCountdown();
  }

  function leaveTitle() {
    if (state.phase === 'title') showMenu();
  }

  function onAction() {
    if (state.phase === 'title') return leaveTitle();
    if (state.phase === 'replay') return showResult(); // this press is spent on the skip
    if (performance.now() < state.actionLockUntil) return;
    if (state.phase === 'menu') return activateMenuItem();
    if (isOnline()) {
      if (state.phase === 'gameover') { showMenu(); }
      else if (state.phase === 'roundover' && !state.online.localReady) {
        state.online.localReady = true;
        Online.send({ type: 'ready' });
        goTitle.textContent = 'WAITING FOR OPPONENT…';
        maybeStartNextOnlineRound();
      }
      return;
    }
    if (state.phase === 'gameover') { showMenu(); }
    else if (state.phase === 'roundover') { newRound(); startCountdown(); }
  }

  function maybeStartNextOnlineRound() {
    const o = state.online;
    if (!o || !o.localReady || !o.remoteReady) return;
    o.localReady = o.remoteReady = false;
    o.roundNumber += 1;
    newRound(); startCountdown();
  }

  function beginOnlineGame(start) {
    el('online-code-input').blur(); // keys must steer, not count as typing
    state.mode = 'online';
    state.gauntlet = null;
    state.online = { seed: start.seed >>> 0, settings: start.settings, youAre: start.youAre,
      session: null, pending: [], roundNumber: 0, localReady: false, remoteReady: false,
      stallSince: null, lagging: false };
    state.match = Match.createMatch(start.settings.matchTarget);
    newRound(); startCountdown();
  }

  // Once the match is won the final screen stands, even if the other player
  // skips their replay and leaves while this client is still watching its own.
  function onlineResultDecided() {
    return state.phase === 'gameover' || (state.phase === 'replay' && state.match.over);
  }

  function onlineAbort(message) {
    Online.disconnect();
    state.online = null;
    if (state.phase === 'menu') { setOnlineStatus(message); return; }
    Audio.stop();
    show(gameover);
    resultTone(null);
    goTitle.textContent = message;
    goBody.innerHTML = '';
    el('go-continue').textContent = 'PRESS ENTER FOR MENU';
    state.phase = 'gameover';
  }

  function showMenu() {
    clearInterval(state.countdownTimer);
    if (state.online) { Online.disconnect(); state.online = null; }
    setOnlineStatus(''); // any room code shown is stale once we're back here
    state.phase = 'menu'; hud.classList.add('hidden'); Audio.stop();
    el('go-flash').classList.add('hidden');
    el('leaderboard').innerHTML = renderBoard(Leaderboard.load(window.localStorage));
    const best = Gauntlet.loadBest(window.localStorage);
    el('gauntlet-best').textContent = best > 0
      ? (best >= Gauntlet.STAGES.length ? '★ GRID CHAMPION ★'
        : `GAUNTLET BEST: ${best} OF ${Gauntlet.STAGES.length} RIVALS`) : '';
    show(menu);
    if (!menuItems().includes(state.menuSelected)) selectMenuItem(menuItems()[0]);
    state.last = performance.now();
    initAttract();
  }

  // --- keyboard/controller menu navigation ---
  function menuItems() {
    return [...menu.querySelectorAll('button, input:not([type="file"])')].filter((b) => b.offsetParent !== null);
  }

  function selectMenuItem(item) {
    if (state.menuSelected) state.menuSelected.classList.remove('menu-selected');
    state.menuSelected = item;
    item.classList.add('menu-selected');
  }

  function moveMenuSelection(dir) {
    const items = menuItems();
    if (!items.includes(state.menuSelected)) return selectMenuItem(items[0]); // its panel was closed
    const centers = items.map((b) => {
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const next = items[MenuNav.move(centers, items.indexOf(state.menuSelected), dir)];
    selectMenuItem(next);
    next.scrollIntoView({ block: 'nearest' });
    // Landing on the room-code box makes it ready to type in.
    if (next.tagName === 'INPUT') next.focus();
    else if (document.activeElement.tagName === 'INPUT') document.activeElement.blur();
  }

  // Settings, Leaderboard and Controls: at most one is open at a time.
  const menuPanels = {
    'settings-toggle': [...document.querySelectorAll('.settings-group')],
    'leaderboard-toggle': [el('leaderboard')],
    'controls-toggle': [el('controls-panel')],
  };

  function closeMenuPanels() {
    Object.values(menuPanels).flat().forEach((p) => p.classList.add('hidden'));
  }

  // Esc / controller Menu on the menu screen: back out of the open panel.
  function closeOpenMenuPanel() {
    const open = Object.keys(menuPanels).find((id) => !menuPanels[id][0].classList.contains('hidden'));
    if (!open) return;
    closeMenuPanels();
    if (!menuItems().includes(state.menuSelected)) selectMenuItem(el(open));
  }

  function activateMenuItem() {
    if (menuItems().includes(state.menuSelected)) state.menuSelected.click();
    else selectMenuItem(menuItems()[0]);
  }

  // wire input + menu buttons
  const inputHandlers = {
    onDirection: (i, dir) => {
      if (state.phase === 'menu') return moveMenuSelection(dir);
      if (isOnline()) {
        // Both key sets steer the local snake online; turns are queued for
        // the lockstep pipeline instead of touching the snake directly.
        if (state.phase !== 'playing') return;
        const p = state.online.pending;
        if (p.length < 3 && p[p.length - 1] !== dir) p.push(dir);
        tr({ t: performance.now() | 0, key: dir, online: true, pending: p.join('<') });
        return;
      }
      const steerable = state.phase === 'playing' && state.round.snakes[i]
        && !(i === 1 && vsCpu());
      if (!steerable) {
        // still record it: proves when a press arrived too late (or in the
        // wrong phase) instead of silently vanishing from the trace
        tr({ t: performance.now() | 0, key: dir, player: i, ignored: state.phase });
        return;
      }
      const snake = state.round.snakes[i];
      const before = snake.queue.join('<');
      steer(snake, dir);
      tr({ t: performance.now() | 0, key: dir, player: i,
        heading: snake.direction, queue: `${before}->${snake.queue.join('<')}` });
    },
    onAction,
    onQuit: () => { if (state.phase !== 'menu') showMenu(); else closeOpenMenuPanel(); }, // on the title, Menu is "start"
    onTurbo: (i, pressed) => {
      if (isOnline()) return;
      if (state.phase !== 'playing') return;
      if (!state.round.snakes[i] || !state.round.snakes[i].alive) return;
      // In CPU-driven modes, ignore P2 turbo (rivals don't turbo)
      if (i === 1 && vsCpu()) return;
      state.turbo[i].held = pressed;
    },
    onFire: (i) => {
      if (isOnline()) return;
      if (state.phase !== 'playing' || !state.round.snakes[i] || !state.round.snakes[i].alive) return;
      if (i === 1 && vsCpu()) return; // rivals fire themselves via CPU.shouldFire
      const before = state.round.firedCount[i];
      Projectile.fire(state.round, i, state.elapsed);
      if (state.round.firedCount[i] !== before) {
        fireFx(i);
        Input.rumble(i, { duration: 160, strong: 0.15, weak: 0.5 });
      }
    },
  };
  Input.attach(inputHandlers);
  // Registered after Input.attach: an Enter press has already left the title
  // through onAction by now, so one press can't also pick a menu item.
  window.addEventListener('keydown', (e) => {
    if (!e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey) leaveTitle();
  });
  titleScreen.addEventListener('click', leaveTitle);
  document.querySelectorAll('[data-mode]').forEach((btn) =>
    btn.addEventListener('click', () => {
      // Unlock the custom audio element now, while we still have a user gesture —
      // Audio.start() fires later from the countdown timer, too late to satisfy
      // stricter autoplay policies (e.g. Edge's "Limit" mode).
      if (state.musicTrack === 'custom') Audio.primeCustomTrack();
      beginGame(btn.dataset.mode);
    }));
  el('go-continue').addEventListener('click', onAction);
  menu.addEventListener('mouseover', (e) => {
    const item = e.target.closest('button, input:not([type="file"])');
    if (item) selectMenuItem(item); // one highlight, whichever input moved it last
  });

  const wallButtons = document.querySelectorAll('[data-wall]');
  wallButtons.forEach((btn) => btn.addEventListener('click', () => {
    state.wallDensity = btn.dataset.wall;
    wallButtons.forEach((b) => b.classList.toggle('active', b === btn));
  }));

  const targetButtons = document.querySelectorAll('[data-target]');
  targetButtons.forEach((btn) => btn.addEventListener('click', () => {
    state.matchTarget = parseInt(btn.dataset.target, 10);
    targetButtons.forEach((b) => b.classList.toggle('active', b === btn));
  }));

  const skillButtons = document.querySelectorAll('[data-skill]');
  skillButtons.forEach((btn) => btn.addEventListener('click', () => {
    state.skillLevel = parseInt(btn.dataset.skill, 10);
    skillButtons.forEach((b) => b.classList.toggle('active', b === btn));
  }));

  const rivalButtons = document.querySelectorAll('[data-rival]');
  rivalButtons.forEach((btn) => btn.addEventListener('click', () => {
    state.rival = btn.dataset.rival;
    rivalButtons.forEach((b) => b.classList.toggle('active', b === btn));
  }));

  const trailButtons = document.querySelectorAll('[data-trail]');
  trailButtons.forEach((btn) => btn.addEventListener('click', () => {
    state.trailMode = btn.dataset.trail;
    trailButtons.forEach((b) => b.classList.toggle('active', b === btn));
  }));

  const gfxButtons = document.querySelectorAll('[data-gfx]');
  gfxButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.gfx === state.gfx);
    btn.addEventListener('click', () => {
      state.gfx = btn.dataset.gfx;
      gfxButtons.forEach((b) => b.classList.toggle('active', b === btn));
      try { window.localStorage.setItem(GFX_KEY, state.gfx); } catch (e) { /* private mode: just not remembered */ }
    });
  });

  const musicButtons = document.querySelectorAll('[data-music]');
  const musicFileInput = el('music-file-input');
  const musicCustomBtn = el('music-custom-btn');
  musicButtons.forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.music === 'custom') { musicFileInput.click(); return; }
    state.musicTrack = btn.dataset.music;
    musicButtons.forEach((b) => b.classList.toggle('active', b === btn));
  }));
  musicFileInput.addEventListener('change', () => {
    const file = musicFileInput.files[0];
    if (!file) return;
    Audio.loadCustomTrack(file);
    state.musicTrack = 'custom';
    musicButtons.forEach((b) => b.classList.toggle('active', b === musicCustomBtn));
    const name = file.name.length > 18 ? `${file.name.slice(0, 18)}…` : file.name;
    musicCustomBtn.textContent = `CUSTOM: ${name}`;
    musicFileInput.value = '';
  });

  const colorToggle = el('color-toggle');
  Renderer.PALETTE.forEach((color) => {
    const btn = document.createElement('button');
    btn.className = 'color-swatch' + (color === state.playerColor ? ' active' : '');
    btn.style.setProperty('--swatch', color);
    btn.dataset.color = color;
    btn.setAttribute('aria-label', color);
    colorToggle.appendChild(btn);
  });
  const colorButtons = document.querySelectorAll('[data-color]');
  colorButtons.forEach((btn) => btn.addEventListener('click', () => {
    state.playerColor = btn.dataset.color;
    colorButtons.forEach((b) => b.classList.toggle('active', b === btn));
  }));

  Object.entries(menuPanels).forEach(([toggleId, parts]) => {
    el(toggleId).addEventListener('click', () => {
      const wasOpen = !parts[0].classList.contains('hidden');
      closeMenuPanels();
      if (wasOpen) return;
      parts.forEach((p) => p.classList.remove('hidden'));
      parts[parts.length - 1].scrollIntoView({ block: 'nearest' });
    });
  });
  el('controls-keyboard').innerHTML = ControlsArt.keyboardSvg();
  el('controls-gamepad').innerHTML = ControlsArt.controllerSvg();

  // --- online menu wiring ---
  const setOnlineStatus = (text) => { el('online-status').textContent = text; };

  const onlineHandlers = {
    onHosted: (msg) => setOnlineStatus(`ROOM CODE: ${msg.code} — SEND IT TO YOUR FRIEND`),
    onStart: (msg) => beginOnlineGame(msg),
    onInput: (msg) => {
      if (!isOnline() || !state.online.session) return;
      Net.remoteInput(state.online.session, msg);
      if (msg.hash !== undefined
        && Net.noteRemoteHash(state.online.session, msg.t - Net.INPUT_DELAY, msg.hash) === 'desync') {
        onlineAbort('GAME OUT OF SYNC — PLEASE REFRESH');
      }
    },
    onReady: () => { if (isOnline()) { state.online.remoteReady = true; maybeStartNextOnlineRound(); } },
    onJoinError: (msg) => setOnlineStatus(msg.reason),
    onOpponentLeft: () => { if (isOnline() && !onlineResultDecided()) onlineAbort('OPPONENT DISCONNECTED'); },
    onVersionMismatch: () => setOnlineStatus('NEW VERSION AVAILABLE — REFRESH THE PAGE'),
    onClosed: () => {
      if (isOnline() && !onlineResultDecided()) onlineAbort('CONNECTION LOST');
      else setOnlineStatus('');
    },
  };

  async function onlineConnectAnd(action) {
    setOnlineStatus('CONNECTING…');
    const slow = setTimeout(() => setOnlineStatus('WAKING UP SERVER… (CAN TAKE ~30S)'), 3000);
    try {
      await Online.connect(onlineHandlers);
      action();
    } catch (err) {
      setOnlineStatus(err.message);
    } finally {
      clearTimeout(slow);
    }
  }

  el('online-toggle').addEventListener('click', () => el('online-panel').classList.toggle('hidden'));
  el('online-host').addEventListener('click', () => onlineConnectAnd(() =>
    Online.send({ type: 'host', settings: { wallDensity: state.wallDensity, trailMode: state.trailMode, matchTarget: state.matchTarget, skillLevel: state.skillLevel } })));
  el('online-join').addEventListener('click', () => {
    const code = el('online-code-input').value.trim().toUpperCase();
    if (code.length !== 4) return setOnlineStatus('ENTER THE 4-LETTER CODE');
    onlineConnectAnd(() => Online.send({ type: 'join', code }));
  });

  window.addEventListener('resize', () => {
    if (state.phase === 'menu') {
      initAttract();
    } else if (state.round) {
      fitCanvas();
      state.atlas = Sprites.bake({ cell, colors: state.colors, borderColor: state.borderColor, cols: COLS, rows: ROWS, shapes: state.shapes });
    }
  });

  show(titleScreen);
  state.raf = requestAnimationFrame(loop);
})();

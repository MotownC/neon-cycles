(function () {
  const COLS = 64, ROWS = 40, MATCH_TARGET = 10;
  const canvas = document.getElementById('game');
  const stage = document.getElementById('stage');
  let cell, ctx;

  const el = (id) => document.getElementById(id);
  const menu = el('menu'), countdown = el('countdown'), hud = el('hud'),
        gameover = el('gameover'), countSpan = el('count'),
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

  const state = {
    phase: 'menu', mode: '1p', round: null, match: null,
    elapsed: 0, acc: 0, boltAcc: 0, last: 0, raf: null, wallDensity: 'none',
    flashes: [], // transient visual markers for bolt cut/kill/bounce outcomes
    trailMode: 'tron',
    playerColor: Renderer.PALETTE[0], colors: Renderer.COLORS,
    borderColor: '#ff2b4a',
    atlas: null, // baked sprite atlas, rebaked on round start and resize
    turboEnabled: false,
    turbo: [freshTurbo(), freshTurbo()],
    rival: 'aggressor',
    gauntlet: null, // active Gauntlet run, only in gauntlet mode
  };

  // Both CPU-driven modes share the same input/AI plumbing; they differ only
  // in which rival is at the controls and what happens when a match ends.
  function vsCpu() { return state.mode === 'cpu' || state.mode === 'gauntlet'; }
  function rivalKey() {
    return state.mode === 'gauntlet' ? Gauntlet.STAGES[state.gauntlet.stage] : state.rival;
  }

  // Field-debug ring buffer: recent inputs and applied directions, dumped to
  // the console on every crash so control issues can be diagnosed from a
  // pasted trace instead of guesswork.
  const trace = [];
  window.__trace = trace; // inspectable from the console at any time
  function tr(entry) { trace.push(entry); if (trace.length > 64) trace.shift(); }

  function show(node) { for (const o of [menu, countdown, gameover]) o.classList.add('hidden');
    if (node) node.classList.remove('hidden'); }

  function newRound() {
    const specs = state.mode === '1p'
      ? [{ start: { x: (COLS/2)|0, y: (ROWS/2)|0 }, direction: 'right' }]
      : [{ start: { x: (COLS*0.25)|0, y: (ROWS/2)|0 }, direction: 'right' },
         { start: { x: (COLS*0.75)|0, y: (ROWS/2)|0 }, direction: 'left' }];
    const walls = Walls.generate(COLS, ROWS, state.wallDensity);
    state.round = Round.createRound(COLS, ROWS, specs, walls, state.trailMode);
    // A rival rides its signature color unless the player claimed it first.
    const rivalColor = vsCpu() ? RIVALS[rivalKey()].color : null;
    state.colors = [state.playerColor,
      rivalColor && rivalColor !== state.playerColor ? rivalColor : Renderer.pickOpponentColor(state.playerColor)];
    state.borderColor = Renderer.randomBorderColor();
    state.elapsed = 0; state.acc = 0; state.boltAcc = 0; state.last = performance.now();
    state.flashes = [];
    state.turbo = [freshTurbo(), freshTurbo()];
    const f = Renderer.fit(canvas, COLS, ROWS); cell = f.cell; ctx = f.ctx;
    state.atlas = Sprites.bake({ cell, colors: state.colors, borderColor: state.borderColor });
  }

  function startCountdown() {
    state.phase = 'countdown'; hud.classList.add('hidden'); show(countdown);
    let n = 3; countSpan.textContent = n;
    const iv = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(iv); show(null); hud.classList.remove('hidden');
        state.phase = 'playing'; state.last = performance.now(); Audio.start(); }
      else countSpan.textContent = n;
    }, 700);
  }

  function turboTag(t, color) {
    if (!state.turboEnabled) return '';
    if (t.cooldown > 0) {
      return ` <span style="color:${color};opacity:0.4;font-size:14px">⏳ ${Math.ceil(t.cooldown)}s</span>`;
    }
    if (t.held && t.fuel > 0) {
      return ` <span style="color:#fff;font-size:14px;text-shadow:0 0 8px ${color}">⚡TURBO</span>`;
    }
    // Show fuel bar
    const pct = (t.fuel / Speed.TURBO_FUEL_SEC * 100) | 0;
    return ` <span style="color:${color};opacity:0.6;font-size:14px">⚡${pct}%</span>`;
  }

  function ammoTag(index, color) {
    const available = Projectile.ammoAvailable(state.elapsed, state.round.firedCount[index]);
    const pips = '●'.repeat(available) + '○'.repeat(Projectile.AMMO_CAP - available);
    return ` <span style="color:${color};opacity:0.7;font-size:14px">${pips}</span>`;
  }

  const STATUS_TAGS = { shield: '🛡', phase: '👻' };
  function statusTag(index, color) {
    const snake = state.round.snakes[index];
    let out = '';
    for (const [key, glyph] of Object.entries(STATUS_TAGS)) {
      if (snake[key]) out += ` <span style="color:${color};font-size:14px">${glyph}</span>`;
    }
    const frozenUntil = state.round.frozenUntil && state.round.frozenUntil[index];
    if (frozenUntil && state.elapsed < frozenUntil) {
      out += ` <span style="color:#bdeeff;font-size:14px">❄${Math.ceil(frozenUntil - state.elapsed)}s</span>`;
    }
    return out;
  }

  function updateHud() {
    const [c0, c1] = state.colors;
    const [t0, t1] = state.turbo;
    if (state.mode === '1p') hud.innerHTML = `<span style="color:${c0}">TIME ${state.elapsed.toFixed(1)}s${turboTag(t0, c0)}${ammoTag(0, c0)}${statusTag(0, c0)}</span>`;
    else if (vsCpu()) {
      const stageTag = state.mode === 'gauntlet'
        ? ` <span style="opacity:.5;font-size:14px">${state.gauntlet.stage + 1}/${Gauntlet.STAGES.length}</span>` : '';
      hud.innerHTML = `<span style="color:${c0}">YOU ${state.match.scores[0]}${turboTag(t0, c0)}${ammoTag(0, c0)}${statusTag(0, c0)}</span>`
        + `<span style="color:${c1}">${RIVALS[rivalKey()].name} ${state.match.scores[1]}${turboTag(t1, c1)}${ammoTag(1, c1)}${statusTag(1, c1)}${stageTag}</span>`;
    }
    else hud.innerHTML = `<span style="color:${c0}">P1 ${state.match.scores[0]}${turboTag(t0, c0)}${ammoTag(0, c0)}${statusTag(0, c0)}</span>`
      + `<span style="color:${c1}">P2 ${state.match.scores[1]}${turboTag(t1, c1)}${ammoTag(1, c1)}${statusTag(1, c1)}</span>`;
  }

  function label(index) {
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

  function endRound() {
    const verdicts = crashVerdicts();
    // dump slightly late so presses arriving just after the crash are included
    // label with the live version from the menu so pasted traces can't lie about which build produced them
    setTimeout(() => console.log(`crash trace ${el('version').textContent}:`, JSON.stringify({ verdicts, trace })), 600);
    Audio.crash(); flashCrash(); state.phase = 'roundover';
    if (state.mode === '1p') return finishSolo();
    Match.awardRound(state.match, state.round.winnerIndex);
    if (state.match.over) return state.mode === 'gauntlet' ? finishGauntletStage() : finishMatch();
    show(gameover);
    goTitle.textContent = state.round.winnerIndex === null ? 'DRAW'
      : `${label(state.round.winnerIndex)} WINS ROUND`;
    goBody.innerHTML = `<p>MATCH ${state.match.scores[0]} — ${state.match.scores[1]}</p>` + tauntLine();
    el('go-continue').textContent = 'PRESS ENTER FOR NEXT ROUND';
  }

  function finishMatch() {
    show(gameover);
    goTitle.textContent = `${label(state.match.winnerIndex)} WINS THE MATCH`;
    goBody.innerHTML = `<p>FINAL ${state.match.scores[0]} — ${state.match.scores[1]}</p>` + tauntLine();
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
    show(gameover); goTitle.textContent = 'GAME OVER';
    if (Leaderboard.qualifies(board, time)) {
      const name = (prompt(`New high score: ${time}s! Enter name:`, 'YOU') || 'YOU');
      board = Leaderboard.insert(window.localStorage, board, name, time);
    }
    goBody.innerHTML = `<p>SURVIVED ${time.toFixed(1)}s</p>` + renderBoard(board);
    el('go-continue').textContent = 'PRESS ENTER FOR MENU';
    state.phase = 'gameover';
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
    if (!state.turboEnabled) return;
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

  function isBoosting(playerIndex) {
    if (!state.turboEnabled) return false;
    const t = state.turbo[playerIndex];
    return t.held && t.fuel > 0 && t.cooldown <= 0;
  }

  function loop(now) {
    state.raf = requestAnimationFrame(loop);
    if (state.phase !== 'playing') return;
    const dt = Math.min(now - state.last, 250); state.last = now;
    const dtSec = dt / 1000;
    state.elapsed += dtSec;
    updateTurbo(dtSec);
    Audio.setIntensity(Math.min(1, state.elapsed / 45));

    const boltInt = Speed.tickInterval(state.elapsed) / 3;
    state.boltAcc += dt;
    while (state.boltAcc >= boltInt) {
      state.boltAcc -= boltInt;
      const outcomes = Projectile.advanceBolts(state.round, state.elapsed);
      outcomes.forEach((o) => {
        state.flashes.push({ pos: o.pos, type: o.type, start: state.elapsed });
        o.type === 'bounce' ? Audio.bounceSfx() : Audio.derezSfx();
      });
    }
    state.flashes = state.flashes.filter((f) => state.elapsed - f.start < Renderer.FLASH_DURATION_SEC);

    Powerups.maybeSpawn(state.round, state.elapsed);
    const frozen = Powerups.frozenIndices(state.round, state.elapsed);

    // A head shot kills between snake ticks, so resolve it here rather than
    // waiting for the next tick's resolve.
    Round.resolve(state.round);
    if (state.round.over) { Renderer.render(ctx, state.round, cell, state.colors, state.borderColor, state.elapsed, state.flashes, state.atlas); return endRound(); }

    const normalInt = Speed.tickInterval(state.elapsed);
    const turboInt = Speed.turboInterval(state.elapsed);

    if (!state.turboEnabled) {
      // Original single-accumulator path (no turbo feature)
      state.acc += dt;
      while (state.acc >= normalInt) {
        state.acc -= normalInt;
        if (vsCpu() && state.round.snakes[1].alive && !frozen.includes(1)) {
          const brain = CPU.PERSONALITIES[rivalKey()];
          Snake.bufferDirection(state.round.snakes[1], CPU.chooseDirection(state.round, 1, Math.random, brain));
          if (CPU.shouldFire(state.round, 1, state.elapsed, brain)) {
            const before = state.round.firedCount[1];
            Projectile.fire(state.round, 1, state.elapsed);
            if (state.round.firedCount[1] !== before) Audio.fireSfx();
          }
        }
        Round.tick(state.round, state.elapsed, frozen);
        tr({ t: now | 0,
          tick: state.round.snakes.map((s) => (s.alive ? s.direction : 'dead')),
          pos: state.round.snakes.map((s) => { const h = s.body[s.body.length - 1]; return `${h.x},${h.y}`; }) });
        if (state.round.over) { Renderer.render(ctx, state.round, cell, state.colors, state.borderColor, state.elapsed, state.flashes, state.atlas); return endRound(); }
      }
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
            const brain = CPU.PERSONALITIES[rivalKey()];
            Snake.bufferDirection(snakes[1], CPU.chooseDirection(state.round, 1, Math.random, brain));
            if (CPU.shouldFire(state.round, 1, state.elapsed, brain)) {
              const before = state.round.firedCount[1];
              Projectile.fire(state.round, 1, state.elapsed);
              if (state.round.firedCount[1] !== before) Audio.fireSfx();
            }
          }
          Round.tickSingle(state.round, i, state.elapsed);
          if (state.round.over) { Renderer.render(ctx, state.round, cell, state.colors, state.borderColor, state.elapsed, state.flashes, state.atlas); return endRound(); }
        }
      }
    }

    Powerups.claim(state.round, state.elapsed).forEach((c) => {
      state.flashes.push({ pos: c.pos, type: 'pickup', start: state.elapsed });
      Audio.pickupSfx();
    });

    updateHud();
    Renderer.render(ctx, state.round, cell, state.colors, state.borderColor, state.elapsed, state.flashes, state.atlas);
  }

  function beginGame(mode) {
    state.mode = mode;
    state.gauntlet = mode === 'gauntlet' ? Gauntlet.createGauntlet() : null;
    state.match = Match.createMatch(mode === 'gauntlet' ? Gauntlet.STAGE_TARGET : MATCH_TARGET);
    newRound(); startCountdown();
  }

  function onAction() {
    if (state.phase === 'gameover') { showMenu(); }
    else if (state.phase === 'roundover') { newRound(); startCountdown(); }
  }

  function showMenu() {
    state.phase = 'menu'; hud.classList.add('hidden'); Audio.stop();
    el('leaderboard').innerHTML = renderBoard(Leaderboard.load(window.localStorage));
    const best = Gauntlet.loadBest(window.localStorage);
    el('gauntlet-best').textContent = best > 0
      ? (best >= Gauntlet.STAGES.length ? '★ GRID CHAMPION ★'
        : `GAUNTLET BEST: ${best} OF ${Gauntlet.STAGES.length} RIVALS`) : '';
    show(menu);
  }

  // wire input + menu buttons
  Input.attach({
    onDirection: (i, dir) => {
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
      Snake.bufferDirection(snake, dir);
      tr({ t: performance.now() | 0, key: dir, player: i,
        heading: snake.direction, queue: `${before}->${snake.queue.join('<')}` });
    },
    onAction,
    onTurbo: (i, pressed) => {
      if (state.phase !== 'playing' || !state.turboEnabled) return;
      if (!state.round.snakes[i] || !state.round.snakes[i].alive) return;
      // In CPU-driven modes, ignore P2 turbo (rivals don't turbo)
      if (i === 1 && vsCpu()) return;
      state.turbo[i].held = pressed;
    },
    onFire: (i) => {
      if (state.phase !== 'playing' || !state.round.snakes[i] || !state.round.snakes[i].alive) return;
      if (i === 1 && vsCpu()) return; // rivals fire themselves via CPU.shouldFire
      const before = state.round.firedCount[i];
      Projectile.fire(state.round, i, state.elapsed);
      if (state.round.firedCount[i] !== before) Audio.fireSfx();
    },
  });
  document.querySelectorAll('[data-mode]').forEach((btn) =>
    btn.addEventListener('click', () => beginGame(btn.dataset.mode)));
  el('go-continue').addEventListener('click', onAction);

  const wallButtons = document.querySelectorAll('[data-wall]');
  wallButtons.forEach((btn) => btn.addEventListener('click', () => {
    state.wallDensity = btn.dataset.wall;
    wallButtons.forEach((b) => b.classList.toggle('active', b === btn));
  }));

  const turboButtons = document.querySelectorAll('[data-turbo]');
  turboButtons.forEach((btn) => btn.addEventListener('click', () => {
    state.turboEnabled = btn.dataset.turbo === 'on';
    turboButtons.forEach((b) => b.classList.toggle('active', b === btn));
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

  const colorToggle = el('color-toggle');
  Renderer.PALETTE.forEach((color, i) => {
    const btn = document.createElement('button');
    btn.className = 'color-swatch' + (i === 0 ? ' active' : '');
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

  window.addEventListener('resize', () => {
    if (state.round) {
      const f = Renderer.fit(canvas, COLS, ROWS); cell = f.cell; ctx = f.ctx;
      state.atlas = Sprites.bake({ cell, colors: state.colors, borderColor: state.borderColor });
    }
  });

  showMenu();
  state.raf = requestAnimationFrame(loop);
})();

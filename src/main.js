(function () {
  const COLS = 64, ROWS = 40, MATCH_TARGET = 10;
  const canvas = document.getElementById('game');
  const stage = document.getElementById('stage');
  let cell, ctx;

  function fitCanvas() {
    const f = Renderer.fit(canvas, COLS, ROWS); cell = f.cell; ctx = f.ctx;
  }

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
    matchTarget: MATCH_TARGET,
    flashes: [], // transient visual markers for bolt cut/kill/bounce outcomes
    trailMode: 'tron',
    musicTrack: 'original',
    playerColor: Renderer.PALETTE[0], colors: Renderer.COLORS,
    borderColor: '#ff2b4a',
    atlas: null, // baked sprite atlas, rebaked on round start and resize
    turboEnabled: false,
    turbo: [freshTurbo(), freshTurbo()],
    rival: 'aggressor',
    activeRival: null, // resolved rival key for the current round, when rival === 'random'
    gauntlet: null, // active Gauntlet run, only in gauntlet mode
    online: null, // { seed, settings, youAre, session, pending, roundNumber, localReady, remoteReady, stallSince, lagging }
    attract: null, // decorative menu-screen loop; see initAttract()
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
    state.elapsed = 0; state.acc = 0; state.boltAcc = 0; state.last = performance.now();
    state.flashes = [];
    state.turbo = [freshTurbo(), freshTurbo()];
    fitCanvas();
    state.atlas = Sprites.bake({ cell, colors: state.colors, borderColor: state.borderColor });
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
      atlas: Sprites.bake({ cell, colors: Renderer.PALETTE, borderColor: '#000' }),
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
    Renderer.drawSnake(ctx, a.snake, Renderer.PALETTE[a.colorIndex], cell, 'fade', a.elapsed, false, a.atlas);
  }

  function startCountdown() {
    state.phase = 'countdown'; hud.classList.add('hidden'); show(countdown);
    let n = 3; countSpan.textContent = n;
    const iv = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(iv); show(null); hud.classList.remove('hidden');
        state.phase = 'playing'; state.last = performance.now(); Audio.start(state.musicTrack); }
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
    else if (isOnline()) {
      const y = state.online.youAre;
      const lag = state.online.lagging ? ` <span style="opacity:.5;font-size:14px">CONNECTION LAGGING…</span>` : '';
      hud.innerHTML = `<span style="color:${state.colors[y]}">YOU ${state.match.scores[y]}</span>`
        + `<span style="color:${state.colors[1 - y]}">FRIEND ${state.match.scores[1 - y]}${lag}</span>`;
    }
    else hud.innerHTML = `<span style="color:${c0}">P1 ${state.match.scores[0]}${turboTag(t0, c0)}${ammoTag(0, c0)}${statusTag(0, c0)}</span>`
      + `<span style="color:${c1}">P2 ${state.match.scores[1]}${turboTag(t1, c1)}${ammoTag(1, c1)}${statusTag(1, c1)}</span>`;
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
    goBody.innerHTML = `<p>SURVIVED ${time.toFixed(1)}s</p>` + renderBoard(board);
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
        goBody.innerHTML = `<p>SURVIVED ${time.toFixed(1)}s</p>` + renderBoard(board);
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

  // Claim pickups right after each individual tick (not once per animation
  // frame) so a shield/phase grabbed on tick N is already active if the same
  // frame runs a colliding tick N+1 (happens once the tick interval shrinks
  // enough for a frame to cover more than one tick).
  function claimPickups() {
    Powerups.claim(state.round, state.elapsed).forEach((c) => {
      state.flashes.push({ pos: c.pos, type: 'pickup', start: state.elapsed });
      Audio.pickupSfx();
    });
  }

  function loop(now) {
    state.raf = requestAnimationFrame(loop);
    if (state.phase === 'menu') {
      const dtSec = Math.min(now - state.last, 250) / 1000; state.last = now;
      if (state.attract) { advanceAttract(dtSec); renderAttract(); }
      return;
    }
    if (state.phase !== 'playing') return;
    const dt = Math.min(now - state.last, 250); state.last = now;
    const dtSec = dt / 1000;
    if (!isOnline()) state.elapsed += dtSec; // online: elapsed advances per confirmed tick below
    updateTurbo(dtSec);
    Audio.setIntensity(Math.min(1, state.elapsed / 45));

    let frozen = [];
    if (!isOnline()) {
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
      frozen = Powerups.frozenIndices(state.round, state.elapsed);
      if (state.mode === '1p') Hazard.advance(state.round, state.round.hazard, state.elapsed, Math.random);
    }

    // A head shot kills between snake ticks, so resolve it here rather than
    // waiting for the next tick's resolve.
    Round.resolve(state.round);
    if (state.round.over) { Renderer.render(ctx, state.round, cell, state.colors, state.borderColor, state.elapsed, state.flashes, state.atlas); return endRound(); }

    const normalInt = Speed.tickInterval(state.elapsed);
    const turboInt = Speed.turboInterval(state.elapsed);

    if (isOnline()) {
      const o = state.online;
      // Cap the accumulator so a long stall doesn't fast-forward a burst of
      // ticks when input resumes (both sides stall together within INPUT_DELAY).
      state.acc = Math.min(state.acc + dt, 4 * Speed.BASE_MS);
      let interval = Speed.tickInterval(state.elapsed);
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
        turns.forEach((dirs, i) => dirs.forEach((d) => Snake.bufferDirection(state.round.snakes[i], d)));
        Round.tick(state.round, state.elapsed);
        state.elapsed += interval / 1000; // simulated time: identical on both machines
        interval = Speed.tickInterval(state.elapsed);
        tr({ t: now | 0,
          tick: state.round.snakes.map((s) => (s.alive ? s.direction : 'dead')),
          pos: state.round.snakes.map((s) => { const h = s.body[s.body.length - 1]; return `${h.x},${h.y}`; }) });
        if (state.round.over) { Renderer.render(ctx, state.round, cell, state.colors, state.borderColor, state.elapsed, state.flashes, state.atlas); return endRound(); }
      }
      if (state.acc >= interval && !Net.canTick(o.session)) {
        if (o.stallSince === null) o.stallSince = now;
        o.lagging = now - o.stallSince > 500;
      } else { o.stallSince = null; o.lagging = false; }
    } else if (!state.turboEnabled) {
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
        claimPickups();
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
          claimPickups();
          if (state.round.over) { Renderer.render(ctx, state.round, cell, state.colors, state.borderColor, state.elapsed, state.flashes, state.atlas); return endRound(); }
        }
      }
    }

    updateHud();
    Renderer.render(ctx, state.round, cell, state.colors, state.borderColor, state.elapsed, state.flashes, state.atlas);
  }

  function beginGame(mode) {
    state.mode = mode;
    state.gauntlet = mode === 'gauntlet' ? Gauntlet.createGauntlet() : null;
    state.match = Match.createMatch(mode === 'gauntlet' ? Gauntlet.STAGE_TARGET : state.matchTarget);
    newRound(); startCountdown();
  }

  function onAction() {
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
    state.mode = 'online';
    state.gauntlet = null;
    state.online = { seed: start.seed >>> 0, settings: start.settings, youAre: start.youAre,
      session: null, pending: [], roundNumber: 0, localReady: false, remoteReady: false,
      stallSince: null, lagging: false };
    state.match = Match.createMatch(start.settings.matchTarget);
    newRound(); startCountdown();
  }

  function onlineAbort(message) {
    Online.disconnect();
    state.online = null;
    if (state.phase === 'menu') { setOnlineStatus(message); return; }
    Audio.stop();
    show(gameover);
    goTitle.textContent = message;
    goBody.innerHTML = '';
    el('go-continue').textContent = 'PRESS ENTER FOR MENU';
    state.phase = 'gameover';
  }

  function showMenu() {
    if (state.online) { Online.disconnect(); state.online = null; }
    setOnlineStatus(''); // any room code shown is stale once we're back here
    state.phase = 'menu'; hud.classList.add('hidden'); Audio.stop();
    el('leaderboard').innerHTML = renderBoard(Leaderboard.load(window.localStorage));
    const best = Gauntlet.loadBest(window.localStorage);
    el('gauntlet-best').textContent = best > 0
      ? (best >= Gauntlet.STAGES.length ? '★ GRID CHAMPION ★'
        : `GAUNTLET BEST: ${best} OF ${Gauntlet.STAGES.length} RIVALS`) : '';
    show(menu);
    state.last = performance.now();
    initAttract();
  }

  // wire input + menu buttons
  Input.attach({
    onDirection: (i, dir) => {
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
      Snake.bufferDirection(snake, dir);
      tr({ t: performance.now() | 0, key: dir, player: i,
        heading: snake.direction, queue: `${before}->${snake.queue.join('<')}` });
    },
    onAction,
    onTurbo: (i, pressed) => {
      if (isOnline()) return;
      if (state.phase !== 'playing' || !state.turboEnabled) return;
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
      if (state.round.firedCount[i] !== before) Audio.fireSfx();
    },
  });
  document.querySelectorAll('[data-mode]').forEach((btn) =>
    btn.addEventListener('click', () => {
      // Unlock the custom audio element now, while we still have a user gesture —
      // Audio.start() fires later from the countdown timer, too late to satisfy
      // stricter autoplay policies (e.g. Edge's "Limit" mode).
      if (state.musicTrack === 'custom') Audio.primeCustomTrack();
      beginGame(btn.dataset.mode);
    }));
  el('go-continue').addEventListener('click', onAction);

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

  const settingsGroups = document.querySelectorAll('.settings-group');
  el('settings-toggle').addEventListener('click', () =>
    settingsGroups.forEach((g) => g.classList.toggle('hidden')));
  el('leaderboard-toggle').addEventListener('click', () => el('leaderboard').classList.toggle('hidden'));
  el('controls-toggle').addEventListener('click', () => el('controls-panel').classList.toggle('hidden'));

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
    onOpponentLeft: () => { if (isOnline() && state.phase !== 'gameover') onlineAbort('OPPONENT DISCONNECTED'); },
    onVersionMismatch: () => setOnlineStatus('NEW VERSION AVAILABLE — REFRESH THE PAGE'),
    onClosed: () => {
      if (isOnline() && state.phase !== 'gameover') onlineAbort('CONNECTION LOST');
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
    Online.send({ type: 'host', settings: { wallDensity: state.wallDensity, trailMode: state.trailMode, matchTarget: state.matchTarget } })));
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
      state.atlas = Sprites.bake({ cell, colors: state.colors, borderColor: state.borderColor });
    }
  });

  showMenu();
  state.raf = requestAnimationFrame(loop);
})();

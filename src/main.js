(function () {
  const COLS = 64, ROWS = 40, MATCH_TARGET = 10;
  const canvas = document.getElementById('game');
  let cell, ctx;

  const el = (id) => document.getElementById(id);
  const menu = el('menu'), countdown = el('countdown'), hud = el('hud'),
        gameover = el('gameover'), countSpan = el('count'),
        goTitle = el('go-title'), goBody = el('go-body');

  const state = {
    phase: 'menu', mode: '1p', round: null, match: null,
    elapsed: 0, acc: 0, last: 0, best: 0, raf: null,
  };

  function show(node) { for (const o of [menu, countdown, gameover]) o.classList.add('hidden');
    if (node) node.classList.remove('hidden'); }

  function newRound() {
    const specs = state.mode === '1p'
      ? [{ start: { x: (COLS/2)|0, y: (ROWS/2)|0 }, direction: 'right' }]
      : [{ start: { x: (COLS*0.25)|0, y: (ROWS/2)|0 }, direction: 'right' },
         { start: { x: (COLS*0.75)|0, y: (ROWS/2)|0 }, direction: 'left' }];
    state.round = Round.createRound(COLS, ROWS, specs);
    state.elapsed = 0; state.acc = 0; state.last = performance.now();
    const f = Renderer.fit(canvas, COLS, ROWS); cell = f.cell; ctx = f.ctx;
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

  function updateHud() {
    if (state.mode === '1p') hud.innerHTML = `<span class="p1">TIME ${state.elapsed.toFixed(1)}s</span>`;
    else hud.innerHTML = `<span class="p1">P1 ${state.match.scores[0]}</span>`
      + `<span class="p2">P2 ${state.match.scores[1]}</span>`;
  }

  function endRound() {
    Audio.crash(); state.phase = 'roundover';
    if (state.mode === '1p') return finishSolo();
    Match.awardRound(state.match, state.round.winnerIndex);
    if (state.match.over) return finishMatch();
    show(gameover);
    goTitle.textContent = state.round.winnerIndex === null ? 'DRAW'
      : `PLAYER ${state.round.winnerIndex + 1} WINS ROUND`;
    goBody.innerHTML = `<p>MATCH ${state.match.scores[0]} — ${state.match.scores[1]}</p>`;
    el('go-continue').textContent = 'PRESS ENTER FOR NEXT ROUND';
  }

  function finishMatch() {
    show(gameover);
    goTitle.textContent = `PLAYER ${state.match.winnerIndex + 1} WINS THE MATCH`;
    goBody.innerHTML = `<p>FINAL ${state.match.scores[0]} — ${state.match.scores[1]}</p>`;
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

  function renderBoard(board) {
    if (!board.length) return '';
    const rows = board.map((r, i) =>
      `<div class="row"><span>${i+1}. ${r.name}</span><span>${r.time.toFixed(1)}s</span></div>`).join('');
    return `<div class="leaderboard"><h3>LEADERBOARD</h3>${rows}</div>`;
  }

  function loop(now) {
    state.raf = requestAnimationFrame(loop);
    if (state.phase !== 'playing') return;
    const dt = now - state.last; state.last = now;
    state.elapsed += dt / 1000; state.acc += dt;
    Audio.setIntensity(Math.min(1, state.elapsed / 60));
    const interval = Speed.tickInterval(state.elapsed);
    while (state.acc >= interval) {
      state.acc -= interval;
      Round.tick(state.round);
      if (state.round.over) { Renderer.render(ctx, state.round, cell); return endRound(); }
    }
    updateHud();
    Renderer.render(ctx, state.round, cell);
  }

  function beginGame(mode) {
    state.mode = mode;
    state.match = Match.createMatch(MATCH_TARGET);
    newRound(); startCountdown();
  }

  function onAction() {
    if (state.phase === 'gameover') { showMenu(); }
    else if (state.phase === 'roundover') { newRound(); startCountdown(); }
  }

  function showMenu() {
    state.phase = 'menu'; hud.classList.add('hidden'); Audio.stop();
    el('leaderboard').innerHTML = renderBoard(Leaderboard.load(window.localStorage));
    show(menu);
  }

  // wire input + menu buttons
  Input.attach({
    onDirection: (i, dir) => { if (state.phase === 'playing' && state.round.snakes[i])
      Snake.bufferDirection(state.round.snakes[i], dir); },
    onAction,
  });
  document.querySelectorAll('[data-mode]').forEach((btn) =>
    btn.addEventListener('click', () => beginGame(btn.dataset.mode)));
  el('go-continue').addEventListener('click', onAction);

  window.addEventListener('resize', () => {
    if (state.round) { const f = Renderer.fit(canvas, COLS, ROWS); cell = f.cell; ctx = f.ctx; }
  });

  showMenu();
  state.raf = requestAnimationFrame(loop);
})();

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const COLORS = ['#00f0ff', '#ff2bd6'];

  function fit(canvas, cols, rows) {
    const dpr = window.devicePixelRatio || 1;
    const cell = Math.floor(Math.min(window.innerWidth / cols, window.innerHeight / rows));
    canvas.width = cols * cell * dpr;
    canvas.height = rows * cell * dpr;
    canvas.style.width = cols * cell + 'px';
    canvas.style.height = rows * cell + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { cell, ctx };
  }

  function drawGrid(ctx, cols, rows, cell) {
    ctx.clearRect(0, 0, cols * cell, rows * cell);
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, cols * cell, rows * cell);
    ctx.strokeStyle = 'rgba(60,90,140,0.12)'; ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x++) { ctx.beginPath(); ctx.moveTo(x*cell, 0); ctx.lineTo(x*cell, rows*cell); ctx.stroke(); }
    for (let y = 0; y <= rows; y++) { ctx.beginPath(); ctx.moveTo(0, y*cell); ctx.lineTo(cols*cell, y*cell); ctx.stroke(); }
  }

  function drawSnake(ctx, snake, color, cell) {
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = cell * 0.9;
    ctx.fillStyle = color;
    for (const c of snake.body) {
      ctx.fillRect(c.x * cell + 1, c.y * cell + 1, cell - 2, cell - 2);
    }
    // brighter head
    const head = snake.body[snake.body.length - 1];
    ctx.shadowBlur = cell * 1.4; ctx.fillStyle = '#ffffff';
    ctx.fillRect(head.x * cell + cell*0.2, head.y * cell + cell*0.2, cell*0.6, cell*0.6);
    ctx.restore();
  }

  function render(ctx, round, cell) {
    const { board, snakes } = round;
    drawGrid(ctx, board.width, board.height, cell);
    snakes.forEach((s, i) => drawSnake(ctx, s, COLORS[i], cell));
  }

  return { __name: 'Renderer', COLORS, fit, drawGrid, drawSnake, render };
});

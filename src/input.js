(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const P1 = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  const P2 = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };

  // handlers: { onDirection(playerIndex, dir), onAction(), onTurbo(playerIndex, pressed) }
  function attach(handlers) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return; // held keys autorepeat; only real presses steer
      if (P1[e.code]) { handlers.onDirection(0, P1[e.code]); e.preventDefault(); }
      else if (P2[e.code]) { handlers.onDirection(1, P2[e.code]); e.preventDefault(); }
      else if (e.code === 'Enter' || e.code === 'Space') { handlers.onAction(); e.preventDefault(); }
      else if (e.code === 'ShiftRight' && handlers.onTurbo) { handlers.onTurbo(0, true); e.preventDefault(); }
      else if (e.code === 'ShiftLeft' && handlers.onTurbo) { handlers.onTurbo(1, true); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'ShiftRight' && handlers.onTurbo) { handlers.onTurbo(0, false); e.preventDefault(); }
      else if (e.code === 'ShiftLeft' && handlers.onTurbo) { handlers.onTurbo(1, false); e.preventDefault(); }
    });
  }
  return { __name: 'Input', P1, P2, attach };
});

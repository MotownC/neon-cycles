(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const P1 = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
  const P2 = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

  // handlers: { onDirection(playerIndex, dir), onAction() }
  function attach(handlers) {
    window.addEventListener('keydown', (e) => {
      if (P1[e.code]) { handlers.onDirection(0, P1[e.code]); e.preventDefault(); }
      else if (P2[e.code]) { handlers.onDirection(1, P2[e.code]); e.preventDefault(); }
      else if (e.code === 'Enter' || e.code === 'Space') { handlers.onAction(); e.preventDefault(); }
    });
  }
  return { __name: 'Input', P1, P2, attach };
});

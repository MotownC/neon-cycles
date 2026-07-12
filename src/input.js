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
      else if (e.code === 'Slash' && handlers.onFire) { handlers.onFire(0); e.preventDefault(); }
      else if (e.code === 'KeyQ' && handlers.onFire) { handlers.onFire(1); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'ShiftRight' && handlers.onTurbo) { handlers.onTurbo(0, false); e.preventDefault(); }
      else if (e.code === 'ShiftLeft' && handlers.onTurbo) { handlers.onTurbo(1, false); e.preventDefault(); }
    });
  }
  // Gamepad API is poll-only (no press/release events), so pollGamepads is
  // called once per rAF frame from main.js's loop() instead of being wired
  // via addEventListener like attach() above. Per-slot state below lets it
  // edge-detect direction/fire changes so a held stick/button doesn't fire
  // handlers.onDirection/onFire every single frame.
  const DPAD = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
  const STICK_DEADZONE = 0.5;
  const padState = [
    { dir: null, turbo: false, fire: false },
    { dir: null, turbo: false, fire: false },
  ];

  function stickDirection(gp) {
    const x = gp.axes[0] || 0, y = gp.axes[1] || 0;
    if (Math.abs(x) < STICK_DEADZONE && Math.abs(y) < STICK_DEADZONE) return null;
    return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
  }

  function padDirection(gp) {
    for (const code in DPAD) {
      if (gp.buttons[code] && gp.buttons[code].pressed) return DPAD[code];
    }
    return stickDirection(gp);
  }

  // Same connected-pad-to-player-slot mapping used by pollGamepads and
  // rumble: first two gamepads by connection order, slot 0 / slot 1.
  function connectedPads() {
    if (!navigator.getGamepads) return [];
    return Array.from(navigator.getGamepads())
      .filter(Boolean)
      .sort((a, b) => a.index - b.index)
      .slice(0, 2);
  }

  // handlers: same shape as attach() takes. Call once per animation frame.
  function pollGamepads(handlers) {
    connectedPads().forEach((gp, slot) => {
      const st = padState[slot];

      const dir = padDirection(gp);
      if (dir && dir !== st.dir) handlers.onDirection(slot, dir);
      st.dir = dir;

      const turboHeld = !!(gp.buttons[5] && gp.buttons[5].pressed)
        || !!(gp.buttons[7] && gp.buttons[7].pressed);
      if (turboHeld !== st.turbo && handlers.onTurbo) handlers.onTurbo(slot, turboHeld);
      st.turbo = turboHeld;

      const firePressed = !!(gp.buttons[0] && gp.buttons[0].pressed);
      if (firePressed && !st.fire) {
        if (handlers.onFire) handlers.onFire(slot);
        handlers.onAction();
      }
      st.fire = firePressed;
    });
  }

  // Fire-and-forget haptic feedback for playerIndex's own pad. No-ops
  // silently if that slot has no gamepad or the browser/pad doesn't support
  // the Haptics API — same "gamepad is optional" pattern as the rest of
  // this module.
  function rumble(playerIndex, { duration, strong, weak }) {
    const gp = connectedPads()[playerIndex];
    const actuator = gp && (gp.vibrationActuator
      || (gp.hapticActuators && gp.hapticActuators[0]));
    if (!actuator) return;
    if (actuator.playEffect) {
      actuator.playEffect('dual-rumble',
        { duration, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
    } else if (actuator.pulse) {
      actuator.pulse(strong, duration).catch(() => {});
    }
  }

  return { __name: 'Input', P1, P2, attach, pollGamepads, rumble };
});

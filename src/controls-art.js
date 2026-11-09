(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  // Inline SVG diagrams for the menu's CONTROLS panel. Returns markup strings
  // only; colors and glow live in styles.css under .art-key / .pad-*.

  // e.code -> who a key belongs to. Must agree with input.js (see the test).
  const ROLES = {
    ArrowUp: 'p1', ArrowDown: 'p1', ArrowLeft: 'p1', ArrowRight: 'p1',
    ShiftRight: 'p1', Slash: 'p1',
    KeyW: 'p2', KeyA: 'p2', KeyS: 'p2', KeyD: 'p2', ShiftLeft: 'p2', KeyQ: 'p2',
    Escape: 'shared', Enter: 'shared', Space: 'shared',
  };

  const UNIT = 40, GAP = 4, FN_ROW_GAP = 20;
  // One-unit keys from a string; only letters need a code.
  const keys = (s) => [...s].map((c) => [c, 1, /[A-Z]/.test(c) ? `Key${c}` : null]);
  const fnKeys = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => [`F${from + i}`, 1]);

  // A key is [label, widthInUnits, e.code]; a null label is a blank spacer.
  const KEY_ROWS = [
    [['ESC', 1, 'Escape'], [null, 1], ...fnKeys(1, 4), [null, 0.5], ...fnKeys(5, 8), [null, 0.5], ...fnKeys(9, 12)],
    [...keys('`1234567890-='), ['BKSP', 2]],
    [['TAB', 1.5], ...keys('QWERTYUIOP[]'), ['\\', 1.5]],
    [['CAPS', 1.75], ...keys('ASDFGHJKL;\''), ['ENTER', 2.25, 'Enter']],
    [['SHIFT', 2.25, 'ShiftLeft'], ...keys('ZXCVBNM,.'), ['/', 1, 'Slash'], ['SHIFT', 2.75, 'ShiftRight'],
      [null, 1.5], ['↑', 1, 'ArrowUp']],
    [['CTRL', 1.25], ['WIN', 1.25], ['ALT', 1.25], ['SPACE', 6.25, 'Space'], ['ALT', 1.25], ['FN', 1.25], ['MENU', 1.25], ['CTRL', 1.25],
      [null, 0.5], ['←', 1, 'ArrowLeft'], ['↓', 1, 'ArrowDown'], ['→', 1, 'ArrowRight']],
  ];

  const centered = (x, y, s) =>
    `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${s}</text>`;

  function keySvg(x, y, label, width, code) {
    const w = width * UNIT - GAP, h = UNIT - GAP, role = ROLES[code];
    return `<g class="art-key${role ? ` lit ${role}` : ''}"${code ? ` data-code="${code}"` : ''}>`
      + `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>`
      + `${centered(x + w / 2, y + h / 2, label)}</g>`;
  }

  function keyboardSvg() {
    let out = '';
    KEY_ROWS.forEach((row, r) => {
      const y = r * UNIT + (r > 0 ? FN_ROW_GAP : 0);
      let x = 0;
      row.forEach(([label, width, code]) => {
        if (label !== null) out += keySvg(x, y, label, width, code);
        x += width * UNIT;
      });
    });
    const desc = 'Keyboard. Player 1: arrow keys steer, Right Shift turbo, slash fires. '
      + 'Player 2: W A S D steer, Left Shift turbo, Q fires. Esc quits to menu, Enter or Space continues.';
    return `<svg viewBox="-3 -3 746 270" role="img" aria-label="${desc}">${out}</svg>`;
  }

  // part('on') lights a piece up; part('') leaves it dim.
  const part = (cls, shapes) => `<g class="art-key${cls ? ` lit ${cls}` : ''}">${shapes}</g>`;
  const circle = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}"/>`;
  const rrect = (x, y, w, h, rx) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;
  const stick = (x, y) => circle(x, y, 34) + circle(x, y, 22);
  const faceButton = (cls, x, y, s) => part(cls, circle(x, y, 17) + centered(x, y, s));
  const callout = (x1, y1, x2, y2) =>
    `<line class="pad-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  const padLabel = (x, y, anchor, s) =>
    `<text class="pad-label" x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="central">${s}</text>`;

  const PAD_BODY = 'M250 104 C215 98 190 104 172 128 C148 165 124 265 118 322 C114 362 140 388 170 376 '
    + 'C198 364 226 300 256 282 C272 274 448 274 464 282 C494 300 522 364 550 376 '
    + 'C580 388 606 362 602 322 C596 265 572 165 548 128 C530 104 505 98 470 104 C430 112 290 112 250 104 Z';
  const DPAD = 'M282 202 h20 v20 h20 v20 h-20 v20 h-20 v-20 h-20 v-20 h20 z';

  function controllerSvg() {
    const shoulders = part('', rrect(196, 40, 60, 40, 12) + centered(226, 59, 'LT'))
      + part('on', rrect(464, 40, 60, 40, 12) + centered(494, 59, 'RT'))
      + part('', rrect(176, 78, 100, 36, 10) + centered(226, 91, 'LB'))
      + part('on', rrect(444, 78, 100, 36, 10) + centered(494, 91, 'RB'));
    const controls = part('on', stick(232, 176))
      + part('on', `<path d="${DPAD}"/>`)
      + part('', stick(428, 232))
      + part('', rrect(319, 154, 22, 12, 6) + rrect(379, 154, 22, 12, 6) + circle(360, 128, 13))
      + faceButton('pad-a', 488, 212, 'A')
      + faceButton('', 524, 176, 'B')
      + faceButton('pad-x', 452, 176, 'X')
      + faceButton('', 488, 140, 'Y');
    const callouts = callout(198, 176, 104, 205) + callout(262, 232, 104, 205) + padLabel(96, 205, 'end', 'STEER')
      + callout(524, 60, 622, 76) + callout(544, 94, 622, 76) + padLabel(630, 76, 'start', 'HOLD: TURBO')
      + callout(505, 212, 622, 212) + padLabel(630, 212, 'start', 'FIRE / CONTINUE')
      + callout(446, 160, 385, 46) + padLabel(370, 32, 'middle', 'QUIT TO MENU');
    const desc = 'Xbox-style controller. D-pad or left stick steers, hold RB or RT for turbo, '
      + 'A fires and continues, X quits to menu.';
    return `<svg viewBox="-70 12 880 386" role="img" aria-label="${desc}">`
      + `${shoulders}<path class="pad-body" d="${PAD_BODY}"/>${controls}${callouts}</svg>`;
  }

  return { __name: 'ControlsArt', ROLES, keyboardSvg, controllerSvg };
});

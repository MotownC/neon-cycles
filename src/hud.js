(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  // In-game HUD panels and the results scoreboard, as markup strings plus the
  // small view-models behind them. No DOM here; styles live in styles.css
  // under .hud-* and .score-*. Names passed in are the game's own labels
  // (YOU, P1, rival names), never player-typed text.
  const MAX_ROUND_PIPS = 10; // above this a row of pips stops being readable

  // What the turbo bar shows: draining while burning, refilling on cooldown.
  function turboMeter(turbo, fuelMaxSec, cooldownMaxSec) {
    if (turbo.cooldown > 0) {
      return { state: 'cooldown', fill: 1 - turbo.cooldown / cooldownMaxSec, note: `${Math.ceil(turbo.cooldown)}s` };
    }
    const fill = turbo.fuel / fuelMaxSec;
    return { state: turbo.held && turbo.fuel > 0 ? 'burning' : 'ready', fill, note: '' };
  }

  // Rounds won out of the match target, or null when there are too many to draw.
  function rounds(won, target) { return target <= MAX_ROUND_PIPS ? { won, target } : null; }

  function pips(have, cap) {
    return Array.from({ length: cap }, (_, i) => (i < have ? '<i class="on"></i>' : '<i></i>')).join('');
  }

  // One player's panel. model: { side: 'left'|'right', color, name, score,
  // rounds?, turbo?, ammo?: { have, cap }, chips?: string[], sub?: string }
  function panel(m) {
    const parts = [`<div class="hud-top"><span class="hud-name">${m.name}</span><span class="hud-score">${m.score}</span></div>`];
    if (m.rounds) parts.push(`<div class="hud-rounds">${pips(m.rounds.won, m.rounds.target)}</div>`);
    if (m.turbo) {
      const pct = Math.round(Math.max(0, Math.min(1, m.turbo.fill)) * 100);
      parts.push(`<div class="hud-turbo ${m.turbo.state}"><span class="hud-label">TURBO</span>`
        + `<span class="hud-track"><i style="width:${pct}%"></i></span><span class="hud-note">${m.turbo.note}</span></div>`);
    }
    const chips = (m.chips || []).map((c) => `<span class="hud-chip">${c}</span>`).join('');
    if (m.ammo || chips) {
      const cells = m.ammo ? `<span class="hud-label">BOLTS</span><span class="hud-cells">${pips(m.ammo.have, m.ammo.cap)}</span>` : '';
      parts.push(`<div class="hud-ammo">${cells}${chips}</div>`);
    }
    if (m.sub) parts.push(`<div class="hud-sub">${m.sub}</div>`);
    return `<div class="hud-panel ${m.side}" style="--c:${m.color}">${parts.join('')}</div>`;
  }

  // Results screen: both scores, big. sides: two of { name, score, color }.
  function scoreboard(caption, [a, b]) {
    const side = (s, flip) => `<span class="score-side${flip ? ' flip' : ''}" style="--c:${s.color}"><em>${s.name}</em><b>${s.score}</b></span>`;
    return `<div class="scoreboard"><span class="score-cap">${caption}</span>`
      + `<div class="score-row">${side(a, false)}<span class="score-dash">:</span>${side(b, true)}</div></div>`;
  }

  return { __name: 'Hud', MAX_ROUND_PIPS, turboMeter, rounds, pips, panel, scoreboard };
});

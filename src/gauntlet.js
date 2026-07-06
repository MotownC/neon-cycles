(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const KEY = 'neon-cycles-gauntlet-best';
  // Rival ladder, easiest to hardest; keys index into CPU.PERSONALITIES.
  const STAGES = ['drifter', 'survivor', 'aggressor', 'ambusher', 'grandmaster'];
  const STAGE_TARGET = 3; // rounds to win each rival's match

  function createGauntlet() {
    return { stage: 0, over: false, victory: false };
  }

  // Feed in each finished stage match's winnerIndex (0 = player). A player
  // win advances the ladder; a rival win ends the run. `stage` doubles as
  // the count of rivals defeated, in both outcomes.
  function resolveMatch(gauntlet, winnerIndex) {
    if (winnerIndex === 0) {
      gauntlet.stage += 1;
      if (gauntlet.stage >= STAGES.length) { gauntlet.over = true; gauntlet.victory = true; }
    } else {
      gauntlet.over = true;
    }
    return gauntlet;
  }

  function loadBest(storage) {
    try {
      const n = parseInt(storage.getItem(KEY), 10);
      return Number.isInteger(n) && n >= 0 ? Math.min(n, STAGES.length) : 0;
    } catch (_) { return 0; }
  }

  // Persist the high-water mark of rivals defeated; a worse run never regresses it.
  function saveBest(storage, defeated) {
    const best = Math.max(loadBest(storage), defeated);
    try { storage.setItem(KEY, String(best)); } catch (_) { /* storage may be blocked */ }
    return best;
  }

  return { __name: 'Gauntlet', KEY, STAGES, STAGE_TARGET, createGauntlet, resolveMatch, loadBest, saveBest };
});

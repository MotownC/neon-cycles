(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  function createMatch(target = 10) {
    return { target, scores: [0, 0], over: false, winnerIndex: null };
  }
  function awardRound(match, winnerIndex) {
    if (winnerIndex === null || winnerIndex === undefined) return match;
    match.scores[winnerIndex] += 1;
    if (match.scores[winnerIndex] >= match.target) {
      match.over = true;
      match.winnerIndex = winnerIndex;
    }
    return match;
  }
  return { __name: 'Match', createMatch, awardRound };
});

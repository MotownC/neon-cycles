(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const KEY = 'neon-cycles-leaderboard';
  const MAX = 10;

  function load(storage) {
    try {
      const raw = storage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }
  function qualifies(board, time) {
    if (board.length < MAX) return true;
    return time > board[board.length - 1].time;
  }
  function insert(storage, board, name, time) {
    const next = board.concat([{ name: (name || '???').slice(0, 8), time }])
      .sort((a, b) => b.time - a.time)
      .slice(0, MAX);
    storage.setItem(KEY, JSON.stringify(next));
    return next;
  }
  return { __name: 'Leaderboard', KEY, MAX, load, qualifies, insert };
});

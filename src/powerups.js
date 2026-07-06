(function (root, factory) {
  const deps = typeof require === 'function' ? { B: require('./board') } : { B: window.Board };
  const api = factory(deps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function ({ B }) {
  const TYPES = ['shield', 'freeze', 'ammo', 'phase'];
  const SPAWN_START_SEC = 6;   // no pickups until this long into the round
  const SPAWN_INTERVAL_SEC = 12; // gap between spawns once below MAX_ACTIVE
  const RETRY_SEC = 1;        // how soon to retry after a failed/skipped spawn attempt
  const MAX_ACTIVE = 2;
  const FREEZE_SEC = 5;
  const SPAWN_ATTEMPTS = 60;

  const head = (snake) => snake.body[snake.body.length - 1];

  // A candidate cell must be open and reachable from every living snake's
  // head, so a pickup never spawns behind a wall only one player can reach.
  function findSpawnPoint(board, snakes, rand) {
    const maps = snakes.filter((s) => s.alive).map((s) => B.distanceMap(board, head(s)));
    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
      const c = { x: (rand() * board.width) | 0, y: (rand() * board.height) | 0 };
      if (B.isLit(board, c)) continue;
      const k = c.x + ',' + c.y;
      if (maps.every((m) => m.has(k))) return c;
    }
    return null;
  }

  function pickType(round, rand) {
    const pool = round.snakes.length > 1 ? TYPES : TYPES.filter((t) => t !== 'freeze');
    return pool[(rand() * pool.length) | 0];
  }

  function maybeSpawn(round, elapsedSec, rand = Math.random) {
    if (!round.pickups) round.pickups = [];
    if (round.nextSpawnAt === undefined) round.nextSpawnAt = SPAWN_START_SEC;
    if (elapsedSec < round.nextSpawnAt) return;
    if (round.pickups.length >= MAX_ACTIVE) { round.nextSpawnAt = elapsedSec + RETRY_SEC; return; }
    const pos = findSpawnPoint(round.board, round.snakes, rand);
    if (!pos) { round.nextSpawnAt = elapsedSec + RETRY_SEC; return; }
    round.pickups.push({ pos, type: pickType(round, rand), spawnedAt: elapsedSec });
    round.nextSpawnAt = elapsedSec + SPAWN_INTERVAL_SEC;
  }

  function apply(round, index, type, elapsedSec) {
    const snake = round.snakes[index];
    if (type === 'shield') snake.shield = true;
    else if (type === 'phase') snake.phase = true;
    else if (type === 'ammo') round.firedCount[index] = Math.max(0, round.firedCount[index] - 1);
    else if (type === 'freeze') {
      if (!round.frozenUntil) round.frozenUntil = round.snakes.map(() => 0);
      round.snakes.forEach((s, j) => { if (j !== index && s.alive) round.frozenUntil[j] = elapsedSec + FREEZE_SEC; });
    }
  }

  // Any living snake whose head sits on a pickup's cell claims it. Returns
  // the outcomes claimed this call so callers can drive SFX/flashes.
  function claim(round, elapsedSec) {
    const { snakes, pickups } = round;
    if (!pickups || !pickups.length) return [];
    const claimed = [];
    round.pickups = pickups.filter((p) => {
      const takerIndex = snakes.findIndex((s) => s.alive
        && head(s).x === p.pos.x && head(s).y === p.pos.y);
      if (takerIndex < 0) return true;
      apply(round, takerIndex, p.type, elapsedSec);
      claimed.push({ pos: p.pos, type: p.type, index: takerIndex });
      return false;
    });
    return claimed;
  }

  function frozenIndices(round, elapsedSec) {
    if (!round.frozenUntil) return [];
    return round.frozenUntil.reduce((acc, until, i) => {
      if (elapsedSec < until) acc.push(i);
      return acc;
    }, []);
  }

  return {
    __name: 'Powerups',
    TYPES, SPAWN_START_SEC, SPAWN_INTERVAL_SEC, MAX_ACTIVE, FREEZE_SEC,
    maybeSpawn, claim, frozenIndices,
  };
});

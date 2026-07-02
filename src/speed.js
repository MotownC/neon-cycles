(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const BASE_MS = 110;   // starting tick interval
  const FLOOR_MS = 55;   // fastest allowed
  const RAMP_PER_SEC = 1.1; // ms removed per elapsed second

  function tickInterval(elapsedSec) {
    return Math.max(FLOOR_MS, BASE_MS - elapsedSec * RAMP_PER_SEC);
  }
  return { __name: 'Speed', BASE_MS, FLOOR_MS, RAMP_PER_SEC, tickInterval };
});

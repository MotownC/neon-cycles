(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const BASE_MS = 110;   // starting tick interval
  const FLOOR_MS = 55;   // fastest allowed
  const RAMP_PER_SEC = 1.1; // ms removed per elapsed second

  const TURBO_MULTIPLIER = 0.81; // tick interval multiplied by this during turbo
  const TURBO_FUEL_SEC = 3;      // max seconds of turbo per charge
  const TURBO_COOLDOWN_SEC = 15; // cooldown after fuel is exhausted

  function tickInterval(elapsedSec) {
    return Math.max(FLOOR_MS, BASE_MS - elapsedSec * RAMP_PER_SEC);
  }

  function turboInterval(elapsedSec) {
    return Math.max(FLOOR_MS * TURBO_MULTIPLIER, tickInterval(elapsedSec) * TURBO_MULTIPLIER);
  }

  return {
    __name: 'Speed', BASE_MS, FLOOR_MS, RAMP_PER_SEC,
    TURBO_MULTIPLIER, TURBO_FUEL_SEC, TURBO_COOLDOWN_SEC,
    tickInterval, turboInterval,
  };
});

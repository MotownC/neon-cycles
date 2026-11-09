(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  const BASE_MS = 110;   // starting tick interval
  const FLOOR_MS = 55;   // fastest allowed
  const RAMP_PER_SEC = 1.1; // ms removed per elapsed second

  const TURBO_MULTIPLIER = 0.75; // tick interval multiplied by this during turbo
  const TURBO_FUEL_SEC = 3;      // max seconds of turbo per charge
  const TURBO_COOLDOWN_SEC = 15; // cooldown after fuel is exhausted

  // Skill level 1-5 scales every tick interval, base and floor alike, so a low
  // level stays slower for the whole speed ramp. 3 is the original pace.
  const SKILL_LEVELS = [1, 2, 3, 4, 5];
  const DEFAULT_SKILL = 3;
  const SKILL_SCALE = { 1: 1.5, 2: 1.22, 3: 1, 4: 0.85, 5: 0.72 };

  function skillScale(level) {
    return SKILL_SCALE[level] || 1;
  }

  function tickInterval(elapsedSec, level) {
    return Math.max(FLOOR_MS, BASE_MS - elapsedSec * RAMP_PER_SEC) * skillScale(level);
  }

  function turboInterval(elapsedSec, level) {
    return tickInterval(elapsedSec, level) * TURBO_MULTIPLIER;
  }

  return {
    __name: 'Speed', BASE_MS, FLOOR_MS, RAMP_PER_SEC,
    TURBO_MULTIPLIER, TURBO_FUEL_SEC, TURBO_COOLDOWN_SEC,
    SKILL_LEVELS, DEFAULT_SKILL, SKILL_SCALE, skillScale,
    tickInterval, turboInterval,
  };
});

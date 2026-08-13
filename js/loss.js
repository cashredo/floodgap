// js/loss.js — Monte Carlo flood-loss simulator. Pure; deps injected.
const Loss = {
  // mulberry32 — small, fast, seedable PRNG for reproducible simulations.
  seededRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  simulate(opts) {
    const {
      zone, subtype = null, homeValue, firstFloorElev = 0,
      N = 10000, rng = Math.random, hazard, depthDamage,
    } = opts;
    const losses = new Array(N);
    for (let i = 0; i < N; i++) {
      const depth = hazard.sampleAnnualMaxDepth(zone, subtype, rng);
      const effective = depth - firstFloorElev;
      const ratio = depthDamage.damageRatio(effective);
      losses[i] = Math.min(homeValue, homeValue * ratio);
    }
    losses.sort((x, y) => x - y);
    return losses;
  },
};
if (typeof module !== "undefined" && module.exports) module.exports = Loss;

// js/depthdamage.js — FEMA/USACE simplified one-story, no-basement depth-damage curve.
// Structural damage ratio as a function of water depth ABOVE the first floor (feet).
const DepthDamage = {
  // [depthFt, damageRatio]. Monotonic. Documented on the Methods page.
  _TABLE: [
    [0, 0.10], [1, 0.20], [2, 0.30], [3, 0.38], [4, 0.44], [5, 0.50],
    [6, 0.55], [7, 0.60], [8, 0.64], [10, 0.72], [12, 0.80], [15, 0.90],
  ],
  damageRatio(depthFt) {
    if (!(depthFt > 0)) return 0;
    const t = this._TABLE;
    if (depthFt >= t[t.length - 1][0]) return t[t.length - 1][1];
    for (let i = 0; i < t.length - 1; i++) {
      const [d0, r0] = t[i];
      const [d1, r1] = t[i + 1];
      if (depthFt >= d0 && depthFt <= d1) {
        const f = (depthFt - d0) / (d1 - d0);
        return Math.max(0, Math.min(1, r0 + f * (r1 - r0)));
      }
    }
    return 0;
  },
};
if (typeof module !== "undefined" && module.exports) module.exports = DepthDamage;

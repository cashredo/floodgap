// js/hazard.js — Gumbel stage-frequency curve per FEMA flood zone.
// depth(p) = mu - beta * ln(-ln(1 - p)), where p is the annual exceedance probability.
// mu, beta are fit per zone from anchor return periods (see Methods page).
const Hazard = {
  _params(zone, subtype) {
    const z = (zone || "").toUpperCase();
    if (z.startsWith("V")) return { mu: -1.830, beta: 1.702 };      // coastal, 10y~2ft 100y~6ft
    if (z === "AO" || z === "AH") return { mu: -0.849, beta: 0.511 }; // shallow sheet flow
    if (z.startsWith("A")) return { mu: -1.873, beta: 1.277 };       // riverine, 10y~1ft 100y~4ft
    const shaded = subtype && /0\.2|SHADED/i.test(subtype);
    if ((z === "X" || z === "B" || z === "C") && shaded) return { mu: -2.352, beta: 0.620 };
    return { mu: -3.5, beta: 0.5 };                                  // minimal / unknown: rarely floods
  },
  depthForProbability(zone, subtype, p) {
    const { mu, beta } = this._params(zone, subtype);
    return mu - beta * Math.log(-Math.log(1 - p));
  },
  sampleAnnualMaxDepth(zone, subtype, rng) {
    const { mu, beta } = this._params(zone, subtype);
    let u = rng();
    if (u <= 0) u = 1e-12;
    if (u >= 1) u = 1 - 1e-12;
    const depth = mu - beta * Math.log(-Math.log(u)); // u = non-exceedance prob
    return Math.max(0, depth);
  },
};
if (typeof module !== "undefined" && module.exports) module.exports = Hazard;

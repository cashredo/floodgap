// js/insurance.js — turn risk metrics into an insurance decision. Pure.
const Insurance = {
  fairPremium(eal) { return eal; },
  // Exponential (CARA) utility: certainty-equivalent premium pi = (1/a) ln E[e^{a L}].
  // This is the most a homeowner with risk-aversion `a` should rationally pay; pi >= EAL.
  certaintyEquivalentPremium(losses, a) {
    const mean = losses.reduce((s, x) => s + x, 0) / losses.length;
    if (!(a > 0)) return mean;
    let m = 0;
    for (const l of losses) m += Math.exp(a * l);
    m /= losses.length;
    return Math.log(m) / a;
  },
  // NPV of insuring: sum of (avoided expected loss - premium), discounted, with a climate trend.
  thirtyYearNPV({ eal, premium, discountRate = 0.03, climateTrend = 0.01, years = 30 }) {
    let npv = 0;
    for (let t = 1; t <= years; t++) {
      const expectedLoss = eal * Math.pow(1 + climateTrend, t);
      npv += (expectedLoss - premium) / Math.pow(1 + discountRate, t);
    }
    return npv;
  },
};
if (typeof module !== "undefined" && module.exports) module.exports = Insurance;

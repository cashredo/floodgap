// js/insurance.js — turn risk metrics into an insurance decision. Pure.
const Insurance = {
  fairPremium(eal) { return eal; },
  // Exponential (CARA) utility: certainty-equivalent premium pi = (1/a) ln E[e^{a L}].
  // This is the most a homeowner with risk-aversion `a` should rationally pay; pi >= EAL.
  certaintyEquivalentPremium(losses, a) {
    const mean = losses.reduce((s, x) => s + x, 0) / losses.length;
    if (!(a > 0)) return mean;
    // log-sum-exp form: pi = Lmax + (1/a) ln( (1/N) sum e^{a (L - Lmax)} ).
    // Mathematically identical to (1/a) ln E[e^{aL}] but overflow-safe, since
    // every exponent a(L - Lmax) <= 0 (naive e^{aL} overflows for huge losses).
    let lmax = losses[0];
    for (const l of losses) if (l > lmax) lmax = l;
    let s = 0;
    for (const l of losses) s += Math.exp(a * (l - lmax));
    return lmax + Math.log(s / losses.length) / a;
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

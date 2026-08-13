// js/riskmetrics.js — summarize a loss sample into actuarial/quant risk metrics.
// Expects `losses` sorted ascending.
const RiskMetrics = {
  expectedAnnualLoss(losses) {
    return losses.reduce((s, x) => s + x, 0) / losses.length;
  },
  valueAtRisk(losses, alpha) {
    const idx = Math.min(losses.length - 1, Math.floor(alpha * losses.length));
    return losses[idx];
  },
  conditionalVaR(losses, alpha) {
    const idx = Math.min(losses.length - 1, Math.floor(alpha * losses.length));
    let sum = 0;
    for (let i = idx; i < losses.length; i++) sum += losses[i];
    return sum / (losses.length - idx);
  },
  exceedanceProbability(losses, threshold) {
    let n = 0;
    for (const l of losses) if (l > threshold) n++;
    return n / losses.length;
  },
  // Normal approximation on the mean (deterministic). A bootstrap is a drop-in alternative.
  confidenceInterval(losses, level) {
    const n = losses.length;
    const mean = this.expectedAnnualLoss(losses);
    let v = 0;
    for (const l of losses) v += (l - mean) * (l - mean);
    const stderr = Math.sqrt(v / n) / Math.sqrt(n);
    const z = level >= 0.95 ? 1.96 : 1.645; // 95% or 90%
    return { lo: mean - z * stderr, hi: mean + z * stderr };
  },
};
if (typeof module !== "undefined" && module.exports) module.exports = RiskMetrics;

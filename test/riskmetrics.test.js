const test = require("node:test");
const assert = require("node:assert/strict");
const RM = require("../js/riskmetrics.js");

const sample = []; // 99 zeros then one 100000 -> tail lives at the top
for (let i = 0; i < 99; i++) sample.push(0);
sample.push(100000);

test("EAL is the mean", () => {
  assert.equal(RM.expectedAnnualLoss(sample), 1000); // 100000 / 100
});

test("VaR at 0.99 picks the tail loss", () => {
  assert.equal(RM.valueAtRisk(sample, 0.99), 100000);
});

test("CVaR >= VaR >= EAL", () => {
  const eal = RM.expectedAnnualLoss(sample);
  const var99 = RM.valueAtRisk(sample, 0.99);
  const cvar99 = RM.conditionalVaR(sample, 0.99);
  assert.ok(cvar99 >= var99 && var99 >= eal);
});

test("exceedance probability counts losses above a threshold", () => {
  assert.equal(RM.exceedanceProbability(sample, 50000), 0.01);
});

test("confidence interval brackets the mean", () => {
  const { lo, hi } = RM.confidenceInterval(sample, 0.90);
  const eal = RM.expectedAnnualLoss(sample);
  assert.ok(lo <= eal && eal <= hi);
});

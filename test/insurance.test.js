const test = require("node:test");
const assert = require("node:assert/strict");
const Insurance = require("../js/insurance.js");

test("fair premium equals EAL", () => {
  assert.equal(Insurance.fairPremium(1234), 1234);
});

test("a risk-averse homeowner should pay more than the fair premium", () => {
  const losses = [0, 100000];
  const fair = (0 + 100000) / 2; // 50000
  const ce = Insurance.certaintyEquivalentPremium(losses, 1e-5);
  assert.ok(ce > fair);
});

test("zero risk aversion collapses to the fair premium", () => {
  const losses = [0, 100000];
  assert.ok(Math.abs(Insurance.certaintyEquivalentPremium(losses, 0) - 50000) < 1e-6);
});

test("NPV is zero when premium equals expected loss and no trend/discount", () => {
  const npv = Insurance.thirtyYearNPV({ eal: 1000, premium: 1000, discountRate: 0, climateTrend: 0, years: 1 });
  assert.equal(npv, 0);
});

test("NPV favors insuring when expected loss exceeds premium", () => {
  const npv = Insurance.thirtyYearNPV({ eal: 2000, premium: 1000, discountRate: 0, climateTrend: 0, years: 1 });
  assert.equal(npv, 1000);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const Loss = require("../js/loss.js");
const DepthDamage = require("../js/depthdamage.js");

test("with a constant-depth hazard, every simulated loss equals value x ratio", () => {
  const fakeHazard = { sampleAnnualMaxDepth: () => 3 }; // always 3 ft
  const losses = Loss.simulate({
    zone: "AE", subtype: null, homeValue: 300000, N: 1000,
    hazard: fakeHazard, depthDamage: DepthDamage,
  });
  assert.equal(losses.length, 1000);
  const expected = 300000 * DepthDamage.damageRatio(3); // 0.38 -> 114000
  assert.equal(losses[0], expected);
  assert.equal(losses[losses.length - 1], expected);
});

test("output is sorted ascending", () => {
  const losses = Loss.simulate({
    zone: "AE", subtype: null, homeValue: 300000, N: 500,
    rng: Loss.seededRng(42), hazard: require("../js/hazard.js"), depthDamage: DepthDamage,
  });
  for (let i = 1; i < losses.length; i++) assert.ok(losses[i] >= losses[i - 1]);
});

test("seeded RNG is reproducible", () => {
  const r1 = Loss.seededRng(7), r2 = Loss.seededRng(7);
  assert.equal(r1(), r2());
});

test("first-floor elevation reduces losses", () => {
  const Hazard = require("../js/hazard.js");
  const base = Loss.simulate({ zone: "AE", subtype: null, homeValue: 300000, N: 2000, rng: Loss.seededRng(1), hazard: Hazard, depthDamage: DepthDamage });
  const raised = Loss.simulate({ zone: "AE", subtype: null, homeValue: 300000, firstFloorElev: 3, N: 2000, rng: Loss.seededRng(1), hazard: Hazard, depthDamage: DepthDamage });
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  assert.ok(mean(raised) < mean(base));
});

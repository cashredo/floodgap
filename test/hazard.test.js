const test = require("node:test");
const assert = require("node:assert/strict");
const Hazard = require("../js/hazard.js");

test("AE zone reproduces its anchor return periods", () => {
  // fit anchors: 10-yr (p=0.10) ~ 1 ft, 100-yr (p=0.01) ~ 4 ft
  assert.ok(Math.abs(Hazard.depthForProbability("AE", null, 0.10) - 1) < 0.02);
  assert.ok(Math.abs(Hazard.depthForProbability("AE", null, 0.01) - 4) < 0.02);
});

test("depth increases as probability gets rarer (monotonic)", () => {
  const d10 = Hazard.depthForProbability("AE", null, 0.10);
  const d100 = Hazard.depthForProbability("AE", null, 0.01);
  const d500 = Hazard.depthForProbability("AE", null, 0.002);
  assert.ok(d500 > d100 && d100 > d10);
});

test("sampling never returns negative depth", () => {
  const rng = () => 0.001; // a very dry draw
  assert.ok(Hazard.sampleAnnualMaxDepth("X", null, rng) >= 0);
});

test("shaded X is riskier than unshaded X", () => {
  const shaded = Hazard.depthForProbability("X", "0.2 PCT ANNUAL CHANCE FLOOD HAZARD", 0.01);
  const plain = Hazard.depthForProbability("X", null, 0.01);
  assert.ok(shaded > plain);
});

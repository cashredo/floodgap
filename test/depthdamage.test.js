const test = require("node:test");
const assert = require("node:assert/strict");
const DepthDamage = require("../js/depthdamage.js");

test("no water above the floor means no damage", () => {
  assert.equal(DepthDamage.damageRatio(0), 0);
  assert.equal(DepthDamage.damageRatio(-2), 0);
});

test("table anchor points are exact", () => {
  assert.equal(DepthDamage.damageRatio(1), 0.20);
  assert.equal(DepthDamage.damageRatio(4), 0.44);
});

test("interpolates linearly between anchors", () => {
  // halfway between (0,0.10) and (1,0.20)
  assert.ok(Math.abs(DepthDamage.damageRatio(0.5) - 0.15) < 1e-9);
});

test("clamps deep water to the table maximum", () => {
  assert.equal(DepthDamage.damageRatio(50), 0.90);
});

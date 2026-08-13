const test = require("node:test");
const assert = require("node:assert/strict");
const Charts = require("../js/charts.js");
const DepthDamage = require("../js/depthdamage.js");

test("depth-damage curve returns an SVG with a plotted path and a current marker", () => {
  const svg = Charts.depthDamageCurve(DepthDamage, { currentDepth: 3, baseFloodDepth: 4 });
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("<path"));
  assert.ok(svg.includes('class="dd-marker"'));
});

test("claims-by-year highlights the target year", () => {
  const svg = Charts.claimsByYearBars(
    [{ year: 2001, count: 2 }, { year: 2017, count: 40 }],
    { highlightYear: 2017 }
  );
  assert.ok(svg.includes("<svg"));
  assert.ok(svg.includes('class="bar bar-highlight"'));
});

test("empty claims data still returns valid SVG (no crash)", () => {
  const svg = Charts.claimsByYearBars([], {});
  assert.ok(svg.startsWith("<svg"));
});

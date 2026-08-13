# FloodGap Risk Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Monte Carlo catastrophe-model risk engine to FloodGap that produces a full loss distribution, quant risk metrics (EAL/VaR/CVaR), an expected-utility insurance decision, supporting SVG charts, and a "The Math" methods page.

**Architecture:** Pure, dependency-injected JS math modules (`hazard → depthdamage → loss → riskmetrics → insurance`) with a thin data layer (`fema.js`) and orchestrator (`app.js`). Math modules carry a dual-export shim so the same file runs as a browser global (via `<script>`) and a Node module (via `require`) for unit testing. UI and docs are additive — the existing search/zone/claims/gap flow is untouched.

**Tech Stack:** Vanilla ES2020 JS (no framework, no bundler), Leaflet (already present), hand-rolled inline SVG for charts (no chart lib), Node's built-in `node:test` + `node:assert/strict` for tests (zero dependencies), Flask (existing, optional AI explainer).

## Global Constraints

- No new runtime dependencies; no paid APIs; no API keys beyond the existing optional `GROQ_API_KEY`/`GEMINI_API_KEY`.
- Every math module is a global-singleton object (`const Name = { ... }`) matching the existing `Fema`/`GapCalc` pattern, and ends with: `if (typeof module !== "undefined" && module.exports) module.exports = Name;`
- Math modules are **pure** — no DOM, no `fetch`, no `window`. Cross-module dependencies are passed in as parameters (dependency injection), never referenced as globals inside a module.
- Dollar amounts render via `GapCalc.formatUSD`. Existing files unchanged except where a task says "Modify".
- All model assumptions (zone anchor depths, damage table, risk-aversion `a`, discount rate `r`, climate trend `g`, default first-floor elevation) must appear on the Methods page verbatim.
- Test files live in `test/`, named `*.test.js`, run with `node --test`.
- Commit after every task with the message shown.

---

### Task 1: Test harness + DepthDamage module

**Files:**
- Create: `js/depthdamage.js`
- Test: `test/depthdamage.test.js`

**Interfaces:**
- Produces: `DepthDamage.damageRatio(depthAboveFirstFloorFt: number) → number` in `[0,1]`.

- [ ] **Step 1: Write the failing test**

```js
// test/depthdamage.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/depthdamage.test.js`
Expected: FAIL — `Cannot find module '../js/depthdamage.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// js/depthdamage.js — FEMA/USACE simplified one-story, no-basement depth-damage curve.
// Structural damage ratio as a function of water depth ABOVE the first floor (feet).
const DepthDamage = {
  // [depthFt, damageRatio]. Monotonic. Documented on the Methods page.
  _TABLE: [
    [0, 0.10], [1, 0.20], [2, 0.30], [3, 0.38], [4, 0.44], [5, 0.50],
    [6, 0.55], [7, 0.60], [8, 0.64], [10, 0.72], [12, 0.80], [15, 0.90],
  ],
  damageRatio(depthFt) {
    if (!(depthFt > 0)) return 0;
    const t = this._TABLE;
    if (depthFt >= t[t.length - 1][0]) return t[t.length - 1][1];
    for (let i = 0; i < t.length - 1; i++) {
      const [d0, r0] = t[i];
      const [d1, r1] = t[i + 1];
      if (depthFt >= d0 && depthFt <= d1) {
        const f = (depthFt - d0) / (d1 - d0);
        return Math.max(0, Math.min(1, r0 + f * (r1 - r0)));
      }
    }
    return 0;
  },
};
if (typeof module !== "undefined" && module.exports) module.exports = DepthDamage;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/depthdamage.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add js/depthdamage.js test/depthdamage.test.js
git commit -m "feat: depth-damage curve module with unit tests"
```

---

### Task 2: Hazard (stage-frequency) module

**Files:**
- Create: `js/hazard.js`
- Test: `test/hazard.test.js`

**Interfaces:**
- Produces:
  - `Hazard.depthForProbability(zone: string, subtype: string|null, p: number) → feet` (p = annual exceedance probability)
  - `Hazard.sampleAnnualMaxDepth(zone: string, subtype: string|null, rng: () => number) → feet` (≥ 0)

- [ ] **Step 1: Write the failing test**

```js
// test/hazard.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/hazard.test.js`
Expected: FAIL — `Cannot find module '../js/hazard.js'`

- [ ] **Step 3: Write minimal implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/hazard.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add js/hazard.js test/hazard.test.js
git commit -m "feat: Gumbel stage-frequency hazard module with unit tests"
```

---

### Task 3: Loss (Monte Carlo) module

**Files:**
- Create: `js/loss.js`
- Test: `test/loss.test.js`

**Interfaces:**
- Consumes: `Hazard.sampleAnnualMaxDepth`, `DepthDamage.damageRatio` (passed in via `opts.hazard` / `opts.depthDamage`).
- Produces:
  - `Loss.seededRng(seed: number) → () => number`
  - `Loss.simulate(opts) → number[]` sorted ascending, length `N`. `opts = { zone, subtype, homeValue, firstFloorElev=0, N=10000, rng=Math.random, hazard, depthDamage }`.

- [ ] **Step 1: Write the failing test**

```js
// test/loss.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/loss.test.js`
Expected: FAIL — `Cannot find module '../js/loss.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// js/loss.js — Monte Carlo flood-loss simulator. Pure; deps injected.
const Loss = {
  // mulberry32 — small, fast, seedable PRNG for reproducible simulations.
  seededRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  simulate(opts) {
    const {
      zone, subtype = null, homeValue, firstFloorElev = 0,
      N = 10000, rng = Math.random, hazard, depthDamage,
    } = opts;
    const losses = new Array(N);
    for (let i = 0; i < N; i++) {
      const depth = hazard.sampleAnnualMaxDepth(zone, subtype, rng);
      const effective = depth - firstFloorElev;
      const ratio = depthDamage.damageRatio(effective);
      losses[i] = Math.min(homeValue, homeValue * ratio);
    }
    losses.sort((x, y) => x - y);
    return losses;
  },
};
if (typeof module !== "undefined" && module.exports) module.exports = Loss;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/loss.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add js/loss.js test/loss.test.js
git commit -m "feat: Monte Carlo loss simulator with seeded RNG and unit tests"
```

---

### Task 4: RiskMetrics module

**Files:**
- Create: `js/riskmetrics.js`
- Test: `test/riskmetrics.test.js`

**Interfaces:**
- Consumes: a sorted-ascending `losses: number[]`.
- Produces:
  - `RiskMetrics.expectedAnnualLoss(losses) → number`
  - `RiskMetrics.valueAtRisk(losses, alpha) → number`
  - `RiskMetrics.conditionalVaR(losses, alpha) → number`
  - `RiskMetrics.exceedanceProbability(losses, threshold) → number`
  - `RiskMetrics.confidenceInterval(losses, level) → { lo, hi }`

- [ ] **Step 1: Write the failing test**

```js
// test/riskmetrics.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/riskmetrics.test.js`
Expected: FAIL — `Cannot find module '../js/riskmetrics.js'`

- [ ] **Step 3: Write minimal implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/riskmetrics.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add js/riskmetrics.js test/riskmetrics.test.js
git commit -m "feat: risk metrics (EAL, VaR, CVaR, exceedance, CI) with unit tests"
```

---

### Task 5: Insurance decision module

**Files:**
- Create: `js/insurance.js`
- Test: `test/insurance.test.js`

**Interfaces:**
- Consumes: `losses: number[]`, and scalar EAL/premium.
- Produces:
  - `Insurance.fairPremium(eal) → number`
  - `Insurance.certaintyEquivalentPremium(losses, a) → number`
  - `Insurance.thirtyYearNPV({ eal, premium, discountRate=0.03, climateTrend=0.01, years=30 }) → number`

- [ ] **Step 1: Write the failing test**

```js
// test/insurance.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/insurance.test.js`
Expected: FAIL — `Cannot find module '../js/insurance.js'`

- [ ] **Step 3: Write minimal implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/insurance.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add js/insurance.js test/insurance.test.js
git commit -m "feat: insurance decision model (CE premium, 30-yr NPV) with unit tests"
```

---

### Task 6: Data layer — claims-by-year + market premium

**Files:**
- Modify: `js/fema.js` (add `_aggregateByYear`, `claimsByYear`, `marketPremium`)
- Test: `test/fema.test.js`

**Interfaces:**
- Consumes: existing `Fema` object.
- Produces:
  - `Fema._aggregateByYear(rows: {yearOfLoss:number}[]) → {year:number,count:number}[]` sorted ascending (pure, tested).
  - `Fema.claimsByYear(zip) → Promise<{year,count}[]>` (best-effort; `[]` on failure).
  - `Fema.marketPremium(zip, level) → Promise<number>` (live OpenFEMA Policies avg; benchmark fallback by risk level).

- [ ] **Step 1: Write the failing test** (only the pure aggregator is unit-tested; network methods degrade gracefully)

```js
// test/fema.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Fema = require("../js/fema.js");

test("aggregateByYear counts claims per year, sorted ascending", () => {
  const rows = [
    { yearOfLoss: 2017 }, { yearOfLoss: 2017 }, { yearOfLoss: 2001 }, { yearOfLoss: 2017 }, { yearOfLoss: 2019 },
  ];
  const out = Fema._aggregateByYear(rows);
  assert.deepEqual(out, [
    { year: 2001, count: 1 },
    { year: 2017, count: 3 },
    { year: 2019, count: 1 },
  ]);
});

test("aggregateByYear ignores rows with no year", () => {
  const out = Fema._aggregateByYear([{ yearOfLoss: null }, { yearOfLoss: 2010 }]);
  assert.deepEqual(out, [{ year: 2010, count: 1 }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/fema.test.js`
Expected: FAIL — `TypeError: Fema._aggregateByYear is not a function`

> Note: `js/fema.js` currently has no export shim. Step 3 adds one so `require` works. In the browser `Fema` remains a global exactly as before.

- [ ] **Step 3: Write minimal implementation** — add these methods inside the `Fema` object (before the closing `};`) and the export shim after it:

```js
  // Aggregate raw claim rows into {year,count}[] sorted ascending. Pure.
  _aggregateByYear(rows) {
    const byYear = new Map();
    for (const r of rows || []) {
      const y = Number(r.yearOfLoss);
      if (!Number.isFinite(y)) continue;
      byYear.set(y, (byYear.get(y) || 0) + 1);
    }
    return [...byYear.entries()]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year);
  },

  // Claims per year for a ZIP (best-effort; capped fetch like claimsByZip).
  async claimsByYear(zip) {
    if (!zip) return [];
    try {
      const url =
        "https://www.fema.gov/api/open/v2/FimaNfipClaims" +
        "?$filter=reportedZipCode%20eq%20%27" + encodeURIComponent(zip) + "%27" +
        "&$top=10000&$select=yearOfLoss";
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return this._aggregateByYear(data?.FimaNfipClaims || []);
    } catch {
      return [];
    }
  },

  // Average annual NFIP premium for a ZIP. Live OpenFEMA Policies with a
  // documented benchmark fallback by risk level (see Methods page).
  async marketPremium(zip, level) {
    const benchmark = level === "high" ? 1200 : level === "moderate" ? 700 : 500;
    if (!zip) return benchmark;
    try {
      const url =
        "https://www.fema.gov/api/open/v2/FimaNfipPolicies" +
        "?$filter=reportedZipCode%20eq%20%27" + encodeURIComponent(zip) + "%27" +
        "&$top=2000&$select=totalInsurancePremiumOfThePolicy";
      const res = await fetch(url);
      if (!res.ok) return benchmark;
      const data = await res.json();
      const rows = data?.FimaNfipPolicies || [];
      const vals = rows
        .map((r) => Number(r.totalInsurancePremiumOfThePolicy))
        .filter((v) => Number.isFinite(v) && v > 0);
      if (vals.length === 0) return benchmark;
      return Math.round(vals.reduce((s, x) => s + x, 0) / vals.length);
    } catch {
      return benchmark;
    }
  },
```

Then after the closing `};` of the `Fema` object, add:

```js
if (typeof module !== "undefined" && module.exports) module.exports = Fema;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/fema.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add js/fema.js test/fema.test.js
git commit -m "feat: claims-by-year aggregation and market-premium fetch with fallback"
```

---

### Task 7: SVG chart builders

**Files:**
- Create: `js/charts.js`
- Test: `test/charts.test.js`

**Interfaces:**
- Produces (all return an SVG string, pure):
  - `Charts.depthDamageCurve(depthDamage, { currentDepth, baseFloodDepth, maxDepth=12, width=320, height=180 }) → string`
  - `Charts.claimsByYearBars(yearData, { highlightYear=2017, width=320, height=160 }) → string`
  - `Charts.lossExceedance(losses, riskMetrics, { width=320, height=160 }) → string`

- [ ] **Step 1: Write the failing test**

```js
// test/charts.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/charts.test.js`
Expected: FAIL — `Cannot find module '../js/charts.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// js/charts.js — hand-rolled inline SVG charts. Pure string builders, no deps.
const Charts = {
  _svg(w, h, inner) {
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet" role="img">${inner}</svg>`;
  },
  depthDamageCurve(depthDamage, opts = {}) {
    const { currentDepth = 0, baseFloodDepth = null, maxDepth = 12, width = 320, height = 180 } = opts;
    const pad = 28;
    const x = (d) => pad + (d / maxDepth) * (width - 2 * pad);
    const y = (r) => height - pad - r * (height - 2 * pad);
    let path = "";
    for (let d = 0; d <= maxDepth; d += 0.5) {
      path += (d === 0 ? "M" : "L") + x(d).toFixed(1) + " " + y(depthDamage.damageRatio(d)).toFixed(1) + " ";
    }
    const axes =
      `<line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="axis"/>` +
      `<line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" class="axis"/>`;
    const bfe = baseFloodDepth != null
      ? `<line x1="${x(baseFloodDepth).toFixed(1)}" y1="${pad}" x2="${x(baseFloodDepth).toFixed(1)}" y2="${height - pad}" class="dd-bfe"/>`
      : "";
    const marker =
      `<circle class="dd-marker" cx="${x(currentDepth).toFixed(1)}" cy="${y(depthDamage.damageRatio(currentDepth)).toFixed(1)}" r="5"/>`;
    return this._svg(width, height, axes + bfe + `<path class="dd-line" d="${path}" fill="none"/>` + marker);
  },
  claimsByYearBars(yearData, opts = {}) {
    const { highlightYear = 2017, width = 320, height = 160 } = opts;
    const pad = 24;
    if (!yearData || yearData.length === 0) {
      return this._svg(width, height, `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="empty">No dated claims</text>`);
    }
    const max = Math.max(...yearData.map((d) => d.count), 1);
    const bw = (width - 2 * pad) / yearData.length;
    let bars = "";
    yearData.forEach((d, i) => {
      const h = (d.count / max) * (height - 2 * pad);
      const bx = pad + i * bw;
      const by = height - pad - h;
      const cls = d.year === highlightYear ? "bar bar-highlight" : "bar";
      bars += `<rect class="${cls}" x="${(bx + 1).toFixed(1)}" y="${by.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}"><title>${d.year}: ${d.count}</title></rect>`;
    });
    const axis = `<line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="axis"/>`;
    return this._svg(width, height, axis + bars);
  },
  lossExceedance(losses, riskMetrics, opts = {}) {
    const { width = 320, height = 160 } = opts;
    const pad = 28;
    const n = losses.length;
    const maxL = losses[n - 1] || 1;
    let path = "";
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 60))) {
      const p = 1 - i / n; // exceedance probability
      const px = pad + (1 - p) * 0 + (losses[i] / maxL) * (width - 2 * pad);
      const py = pad + (1 - p) * (height - 2 * pad);
      path += (path === "" ? "M" : "L") + px.toFixed(1) + " " + py.toFixed(1) + " ";
    }
    const axes =
      `<line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="axis"/>` +
      `<line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" class="axis"/>`;
    return this._svg(width, height, axes + `<path class="le-line" d="${path}" fill="none"/>`);
  },
};
if (typeof module !== "undefined" && module.exports) module.exports = Charts;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/charts.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add js/charts.js test/charts.test.js
git commit -m "feat: inline-SVG chart builders (depth-damage, claims-by-year, exceedance)"
```

---

### Task 8: Risk-engine UI (HTML cards + CSS + script tags)

**Files:**
- Modify: `index.html` (add three cards after the gap card; add script tags)
- Modify: `css/style.css` (append chart + card styles)

**Interfaces:**
- Consumes: element IDs wired in Task 9.
- Produces: DOM elements `#risk-card`, `#depth-slider`, `#ffe-input`, `#dd-chart`, `#eal-val`, `#var-val`, `#cvar-val`, `#insure-card`, `#fair-prem`, `#market-prem`, `#ce-prem`, `#npv-val`, `#history-card`, `#year-chart`, and the five new `<script>` tags + `charts.js`.

- [ ] **Step 1: Add the script tags.** In `index.html`, replace the line `<script src="js/gapcalc.js"></script>` with:

```html
    <script src="js/gapcalc.js"></script>
    <script src="js/depthdamage.js"></script>
    <script src="js/hazard.js"></script>
    <script src="js/loss.js"></script>
    <script src="js/riskmetrics.js"></script>
    <script src="js/insurance.js"></script>
    <script src="js/charts.js"></script>
```

- [ ] **Step 2: Add the cards.** In `index.html`, immediately after the closing `</div>` of the `gap-card` (the `<!-- Gap calculator -->` block) and before `<!-- Plain-English explanation -->`, insert:

```html
                <!-- Risk model -->
                <div class="card risk-model-card" id="risk-card">
                    <h2><i data-lucide="activity"></i> Your flood risk, modeled</h2>
                    <p class="detail">We simulate 10,000 possible years of weather for your zone and read off the risk.</p>
                    <div class="risk-inputs">
                        <label>First-floor height above ground (ft)
                            <input type="number" id="ffe-input" value="1" min="0" max="15" step="0.5" />
                        </label>
                        <label>Explore a flood depth: <span id="depth-readout">3.0 ft</span>
                            <input type="range" id="depth-slider" min="0" max="12" step="0.5" value="3" />
                        </label>
                    </div>
                    <div id="dd-chart" class="chart" aria-label="Depth-damage curve"></div>
                    <div class="metric-row">
                        <div class="metric"><span class="metric-label">Expected annual loss</span><span class="metric-val" id="eal-val">—</span></div>
                        <div class="metric"><span class="metric-label">1-in-100 year loss (VaR)</span><span class="metric-val" id="var-val">—</span></div>
                        <div class="metric"><span class="metric-label">Catastrophic-year avg (CVaR)</span><span class="metric-val" id="cvar-val">—</span></div>
                    </div>
                </div>

                <!-- Insurance decision -->
                <div class="card insure-card" id="insure-card">
                    <h2><i data-lucide="scale"></i> Should you insure?</h2>
                    <div class="metric-row">
                        <div class="metric"><span class="metric-label">Fair-value premium</span><span class="metric-val" id="fair-prem">—</span></div>
                        <div class="metric"><span class="metric-label">Typical market premium</span><span class="metric-val" id="market-prem">—</span></div>
                        <div class="metric"><span class="metric-label">Worth it up to</span><span class="metric-val" id="ce-prem">—</span></div>
                    </div>
                    <p class="detail" id="npv-val">—</p>
                    <p class="detail methods-link"><a href="methods.html">See the math behind these numbers →</a></p>
                </div>

                <!-- Flood history -->
                <div class="card history-card" id="history-card">
                    <h2><i data-lucide="bar-chart-3"></i> Flood claims by year</h2>
                    <div id="year-chart" class="chart" aria-label="NFIP claims by year"></div>
                    <p class="detail">NFIP claims paid in this ZIP each year. Harvey (2017) is highlighted.</p>
                </div>
```

- [ ] **Step 3: Append styles.** Add to the end of `css/style.css`:

```css
/* Risk engine */
.risk-inputs { display: grid; gap: 0.75rem; margin: 0.5rem 0 1rem; }
.risk-inputs label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; }
.risk-inputs input[type="range"] { width: 100%; }
.chart { width: 100%; margin: 0.5rem 0; }
.chart .axis { stroke: var(--border, #cbd5e1); stroke-width: 1; }
.chart .dd-line { stroke: var(--accent, #2563eb); stroke-width: 2.5; }
.chart .dd-bfe { stroke: #ef4444; stroke-dasharray: 4 3; stroke-width: 1.5; }
.chart .dd-marker { fill: var(--accent, #2563eb); stroke: #fff; stroke-width: 2; }
.chart .bar { fill: var(--accent, #2563eb); opacity: 0.7; }
.chart .bar-highlight { fill: #ef4444; opacity: 1; }
.chart .le-line { stroke: var(--accent, #2563eb); stroke-width: 2; }
.chart .empty { fill: var(--muted, #64748b); font-size: 12px; }
.metric-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin-top: 0.75rem; }
.metric { display: flex; flex-direction: column; gap: 0.15rem; }
.metric-label { font-size: 0.72rem; color: var(--muted, #64748b); }
.metric-val { font-size: 1.05rem; font-weight: 700; }
.methods-link { margin-top: 0.5rem; }
@media (max-width: 640px) { .metric-row { grid-template-columns: 1fr; } }
```

- [ ] **Step 4: Verify it renders (manual).**

Run: `python -m http.server 8000` in the project root, open `http://localhost:8000`, search an address. Confirm the three new cards appear (empty values are fine — Task 9 fills them) and the layout doesn't break in light or dark mode.
Expected: three new cards visible below the gap card; no console errors about missing scripts.

- [ ] **Step 5: Commit**

```bash
git add index.html css/style.css
git commit -m "feat: risk-engine UI cards, chart containers, and styles"
```

---

### Task 9: Wire the risk engine into app.js

**Files:**
- Modify: `js/app.js` (add `runRiskEngine`, `renderDepthSlider`; call them from `search` and add listeners in `init`)

**Interfaces:**
- Consumes: `Hazard`, `DepthDamage`, `Loss`, `RiskMetrics`, `Insurance`, `Charts`, `Fema.claimsByYear`, `Fema.marketPremium` (all browser globals).
- Produces: populated risk/insurance/history cards; live depth slider.

- [ ] **Step 1: Add state fields.** In `js/app.js`, extend the `state` object with:

```js
        risk: null,
        losses: null,
```

- [ ] **Step 2: Add listeners.** In `init()`, after the `lang-toggle` listener, add:

```js
        document.getElementById("depth-slider").addEventListener("input", () => this.renderDepthSlider());
        document.getElementById("ffe-input").addEventListener("input", () => this.runRiskEngine());
```

- [ ] **Step 3: Add the engine methods.** Add these methods to the `App` object (e.g., after `renderClaims`):

```js
    async runRiskEngine() {
        const s = this.state;
        if (!s.zone) return;
        const homeValue = Math.max(1000, Number(document.getElementById("home-value").value) || 300000);
        const ffe = Math.max(0, Number(document.getElementById("ffe-input").value) || 0);

        const losses = Loss.simulate({
            zone: s.zone, subtype: s.subtype, homeValue, firstFloorElev: ffe,
            N: 10000, rng: Loss.seededRng(20260812), hazard: Hazard, depthDamage: DepthDamage,
        });
        s.losses = losses;

        const eal = RiskMetrics.expectedAnnualLoss(losses);
        const var99 = RiskMetrics.valueAtRisk(losses, 0.99);
        const cvar99 = RiskMetrics.conditionalVaR(losses, 0.99);
        const fair = Insurance.fairPremium(eal);
        const ce = Insurance.certaintyEquivalentPremium(losses, 1e-5);
        const market = await Fema.marketPremium(s.address?.zip, s.zoneInfo?.level);
        const npv = Insurance.thirtyYearNPV({ eal, premium: market });
        s.risk = { eal, var99, cvar99, fair, ce, market, npv, homeValue, ffe };

        document.getElementById("eal-val").textContent = GapCalc.formatUSD(eal) + "/yr";
        document.getElementById("var-val").textContent = GapCalc.formatUSD(var99);
        document.getElementById("cvar-val").textContent = GapCalc.formatUSD(cvar99);
        document.getElementById("fair-prem").textContent = GapCalc.formatUSD(fair) + "/yr";
        document.getElementById("market-prem").textContent = GapCalc.formatUSD(market) + "/yr";
        document.getElementById("ce-prem").textContent = GapCalc.formatUSD(ce) + "/yr";
        document.getElementById("npv-val").textContent = npv > 0
            ? "Over 30 years, insuring saves about " + GapCalc.formatUSD(npv) + " in expectation (discounted, with a rising-risk trend)."
            : "Over 30 years, the market premium slightly exceeds your expected losses (" + GapCalc.formatUSD(-npv) + " net).";

        this.renderDepthSlider();
        this.renderYearChart();
    },

    renderDepthSlider() {
        const s = this.state;
        if (!s.risk) return;
        const depth = Number(document.getElementById("depth-slider").value);
        document.getElementById("depth-readout").textContent = depth.toFixed(1) + " ft";
        const bfe = Hazard.depthForProbability(s.zone, s.subtype, 0.01); // 100-yr base flood
        document.getElementById("dd-chart").innerHTML =
            Charts.depthDamageCurve(DepthDamage, { currentDepth: depth, baseFloodDepth: bfe });
    },

    async renderYearChart() {
        const s = this.state;
        const data = await Fema.claimsByYear(s.address?.zip);
        document.getElementById("year-chart").innerHTML =
            Charts.claimsByYearBars(data, { highlightYear: 2017 });
    },
```

- [ ] **Step 4: Trigger the engine.** In `search()`, immediately after the `this.renderExplain();` that follows claims handling (right before `this.tryAIExplain();` at the end of the `try`), add:

```js
            this.runRiskEngine();
```

Also, at the end of `calculate()`, after `this.state.gap = ...`, add `this.runRiskEngine();` so a new home value re-runs the simulation.

- [ ] **Step 5: Verify (manual) + commit.**

Run: `python -m http.server 8000`, search `5100 Braesheather Dr, Houston, TX 77096` (Meyerland, Zone AE). Confirm: EAL/VaR/CVaR populate, the depth-damage curve draws with a red base-flood line, dragging the slider moves the marker and updates the readout, the premium row fills, and the claims-by-year chart shows a tall 2017 bar. Change first-floor height and confirm numbers update. Check the browser console for errors.
Expected: all cards populated, slider live, no console errors.

```bash
git add js/app.js
git commit -m "feat: wire Monte Carlo risk engine, live depth slider, and year chart into app"
```

---

### Task 10: Extend the explainer (template + AI payload) for the distribution

**Files:**
- Modify: `js/app.js` (`renderExplain` EN + ES branches; `tryAIExplain` payload)
- Modify: `server/app.py` (accept and mention the new fields in the prompt)

**Interfaces:**
- Consumes: `this.state.risk`.
- Produces: EN/ES sentences describing EAL + tail risk; AI prompt enriched.

- [ ] **Step 1: Add EN copy.** In `renderExplain()`, inside the English branch, after the `if (gap) { ... }` block and before `el.innerHTML = html || ...`, add:

```js
        if (s.risk) {
            html += "<p>Simulating 10,000 possible years, your <strong>expected annual flood loss</strong> is about <strong>" +
                GapCalc.formatUSD(s.risk.eal) + "</strong>. In a rare bad year (a 1-in-100 flood) the loss could reach <strong>" +
                GapCalc.formatUSD(s.risk.var99) + "</strong>. A fair-value flood premium is around <strong>" +
                GapCalc.formatUSD(s.risk.fair) + "/yr</strong>.</p>";
        }
```

- [ ] **Step 2: Add ES copy.** In the Spanish branch, in the matching spot before `el.innerHTML = html || ...`, add:

```js
            if (s.risk) {
                html += "<p>Simulando 10,000 años posibles, su <strong>pérdida anual esperada</strong> por inundación es de aproximadamente <strong>" +
                    GapCalc.formatUSD(s.risk.eal) + "</strong>. En un año malo poco frecuente (una inundación de 1 en 100) la pérdida podría llegar a <strong>" +
                    GapCalc.formatUSD(s.risk.var99) + "</strong>. Una prima justa rondaría los <strong>" +
                    GapCalc.formatUSD(s.risk.fair) + "/año</strong>.</p>";
            }
```

- [ ] **Step 3: Enrich the AI payload.** In `tryAIExplain()`, add to the `body` JSON object:

```js
                    expectedAnnualLoss: s.risk?.eal ?? null,
                    var99: s.risk?.var99 ?? null,
                    fairPremium: s.risk?.fair ?? null,
                    marketPremium: s.risk?.market ?? null,
```

- [ ] **Step 4: Use them server-side.** In `server/app.py`, locate where the prompt is assembled from the request JSON and add the new fields to the context string the model receives (match the existing style; if the code builds a `facts`/`context` string, append):

```python
    eal = data.get("expectedAnnualLoss")
    var99 = data.get("var99")
    fair = data.get("fairPremium")
    if eal is not None:
        context += f"\nExpected annual loss: ${eal:,.0f}. 1-in-100-year loss: ${var99:,.0f}. Fair-value premium: ${fair:,.0f}/yr."
```

> If `context` is named differently in `app.py`, append to whatever string is passed to the model as the situation description. Do not change the model, temperature, or fallback behavior.

- [ ] **Step 5: Verify (manual) + commit.**

Run (template path, no key needed): `python -m http.server 8000`, search a Zone AE address, confirm the explain panel now includes the "expected annual flood loss" sentence in both EN and ES (toggle language). If you have `GROQ_API_KEY`, run `python server/app.py` and confirm the AI text references the loss figures and still falls back cleanly when the key is unset.
Expected: distribution sentence appears in both languages; AI path still degrades gracefully.

```bash
git add js/app.js server/app.py
git commit -m "feat: explainer narrates the loss distribution (EN/ES + AI prompt)"
```

---

### Task 11: "The Math" methods page

**Files:**
- Create: `methods.html`
- Modify: `index.html` (link already added in Task 8's insure-card; add a footer link too)

**Interfaces:**
- Consumes: nothing (static page).
- Produces: `methods.html` documenting every formula and assumption.

- [ ] **Step 1: Create `methods.html`** (mirrors the existing `about.html` shell — same header/footer, links back to `index.html`):

```html
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>The Math Behind FloodGap</title>
    <link rel="stylesheet" href="css/style.css" />
    <script>
        (function () {
            var saved = localStorage.getItem("floodgap-theme");
            var dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
            if (dark) document.documentElement.setAttribute("data-theme", "dark");
        })();
    </script>
</head>
<body>
    <header class="site-header"><div class="wrap header-row">
        <a class="brand brand-link" href="index.html"><span class="brand-name">FloodGap</span></a>
        <p class="tagline">The math behind the numbers</p>
    </div></header>
    <main class="wrap methods-page">
        <h1>How FloodGap models flood risk</h1>
        <p>FloodGap treats a home's flood risk the way catastrophe modelers and actuaries do:
        it simulates thousands of possible years, builds a distribution of losses, and prices
        insurance against it. Every formula and assumption is below. This is a simplified
        educational model, not an official risk rating.</p>

        <h2>1. Effective flood depth</h2>
        <p class="formula">d<sub>eff</sub> = d<sub>flood</sub> − FFE</p>
        <p>Water depth that reaches the structure = flood depth above ground minus the
        first-floor elevation (FFE) you enter. Default FFE = 1 ft.</p>

        <h2>2. Depth → damage → loss</h2>
        <p class="formula">loss = V · r(d<sub>eff</sub>)</p>
        <p>Home value V times a damage ratio r from a FEMA/USACE one-story, no-basement
        depth-damage curve, linearly interpolated and clamped to [0, 1]. Anchor points:
        0 ft → 10%, 1 ft → 20%, 3 ft → 38%, 6 ft → 55%, 12 ft → 80%.</p>

        <h2>3. Hazard: the stage-frequency curve</h2>
        <p class="formula">d(p) = μ − β · ln(−ln(1 − p))</p>
        <p>A Gumbel (extreme-value) curve gives flood depth as a function of annual
        exceedance probability p. μ and β are fit per FEMA zone from anchor return periods —
        e.g. Zone AE: the 10-year (p = 0.10) flood ≈ 1 ft and the 100-year base flood
        (p = 0.01) ≈ 4 ft.</p>

        <h2>4. Monte Carlo expected annual loss</h2>
        <p class="formula">EAL ≈ (1/N) · Σ L<sub>i</sub>&nbsp;&nbsp;=&nbsp;&nbsp;∫₀¹ L(p) dp</p>
        <p>We simulate N = 10,000 synthetic years. Each year we draw a random flood depth
        from the hazard curve, convert it to a loss, and average — the mean of that
        distribution is the Expected Annual Loss.</p>

        <h2>5. Tail risk</h2>
        <p class="formula">VaR<sub>α</sub> = Q<sub>α</sub>(L)&nbsp;&nbsp;·&nbsp;&nbsp;CVaR<sub>α</sub> = E[L | L ≥ VaR<sub>α</sub>]</p>
        <p>Value-at-Risk at α = 0.99 is the 1-in-100-year loss. Conditional VaR is the
        average loss in years worse than that — the catastrophe tail. These are the same
        risk measures used in finance.</p>

        <h2>6. Fair vs. worth-it premium</h2>
        <p class="formula">π = (1/a) · ln E[e<sup>a·L</sup>]</p>
        <p>The fair premium equals the EAL. Under exponential (risk-averse) utility with
        coefficient a = 1×10⁻⁵, the certainty-equivalent premium π is the most a homeowner
        should rationally pay — always at least the EAL, which is why buying insurance can be
        rational even when the premium exceeds the average loss.</p>

        <h2>7. 30-year value of insuring</h2>
        <p class="formula">NPV = Σ<sub>t=1..30</sub> (E[L<sub>t</sub>] − premium) / (1 + r)<sup>t</sup>,&nbsp; E[L<sub>t</sub>] = EAL · (1 + g)<sup>t</sup></p>
        <p>Discount rate r = 3%; climate trend g = 1%/yr nudges expected losses upward over
        time. A positive NPV means insuring pays off in expectation.</p>

        <h2>Sources</h2>
        <ul>
            <li>FEMA National Flood Hazard Layer — flood zones</li>
            <li>OpenFEMA NFIP Claims &amp; Policies — claim history and premiums</li>
            <li>FEMA/USACE depth-damage functions — damage ratios</li>
            <li>Extreme-value / flood-frequency methods (USGS Bulletin 17C context)</li>
        </ul>
        <p><a href="index.html">← Back to FloodGap</a></p>
    </main>
    <footer class="site-footer"><div class="wrap">
        <p>Educational model, not an official flood rating or financial advice.</p>
    </div></footer>
</body>
</html>
```

- [ ] **Step 2: Add formula styling.** Append to `css/style.css`:

```css
.methods-page { max-width: 720px; }
.methods-page h2 { margin-top: 1.5rem; }
.formula {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    background: var(--card-bg, #f1f5f9); color: var(--text, #0f172a);
    padding: 0.6rem 0.8rem; border-radius: 8px; font-size: 1.05rem;
    overflow-x: auto; border: 1px solid var(--border, #e2e8f0);
}
```

- [ ] **Step 3: Add a footer link on the main page.** In `index.html`, in the `<footer>`, change the "About" line to also link methods:

```html
            <p>Built by Julian Quevedo · Houston, TX · <a href="about.html">About &amp; privacy</a> · <a href="methods.html">The math</a></p>
```

- [ ] **Step 4: Verify (manual).**

Run: `python -m http.server 8000`, open `http://localhost:8000/methods.html`. Confirm all seven formula blocks render, the page respects dark mode, and the "See the math" link on the insurance card (from Task 8) and the footer link both reach it.
Expected: clean, readable methods page in both themes.

- [ ] **Step 5: Commit**

```bash
git add methods.html css/style.css index.html
git commit -m "feat: 'The Math' methods page with all formulas and assumptions"
```

---

### Task 12: Full test run, README roadmap, and cache bump

**Files:**
- Modify: `README.md` (roadmap + methods mention)
- Modify: `sw.js` (bump cache version and add new JS + methods.html so the PWA caches them)

**Interfaces:**
- Consumes: everything above.
- Produces: green test suite, updated docs, correct offline caching.

- [ ] **Step 1: Run the whole suite.**

Run: `node --test`
Expected: PASS across all `test/*.test.js` (DepthDamage, Hazard, Loss, RiskMetrics, Insurance, Fema, Charts).

- [ ] **Step 2: Update the service worker.** In `sw.js`, bump the cache version constant (e.g. `v6` → `v7`) and add the new files to the precache list: `js/depthdamage.js`, `js/hazard.js`, `js/loss.js`, `js/riskmetrics.js`, `js/insurance.js`, `js/charts.js`, `methods.html`. (Match the existing array/format in the file.)

- [ ] **Step 3: Update the README roadmap.** In `README.md`, under `## Roadmap`, add:

```markdown
- [x] Stage 4 — Risk engine: Monte Carlo loss distribution, EAL/VaR/CVaR, expected-utility
  insurance model, depth-damage + claims-by-year charts, and a "The Math" methods page
```

And under `## How it works`, add a line: `6. **Risk engine** simulates 10,000 years per zone to produce an expected annual loss, tail risk (VaR/CVaR), and a fair-vs-market premium — see methods.html.`

- [ ] **Step 4: Final manual smoke test.**

Run: `python -m http.server 8000`, hard-reload (clear service worker), search a Zone AE and a Zone X address. Confirm both produce sane numbers, no console errors, dark mode intact, and the app still works with the AI backend off.
Expected: full flow works end to end.

- [ ] **Step 5: Commit**

```bash
git add README.md sw.js
git commit -m "chore: bump SW cache for risk engine, document Stage 4 in README"
```

---

## Self-Review

**Spec coverage:**
- Monte Carlo loss distribution → Task 3. ✅
- EAL / VaR / CVaR / exceedance / CI → Task 4. ✅
- Gumbel stage-frequency hazard → Task 2. ✅
- Depth-damage curve + elevation input → Tasks 1, 8, 9. ✅
- Fair premium / market premium / CE premium / 30-yr NPV → Tasks 5, 6, 9. ✅
- Charts (depth-damage, Harvey year bars, exceedance) → Tasks 7, 8, 9. ✅
- EN/ES explainer extension → Task 10. ✅
- "The Math" methods page with formulas → Task 11. ✅
- Error handling / graceful degradation → market-premium + claims-by-year fallbacks (Task 6), engine runs on zone alone. ✅
- Testing strategy (TDD, pure modules) → Tasks 1–7. ✅
- Local calibration → intentionally deferred (spec §9 stretch); not in this plan. ✅ (documented omission)

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The one build-time uncertainty (OpenFEMA Policies field name) is handled by a guaranteed benchmark fallback, so the code is complete and functional regardless. ✅

**Type consistency:** `Loss.simulate` consumes `hazard.sampleAnnualMaxDepth(zone, subtype, rng)` and `depthDamage.damageRatio(depth)` — matching Tasks 2 and 1. `RiskMetrics`/`Insurance` consume the sorted `losses` array from Task 3. `Charts.*` signatures in Task 7 match the calls in Task 9. Element IDs created in Task 8 match those read in Task 9. ✅

**Scope:** Single cohesive subsystem (one risk engine + its UI + docs). Appropriately sized for one plan, staged into 12 independently-testable tasks.

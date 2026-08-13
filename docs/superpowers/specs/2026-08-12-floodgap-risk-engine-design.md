# FloodGap Risk Engine — Design Spec

**Date:** 2026-08-12
**Author:** Julian Quevedo
**Status:** Approved for planning
**Scope:** Add a Monte Carlo catastrophe-model risk engine to FloodGap, replacing the
single-number gap estimate with a full loss distribution, quant risk metrics, an
expected-utility insurance model, and supporting visualizations.

---

## 1. Context & Problem

FloodGap today answers one question per address (zone, ZIP claim count, single "typical
flood" gap) and stops. Every card is an output of one lookup; the underlying math is
hidden and the result is a point estimate. This reads as a polished *lookup tool*, not a
*model*.

This spec turns the hidden depth-damage math into a real **catastrophe model**: a
simulated distribution of possible annual losses, from which we read expected loss, tail
risk (VaR/CVaR), and a decision-theoretic insurance recommendation. The same risk metrics
(VaR, CVaR) appear in Julian's finance tools, unifying the portfolio around one idea —
*quantifying and pricing real-world risk*.

## 2. Goals

- Replace the deterministic gap number with a **Monte Carlo loss distribution** (10,000+
  simulated years).
- Report **EAL, VaR₉₉, CVaR, loss-exceedance probabilities, and a confidence band**.
- Model insurance as a **decision under uncertainty**: fair premium (EAL), market premium
  (OpenFEMA Policies), certainty-equivalent premium under risk aversion, and a 30-year NPV
  with discounting and a climate trend.
- Make the model **site-specific** via a first-floor-elevation input.
- Visualize: interactive depth–damage curve and Harvey claims-by-year chart (plan item
  #4). The ZIP-claims map heatmap (plan item #6) is already approved and built in the map
  work; an optional loss-exceedance visual may accompany the risk metrics.
- Extend the EN/ES explainer to narrate the distribution results.
- Ship a **Methods / "The Math"** page that presents the **actual formulas** used (not just
  citations), each with a plain-language line explaining what it does and every assumption
  listed. See Section 5.1.

## 3. Non-Goals

- No site-specific Base Flood Elevation lookup from FEMA (not free/queryable client-side);
  elevation is a user input with a sensible default.
- No paid APIs, no API keys beyond the existing optional Groq/Gemini explainer key.
- Local calibration to real claim history is a **stretch goal** (Section 9), not v1.
- No change to the existing search → geocode → zone → claims flow, the UI shell, the map
  base layer, or the PWA/service-worker setup beyond additive cards.

## 4. Architecture

A pipeline of pure, independently testable modules. Each is a plain JS module exposing
pure functions (no DOM, no fetch) so the math can be unit-tested against known values.
`app.js` orchestrates; only the orchestrator and a thin data layer touch the network/DOM.

```
                 zone, homeValue, firstFloorElev, coverage
                                   │
   ┌───────────────┐   ┌────────────────────┐   ┌───────────┐
   │  HazardModel  │──▶│  DepthDamageModel  │──▶│ LossModel │
   └───────────────┘   └────────────────────┘   └───────────┘
     stage-freq curve      depth → damage %        MC sim →
     (Gumbel/GEV)          (FEMA/USACE curve)      loss samples
                                   │
                          ┌────────────────┐   ┌────────────────┐
                          │  RiskMetrics   │──▶│ InsuranceModel │
                          └────────────────┘   └────────────────┘
                          EAL, VaR, CVaR,       fair vs market
                          exceedance, CI        premium, EU CE
                                   │             premium, 30yr NPV
                                   ▼
                             Explainer (EN/ES) + charts + Methods
```

### 4.1 `js/hazard.js` — HazardModel
- **Responsibility:** map a FEMA zone to a continuous **stage-frequency curve** — flood
  depth (above grade) as a function of annual exceedance probability `p`.
- **Method:** fit an extreme-value distribution (Gumbel as default; GEV optional) whose
  parameters are set per zone from anchor points (e.g., Zone AE: 100-yr/1% ≈ base flood
  depth, 10-yr/10% ≈ shallow, 500-yr/0.2% ≈ deep). Zones X, AE, A, VE, V get distinct
  parameter sets; minimal-risk zones get a near-zero curve.
- **Interface:** `depthForProbability(zone, p) → feet`, `sampleAnnualMaxDepth(zone, rng) → feet`.
- **Depends on:** zone code only.

### 4.2 `js/depthdamage.js` — DepthDamageModel
- **Responsibility:** convert flood depth **relative to the first floor** into a structural
  damage ratio.
- **Method:** FEMA/USACE one-story-no-basement depth-damage table, linearly interpolated;
  pluggable table keyed by structure type (default: single-family).
- **Interface:** `damageRatio(depthAboveFirstFloor) → 0..1`. `effectiveDepth = floodDepthAboveGrade − firstFloorElevation`.
- **Depends on:** nothing (pure table + interpolation).

### 4.3 `js/loss.js` — LossModel
- **Responsibility:** the Monte Carlo core. Simulate N (default 10,000) synthetic years.
- **Method:** each year, `sampleAnnualMaxDepth` → subtract first-floor elevation →
  `damageRatio` → `loss$ = homeValue × ratio` (clamped to homeValue). Collect all N losses.
- **Interface:** `simulate({zone, homeValue, firstFloorElev, N, seed}) → number[] (sorted losses)`.
- **Notes:** seeded RNG for reproducibility; N configurable; runs in <50ms for 10k in-browser.
- **Depends on:** HazardModel, DepthDamageModel.

### 4.4 `js/riskmetrics.js` — RiskMetrics
- **Responsibility:** summarize the loss sample into quant risk metrics.
- **Method / interface:**
  - `expectedAnnualLoss(losses) → mean`
  - `valueAtRisk(losses, 0.99) → 99th-percentile loss`
  - `conditionalVaR(losses, 0.99) → mean of losses beyond VaR₉₉`
  - `exceedanceProbability(losses, threshold) → p`
  - `confidenceInterval(losses, 0.90)` via bootstrap resampling of the loss array (normal
    approximation on the mean as a fast fallback)
- **Depends on:** nothing (operates on the array).

### 4.5 `js/insurance.js` — InsuranceModel
- **Responsibility:** turn risk metrics into an insurance decision.
- **Method / interface:**
  - `fairPremium = EAL`
  - `marketPremium(zip)` — from OpenFEMA Policies (data layer; fallback to labeled FEMA
    average if endpoint unreachable).
  - `certaintyEquivalentPremium(losses, riskAversion)` under CRRA/exponential utility —
    the max a risk-averse homeowner should rationally pay; explains premium > EAL.
  - `thirtyYearNPV({losses, premium, discountRate, climateTrend})` — expected cumulative
    uninsured loss vs. premiums paid, discounted, with annual flood probability drifting
    upward by `climateTrend`.
- **Depends on:** RiskMetrics, data layer (market premium).

### 4.6 Data layer — extend `js/fema.js`
- Existing: zone (NFHL), claim count (OpenFEMA claims).
- **Add:** claims aggregated by `dateOfLoss` year (for the Harvey chart); average premium
  from OpenFEMA **Policies** dataset by ZIP (verify CORS/reachability first; fallback ready).

### 4.7 Presentation
- `js/charts.js` — hand-rolled inline **SVG** charts (no new dependency): depth–damage
  curve with live slider marker + base-flood flag; claims-by-year bar chart (2017
  highlighted); optional loss-exceedance visual for the risk metrics.
- `js/app.js` — orchestrate: on result, run pipeline, render new cards, wire the depth
  slider and elevation input to live updates.
- `index.html` / `css/style.css` — additive cards: "Risk model" (slider, curve, EAL,
  VaR/CVaR), "Insurance decision" (fair vs market vs CE premium, 30-yr NPV), "Flood
  history" (year chart). Existing cards unchanged.

## 5. Data Sources & Citations (Methods page)

- **FEMA National Flood Hazard Layer** — flood zone (existing).
- **OpenFEMA NFIP Claims v2** — claim counts and by-year history.
- **OpenFEMA NFIP Policies** — average market premium by ZIP (with fallback).
- **FEMA/USACE depth-damage functions** — damage-ratio curve.
- **USGS/hydrology extreme-value methods (Bulletin 17C context)** — stage-frequency curve
  rationale.
All assumptions (zone anchor depths, climate trend rate, risk-aversion coefficient,
discount rate, default first-floor elevation) listed explicitly on the Methods page.

### 5.1 "The Math" page — formulas to display

A dedicated `methods.html` section renders each formula with a one-line plain-language
gloss. Math is shown as clean static markup (no heavy typesetting dependency — hand-set
HTML/CSS, or a tiny inline renderer if needed). Formulas:

- **Effective flood depth:** `d_eff = d_flood − FFE` (flood depth above grade minus
  first-floor elevation).
- **Damage & loss:** `loss = V · r(d_eff)`, where `r(·)` is the FEMA/USACE depth-damage
  ratio, linearly interpolated between table points and clamped to `[0, 1]`.
- **Hazard (stage-frequency) curve:** Gumbel quantile
  `d(p) = μ − β · ln(−ln(1 − p))`, with `μ, β` fit per zone from anchor return periods.
- **Monte Carlo estimator:** `EAL ≈ (1/N) · Σ Lᵢ` over `N` simulated years; equivalently
  the analytic area under the loss-probability curve `EAL = ∫₀¹ L(p) dp`.
- **Tail risk:** `VaRₐ = Qₐ(L)` (the α-quantile of losses); `CVaRₐ = E[L | L ≥ VaRₐ]`.
- **Certainty-equivalent premium** (exponential utility, risk-aversion `a`):
  `π = (1/a) · ln E[e^{a·L}]` — the most a risk-averse homeowner should rationally pay;
  note `π ≥ EAL`.
- **30-year NPV of insuring:** `NPV = Σ_{t=1}^{30} (E[Lₜ] − premium) / (1 + r)ᵗ`, with
  climate trend `E[Lₜ] = EAL · (1 + g)ᵗ` and discount rate `r`.

## 6. Error Handling & Degradation

- NFHL / OpenFEMA down → existing graceful "service unavailable" messaging; risk engine
  runs on zone alone (claims/premium optional enrichments).
- Policies endpoint unreachable → labeled FEMA-average premium fallback; EAL/VaR/CVaR/NPV
  all still compute.
- Unknown/unmapped zone → conservative default curve with a visible caveat.

## 7. Testing Strategy (TDD)

Math modules are pure → unit-test first against known values:
- DepthDamageModel: table endpoints and interpolation midpoints.
- HazardModel: `depthForProbability` reproduces anchor points; monotonic in `p`.
- LossModel: with a degenerate 1-point hazard, MC mean → analytic loss; seeded RNG
  reproducible.
- RiskMetrics: VaR/CVaR/EAL against a hand-computed small sample; CVaR ≥ VaR ≥ EAL ordering.
- InsuranceModel: CE premium ≥ fair premium for positive risk aversion; NPV sign flips at
  the expected break-even.

## 8. File Plan

- New: `js/hazard.js`, `js/depthdamage.js`, `js/loss.js`, `js/riskmetrics.js`,
  `js/insurance.js`, `js/charts.js`, `test/` unit tests, `methods.html`.
- Edit: `js/fema.js` (by-year claims, policies), `js/app.js` (wiring), `index.html`,
  `css/style.css`, `README.md` (roadmap + methods link).
- Unchanged: `geocode.js`, `map.js` base layer, `server/app.py`, PWA files (heatmap layer
  from approved item #6 handled in its own map work).

## 9. Stretch Goal — Local Calibration

Use the ZIP's real claims-by-year to estimate an empirical event frequency, then
**credibility-weight** (actuarial credibility theory) the model hazard curve toward local
evidence, so each neighborhood's model reflects its actual flood record. Additive to
`hazard.js` via an optional calibration input; ships only after the core engine is verified.

## 10. Open Assumptions to Confirm at Build Time

- OpenFEMA Policies endpoint is queryable from the browser (CORS). If not → fallback.
- Default risk-aversion coefficient and discount/climate-trend rates (pick documented,
  conservative defaults; expose climate trend as a small toggle if cheap).

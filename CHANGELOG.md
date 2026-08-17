# Changelog

All notable changes to FloodGap are recorded here. Versions follow
[semantic versioning](https://semver.org/): `MAJOR.MINOR.PATCH`. FloodGap is
pre-1.0, so the API and features may still change between minor versions.

## [0.1.1] — 2026-08-16

### Added
- Prominent "Get a flood insurance quote" call-to-action in the insurance card,
  shown after a result — the clear next step for the user, and the slot a future
  insurer-referral partnership would occupy.

## [0.1.0] — 2026-08-16

First public release, live at https://cashredo.github.io/floodgap/

### Added
- Address lookup → FEMA flood zone (National Flood Hazard Layer), local NFIP
  claims history, and an insurance-gap calculator.
- **Monte Carlo risk engine**: Gumbel stage-frequency hazard curve → 10,000-year
  simulation → expected annual loss (EAL), Value-at-Risk, and Conditional VaR.
- **Insurance decision model**: fair-value premium vs. market premium, a
  risk-averse certainty-equivalent premium, and a 30-year net-present-value of
  insuring (with discounting and a climate trend).
- First-floor-elevation input and a live depth slider.
- Charts (hand-rolled SVG): depth–damage curve, loss-exceedance curve, and an
  NFIP claims-by-year bar chart with Harvey (2017) highlighted.
- **"The Math" methods page** publishing every formula and assumption.
- Bilingual (English/Spanish) plain-language explainer, with an optional AI
  explainer backend and a template fallback.
- Progressive web app (installable, offline shell, service worker v7).
- Social-share metadata (Open Graph / Twitter cards).

### Notes
- The AI explainer requires the Flask backend; on the static GitHub Pages
  deployment it falls back to the built-in template explanations.

[0.1.0]: https://github.com/cashredo/floodgap/releases/tag/v0.1.0

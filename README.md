# FloodGap

**Know your flood risk. Know your gap.**

Enter any Houston-area address → see your FEMA flood zone, your neighborhood's real
flood-claim history, and the gap between what a flood would cost and what your
insurance covers — explained in plain English or Spanish.

Built for the 2026 Congressional App Challenge by Julian Quevedo.

## Why

Hurricane Harvey flooded roughly 204,000 Houston-area homes — and most had no flood
insurance. Homeowners insurance does not cover flooding, FEMA flood maps are hard to
read, and most families have never checked their zone. FloodGap turns three government
datasets into one answer a family can act on.

## How it works

1. **Census Bureau Geocoder** turns the address into coordinates (free, no key)
2. **FEMA National Flood Hazard Layer** returns the official flood zone at that point
3. **OpenFEMA NFIP claims data** shows real flood-insurance claims paid in that ZIP since 1978
4. **Gap calculator** applies simplified FEMA/USACE depth-damage curves:
   `estimated loss = home value × damage ratio(zone depth)`, `gap = loss − coverage`
5. **Explain panel** translates the readout into plain English or Spanish
6. **Risk engine** simulates 10,000 years per zone to produce an expected annual loss, tail
   risk (VaR/CVaR), and a fair-vs-market premium — see methods.html

## Run locally

**Simple (no AI):** static site, no build step. APIs require http, not file://

```
cd floodgap
python -m http.server 8000
```

**Full (with AI explainer):**

```
cd floodgap
pip install flask requests
$env:GROQ_API_KEY = "gsk_..."   # PowerShell; free key from console.groq.com
python server/app.py
```

Either way, open http://localhost:8000. Without an API key everything still
works — the explain panel uses built-in templates instead of AI.

**Every API used is free:** OpenStreetMap Nominatim (geocoding), FEMA NFHL
(flood zones), OpenFEMA (claims), and Groq's free tier (optional AI explainer
running open Llama models — free key, no credit card). A Gemini key also
works if you set GEMINI_API_KEY instead.

## Install as an app (PWA)

FloodGap is a Progressive Web App. When served over HTTPS (or localhost),
Chrome/Edge show an **Install app** button in the header — it installs to the
home screen / desktop with its own icon and runs full-screen like a native app.
The service worker caches the app shell for instant loads.

## Roadmap

- [x] Stage 1 — web skeleton: search, map, zone, claims, gap calculator, template explainer
- [x] Stage 2 — AI explainer: Flask backend + Claude API (English/Spanish), graceful fallback
- [x] Stage 3 — PWA: icons, service worker, install button
- [x] Stage 4 — Risk engine: Monte Carlo loss distribution, EAL/VaR/CVaR, expected-utility
  insurance model, depth-damage + claims-by-year charts, and a "The Math" methods page
- [ ] Deploy (Netlify/Render) + demo video

## Disclaimer

Educational tool, not insurance or financial advice. Zone data from FEMA's NFHL;
claims from OpenFEMA; loss estimates use simplified depth-damage ratios.

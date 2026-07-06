"""FloodGap backend — serves the site + the AI explain endpoint.

Run from the floodgap folder:
    pip install flask requests
    set GEMINI_API_KEY=...   (PowerShell: $env:GEMINI_API_KEY="...")
    python server/app.py

Then open http://localhost:8000

The AI explainer uses Google's Gemini free tier (aistudio.google.com — free
API key, no card). Without a key the site still works fully; the explain
panel uses the built-in template explanations instead.
"""

import os
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

try:
    import requests as http
except ImportError:
    http = None

ROOT = Path(__file__).resolve().parent.parent  # the floodgap/ folder

app = Flask(__name__, static_folder=None)

GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.0-flash:generateContent"
)

SYSTEM_PROMPT = (
    "You are FloodGap's explainer. You receive flood-risk data for one home in the "
    "Houston area and write a short, warm, plain-language explanation for the family "
    "living there. No jargon. Do not exaggerate or catastrophize — be factual and calm, "
    "but do not soften real risk either. 3 short paragraphs max. Mention: what their "
    "flood zone means in everyday terms, what the local claims history says, and what "
    "their coverage gap means for their wallet. If they have no flood insurance, "
    "explain in one sentence that homeowners insurance never covers floods. "
    "End with one concrete next step. Write in {lang}. Write like a knowledgeable "
    "neighbor, not a report: contractions are fine, no em dashes, no bullet points."
)


def _facts_from(data):
    facts = []
    if data.get("zone"):
        facts.append(f"FEMA flood zone: {data['zone']} (risk level: {data.get('riskLevel')})")
    if data.get("zip"):
        facts.append(f"ZIP code: {data['zip']}")
    if data.get("claimCount") is not None:
        facts.append(
            f"NFIP flood-insurance claims in this ZIP since 1978: {data['claimCount']}, "
            f"total paid: ${data.get('claimsTotalPaid') or 0:,.0f}"
        )
    if data.get("homeValue"):
        facts.append(f"Home value: ${data['homeValue']:,}")
        facts.append(f"Flood insurance coverage: ${data.get('coverage', 0):,}")
        facts.append(f"Estimated damage in a typical flood for this zone: ${data.get('estimatedLoss', 0):,}")
        facts.append(f"Uncovered gap: ${data.get('gap', 0):,}")
    return facts


@app.post("/api/explain")
def explain():
    if not GEMINI_KEY or http is None:
        return jsonify({"error": "AI backend not configured"}), 503

    data = request.get_json(silent=True) or {}
    lang = "Spanish" if data.get("lang") == "es" else "English"

    facts = _facts_from(data)
    if not facts:
        return jsonify({"error": "no data"}), 400

    try:
        res = http.post(
            GEMINI_URL,
            params={"key": GEMINI_KEY},
            json={
                "system_instruction": {
                    "parts": [{"text": SYSTEM_PROMPT.format(lang=lang)}]
                },
                "contents": [{"role": "user", "parts": [{"text": "\n".join(facts)}]}],
                "generationConfig": {"maxOutputTokens": 500, "temperature": 0.6},
            },
            timeout=20,
        )
        res.raise_for_status()
        body = res.json()
        text = body["candidates"][0]["content"]["parts"][0]["text"]
    except Exception:
        # Any upstream hiccup: let the frontend keep its template explanation
        return jsonify({"error": "AI request failed"}), 502

    return jsonify({"explanation": text})


# Serve the static site so one command runs everything.
@app.get("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.get("/<path:path>")
def static_files(path):
    return send_from_directory(ROOT, path)


if __name__ == "__main__":
    print("FloodGap running at http://localhost:8000")
    if not GEMINI_KEY:
        print("NOTE: no GEMINI_API_KEY set — AI explain disabled, "
              "built-in template explanations will be used.")
    app.run(host="127.0.0.1", port=8000, debug=False)

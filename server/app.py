"""FloodGap backend — serves the site + the AI explain endpoint.

Run from the floodgap folder:
    pip install flask anthropic
    set ANTHROPIC_API_KEY=sk-ant-...   (PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-...")
    python server/app.py

Then open http://localhost:8000
Without an API key the site still works — the explain panel just stays
template-based instead of AI-generated.
"""

import os
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

ROOT = Path(__file__).resolve().parent.parent  # the floodgap/ folder

app = Flask(__name__, static_folder=None)

try:
    import anthropic

    _client = anthropic.Anthropic() if os.environ.get("ANTHROPIC_API_KEY") else None
except ImportError:
    _client = None


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


@app.post("/api/explain")
def explain():
    if _client is None:
        return jsonify({"error": "AI backend not configured"}), 503

    data = request.get_json(silent=True) or {}
    lang = "Spanish" if data.get("lang") == "es" else "English"

    facts = []
    if data.get("zone"):
        facts.append(f"FEMA flood zone: {data['zone']} (risk level: {data.get('riskLevel')})")
    if data.get("zip"):
        facts.append(f"ZIP code: {data['zip']}")
    if data.get("claimCount") is not None:
        facts.append(
            f"NFIP flood-insurance claims in this ZIP since 1978: {data['claimCount']}, "
            f"total paid: ${data.get('claimsTotalPaid', 0):,.0f}"
        )
    if data.get("homeValue"):
        facts.append(f"Home value: ${data['homeValue']:,}")
        facts.append(f"Flood insurance coverage: ${data.get('coverage', 0):,}")
        facts.append(f"Estimated damage in a typical flood for this zone: ${data.get('estimatedLoss', 0):,}")
        facts.append(f"Uncovered gap: ${data.get('gap', 0):,}")

    if not facts:
        return jsonify({"error": "no data"}), 400

    msg = _client.messages.create(
        model="claude-sonnet-5",
        max_tokens=500,
        system=SYSTEM_PROMPT.format(lang=lang),
        messages=[{"role": "user", "content": "\n".join(facts)}],
    )
    return jsonify({"explanation": msg.content[0].text})


# Serve the static site so one command runs everything.
@app.get("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.get("/<path:path>")
def static_files(path):
    return send_from_directory(ROOT, path)


if __name__ == "__main__":
    print("FloodGap running at http://localhost:8000")
    if _client is None:
        print("NOTE: no ANTHROPIC_API_KEY set (or anthropic not installed) — "
              "AI explain disabled, template explanations will be used.")
    app.run(host="127.0.0.1", port=8000, debug=False)

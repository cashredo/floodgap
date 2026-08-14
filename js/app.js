// app.js — orchestration: address -> geocode -> flood zone + claims -> gap -> explain

const App = {
    state: {
        address: null,
        zone: null,
        subtype: null,
        zoneInfo: null,
        claims: null,
        gap: null,
        lang: "en",
        risk: null,
        losses: null,
    },

    init() {
        MapView.init();
        document.getElementById("search-form").addEventListener("submit", (e) => {
            e.preventDefault();
            this.search();
        });
        document.getElementById("calc-btn").addEventListener("click", () => this.calculate());
        document.getElementById("lang-toggle").addEventListener("click", () => this.toggleLang());
        document.getElementById("depth-slider").addEventListener("input", () => this.renderDepthSlider());
        document.getElementById("ffe-input").addEventListener("input", () => this.runRiskEngine());
        document.querySelectorAll(".chip").forEach((chip) =>
            chip.addEventListener("click", () => {
                document.getElementById("address-input").value = chip.dataset.addr;
                this.search();
            })
        );
        // Desktop mice can't scroll a horizontal bar with a vertical wheel and the
        // scrollbar is hidden — translate vertical wheel motion into horizontal scroll.
        const chipScroll = document.querySelector(".chip-scroll");
        if (chipScroll) {
            chipScroll.addEventListener("wheel", (e) => {
                if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                    chipScroll.scrollLeft += e.deltaY;
                    e.preventDefault();
                }
            }, { passive: false });
        }
        this.setupTheme();
        this.setupInstall();
        this.setupTips();
        // Render all data-lucide placeholders as inline SVG icons
        if (window.lucide) lucide.createIcons();
    },

    // Tooltips open on tap too, since phones can't hover
    setupTips() {
        document.querySelectorAll(".tip").forEach((tip) =>
            tip.addEventListener("click", (e) => {
                e.stopPropagation();
                const wasOpen = tip.classList.contains("open");
                document.querySelectorAll(".tip.open").forEach((t) => t.classList.remove("open"));
                if (!wasOpen) tip.classList.add("open");
            })
        );
        document.addEventListener("click", () =>
            document.querySelectorAll(".tip.open").forEach((t) => t.classList.remove("open"))
        );
    },

    setupTheme() {
        const btn = document.getElementById("theme-toggle");
        // Moon shows in light mode, sun in dark. Lucide swaps <i> for <svg>
        // but keeps the class, so these selectors survive icon rendering.
        const icon = () => {
            const dark = document.documentElement.getAttribute("data-theme") === "dark";
            btn.querySelector(".icon-moon")?.classList.toggle("hidden", dark);
            btn.querySelector(".icon-sun")?.classList.toggle("hidden", !dark);
        };
        btn.addEventListener("click", () => {
            const dark = document.documentElement.getAttribute("data-theme") === "dark";
            if (dark) document.documentElement.removeAttribute("data-theme");
            else document.documentElement.setAttribute("data-theme", "dark");
            localStorage.setItem("floodgap-theme", dark ? "light" : "dark");
            icon();
        });
        icon();
    },

    // "Install app" button: shows when the browser says the PWA is installable.
    setupInstall() {
        const btn = document.getElementById("install-btn");
        let deferred = null;
        window.addEventListener("beforeinstallprompt", (e) => {
            e.preventDefault();
            deferred = e;
            btn.classList.remove("hidden");
        });
        btn.addEventListener("click", async () => {
            if (!deferred) return;
            deferred.prompt();
            await deferred.userChoice;
            deferred = null;
            btn.classList.add("hidden");
        });
        window.addEventListener("appinstalled", () => btn.classList.add("hidden"));
    },

    setStatus(msg, isError = false, isLoading = false) {
        const el = document.getElementById("search-status");
        el.textContent = msg;
        el.classList.toggle("error", isError);
        el.classList.toggle("loading", isLoading);
    },

    // Skeleton shimmer on the stat cards while data loads
    setSkeletons(on) {
        for (const id of ["zone-code", "zone-desc", "claims-count", "claims-desc"]) {
            document.getElementById(id).classList.toggle("skeleton", on);
        }
    },

    async search() {
        const input = document.getElementById("address-input").value.trim();
        const btn = document.getElementById("search-btn");
        if (!input) return;

        btn.disabled = true;
        const btnLabel = btn.textContent;
        btn.textContent = "Checking…";
        this.setStatus("Looking up that address…", false, true);

        try {
            const loc = await Geocode.lookup(input);
            this.state.address = loc;

            document.getElementById("results").classList.remove("hidden");
            this.setSkeletons(true);
            MapView.showLocation(loc.lat, loc.lon, loc.matchedAddress);

            this.setStatus("Checking FEMA's flood maps…", false, true);
            const [zoneRes, claimsRes] = await Promise.allSettled([
                Fema.floodZone(loc.lat, loc.lon),
                Fema.claimsByZip(loc.zip),
            ]);

            if (zoneRes.status === "fulfilled") {
                this.state.zone = zoneRes.value.zone;
                this.state.subtype = zoneRes.value.subtype;
                this.state.zoneInfo = Fema.describeZone(this.state.zone, this.state.subtype);
            } else {
                // Service failure is different from "no zone at this point"
                this.state.zone = "UNKNOWN";
                this.state.subtype = null;
                this.state.zoneInfo = {
                    level: "moderate",
                    text: "FEMA's flood map service didn't answer just now. It happens. Give it a minute and search again.",
                };
            }
            this.renderZone();

            if (claimsRes.status === "fulfilled") {
                this.state.claims = claimsRes.value;
                this.renderClaims();
            } else {
                document.getElementById("claims-count").textContent = "?";
                document.getElementById("claims-desc").textContent =
                    "FEMA's claims records didn't answer just now. Try again in a minute.";
            }

            this.setStatus("");
            this.renderExplain();
            this.runRiskEngine();
            this.tryAIExplain();
        } catch (err) {
            this.setStatus(err.message, true);
        } finally {
            this.setSkeletons(false);
            btn.disabled = false;
            btn.textContent = btnLabel;
        }
    },

    renderZone() {
        const card = document.getElementById("zone-card");
        card.classList.remove("risk-high", "risk-moderate", "risk-low");
        card.classList.add("risk-" + this.state.zoneInfo.level);
        document.getElementById("zone-code").textContent =
            this.state.zone === "UNKNOWN" ? "?" : "Zone " + this.state.zone;
        document.getElementById("zone-desc").textContent = this.state.zoneInfo.text;
    },

    renderClaims() {
        const { count, totalPaid } = this.state.claims;
        const zip = this.state.address.zip || "";
        document.getElementById("claims-count").textContent = count.toLocaleString("en-US");
        let desc;
        if (count === 0) {
            desc = "No NFIP claims on record for this ZIP. Keep in mind claims only count homes that had insurance.";
        } else if (totalPaid === null) {
            desc = "Flood-insurance claims paid in ZIP " + zip + " since 1978. Flooding has happened here before.";
        } else {
            desc = GapCalc.formatUSD(totalPaid) + " paid out in flood-insurance claims in ZIP " +
                zip + " since 1978. Flooding has happened here before.";
        }
        document.getElementById("claims-desc").textContent = desc;
    },

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

        document.getElementById("le-chart").innerHTML = Charts.lossExceedance(losses, RiskMetrics, {});
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

    calculate() {
        if (!this.state.zone) {
            this.setStatus("Search an address first, then calculate your gap.", true);
            return;
        }
        const homeValue = Math.max(0, Number(document.getElementById("home-value").value) || 0);
        const coverage = Math.max(0, Number(document.getElementById("coverage").value) || 0);
        if (homeValue < 1000) {
            this.setStatus("Enter a realistic home value to calculate your gap.", true);
            return;
        }
        this.setStatus("");

        const result = GapCalc.compute(homeValue, coverage, this.state.zone, this.state.subtype);
        this.state.gap = { ...result, homeValue, coverage };
        this.runRiskEngine();

        const box = document.getElementById("gap-result");
        box.classList.remove("hidden");
        box.classList.toggle("covered", result.gap === 0);
        document.getElementById("gap-number").textContent = GapCalc.formatUSD(result.gap);
        document.getElementById("gap-detail").textContent =
            "Estimated damage: " + GapCalc.formatUSD(result.estimatedLoss) +
            " (" + Math.round(result.ratio * 100) + "% of home value at ~" + result.depth +
            " ft of water) minus " + GapCalc.formatUSD(coverage) + " coverage.";

        this.renderExplain();
        this.tryAIExplain();
    },

    toggleLang() {
        this.state.lang = this.state.lang === "en" ? "es" : "en";
        document.getElementById("lang-toggle").textContent =
            this.state.lang === "en" ? "ES" : "EN";
        this.renderExplain();
        this.tryAIExplain();
    },

    // Try the AI backend; if it's not running, the template explanation stays.
    async tryAIExplain() {
        const s = this.state;
        if (!s.zone) return;
        const seq = ++this._aiSeq;
        try {
            const res = await fetch("/api/explain", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    lang: s.lang,
                    zone: s.zone,
                    subtype: s.subtype,
                    riskLevel: s.zoneInfo?.level,
                    zip: s.address?.zip,
                    claimCount: s.claims?.count ?? null,
                    claimsTotalPaid: s.claims?.totalPaid ?? null,
                    homeValue: s.gap?.homeValue ?? null,
                    coverage: s.gap?.coverage ?? null,
                    estimatedLoss: s.gap?.estimatedLoss ?? null,
                    gap: s.gap?.gap ?? null,
                    expectedAnnualLoss: s.risk?.eal ?? null,
                    var99: s.risk?.var99 ?? null,
                    fairPremium: s.risk?.fair ?? null,
                    marketPremium: s.risk?.market ?? null,
                }),
            });
            if (!res.ok) return;
            const data = await res.json();
            // Ignore stale responses (user searched/toggled again mid-flight)
            if (seq !== this._aiSeq || !data.explanation) return;
            const el = document.getElementById("explain-text");
            el.innerHTML = "";
            for (const para of data.explanation.split(/\n+/)) {
                if (!para.trim()) continue;
                const p = document.createElement("p");
                p.textContent = para.trim();
                el.appendChild(p);
            }
            const badge = document.createElement("p");
            badge.className = "ai-badge";
            const spark = document.createElement("i");
            spark.setAttribute("data-lucide", "sparkles");
            badge.appendChild(spark);
            badge.appendChild(document.createTextNode(
                this.state.lang === "es" ? " Explicado con un poco de ayuda de IA" : " Explained with a little help from AI"
            ));
            el.appendChild(badge);
            if (window.lucide) lucide.createIcons();
        } catch {
            /* backend not running — template explanation stays */
        }
    },
    _aiSeq: 0,

    // Template-based explanation (always renders instantly; AI upgrades it when available).
    renderExplain() {
        const el = document.getElementById("explain-text");
        const s = this.state;
        if (!s.zone) return;

        const zoneName = s.zone === "UNKNOWN" ? null : s.zone;
        const claims = s.claims;
        const gap = s.gap;

        if (s.lang === "es") {
            let html = "";
            if (zoneName) {
                html += "<p>Su dirección está en la <strong>zona " + zoneName + "</strong> según los mapas oficiales de FEMA. " +
                    (s.zoneInfo.level === "high"
                        ? "Es una zona de <strong>alto riesgo</strong>: al menos 1% de probabilidad de inundación cada año."
                        : s.zoneInfo.level === "moderate"
                        ? "Es una zona de riesgo moderado."
                        : "Es una zona de menor riesgo en los mapas, pero 1 de cada 4 reclamos de inundación viene de zonas así.") + "</p>";
            }
            if (claims && claims.count > 0) {
                html += "<p>En su código postal ha habido <strong>" + claims.count.toLocaleString("es") +
                    " reclamos</strong> de seguro por inundación desde 1978.</p>";
            }
            if (gap) {
                html += gap.gap > 0
                    ? "<p>Si ocurriera una inundación típica para su zona, el daño estimado sería de <strong>" +
                      GapCalc.formatUSD(gap.estimatedLoss) + "</strong>, y <strong>" + GapCalc.formatUSD(gap.gap) +
                      "</strong> saldría de su bolsillo. El seguro de casa normal <strong>no</strong> cubre inundaciones; se necesita una póliza aparte (NFIP).</p>"
                    : "<p>Con su cobertura actual, una inundación típica estaría <strong>cubierta</strong>. Bien hecho.</p>";
            }
            if (s.risk) {
                html += "<p>Simulando 10,000 años posibles, su <strong>pérdida anual esperada</strong> por inundación es de aproximadamente <strong>" +
                    GapCalc.formatUSD(s.risk.eal) + "</strong>. En un año malo poco frecuente (una inundación de 1 en 100) la pérdida podría llegar a <strong>" +
                    GapCalc.formatUSD(s.risk.var99) + "</strong>. Una prima justa rondaría los <strong>" +
                    GapCalc.formatUSD(s.risk.fair) + "/año</strong>.</p>";
            }
            el.innerHTML = html || "<p>Busque una dirección para ver la explicación.</p>";
            return;
        }

        let html = "";
        if (zoneName) {
            html += "<p>Your address sits in <strong>Zone " + zoneName + "</strong> on FEMA's official flood maps. " +
                (s.zoneInfo.level === "high"
                    ? "That's a <strong>high-risk</strong> zone: at least a 1-in-100 chance of flooding every single year, which adds up to about a 26% chance over a 30-year mortgage."
                    : s.zoneInfo.level === "moderate"
                    ? "That's a moderate-risk zone. It sits outside the required-insurance area, but well within where Harvey's damage reached."
                    : "That's a lower-risk zone on the maps, but about 1 in 4 flood claims come from zones like this.") + "</p>";
        }
        if (claims && claims.count > 0) {
            html += "<p>Your ZIP code has <strong>" + claims.count.toLocaleString("en-US") +
                " flood-insurance claims</strong> on record since 1978. Flooding here is not hypothetical.</p>";
        }
        if (gap) {
            html += gap.gap > 0
                ? "<p>If a typical flood for your zone hit tomorrow, the estimated damage is <strong>" +
                  GapCalc.formatUSD(gap.estimatedLoss) + "</strong>, and <strong>" + GapCalc.formatUSD(gap.gap) +
                  "</strong> of that would come out of your pocket. Regular homeowners insurance does <strong>not</strong> cover floods; it takes a separate NFIP or private flood policy.</p>"
                : "<p>With your current coverage, a typical flood for your zone would be <strong>fully covered</strong>. That puts you ahead of most of Houston.</p>";
        }
        if (s.risk) {
            html += "<p>Simulating 10,000 possible years, your <strong>expected annual flood loss</strong> is about <strong>" +
                GapCalc.formatUSD(s.risk.eal) + "</strong>. In a rare bad year (a 1-in-100 flood) the loss could reach <strong>" +
                GapCalc.formatUSD(s.risk.var99) + "</strong>. A fair-value flood premium is around <strong>" +
                GapCalc.formatUSD(s.risk.fair) + "/yr</strong>.</p>";
        }
        el.innerHTML = html || "<p>Search an address to see your explanation.</p>";
    },
};

document.addEventListener("DOMContentLoaded", () => App.init());

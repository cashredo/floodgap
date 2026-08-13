// fema.js — FEMA data fetchers: flood zone (NFHL) + claims history (OpenFEMA NFIP)

const Fema = {
    // Flood zone at a point, from the National Flood Hazard Layer.
    // Layer 28 = "Flood Hazard Zones" polygons on FEMA's public ArcGIS server.
    async floodZone(lat, lon) {
        const url =
            "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query" +
            "?geometry=" + lon + "," + lat +
            "&geometryType=esriGeometryPoint&inSR=4326" +
            "&spatialRel=esriSpatialRelIntersects" +
            "&outFields=FLD_ZONE,ZONE_SUBTY" +
            "&returnGeometry=false&f=json";

        const res = await fetch(url);
        if (!res.ok) throw new Error("FEMA flood map service unavailable");
        const data = await res.json();

        const feat = data?.features?.[0];
        if (!feat) return { zone: "UNKNOWN", subtype: null };
        return {
            zone: feat.attributes.FLD_ZONE || "UNKNOWN",
            subtype: feat.attributes.ZONE_SUBTY || null,
        };
    },

    // Historical NFIP flood-insurance claims for a ZIP code (OpenFEMA v2).
    // Returns { count, totalPaid }. totalPaid is null if only the count was retrievable
    // (flood-heavy ZIPs can have thousands of rows; the sum fetch is best-effort).
    async claimsByZip(zip) {
        if (!zip) return { count: 0, totalPaid: 0 };

        const base =
            "https://www.fema.gov/api/open/v2/FimaNfipClaims" +
            "?$filter=reportedZipCode%20eq%20%27" + encodeURIComponent(zip) + "%27";

        // Exact count via metadata: fast and tiny regardless of ZIP size.
        const countRes = await fetch(base + "&$top=1&$inlinecount=allpages&$select=yearOfLoss");
        if (!countRes.ok) throw new Error("OpenFEMA claims service unavailable");
        const countData = await countRes.json();
        const count = countData?.metadata?.count ?? 0;
        if (count === 0) return { count: 0, totalPaid: 0 };

        // Dollar total: heavier query, degrade gracefully if it fails.
        let totalPaid = null;
        try {
            const res = await fetch(
                base + "&$top=10000&$select=amountPaidOnBuildingClaim,amountPaidOnContentsClaim"
            );
            if (res.ok) {
                const data = await res.json();
                totalPaid = 0;
                for (const c of data?.FimaNfipClaims || []) {
                    totalPaid +=
                        (Number(c.amountPaidOnBuildingClaim) || 0) +
                        (Number(c.amountPaidOnContentsClaim) || 0);
                }
            }
        } catch {
            totalPaid = null;
        }
        return { count, totalPaid };
    },

    // Human-readable description + severity bucket for a FEMA zone code.
    describeZone(zone, subtype) {
        const z = (zone || "").toUpperCase();
        if (z.startsWith("V")) {
            return {
                level: "high",
                text: "High-risk coastal zone: 1% annual flood chance plus wave hazard. Flood insurance is required for federally backed mortgages.",
            };
        }
        if (z === "AE" || z === "A" || z === "AO" || z === "AH" || z.startsWith("A")) {
            return {
                level: "high",
                text: "High-risk zone: at least a 1% chance of flooding every year (a \"100-year\" floodplain). Over a 30-year mortgage that's about a 26% chance of at least one flood. Flood insurance is required for federally backed mortgages.",
            };
        }
        if (z === "X" && subtype && /0\.2|SHADED/i.test(subtype)) {
            return {
                level: "moderate",
                text: "Moderate risk: 0.2% annual flood chance (a \"500-year\" floodplain). Not required to carry flood insurance, but many Harvey-flooded homes were in this zone.",
            };
        }
        if (z === "X" || z === "C" || z === "B") {
            return {
                level: "low",
                text: "Lower-risk zone on FEMA's maps. Still, about 1 in 4 flood claims come from outside high-risk zones. Low risk is not no risk.",
            };
        }
        return {
            level: "moderate",
            text: "Zone could not be determined from FEMA's flood map service for this exact point.",
        };
    },

    // Aggregate raw claim rows into {year,count}[] sorted ascending. Pure.
    _aggregateByYear(rows) {
        const byYear = new Map();
        for (const r of rows || []) {
            const y = Number(r.yearOfLoss);
            if (!Number.isFinite(y) || y <= 0) continue;
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
};

if (typeof module !== "undefined" && module.exports) module.exports = Fema;

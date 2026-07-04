// gapcalc.js — the insurance-gap math.
//
// Method (simplified FEMA/USACE depth-damage approach):
//   1. Each flood zone maps to a typical flood depth for that zone's design event.
//   2. Depth maps to a damage ratio (fraction of structure value destroyed),
//      based on simplified USACE one-story, no-basement depth-damage curves.
//   3. estimated loss = home value x damage ratio
//   4. gap = estimated loss - flood insurance coverage (floored at 0)

const GapCalc = {
    // Typical depth (feet above first floor) for the zone's design flood.
    zoneDepth(zone, subtype) {
        const z = (zone || "").toUpperCase();
        if (z.startsWith("V")) return 4;               // coastal, wave action
        if (z === "AE" || z === "A") return 3;         // riverine 1% event
        if (z === "AO" || z === "AH") return 1.5;      // shallow flooding
        if (z === "X" && subtype && /0\.2|SHADED/i.test(subtype)) return 1;
        return 0.5;                                    // minimal zones: shallow event
    },

    // Simplified USACE depth-damage curve (structure only).
    damageRatio(depthFt) {
        if (depthFt >= 4) return 0.49;
        if (depthFt >= 3) return 0.40;
        if (depthFt >= 2) return 0.30;
        if (depthFt >= 1.5) return 0.25;
        if (depthFt >= 1) return 0.20;
        return 0.15;
    },

    compute(homeValue, coverage, zone, subtype) {
        const depth = this.zoneDepth(zone, subtype);
        const ratio = this.damageRatio(depth);
        const estimatedLoss = Math.round(homeValue * ratio);
        const gap = Math.max(0, estimatedLoss - coverage);
        return { depth, ratio, estimatedLoss, gap };
    },

    formatUSD(n) {
        return "$" + Math.round(n).toLocaleString("en-US");
    },
};

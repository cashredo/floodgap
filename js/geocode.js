// geocode.js — address lookup with a fallback so traffic spikes or outages can't
// break it. Nominatim (OpenStreetMap) is primary; Photon (also OSM-based) is the
// fallback and covers Nominatim rate-limits and downtime. Both are free and
// CORS-enabled, and both run from the visitor's own browser. Nothing is stored.
// Returns { lat, lon, matchedAddress, zip } for a one-line address string.

const Geocode = {
    async _nominatim(address) {
        const url =
            "https://nominatim.openstreetmap.org/search" +
            "?q=" + encodeURIComponent(address) +
            "&format=json&addressdetails=1&limit=1&countrycodes=us";
        const res = await fetch(url, { headers: { "Accept-Language": "en" } });
        if (!res.ok) throw new Error("nominatim " + res.status);
        const data = await res.json();
        const m = Array.isArray(data) && data[0];
        if (!m) return null;
        return {
            lat: Number(m.lat),
            lon: Number(m.lon),
            matchedAddress: m.display_name,
            zip: m.address?.postcode || null,
        };
    },

    async _photon(address) {
        const url =
            "https://photon.komoot.io/api/?q=" + encodeURIComponent(address) + "&limit=1&lang=en";
        const res = await fetch(url);
        if (!res.ok) throw new Error("photon " + res.status);
        const data = await res.json();
        const f = data?.features?.[0];
        if (!f || !f.geometry?.coordinates) return null;
        const [lon, lat] = f.geometry.coordinates;
        const p = f.properties || {};
        const label = [p.name, p.street, p.city, p.state, p.postcode].filter(Boolean).join(", ");
        return {
            lat: Number(lat),
            lon: Number(lon),
            matchedAddress: label || address,
            zip: p.postcode || null,
        };
    },

    async lookup(address) {
        let result = null;
        try { result = await this._nominatim(address); } catch { result = null; }
        if (!result) {
            try { result = await this._photon(address); } catch { result = null; }
        }
        if (!result) {
            throw new Error("Address not found. Try adding city, state, and ZIP.");
        }
        return result;
    },
};

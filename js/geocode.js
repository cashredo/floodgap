// geocode.js — address lookup via OpenStreetMap Nominatim (free, CORS-enabled).
// (The Census Bureau geocoder is more precise for US addresses but blocks
// browser requests, so Nominatim is the client-side choice.)
// Returns { lat, lon, matchedAddress, zip } for a one-line address string.

const Geocode = {
    async lookup(address) {
        const url =
            "https://nominatim.openstreetmap.org/search" +
            "?q=" + encodeURIComponent(address) +
            "&format=json&addressdetails=1&limit=1&countrycodes=us";

        const res = await fetch(url, {
            headers: { "Accept-Language": "en" },
        });
        if (!res.ok) throw new Error("Address service unavailable (" + res.status + ")");
        const data = await res.json();

        if (!Array.isArray(data) || data.length === 0) {
            throw new Error("Address not found. Try adding city, state, and ZIP.");
        }

        const m = data[0];
        return {
            lat: Number(m.lat),
            lon: Number(m.lon),
            matchedAddress: m.display_name,
            zip: m.address?.postcode || null,
        };
    },
};

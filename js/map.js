// map.js — Leaflet map wrapper

const MapView = {
    map: null,
    marker: null,

    init() {
        this.map = L.map("map", { zoomControl: true }).setView([29.76, -95.37], 10); // Houston
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap contributors",
        }).addTo(this.map);
    },

    showLocation(lat, lon, label) {
        if (!this.map) this.init();
        if (this.marker) this.marker.remove();
        this.marker = L.marker([lat, lon]).addTo(this.map);
        if (label) this.marker.bindPopup(label).openPopup();
        this.map.flyTo([lat, lon], 16, { duration: 1.2 });
    },
};

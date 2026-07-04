// sw.js — service worker: caches the app shell so FloodGap installs and
// opens instantly like a native app. API calls always go to the network.

const CACHE = "floodgap-v4";
const SHELL = [
    ".",
    "index.html",
    "css/style.css",
    "js/app.js",
    "js/geocode.js",
    "js/fema.js",
    "js/gapcalc.js",
    "js/map.js",
    "manifest.json",
    "icons/icon-192.png",
    "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
    self.skipWaiting();
});

self.addEventListener("activate", (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);
    // Never cache API/data requests — always live government data.
    if (url.origin !== location.origin) return;
    // Network-first: fresh code when online, cached shell when offline.
    // cache:"no-cache" forces revalidation so the browser HTTP cache can't serve stale JS.
    e.respondWith(
        fetch(e.request, { cache: "no-cache" })
            .then((res) => {
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put(e.request, copy));
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});

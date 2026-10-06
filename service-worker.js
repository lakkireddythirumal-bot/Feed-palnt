const CACHE_NAME = "feed-plant-v6-data-fix";
const APP_ASSETS = ["./", "./index.html", "./style.css", "./app.js"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/app.js") || url.pathname.endsWith("/style.css") || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/manifest.json")) {
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone(); caches.open(CACHE_NAME).then(c => c.put(event.request, copy)); return response;
    }).catch(() => caches.match(event.request)));
  }
});

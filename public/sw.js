const CACHE_NAME = "subli-nation-static-v1";
const PRECACHE_URLS = [
  "/offline.html",
  "/logo.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];
const STATIC_PATHS = ["/logo.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter(name => name.startsWith("subli-nation-") && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () =>
      await caches.match("/offline.html") || Response.error()));
    return;
  }

  const isStaticAsset = url.pathname.startsWith("/_next/static/") || STATIC_PATHS.includes(url.pathname);
  if (!isStaticAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});

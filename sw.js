const CACHE_NAME = "theblackbox-static-v1";

const PRECACHE_PATHS = [
  "",
  "index.html",
  "style.css",
  "background_motion.js",
  "movies.html",
  "movies.js",
  "live.html",
  "live.js",
  "live_player.html",
  "live_player.js",
  "series.html",
  "series.js",
  "series_detail.html",
  "series_detail.js",
  "player.html",
  "open_in_player.js",
];

const scopeUrl = self.registration.scope;
const PRECACHE_URLS = PRECACHE_PATHS.map((path) => new URL(path, scopeUrl).toString());
const OFFLINE_FALLBACK_URL = new URL("index.html", scopeUrl).toString();

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch((error) => {
        console.error("[ServiceWorker] Pre-cache failed", error);
      })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      )
    )
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type !== "basic") {
            return response;
          }

          const responseToCache = response.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache).catch((error) => {
              console.error("[ServiceWorker] Cache put failed", error);
            });
          });

          return response;
        })
        .catch((error) => {
          console.error("[ServiceWorker] Network request failed", error);

          if (request.mode === "navigate" || request.destination === "document") {
            return caches.match(OFFLINE_FALLBACK_URL);
          }

          return Promise.reject(error);
        });
    })
  );
});

const CACHE_NAME = "theblackbox-shell-v16";
const PRECACHE_PATHS = [
  "",
  "index.html",
  "site.webmanifest",
  "icons/app-icon.svg",
];

const scopeUrl = self.registration.scope;
const PRECACHE_URLS = PRECACHE_PATHS.map((path) => new URL(path, scopeUrl).toString());
const OFFLINE_FALLBACK_URL = new URL("index.html", scopeUrl).toString();

function isSameOriginRequest(requestUrl) {
  return requestUrl.origin === self.location.origin;
}

function isAppApiRequest(pathname) {
  return pathname.startsWith("/api/") || pathname.startsWith("/ext/");
}

async function networkFirst(request, { cacheResponse = true } = {}) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (cacheResponse && response && response.status === 200) {
      cache.put(request, response.clone()).catch((error) => {
        console.error("[ServiceWorker] Cache put failed", error);
      });
    }
    return response;
  } catch (error) {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  const networkPromise = fetch(request, { cache: "no-store" })
    .then((response) => {
      if (response && response.status === 200) {
        cache.put(request, response.clone()).catch((error) => {
          console.error("[ServiceWorker] Cache put failed", error);
        });
      }
      return response;
    })
    .catch((error) => {
      console.error("[ServiceWorker] Network request failed", error);
      return null;
    });
  return cachedResponse || networkPromise || Response.error();
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch((error) => {
        console.error("[ServiceWorker] Pre-cache failed", error);
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isSameOriginRequest(url) || isAppApiRequest(url.pathname)) {
    return;
  }

  const acceptsHtml =
    request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html");

  if (acceptsHtml) {
    event.respondWith(
      networkFirst(request).catch(async (error) => {
        console.error("[ServiceWorker] HTML request failed", error);
        return (await caches.match(request)) || caches.match(OFFLINE_FALLBACK_URL);
      }),
    );
    return;
  }

  const destination = request.destination || "";
  if (destination === "script" || destination === "style" || destination === "worker") {
    event.respondWith(
      networkFirst(request).catch(async (error) => {
        console.error("[ServiceWorker] Static request failed", error);
        return (await caches.match(request)) || Response.error();
      }),
    );
    return;
  }

  if (destination === "image" || destination === "font" || destination === "manifest") {
    event.respondWith(staleWhileRevalidate(request));
  }
});

const PROP_ZONE_IDS = [9961316, 9961315, 9961314, 9961313];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

try {
  importScripts(`https://propu.sh/pfe/current/service-worker.min.js?z=${PROP_ZONE_IDS.join(',')}`);
} catch (error) {
  if (self && self.console && typeof self.console.error === 'function') {
    self.console.error('Propeller multi-tag service worker failed to load', error);
  }
}

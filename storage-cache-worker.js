const CACHE_NAME = 'carsongames-storage-v2';
const STORAGE_HOST = 'carson-games-e801ce365c25.herokuapp.com';
const STORAGE_PREFIX = '/api/storage/chat-files/';
const MAX_CACHED_BYTES = 10 * 1024 * 1024;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.host !== STORAGE_HOST || !url.pathname.startsWith(STORAGE_PREFIX)) return;

  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (!response || !response.ok) return response;

  try {
    const length = Number(response.headers.get('content-length') || 0);
    if (!length || length <= MAX_CACHED_BYTES) await cache.put(request, response.clone());
  } catch {
    // Browser caching is optional; never break the actual download.
  }
  return response;
}

const CACHE_NAME = 'carsongames-storage-v2';
const SUPABASE_STORAGE_HOST = 'hbynnertatvxpvtqctyg.supabase.co';
const SUPABASE_STORAGE_PREFIX = '/storage/v1/object/public/chat-files/';
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
  if (url.hostname !== SUPABASE_STORAGE_HOST || !url.pathname.startsWith(SUPABASE_STORAGE_PREFIX)) return;

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

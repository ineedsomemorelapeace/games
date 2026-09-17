(function () {
  const THEME_PREFIX = 'theme-';
  const SITE_META_URL = '/site-meta.json';
  const STORAGE_CACHE_WORKER_URL = '/storage-cache-worker.js';
  const DEFAULT_SITE_META = {
    title: 'Dashboard | RapidIdentity',
    favicon: 'https://northallegheny.us004-rapididentity.com:443/files/NAlogo_gold_flat.png',
  };

  const clearThemeClasses = (element) => {
    if (!element) return;
    for (const className of Array.from(element.classList)) {
      if (className.startsWith(THEME_PREFIX)) element.classList.remove(className);
    }
  };

  const applyThemeToElement = (element, themeName) => {
    if (!element) return;
    clearThemeClasses(element);
    if (themeName && themeName !== 'default') element.classList.add(`${THEME_PREFIX}${themeName}`);
  };

  const applyTheme = (themeName) => {
    applyThemeToElement(document.documentElement, themeName);
    if (document.body) applyThemeToElement(document.body, themeName);
    else document.addEventListener('DOMContentLoaded', () => applyThemeToElement(document.body, themeName), { once: true });
  };

  const syncStoredTheme = () => applyTheme(localStorage.getItem('carson_theme') || 'default');

  const applySiteMeta = (meta) => {
    const resolvedMeta = { ...DEFAULT_SITE_META, ...(meta || {}) };
    if (resolvedMeta.title) document.title = resolvedMeta.title;
    if (resolvedMeta.favicon) {
      let faviconLink = document.querySelector('link[rel="icon"]');
      if (!faviconLink) {
        faviconLink = document.createElement('link');
        faviconLink.setAttribute('rel', 'icon');
        document.head.appendChild(faviconLink);
      }
      faviconLink.setAttribute('href', resolvedMeta.favicon);
      faviconLink.setAttribute('type', 'image/svg+xml');
    }
  };

  const syncSiteMeta = async () => {
    try {
      const response = await fetch(SITE_META_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      applySiteMeta(await response.json());
    } catch {
      applySiteMeta(DEFAULT_SITE_META);
    }
  };

  const originalFetch = window.fetch.bind(window);
  const STORAGE_HOST = 'hbynnertatvxpvtqctyg.supabase.co';
  const STORAGE_PATH = '/storage/v1/object/';
  const MAX_UPLOAD_IMAGE_BYTES = 10 * 1024 * 1024;
  const TARGET_IMAGE_BYTES = 2.5 * 1024 * 1024;
  const MAX_IMAGE_DIMENSION = 1600;
  let optimizingUpload = false;
  let deleteAllStorageRunning = false;

  async function compressUploadImage(blob) {
    if (optimizingUpload || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return null;
    if (!blob.type || !blob.type.startsWith('image/') || blob.type === 'image/svg+xml' || blob.size <= 1024 * 1024) return null;
    if (blob.size > MAX_UPLOAD_IMAGE_BYTES) throw new Error('Image uploads must be 10 MB or smaller.');

    optimizingUpload = true;
    try {
      const bitmap = await createImageBitmap(blob);
      const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
      let width = Math.max(1, Math.round(bitmap.width * scale));
      let height = Math.max(1, Math.round(bitmap.height * scale));
      const render = async (quality) => {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d', { alpha: true });
        ctx.drawImage(bitmap, 0, 0, width, height);
        return canvas.convertToBlob({ type: 'image/webp', quality });
      };

      let result = null;
      for (const quality of [0.82, 0.74, 0.66, 0.58]) {
        result = await render(quality);
        if (result.size <= TARGET_IMAGE_BYTES) break;
      }
      if (result && result.size > TARGET_IMAGE_BYTES) {
        width = Math.max(1, Math.round(width * 0.7));
        height = Math.max(1, Math.round(height * 0.7));
        result = await render(0.58);
      }
      bitmap.close();
      return result && result.size < blob.size ? result : null;
    } finally {
      optimizingUpload = false;
    }
  }

  async function deleteAllChatStorage(authHeaders) {
    if (deleteAllStorageRunning) return { deleted: 0, skipped: true };
    deleteAllStorageRunning = true;
    const bucket = 'chat-files';
    let deleted = 0;

    const headers = new Headers(authHeaders);
    headers.set('Content-Type', 'application/json');

    async function listPrefix(prefix) {
      const response = await originalFetch(`https://${STORAGE_HOST}/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prefix,
          limit: 1000,
          offset: 0,
          sortBy: { column: 'name', order: 'asc' }
        })
      });
      if (!response.ok) throw new Error(`Storage list failed: HTTP ${response.status}`);
      return response.json();
    }

    async function collect(prefix = '') {
      const items = await listPrefix(prefix);
      const paths = [];
      for (const item of items || []) {
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id === null) paths.push(...await collect(path));
        else paths.push(path);
      }
      return paths;
    }

    try {
      const paths = await collect('');
      for (let i = 0; i < paths.length; i += 1000) {
        const batch = paths.slice(i, i + 1000);
        if (!batch.length) continue;
        const response = await originalFetch(`https://${STORAGE_HOST}/storage/v1/object/${bucket}`, {
          method: 'DELETE',
          headers,
          body: JSON.stringify({ prefixes: batch })
        });
        if (!response.ok) throw new Error(`Storage delete failed: HTTP ${response.status}`);
        deleted += batch.length;
      }

      if (window.caches) {
        try { await caches.delete('carsongames-storage-v2'); } catch {}
      }
      console.info(`[CarsonGames] /deleteall removed ${deleted} Storage files.`);
      return { deleted };
    } finally {
      deleteAllStorageRunning = false;
    }
  }

  window.fetch = async function (input, init) {
    let request;
    try { request = new Request(input, init); } catch { return originalFetch(input, init); }
    const url = new URL(request.url);
    const isStorageUpload = url.hostname === STORAGE_HOST &&
      url.pathname.startsWith(STORAGE_PATH) && /^(POST|PUT)$/i.test(request.method);

    const isChatDeleteAllDbRequest = url.hostname === STORAGE_HOST &&
      url.pathname.startsWith('/rest/v1/') && /^(DELETE)$/i.test(request.method) &&
      (url.pathname.includes('/messages') || url.pathname.includes('/whispers')) &&
      location.pathname.includes('/chat') &&
      /(^|&)id=not\.is\.null(&|$)/i.test(url.search.slice(1));

    if (!isStorageUpload && !isChatDeleteAllDbRequest) return originalFetch(request);

    const headers = new Headers(request.headers);

    if (isStorageUpload) {
      headers.set('cache-control', '31536000');
      headers.set('x-carson-storage-optimizer', 'v2');

      try {
        const contentType = headers.get('content-type') || '';
        if (contentType.startsWith('image/') && request.body) {
          const bodyBlob = await request.clone().blob();
          const compressed = await compressUploadImage(bodyBlob);
          if (compressed) {
            headers.set('content-type', 'image/webp');
            return originalFetch(new Request(request, { headers, body: compressed }));
          }
        }
      } catch (error) {
        console.warn('[CarsonGames storage optimizer]', error);
      }

      return originalFetch(new Request(request, { headers }));
    }

    const response = await originalFetch(request);
    if (response.ok && !deleteAllStorageRunning) {
      deleteAllChatStorage(headers).catch(error => {
        console.error('[CarsonGames /deleteall Storage cleanup]', error);
      });
    }
    return response;
  };

  const registerStorageCache = async () => {
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.register(STORAGE_CACHE_WORKER_URL, { scope: '/', updateViaCache: 'none' });
    } catch {
      // Optional optimization; the site works normally if registration fails.
    }
  };

  window.CarsonGamesTheme = {
    apply(themeName) {
      const resolvedTheme = themeName || 'default';
      localStorage.setItem('carson_theme', resolvedTheme);
      applyTheme(resolvedTheme);
    },
    sync: syncStoredTheme,
  };

  syncStoredTheme();
  syncSiteMeta();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', registerStorageCache, { once: true });
  else registerStorageCache();
  window.addEventListener('storage', (event) => {
    if (event.key === 'carson_theme') applyTheme(event.newValue || 'default');
  });
})();
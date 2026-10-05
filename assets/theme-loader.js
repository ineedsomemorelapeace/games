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
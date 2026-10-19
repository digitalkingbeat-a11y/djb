// DJ Battle service worker: caches the app shell so the app opens fast and shows a friendly
// offline page instead of a blank screen. API, auth and any cross-origin (Supabase) traffic is
// never cached. CACHE_VERSION is stamped by `npm run build` (scripts/stamp-sw-version.js) from a
// hash of every shell file, so each change ships a new worker and the app shows "Update ready".
const CACHE_VERSION = 'djb-shell-abb033b16ec5';
const CACHE_PREFIX = 'djb-shell-';
const OFFLINE_URL = 'offline.html';
const SHELL_FILES = [
  './',
  'index.html',
  OFFLINE_URL,
  'manifest.webmanifest',
  'styles.css', 'battle-room.css', 'battle-results.css', 'battle-history.css', 'verified-results.css', 'rankings.css',
  'music-library.css', 'challenges.css', 'hardware.css', 'operations.css', 'professional-redesign.css',
  'api_client.js', 'submission_upload.js', 'battle_modes.js', 'app.js', 'window.js',
  'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js',
  'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js',
  'assets/favicon.svg', 'assets/favicon-64.png', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/icon-maskable-512.png'
];

// Never cache these: live data, sign-in, uploads, and anything carrying credentials.
function isNeverCached(url, request){
  if(request && request.method && request.method !== 'GET') return true;
  if(request && request.headers && typeof request.headers.get === 'function' && request.headers.get('authorization')) return true;
  const path = url.pathname || '';
  if(/^\/(api|auth|rest|storage|realtime|functions)\b/.test(path) || path.includes('/api/') || path.includes('/auth/')) return true;
  if(/supabase/i.test(url.hostname || '')) return true;
  return false;
}

// Only the app's own static files are cached (not audio, uploads or anything else).
function isShellPath(pathname){
  const path = String(pathname || '').replace(/^.*?\/(?=(studio\/|assets\/)?[^/]*$)/, '/');
  return /^\/$/.test(path)
    || /^\/[A-Za-z0-9_.-]+\.(html|css|js|webmanifest)$/.test(path)
    || /^\/studio\/[A-Za-z0-9_.-]+\.js$/.test(path)
    || /^\/assets\/[A-Za-z0-9_.-]+\.(png|svg)$/.test(path);
}

function isSameOrigin(url, origin){ return url.origin === origin; }

function isOldShellCache(name){ return name.startsWith(CACHE_PREFIX) && name !== CACHE_VERSION; }

function cacheableResponse(response){
  return Boolean(response && response.ok && response.status === 200 && response.type === 'basic' && !/no-store/i.test(response.headers.get('cache-control') || ''));
}

if(typeof self !== 'undefined' && typeof self.addEventListener === 'function'){
  self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_VERSION)
      .then(cache => Promise.all(SHELL_FILES.map(file => cache.add(new Request(file, { cache:'reload' })).catch(() => null)))));
    // No skipWaiting() here: a new version waits until the DJ taps "Update ready" (so a page
    // never swaps files mid-battle). The very first install activates right away on its own.
  });

  // The app's "Update ready — tap to refresh" bar sends this.
  self.addEventListener('message', event => {
    if(event && event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  });

  self.addEventListener('activate', event => {
    event.waitUntil(caches.keys()
      .then(names => Promise.all(names.filter(isOldShellCache).map(name => caches.delete(name))))
      .then(() => self.clients.claim()));
  });

  self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if(!isSameOrigin(url, self.location.origin) || isNeverCached(url, request)) return;
    if(request.mode === 'navigate'){
      // Pages: always try the network first so a deploy shows up immediately.
      event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL, { cacheName:CACHE_VERSION })
        .then(offline => offline || new Response('<h1>You\'re offline</h1>', { headers:{ 'Content-Type':'text/html' } }))));
      return;
    }
    if(!isShellPath(url.pathname)) return;
    // Shell files: serve the cached copy right away, refresh it in the background.
    event.respondWith(caches.open(CACHE_VERSION).then(cache => cache.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if(cacheableResponse(response)) cache.put(request, response.clone());
        return response;
      }).catch(() => cached || Response.error());
      return cached || network;
    })));
  });
}

if(typeof module !== 'undefined' && module.exports){
  module.exports = { CACHE_VERSION, CACHE_PREFIX, OFFLINE_URL, SHELL_FILES, isNeverCached, isShellPath, isSameOrigin, isOldShellCache, cacheableResponse };
}

// DJ Battle service worker: caches the app shell so the app opens fast and shows a friendly
// offline page instead of a blank screen. API, auth and any cross-origin (Supabase) traffic is
// never cached. CACHE_VERSION is stamped by `npm run build` (scripts/stamp-sw-version.js) from a
// hash of every shell file, so each change ships a new worker and the app shows "Update ready".
const CACHE_VERSION = 'djb-shell-4d7370783385';
const CACHE_PREFIX = 'djb-shell-';
const OFFLINE_URL = 'offline.html';
const SHELL_FILES = [
  './',
  'index.html',
  OFFLINE_URL,
  'manifest.webmanifest',
  'styles.css', 'battle-room.css', 'battle-results.css', 'battle-history.css', 'verified-results.css', 'rankings.css',
  'music-library.css', 'challenges.css', 'hardware.css', 'operations.css', 'professional-redesign.css', 'themes.css', 'social.css', 'light-theme.css',
  'api_client.js', 'submission_upload.js', 'battle_modes.js', 'app.js', 'social.js', 'connect.js', 'oct20.js', 'oct20b.js', 'passkeys.js', 'invites.js', 'remix_contests.js', 'stems_zip.js', 'sales_chart.js', 'automix.js', 'share_links.js', 'studio_five.js', 'assets/vendor/qrcode.js', 'oct29_five.js', 'share_target.js', 'window.js',
  'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js',
  'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/beatmatch_lessons.js', 'studio/track_prefs.js', 'studio/deck_perf.js', 'studio/studio_browser.js', 'studio/deck_runtime.js',
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

// Only in-app links (./#view) may be opened from an alert.
function safePushUrl(url){ return /^\.\/#[a-z-]{1,40}$/.test(String(url || '')) ? url : './'; }
function parsePushData(data){
  let raw = {};
  try{ raw = data && typeof data.json === 'function' ? data.json() : JSON.parse(String(data || '{}')); }catch(e){ raw = {}; }
  const text = (v, max, d) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : d);
  return { title:text(raw.title, 80, 'DJ Battle'), body:text(raw.body, 120, 'Tap to open DJ Battle'), tag:text(raw.tag, 60, 'djb'), url:safePushUrl(raw.url) };
}

// Nov 1: "Share to DJ Battle". The installed app's manifest share_target POSTs shared audio here.
// The worker keeps the files in a private cache (never sent anywhere) and sends the page to My Music.
const SHARE_CACHE = 'djb-share-inbox';
const SHARE_MAX_FILES = 10;
const SHARE_MAX_BYTES = 300 * 1024 * 1024;
const SHARE_AUDIO_EXT = /\.(mp3|wav|aif|aiff|flac|m4a|aac|ogg|oga|opus|webm)$/i;
function isShareTargetPath(pathname, scopePath){
  const base = String(scopePath || '/').replace(/[^/]*$/, '');
  return String(pathname || '') === base + 'share-target';
}
function isShareableAudio(file){
  if(!file || typeof file.size !== 'number' || file.size <= 0 || file.size > SHARE_MAX_BYTES) return false;
  return /^audio\//i.test(String(file.type || '')) || SHARE_AUDIO_EXT.test(String(file.name || ''));
}
function pickSharedAudio(files){
  const list = Array.from(files || []);
  const audio = list.filter(isShareableAudio).slice(0, SHARE_MAX_FILES);
  return { audio, skipped:list.length - audio.length };
}
function shareRedirectUrl(scope, count, skipped){
  return new URL(`index.html?shared=${Number(count) || 0}&skipped=${Number(skipped) || 0}#library`, scope).href;
}
async function storeSharedFiles(cacheStorage, scope, files){
  await cacheStorage.delete(SHARE_CACHE);
  const cache = await cacheStorage.open(SHARE_CACHE);
  await Promise.all(files.map((file, i) => cache.put(new URL(`__share/${i}`, scope).href, new Response(file, { headers:{
    'Content-Type': file.type || 'application/octet-stream',
    'X-Share-Name': encodeURIComponent(String(file.name || `shared-${i + 1}`).slice(0, 200)),
    'X-Share-Time': String(Date.now())
  } }))));
}
async function handleShareTarget(request, cacheStorage, scope){
  let picked = { audio:[], skipped:0 };
  try{ const form = await request.formData(); picked = pickSharedAudio(form.getAll('audio')); }catch(e){ picked = { audio:[], skipped:1 }; }
  try{ if(picked.audio.length) await storeSharedFiles(cacheStorage, scope, picked.audio); }catch(e){ picked = { audio:[], skipped:picked.audio.length + picked.skipped }; }
  return Response.redirect(shareRedirectUrl(scope, picked.audio.length, picked.skipped), 303);
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

  // Oct 20: lock-screen alerts. The server only sends a short title (never message text).
  self.addEventListener('push', event => {
    const data = parsePushData(event && event.data);
    event.waitUntil(self.registration.showNotification(data.title, {
      body:data.body, tag:data.tag, renotify:true, icon:'assets/icon-192.png', badge:'assets/favicon-64.png', data:{ url:data.url }
    }));
  });
  self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = new URL(safePushUrl(event.notification.data && event.notification.data.url), self.registration.scope).href;
    event.waitUntil(self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
      const open = list.find(c => c.url.split('#')[0] === target.split('#')[0]);
      if(open){ if('navigate' in open) open.navigate(target).catch(() => {}); return open.focus(); }
      return self.clients.openWindow(target);
    }));
  });

  self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if(request.method === 'POST' && isSameOrigin(url, self.location.origin) && isShareTargetPath(url.pathname, new URL(self.registration.scope).pathname)){
      event.respondWith(handleShareTarget(request, caches, self.registration.scope));
      return;
    }
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
  module.exports = { CACHE_VERSION, CACHE_PREFIX, OFFLINE_URL, SHELL_FILES, isNeverCached, isShellPath, isSameOrigin, isOldShellCache, cacheableResponse, safePushUrl, parsePushData, SHARE_CACHE, SHARE_MAX_FILES, SHARE_MAX_BYTES, isShareTargetPath, isShareableAudio, pickSharedAudio, shareRedirectUrl, storeSharedFiles, handleShareTarget };
}

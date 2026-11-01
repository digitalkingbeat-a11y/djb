// Nov 1: Share to DJ Battle. When the app is installed (Android / Chrome), a DJ can tap Share on an
// audio file in Files or another app and pick DJ Battle. The service worker (sw.js) keeps the files
// in a private on-device cache and opens My Music with ?shared=N; this file picks them up, clears the
// cache, and opens the normal upload form (title, artist, BPM, rights category and the music rights
// checkbox) for each one. Nothing is uploaded until the DJ taps Upload.
(function(){
  const SHARE_CACHE = 'djb-share-inbox';
  const MAX_FILES = 10;

  function sharedCountFromUrl(href){
    try{
      const url = new URL(String(href || ''));
      if(!url.searchParams.has('shared')) return null;
      const n = Number(url.searchParams.get('shared'));
      const s = Number(url.searchParams.get('skipped'));
      return { count:Number.isFinite(n) && n > 0 ? Math.min(n, MAX_FILES) : 0, skipped:Number.isFinite(s) && s > 0 ? s : 0 };
    }catch(e){ return null; }
  }

  // Remove ?shared=… so a refresh does not try again.
  function cleanUrl(win){
    try{
      const url = new URL(win.location.href);
      url.searchParams.delete('shared'); url.searchParams.delete('skipped');
      win.history.replaceState(win.history.state, '', url.pathname + (url.search || '') + (url.hash || '#library'));
    }catch(e){}
  }

  // Is "share into the app" possible here? Needs the manifest share_target support (Chromium on Android).
  function shareSupport(win){
    const w = win || window;
    const nav = w.navigator || {};
    const ua = String(nav.userAgent || '');
    const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && Number(nav.maxTouchPoints) > 1);
    const android = /Android/i.test(ua);
    const chromium = /Chrome\/|Chromium|EdgA|SamsungBrowser/i.test(ua) && !/Firefox|FxiOS/i.test(ua);
    const standalone = !!((w.matchMedia && w.matchMedia('(display-mode: standalone)').matches) || nav.standalone);
    const hasSw = 'serviceWorker' in nav && typeof w.caches !== 'undefined';
    return { ios, android, chromium, standalone, hasSw, supported:!ios && android && chromium && hasSw };
  }

  function noteText(support){
    if(support.supported && support.standalone) return 'Tip: in Files or another app, tap Share on an audio file and choose DJ Battle to add it here.';
    if(support.supported) return 'Tip: install DJ Battle on your phone (Add to Home screen), then tap Share on any audio file and choose DJ Battle.';
    if(support.ios) return 'Sharing audio into DJ Battle works when the app is installed on Android (Chrome). On iPhone, use Upload Tracks.';
    return 'Sharing audio into DJ Battle works when the app is installed on Android (Chrome). Here, use Upload Tracks or drag files in.';
  }

  function renderNote(win){
    const doc = (win || window).document;
    const head = doc.querySelector('#library .toolbar > div');
    if(!head) return null;
    let note = doc.getElementById('share-target-note');
    if(!note){ note = doc.createElement('p'); note.id = 'share-target-note'; note.className = 'share-target-note'; head.appendChild(note); }
    const support = shareSupport(win);
    note.textContent = noteText(support);
    note.classList.toggle('supported', support.supported);
    return note;
  }

  async function readSharedFiles(cacheStorage, FileCtor){
    if(!cacheStorage || typeof cacheStorage.open !== 'function') return [];
    const has = typeof cacheStorage.has === 'function' ? await cacheStorage.has(SHARE_CACHE) : true;
    if(!has) return [];
    const cache = await cacheStorage.open(SHARE_CACHE);
    const keys = (await cache.keys()).slice(0, MAX_FILES);
    const files = [];
    for(const req of keys){
      const res = await cache.match(req);
      if(!res) continue;
      const blob = await res.blob();
      let name = 'shared-audio';
      try{ name = decodeURIComponent(res.headers.get('X-Share-Name') || name); }catch(e){}
      name = name.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200) || 'shared-audio';
      const type = res.headers.get('Content-Type') || blob.type || '';
      files.push(new FileCtor([blob], name, { type, lastModified:Number(res.headers.get('X-Share-Time')) || Date.now() }));
    }
    await cacheStorage.delete(SHARE_CACHE);
    return files;
  }

  async function pickUpSharedFiles(win){
    const w = win || window;
    const info = sharedCountFromUrl(w.location.href);
    if(!info) return { ok:false, reason:'none' };
    cleanUrl(w);
    const hooks = w.__DJBattleTestHooks || {};
    if(typeof hooks.switchView === 'function') hooks.switchView('library');
    const toast = (t, b) => { if(typeof w.showAppToast === 'function') w.showAppToast(t, b); };
    let files = [];
    try{ files = await readSharedFiles(w.caches, w.File); }catch(e){ files = []; }
    if(!files.length){
      toast('Nothing to add', info.skipped ? 'That file isn\'t an audio file DJ Battle can use. Share MP3, WAV, AIFF, FLAC, M4A or OGG.' : 'The shared file could not be read. Try Upload Tracks instead.');
      return { ok:false, reason:'empty', skipped:info.skipped };
    }
    if(info.skipped) toast('Some files skipped', `${info.skipped} shared file(s) weren't audio or were too big.`);
    const handle = hooks.handleLibraryPickedFiles || w.handleLibraryPickedFiles;
    if(typeof handle !== 'function') return { ok:false, reason:'no-upload' };
    await handle(files);
    return { ok:true, count:files.length, skipped:info.skipped };
  }

  const api = { SHARE_CACHE, MAX_FILES, sharedCountFromUrl, shareSupport, noteText, renderNote, readSharedFiles, pickUpSharedFiles };
  if(typeof window !== 'undefined' && window.document){
    window.DJBShareTarget = api;
    Object.assign(window.__DJBattleTestHooks || (window.__DJBattleTestHooks = {}), { shareTarget:api });
    renderNote(window);
    if(!window.__DJBattleSkipShareTarget) pickUpSharedFiles(window).catch(() => {});
  }
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})();

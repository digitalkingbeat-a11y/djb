// Nov 1: "Play on a speaker or TV". Adds a cast button to the persistent player (mixes / library
// tracks) and to battle replay players. Uses the browser's own picker: the Remote Playback API
// (Chrome on Android -> Chromecast / Google TV / Nest speakers; Safari -> AirPlay) or Safari's
// AirPlay picker. Where neither exists (Firefox, most desktop Chrome without devices, in-app
// browsers) the button stays hidden; a failed attempt explains why in plain words.
(function(){
  const LABEL = 'Play on a speaker or TV';

  function castSupport(audio, win){
    const w = win || window;
    const remote = !!(audio && audio.remote && typeof audio.remote.prompt === 'function');
    const airplay = !!(audio && typeof audio.webkitShowPlaybackTargetPicker === 'function') || typeof w.WebKitPlaybackTargetAvailabilityEvent !== 'undefined';
    return { remote, airplay, supported:remote || airplay };
  }

  function errorMessage(err, audio){
    const name = String(err && err.name || '');
    const src = String(audio && (audio.currentSrc || audio.src) || '');
    if(!src) return 'Play a track first, then tap the cast button.';
    if(/^blob:|^data:/.test(src) && name === 'NotSupportedError') return 'This track is only saved on this device, so a speaker or TV can\'t reach it. Upload it to your account to cast it.';
    if(name === 'NotFoundError') return 'No speaker or TV found. Make sure it\'s on the same Wi‑Fi and switched on.';
    if(name === 'NotAllowedError' || name === 'AbortError') return '';
    if(name === 'NotSupportedError') return 'Casting isn\'t supported in this browser. Try Chrome on Android, or Safari on iPhone, iPad or Mac.';
    if(name === 'InvalidStateError') return 'Casting is turned off for this player.';
    return 'Couldn\'t start casting. Try again.';
  }

  function setState(btn, state){
    btn.dataset.castState = state;
    btn.classList.toggle('casting', state === 'connected');
    btn.setAttribute('aria-pressed', state === 'connected' ? 'true' : 'false');
    const txt = state === 'connected' ? 'Casting' : state === 'connecting' ? 'Connecting…' : 'Cast';
    const label = btn.querySelector('.cast-label'); if(label) label.textContent = txt;
    btn.title = state === 'connected' ? 'Playing on a speaker or TV. Tap to change or stop.' : LABEL;
  }

  async function startCast(audio, btn, win){
    const w = win || window;
    const toast = (t, b) => { if(typeof w.showAppToast === 'function') w.showAppToast(t, b); };
    const s = castSupport(audio, w);
    if(!s.supported){ toast('Can\'t cast here', errorMessage({ name:'NotSupportedError' }, { src:'x' })); return { ok:false, reason:'unsupported' }; }
    if(!(audio.currentSrc || audio.src)){ toast('Nothing to cast', errorMessage(null, audio)); return { ok:false, reason:'no-source' }; }
    try{
      if(s.remote) await audio.remote.prompt();
      else audio.webkitShowPlaybackTargetPicker();
      return { ok:true, via:s.remote ? 'remote' : 'airplay' };
    }catch(err){
      const msg = errorMessage(err, audio);
      if(msg) toast('Can\'t cast', msg);
      return { ok:false, reason:String(err && err.name || 'error'), message:msg };
    }
  }

  function attach(audio, host, opts){
    const w = (opts && opts.win) || window;
    if(!audio || !host || audio.dataset.castWired) return null;
    const doc = host.ownerDocument;
    const s = castSupport(audio, w);
    audio.dataset.castWired = '1';
    audio.disableRemotePlayback = false;
    const btn = doc.createElement('button');
    btn.type = 'button'; btn.className = 'ghost cast-btn'; btn.setAttribute('aria-label', LABEL);
    btn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M21 3H3a2 2 0 0 0-2 2v3h2V5h18v14h-7v2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM1 18v3h3a3 3 0 0 0-3-3zm0-4v2a5 5 0 0 1 5 5h2a7 7 0 0 0-7-7zm0-4v2a9 9 0 0 1 9 9h2A11 11 0 0 0 1 10z"/></svg><span class="cast-label">Cast</span>';
    btn.hidden = !s.supported;
    setState(btn, 'disconnected');
    btn.onclick = () => startCast(audio, btn, w);
    if(s.remote){
      ['connecting', 'connect', 'disconnect'].forEach(ev => audio.remote.addEventListener(ev, () => setState(btn, ev === 'connect' ? 'connected' : ev === 'connecting' ? 'connecting' : 'disconnected')));
      if(audio.remote.state) setState(btn, audio.remote.state);
    } else if(s.airplay){
      audio.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', () => setState(btn, audio.webkitCurrentPlaybackTargetIsWireless ? 'connected' : 'disconnected'));
      audio.addEventListener('webkitplaybacktargetavailabilitychanged', e => { btn.hidden = e.availability !== 'available'; });
    }
    if(opts && opts.before) host.insertBefore(btn, opts.before); else host.appendChild(btn);
    // A class instead of CSS :has(), so older iPhones lay the player out the same way.
    const syncHost = () => host.classList.toggle('has-cast', !btn.hidden);
    syncHost();
    if(s.airplay && !s.remote) audio.addEventListener('webkitplaybacktargetavailabilitychanged', () => setTimeout(syncHost, 0));
    return btn;
  }

  function wireAll(win){
    const w = win || window, doc = w.document;
    const player = doc.getElementById('library-player-audio');
    if(player) attach(player, doc.getElementById('library-player'), { win:w, before:doc.getElementById('library-player-minimize') });
    doc.querySelectorAll('audio.timed-audio').forEach(a => {
      if(a.dataset.castWired) return;
      const row = doc.createElement('div'); row.className = 'cast-row';
      a.insertAdjacentElement('afterend', row);
      attach(a, row, { win:w });
    });
  }

  const api = { LABEL, castSupport, errorMessage, startCast, attach, wireAll };
  if(typeof window !== 'undefined' && window.document){
    window.DJBCast = api;
    Object.assign(window.__DJBattleTestHooks || (window.__DJBattleTestHooks = {}), { cast:api });
    // Never let the cast button break the rest of the app: errors are caught, and the watcher only
    // wakes up when an <audio> element is added (batched), not on every DOM change.
    const safeWire = () => { try{ wireAll(window); }catch(e){} };
    safeWire();
    let queued = false;
    const hasAudio = list => list.some(m => Array.from(m.addedNodes || []).some(n => n.nodeType === 1 && (n.tagName === 'AUDIO' || (n.querySelector && n.querySelector('audio')))));
    if(typeof MutationObserver !== 'undefined') new MutationObserver(list => {
      if(queued || !hasAudio(list)) return;
      queued = true;
      setTimeout(() => { queued = false; safeWire(); }, 50);
    }).observe(window.document.body, { childList:true, subtree:true });
  }
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})();

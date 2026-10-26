// Studio five (Oct 26): mic talkover, keep the screen awake, waveform zoom,
// tracklist copy as chapters, and battle time limit warnings with an automatic stop.
(function(W){
  'use strict';
  const D = W.document;
  const ZOOM_LEVELS = [1, 2, 4, 8];
  const DUCK_CHOICES = [{ value:0.5, label:'Music drops to half' }, { value:0.3, label:'Music drops low' }, { value:0.7, label:'Music drops a little' }];
  const WARN_MS = 60000;

  // ---------- pure helpers ----------
  function snapZoom(v){
    const n = Number(v) || 1;
    return ZOOM_LEVELS.reduce((best, z) => Math.abs(Math.log(z) - Math.log(Math.max(0.5, n))) < Math.abs(Math.log(best) - Math.log(Math.max(0.5, n))) ? z : best, 1);
  }
  function stepZoom(z, dir){
    const i = ZOOM_LEVELS.indexOf(snapZoom(z));
    return ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i + (dir > 0 ? 1 : -1)))];
  }
  // Fraction of the track hidden off the left edge so the playhead stays in view (centred when possible).
  function zoomOffset(frac, z){
    const zoom = Math.max(1, Number(z) || 1);
    if(zoom === 1) return 0;
    const view = 1 / zoom;
    return Math.max(0, Math.min(1 - view, (Number(frac) || 0) - view / 2));
  }
  function pinchZoom(startZoom, startDist, dist){
    if(!(startDist > 0) || !(dist > 0)) return snapZoom(startZoom);
    return snapZoom(Math.max(1, Math.min(8, startZoom * (dist / startDist))));
  }
  function clock(ms){
    const s = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function limitPhase(remainingMs){
    if(!(Number.isFinite(remainingMs))) return 'none';
    if(remainingMs <= 0) return 'over';
    if(remainingMs <= WARN_MS) return 'warn';
    return 'ok';
  }
  function fmtTime(ms){
    const s = Math.floor(Math.max(0, Number(ms) || 0) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  // "00:00 Artist - Title" per line, first line always at 00:00 so YouTube/Mixcloud read them as chapters.
  function chaptersText(list, title){
    const rows = (list || []).filter(t => t && t.title).slice().sort((a, b) => (a.ms || 0) - (b.ms || 0));
    if(!rows.length) return '';
    const lines = rows.map(t => `${fmtTime(t.ms)} ${t.artist ? `${t.artist} - ` : ''}${t.title}`);
    if((rows[0].ms || 0) >= 1000) lines.unshift('00:00 Intro');
    return (title ? [title, ''] : []).concat(lines).join('\n');
  }
  function wakeWanted(o){ return Boolean(o && o.enabled && o.visible !== false && (o.playing || o.recording)); }

  // ---------- state ----------
  const hooks = () => W.djbStudioHooks || {};
  const rt = () => { try{ return hooks().runtime && hooks().runtime(); }catch(e){ return null; } };
  const toast = (t, b) => { if(W.showAppToast) W.showAppToast(t, b); };
  const store = (() => { try{ return W.localStorage; }catch(e){ return null; } })();
  const st = {
    zoom:{ a:1, b:1 }, frac:{ a:0, b:0 },
    awakeEnabled: !(store && store.getItem('djbKeepAwake') === 'off'),
    lock:null, lockPending:false, awakeNote:'',
    mic:null, talking:false, duck:Number(store && store.getItem('djbMicDuck')) || 0.5, monitor:false,
    takeKey:null, warned:false, stopped:false, clockWarned:false,
    timer:null, view:''
  };

  function decksPlaying(){ return ['a', 'b'].some(d => { const a = D.getElementById(`audio-${d}`); return a && a.src && !a.paused; }); }
  function recState(){ try{ return hooks().recording ? hooks().recording() : null; }catch(e){ return null; } }
  function recording(){ const r = recState(); return Boolean(r && r.state === 'recording'); }

  // ---------- keep the screen awake ----------
  function wakeSupported(){ return Boolean(W.navigator && W.navigator.wakeLock && W.navigator.wakeLock.request); }
  async function syncWake(){
    const want = wakeWanted({ enabled:st.awakeEnabled, playing:decksPlaying(), recording:recording(), visible:D.visibilityState !== 'hidden' });
    if(want && !st.lock && !st.lockPending && wakeSupported()){
      st.lockPending = true;
      try{
        const lock = await W.navigator.wakeLock.request('screen');
        st.lock = lock; st.awakeNote = '';
        if(lock && lock.addEventListener) lock.addEventListener('release', () => { if(st.lock === lock) st.lock = null; renderAwake(); });
      }catch(e){ st.awakeNote = 'The browser said no (low battery or power saver can block it).'; }
      st.lockPending = false;
    }else if(!want && st.lock){
      const lock = st.lock; st.lock = null;
      try{ await lock.release(); }catch(e){}
    }
    renderAwake();
    return Boolean(st.lock);
  }
  function setAwakeEnabled(on){
    st.awakeEnabled = Boolean(on);
    try{ store && store.setItem('djbKeepAwake', on ? 'on' : 'off'); }catch(e){}
    return syncWake();
  }
  function renderAwake(){
    const btn = D.getElementById('sf-awake');
    const note = D.getElementById('sf-awake-note');
    if(!btn) return;
    btn.setAttribute('aria-pressed', String(st.awakeEnabled));
    btn.classList.toggle('on', st.awakeEnabled);
    btn.textContent = st.awakeEnabled ? 'Keep screen awake: On' : 'Keep screen awake: Off';
    if(note){
      note.textContent = !wakeSupported() ? 'This browser can\'t keep the screen on. Turn off auto-lock while you mix.'
        : st.awakeNote || (!st.awakeEnabled ? 'The screen may dim while you mix.' : st.lock ? 'Screen is staying on.' : 'Turns on while a deck plays or you record.');
    }
  }

  // ---------- mic talkover ----------
  async function micOn(){
    if(st.mic) return { ok:true };
    const md = W.navigator && W.navigator.mediaDevices;
    if(!md || !md.getUserMedia){ renderMic('This browser has no mic access.'); return { ok:false, error:'unsupported' }; }
    const r = rt();
    try{
      const stream = await md.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true } });
      if(r && r.ensureAudioGraph) r.ensureAudioGraph();
      const ctx = r && r.getAudioContext && r.getAudioContext();
      if(!ctx) throw new Error('Press Play on a deck once, then try again.');
      if(ctx.resume) try{ await ctx.resume(); }catch(e){}
      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain(); gain.gain.value = 0;
      const monitor = ctx.createGain(); monitor.gain.value = st.monitor ? 1 : 0;
      source.connect(gain);
      const dest = r.getRecordingDestination && r.getRecordingDestination();
      if(dest) gain.connect(dest);
      gain.connect(monitor); monitor.connect(ctx.destination);
      let analyser = null;
      if(ctx.createAnalyser){ analyser = ctx.createAnalyser(); analyser.fftSize = 256; source.connect(analyser); }
      st.mic = { stream, source, gain, monitor, analyser, ctx };
      renderMic('');
      return { ok:true };
    }catch(e){
      const msg = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'Mic blocked. Allow the mic for this site in your browser settings.' : (e && e.message) || 'Could not open the mic.';
      renderMic(msg);
      return { ok:false, error:msg };
    }
  }
  function micOff(){
    if(st.talking) setTalk(false);
    if(st.mic){
      try{ st.mic.stream.getTracks().forEach(t => t.stop()); }catch(e){}
      ['source', 'gain', 'monitor', 'analyser'].forEach(k => { try{ st.mic[k] && st.mic[k].disconnect(); }catch(e){} });
    }
    st.mic = null;
    renderMic('');
  }
  function setTalk(on){
    const want = Boolean(on) && Boolean(st.mic);
    st.talking = want;
    const r = rt();
    if(r && r.setDuck) r.setDuck(want ? st.duck : 1);
    if(st.mic){
      const g = st.mic.gain.gain;
      try{ if(g.setTargetAtTime) g.setTargetAtTime(want ? 1 : 0, st.mic.ctx.currentTime, 0.04); else g.value = want ? 1 : 0; }catch(e){ g.value = want ? 1 : 0; }
    }
    renderMic();
    return want;
  }
  function setDuck(v){
    st.duck = Math.max(0.05, Math.min(1, Number(v) || 0.5));
    try{ store && store.setItem('djbMicDuck', String(st.duck)); }catch(e){}
    if(st.talking){ const r = rt(); if(r && r.setDuck) r.setDuck(st.duck); }
  }
  function setMonitor(on){
    st.monitor = Boolean(on);
    if(st.mic) try{ st.mic.monitor.gain.value = st.monitor ? 1 : 0; }catch(e){}
  }
  function micLevel(){
    if(!st.mic || !st.mic.analyser || !st.mic.analyser.getByteTimeDomainData) return 0;
    const buf = new Uint8Array(st.mic.analyser.fftSize);
    st.mic.analyser.getByteTimeDomainData(buf);
    let peak = 0; for(let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128);
    return Math.min(1, peak * 1.6);
  }
  function renderMic(msg){
    const box = D.getElementById('sf-mic'); if(!box) return;
    const on = D.getElementById('sf-mic-on'), talk = D.getElementById('sf-talk'), note = D.getElementById('sf-mic-note');
    if(on) on.textContent = st.mic ? 'Mic off' : 'Turn on mic';
    if(talk){ talk.disabled = !st.mic; talk.classList.toggle('live', st.talking); talk.setAttribute('aria-pressed', String(st.talking)); talk.textContent = st.talking ? 'TALKING' : 'TALK'; }
    box.classList.toggle('live', st.talking);
    if(note && msg !== undefined) note.textContent = msg || (st.mic ? 'Tap TALK (or hold M) to speak. Music dips while you talk. Your voice goes into the recording.' : 'Use a headset mic to avoid echo.');
  }

  // ---------- waveform zoom ----------
  function applyZoom(deck){
    const w = D.getElementById(`wave-${deck}`); if(!w) return;
    const layer = w.querySelector('.wave-layer');
    const z = st.zoom[deck] || 1;
    w.classList.toggle('zoomed', z > 1);
    if(layer){
      layer.style.width = `${z * 100}%`;
      // translateX % is of the layer's own width (z × the waveform), so the track offset maps straight across.
      layer.style.transform = z > 1 ? `translateX(${-(zoomOffset(st.frac[deck], z) * 100).toFixed(3)}%)` : '';
    }
    const label = D.getElementById(`sf-zoom-label-${deck}`); if(label) label.textContent = `${z}×`;
    const out = D.getElementById(`sf-zoom-out-${deck}`), inn = D.getElementById(`sf-zoom-in-${deck}`);
    if(out) out.disabled = z <= 1; if(inn) inn.disabled = z >= 8;
  }
  function setZoom(deck, z){ st.zoom[deck] = snapZoom(z); applyZoom(deck); return st.zoom[deck]; }
  function wirePinch(deck){
    const w = D.getElementById(`wave-${deck}`); if(!w || w.dataset.sfPinch) return;
    w.dataset.sfPinch = '1';
    let start = null;
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    w.addEventListener('touchstart', e => { if(e.touches && e.touches.length === 2){ start = { d:dist(e.touches), z:st.zoom[deck] }; } }, { passive:true });
    w.addEventListener('touchmove', e => {
      if(!start || !e.touches || e.touches.length !== 2) return;
      if(e.cancelable) e.preventDefault();
      setZoom(deck, pinchZoom(start.z, start.d, dist(e.touches)));
    }, { passive:false });
    w.addEventListener('touchend', e => { if(!e.touches || e.touches.length < 2) start = null; });
  }

  // ---------- battle time limit ----------
  function stopDecks(){
    const r = rt();
    ['a', 'b'].forEach(d => {
      const a = D.getElementById(`audio-${d}`);
      if(a && !a.paused) try{ a.pause(); }catch(e){}
      if(r && r.updateDeckButtons) try{ r.updateDeckButtons(d); }catch(e){}
    });
  }
  function showLimit(text, kind){
    const b = D.getElementById('sf-limit-banner'); if(!b) return;
    b.textContent = text || '';
    b.className = `sf-limit-banner ${kind || ''}`;
    b.classList.toggle('hidden', !text);
  }
  function limitTick(nowMs){
    const r = recState();
    const clockEl = D.getElementById('battle-clock');
    const card = clockEl && clockEl.closest ? clockEl.closest('.timer-card') : null;
    if(r && r.state === 'recording' && r.limitMs > 0 && r.startedAt){
      const key = `${r.startedAt}`;
      if(st.takeKey !== key){ st.takeKey = key; st.warned = false; st.stopped = false; showLimit(''); }
      const remaining = r.limitMs - (nowMs - r.startedAt);
      const phase = limitPhase(remaining);
      if(clockEl) clockEl.textContent = clock(remaining);
      if(card){ card.classList.toggle('sf-warn', phase === 'warn'); card.classList.toggle('sf-over', phase === 'over'); }
      if(phase === 'warn' && !st.warned){ st.warned = true; showLimit('1 minute left', 'warn'); toast('1 minute left', 'Start bringing your set home. The take stops on its own at 0:00.'); }
      if(phase === 'over' && !st.stopped){ st.stopped = true; try{ hooks().stopRecording && hooks().stopRecording(); }catch(e){} }
      return phase;
    }
    if(r && r.autoStopped && st.takeKey && !st.stoppedDecks){
      st.stoppedDecks = st.takeKey; stopDecks();
      if(clockEl) clockEl.textContent = '0:00';
      if(card){ card.classList.remove('sf-warn'); card.classList.add('sf-over'); }
      showLimit('Time\'s up. The take stopped and the decks paused.', 'over');
      toast('Time\'s up', 'Your battle take stopped at the time limit. Review it below.');
      return 'over';
    }
    if(r && r.state === 'recording' && st.stoppedDecks){ st.stoppedDecks = null; }
    return 'none';
  }
  // The manual BATTLE CLOCK in the studio head (Start button) gets the same warning and stop.
  function clockTick(secondsLeft){
    const ms = Number(secondsLeft) * 1000;
    const phase = limitPhase(ms);
    const card = D.querySelector('#studio .timer-card');
    if(card){ card.classList.toggle('sf-warn', phase === 'warn'); card.classList.toggle('sf-over', phase === 'over'); }
    if(phase === 'ok') st.clockWarned = false;
    if(phase === 'warn' && !st.clockWarned){ st.clockWarned = true; showLimit('1 minute left', 'warn'); toast('1 minute left', 'The battle clock is almost out.'); }
    if(phase === 'over'){
      if(recording()) try{ hooks().stopRecording && hooks().stopRecording(); }catch(e){}
      stopDecks();
      showLimit('Time\'s up. The decks paused.', 'over');
      toast('Time\'s up', 'The battle clock ran out.');
    }
    return phase;
  }

  // ---------- tracklist chapters ----------
  async function copyChapters(){
    const r = recState();
    const text = chaptersText(r && r.tracklist, '');
    if(!text) return { ok:false, text };
    try{ if(W.navigator.clipboard && W.navigator.clipboard.writeText){ await W.navigator.clipboard.writeText(text); return { ok:true, text }; } }catch(e){}
    try{ const ta = D.createElement('textarea'); ta.value = text; D.body.appendChild(ta); ta.select(); const ok = D.execCommand && D.execCommand('copy'); ta.remove(); return { ok:Boolean(ok), text }; }catch(e){ return { ok:false, text }; }
  }
  function ensureChaptersButton(){
    const head = D.querySelector('#recording-tracklist .tracklist-head');
    if(!head || !D.getElementById('copy-tracklist') || D.getElementById('sf-copy-chapters')) return;
    const b = D.createElement('button');
    b.className = 'ghost small'; b.id = 'sf-copy-chapters'; b.type = 'button';
    b.textContent = 'Copy as chapters';
    b.title = 'Copies 00:00 Artist - Title lines, ready to paste into a YouTube or Mixcloud description';
    b.onclick = () => copyChapters().then(res => { b.textContent = res.ok ? 'Copied' : 'Copy failed'; setTimeout(() => { b.textContent = 'Copy as chapters'; }, 1500); });
    head.appendChild(b);
  }

  // ---------- mount ----------
  function mount(){
    const studio = D.getElementById('studio'); if(!studio) return false;
    const head = studio.querySelector('.studio-head');
    if(head && !D.getElementById('sf-awake-box')){
      const box = D.createElement('div'); box.id = 'sf-awake-box'; box.className = 'sf-awake-box';
      box.innerHTML = '<button class="ghost small" id="sf-awake" type="button" aria-pressed="true"></button><small id="sf-awake-note"></small>';
      head.appendChild(box);
      D.getElementById('sf-awake').onclick = () => setAwakeEnabled(!st.awakeEnabled);
    }
    const strip = D.getElementById('studio-recording-panel');
    if(strip && !D.getElementById('sf-limit-banner')){
      const b = D.createElement('div'); b.id = 'sf-limit-banner'; b.className = 'sf-limit-banner hidden';
      b.setAttribute('role', 'status'); b.setAttribute('aria-live', 'assertive');
      strip.appendChild(b);
    }
    const mixer = studio.querySelector('.professional-mixer');
    if(mixer && !D.getElementById('sf-mic')){
      const m = D.createElement('div'); m.id = 'sf-mic'; m.className = 'sf-mic';
      m.innerHTML = `<div class="sf-mic-row"><span class="eyebrow">MIC</span><button class="ghost small" id="sf-mic-on" type="button">Turn on mic</button><button class="primary small" id="sf-talk" type="button" disabled aria-pressed="false">TALK</button></div>
        <div class="sf-mic-meter" aria-label="Mic level"><i id="sf-mic-level"></i></div>
        <div class="sf-mic-row"><select id="sf-duck" aria-label="How much the music drops while you talk">${DUCK_CHOICES.map(c => `<option value="${c.value}"${c.value === st.duck ? ' selected' : ''}>${c.label}</option>`).join('')}</select>
        <label class="sf-mic-monitor"><input type="checkbox" id="sf-mic-monitor"> Hear mic in speakers</label></div>
        <small id="sf-mic-note"></small>`;
      mixer.appendChild(m);
      D.getElementById('sf-mic-on').onclick = () => (st.mic ? micOff() : micOn());
      D.getElementById('sf-talk').onclick = () => setTalk(!st.talking);
      D.getElementById('sf-duck').onchange = e => setDuck(e.target.value);
      D.getElementById('sf-mic-monitor').onchange = e => setMonitor(e.target.checked);
      renderMic('');
    }
    ['a', 'b'].forEach(deck => {
      const w = D.getElementById(`wave-${deck}`);
      if(w && !D.getElementById(`sf-zoom-${deck}`)){
        const z = D.createElement('div'); z.id = `sf-zoom-${deck}`; z.className = 'sf-zoom';
        z.innerHTML = `<button class="ghost small" id="sf-zoom-out-${deck}" type="button" aria-label="Zoom out deck ${deck.toUpperCase()} waveform">−</button><span id="sf-zoom-label-${deck}">1×</span><button class="ghost small" id="sf-zoom-in-${deck}" type="button" aria-label="Zoom in deck ${deck.toUpperCase()} waveform">+</button>`;
        w.insertAdjacentElement('afterend', z);
        D.getElementById(`sf-zoom-out-${deck}`).onclick = () => setZoom(deck, stepZoom(st.zoom[deck], -1));
        D.getElementById(`sf-zoom-in-${deck}`).onclick = () => setZoom(deck, stepZoom(st.zoom[deck], 1));
      }
      wirePinch(deck);
      applyZoom(deck);
    });
    renderAwake();
    return true;
  }
  function tick(nowMs){
    if(!D.getElementById('sf-mic')) mount();
    limitTick(nowMs == null ? Date.now() : nowMs);
    ensureChaptersButton();
    const lvl = D.getElementById('sf-mic-level'); if(lvl) lvl.style.width = `${Math.round(micLevel() * 100)}%`;
    return syncWake();
  }
  function onView(view){
    st.view = view;
    if(view === 'studio'){
      mount();
      if(!st.timer){ st.timer = setInterval(() => { tick(); }, 400); if(st.timer && st.timer.unref) st.timer.unref(); }
    }else if(st.timer && !recording() && !decksPlaying()){
      clearInterval(st.timer); st.timer = null; syncWake();
    }
  }
  D.addEventListener('visibilitychange', () => { if(D.visibilityState === 'visible') syncWake(); });
  // Hold M to talk (ignored while typing).
  D.addEventListener('keydown', e => { if((e.key === 'm' || e.key === 'M') && !e.repeat && st.mic && !/input|textarea|select/i.test((e.target && e.target.tagName) || '') && !(e.target && e.target.isContentEditable)) setTalk(true); });
  D.addEventListener('keyup', e => { if((e.key === 'm' || e.key === 'M') && st.talking && st.mic && !/input|textarea|select/i.test((e.target && e.target.tagName) || '')) setTalk(false); });

  W.DJBStudio26 = {
    ZOOM_LEVELS, snapZoom, stepZoom, zoomOffset, pinchZoom, clock, limitPhase, fmtTime, chaptersText, wakeWanted,
    mount, tick, onView, clockTick, limitTick, syncWake, setAwakeEnabled, micOn, micOff, setTalk, setDuck, setMonitor,
    setZoom, getZoom:deck => st.zoom[deck], copyChapters, stopDecks, state:st,
    followPlayhead(deck, frac){ st.frac[deck] = frac; if(st.zoom[deck] > 1) applyZoom(deck); },
    waveRendered(deck){ applyZoom(deck); }
  };
})(window);

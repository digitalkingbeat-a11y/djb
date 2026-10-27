// Auto-mix practice mode: the Studio plays a crate by itself, crossfading from one deck to the
// other near the end of each track. Browser only. The DJ picks a crate and a transition length,
// then presses Start; Stop hands the decks back. Pure helpers are exported for tests.
(function(W){
  'use strict';
  const D = W.document;
  const TRANSITIONS = [4, 8, 16, 32];
  const DEFAULT_TRANSITION = 8;
  const TICK_MS = 200;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  function cleanTransition(sec){ const n = Number(sec); return TRANSITIONS.includes(n) ? n : DEFAULT_TRANSITION; }
  // Crossfader value (-1 = all Deck A, 1 = all Deck B) at `elapsed` seconds into a fade toward `toDeck`.
  function fadePosition(elapsed, length, toDeck){
    const p = Math.max(0, Math.min(1, length > 0 ? elapsed / length : 1));
    const eased = p * p * (3 - 2 * p); // smoothstep: gentle start and finish
    return toDeck === 'b' ? -1 + 2 * eased : 1 - 2 * eased;
  }
  // When the fade should start, in seconds into the track. Short tracks get at most half their length.
  function fadeStartAt(duration, transitionSec){
    if(!(duration > 0)) return null;
    const fade = Math.min(transitionSec, duration / 2);
    return Math.max(0, duration - fade);
  }
  function otherDeck(deck){ return deck === 'a' ? 'b' : 'a'; }

  // ---- Harmonic "Order by key" (Camelot wheel) ----
  function parseCamelot(code){ const m = /^(1[0-2]|[1-9])([AB])$/.exec(String(code || '').trim().toUpperCase()); return m ? { n:Number(m[1]), l:m[2] } : null; }
  // 0 = same key, 1 = perfect neighbour (±1 or relative major/minor), 2 = diagonal, higher = further apart.
  function keyDistance(a, b){
    const x = parseCamelot(a), y = parseCamelot(b);
    if(!x || !y) return null;
    const step = Math.min((x.n - y.n + 12) % 12, (y.n - x.n + 12) % 12);
    const swap = x.l === y.l ? 0 : 1;
    if(step === 0) return swap;
    if(step === 1) return 1 + swap;
    return step + 1 + swap;
  }
  function matchLabel(d){ if(d == null) return 'unknown'; if(d === 0) return 'same'; if(d === 1) return 'smooth'; if(d === 2) return 'ok'; return 'clash'; }
  // items: [{ id, camelot, bpm }] in crate order. Greedy walk: always the closest key next, then the closest BPM,
  // then crate order. Tracks with no key go last, in crate order.
  function harmonicOrder(items){
    const keyed = items.map((t, i) => ({ ...t, i })).filter(t => parseCamelot(t.camelot));
    const unkeyed = items.filter(t => !parseCamelot(t.camelot));
    const out = [];
    const left = keyed.slice();
    let cur = left.shift();
    while(cur){
      out.push(cur);
      if(!left.length) break;
      let best = 0;
      left.forEach((t, k) => {
        const b = left[best];
        const dt = keyDistance(cur.camelot, t.camelot), db = keyDistance(cur.camelot, b.camelot);
        const bt = (cur.bpm && t.bpm) ? Math.abs(cur.bpm - t.bpm) : 999, bb = (cur.bpm && b.bpm) ? Math.abs(cur.bpm - b.bpm) : 999;
        if(dt < db || (dt === db && (bt < bb || (bt === bb && t.i < b.i)))) best = k;
      });
      cur = left.splice(best, 1)[0];
    }
    const ordered = [...out, ...unkeyed];
    return ordered.map((t, k) => ({ id:t.id, camelot:parseCamelot(t.camelot) ? String(t.camelot).toUpperCase() : '', bpm:t.bpm || null, match:k === 0 ? null : matchLabel(keyDistance(ordered[k - 1].camelot, t.camelot)) }));
  }

  // The engine. deps: { runtime, getAudio(deck), canLoad(id), now(), setInterval, clearInterval, setXfader(v), onChange(status) }
  function createEngine(deps){
    const s = { running:false, queue:[], index:-1, deck:'a', transition:DEFAULT_TRANSITION, fading:null, timer:null, message:'', played:0 };
    const now = deps.now || (() => Date.now());
    function emit(msg){ if(msg != null) s.message = msg; if(deps.onChange) deps.onChange(status()); }
    function status(){ return { running:s.running, index:s.index, total:s.queue.length, deck:s.deck, fading:Boolean(s.fading), transition:s.transition, message:s.message, current:s.queue[s.index] || null, next:s.queue[s.index + 1] || null, played:s.played }; }
    function setX(v){ deps.setXfader(v); if(deps.runtime && deps.runtime.applyMix) deps.runtime.applyMix(); }
    async function ensurePlaying(deck){ const a = deps.getAudio(deck); if(a && a.paused){ const r = await deps.runtime.playDeck(deck); return r && r.ok !== false; } return true; }
    function pauseDeck(deck){ const a = deps.getAudio(deck); if(a && !a.paused) a.pause(); }
    // Load the next loadable track (skipping ones the rules block) onto a deck. Returns its queue index or -1.
    function loadNext(fromIndex, deck){
      for(let i = fromIndex; i < s.queue.length; i++){
        const id = s.queue[i];
        if(deps.canLoad && !deps.canLoad(id)) continue;
        const r = deps.runtime.loadLibraryTrackToDeck(id, deck);
        if(r && r.ok === false) continue;
        return i;
      }
      return -1;
    }
    async function start(trackIds, opts = {}){
      stop(true);
      s.queue = (trackIds || []).filter(Boolean);
      s.transition = cleanTransition(opts.transitionSec);
      if(!s.queue.length){ emit('This crate has no tracks to play.'); return { ok:false, error:'empty' }; }
      s.deck = 'a';
      const i = loadNext(0, 'a');
      if(i < 0){ emit('None of these tracks can be loaded right now.'); return { ok:false, error:'unloadable' }; }
      s.index = i; s.running = true; s.played = 1; s.fading = null;
      setX(-1);
      if(!(await ensurePlaying('a'))){ s.running = false; emit('The first track would not play.'); return { ok:false, error:'play' }; }
      s.timer = (deps.setInterval || W.setInterval)(tick, TICK_MS);
      emit(`Auto-mix is playing track 1 of ${s.queue.length}.`);
      return { ok:true };
    }
    function stop(silent){
      if(s.timer) (deps.clearInterval || W.clearInterval)(s.timer);
      const was = s.running;
      s.timer = null; s.running = false; s.fading = null;
      if(was && !silent){ pauseDeck('a'); pauseDeck('b'); emit('Auto-mix stopped. The decks are yours.'); }
    }
    async function beginFade(){
      const to = otherDeck(s.deck);
      const i = loadNext(s.index + 1, to);
      if(i < 0){ s.fading = { ended:true }; return; }
      s.fading = { to, index:i, startedAt:now(), length:s.transition };
      if(deps.runtime.syncDeck && deps.matchTempo && deps.matchTempo()) { try{ deps.runtime.syncDeck(to); }catch(_){ /* tempo match is best effort */ } }
      if(!(await ensurePlaying(to))){ s.fading = null; s.index = i; emit('A track would not play, so it was skipped.'); return; }
      emit(`Mixing into track ${i + 1} of ${s.queue.length}…`);
    }
    function tick(){
      if(!s.running) return;
      const cur = deps.getAudio(s.deck);
      if(s.fading && s.fading.to){
        const elapsed = (now() - s.fading.startedAt) / 1000;
        setX(fadePosition(elapsed, s.fading.length, s.fading.to));
        if(elapsed >= s.fading.length){
          pauseDeck(s.deck);
          s.deck = s.fading.to; s.index = s.fading.index; s.played += 1; s.fading = null;
          emit(`Auto-mix is playing track ${s.index + 1} of ${s.queue.length}.`);
        }
        return;
      }
      if(!cur) return;
      if(s.fading && s.fading.ended){
        if(cur.ended || cur.paused){ stop(true); emit('That was the last track in the crate. Auto-mix finished.'); }
        return;
      }
      const at = fadeStartAt(Number(cur.duration), s.transition);
      if(at != null && (Number(cur.currentTime) >= at || cur.ended)) beginFade();
    }
    return { start, stop:() => stop(false), tick, status, state:s };
  }

  // ---- Studio panel ----
  let engine = null;
  function hooks(){ return W.djbAutomixHooks || null; }
  function keyOrderSaved(){ try{ return W.localStorage.getItem('djbAutomixKeyOrder') === '1'; }catch(_){ return false; } }
  const MATCH_TEXT = { same:'same key', smooth:'smooth', ok:'ok', clash:'key clash', unknown:'no key' };
  // The play order for a crate, plus key info for the list.
  function crateQueue(crate, byKey){
    const h = hooks();
    const ids = h.crateTrackIds(crate);
    const items = ids.map(id => { const t = h.track(id); return { id, camelot:h.camelot ? h.camelot(t) : '', bpm:h.bpm ? h.bpm(t) : null }; });
    if(!byKey) return items.map(t => ({ ...t, match:null }));
    return harmonicOrder(items);
  }
  function selectedCrate(){ const h = hooks(); const sel = D.getElementById('automix-crate'); return sel && h ? h.crates().find(c => String(c.crateId) === String(sel.value)) : null; }
  function queueHtml(queue, index){
    const h = hooks();
    return queue.slice(0, 40).map((t, i) => `<li class="${i === index ? 'is-now' : (index != null && i < index ? 'is-done' : '')}">${t.match ? `<span class="automix-match automix-match--${t.match}">${esc(MATCH_TEXT[t.match])}</span> ` : ''}${esc(h.trackTitle(h.track(t.id)))}${t.camelot ? ` <span class="automix-key">${esc(t.camelot)}</span>` : ''}${i === index ? ' <em>playing</em>' : ''}</li>`).join('');
  }
  function previewQueue(){
    if(engine && engine.state.running) return;
    const crate = selectedCrate(); const list = D.getElementById('automix-queue');
    if(!crate || !list) return;
    state.queue = crateQueue(crate, D.getElementById('automix-keyorder').checked);
    list.innerHTML = queueHtml(state.queue, null);
  }
  const state = { queue:[] };
  function panelHtml(){
    const h = hooks();
    const crates = h ? h.crates() : [];
    const opts = crates.length ? crates.map(c => `<option value="${esc(c.crateId)}">${esc(c.name || 'Crate')} (${h.crateTrackIds(c).length})</option>`).join('') : '<option value="">No crates with tracks yet</option>';
    const saved = cleanTransition(W.localStorage && W.localStorage.getItem('djbAutomixTransition'));
    return `<span class="eyebrow">PRACTICE</span><h3>Auto-mix</h3><p class="muted">The Studio plays a crate by itself and crossfades between Deck A and Deck B. Good for hearing your crate flow or practising over it.</p>
      <div class="automix-controls"><label>Crate<select id="automix-crate"${crates.length ? '' : ' disabled'}>${opts}</select></label>
      <label>Transition<select id="automix-length">${TRANSITIONS.map(n => `<option value="${n}"${n === saved ? ' selected' : ''}>${n} seconds</option>`).join('')}</select></label>
      <label class="automix-check"><input type="checkbox" id="automix-sync" checked> Match tempo</label>
      <label class="automix-check" title="Reorders the crate so each track's key blends into the next (Camelot wheel)"><input type="checkbox" id="automix-keyorder"${keyOrderSaved() ? ' checked' : ''}> Order by key</label></div>
      <div class="automix-actions"><button class="primary compact" type="button" id="automix-start"${crates.length ? '' : ' disabled'}>Start auto-mix</button><button class="ghost compact" type="button" id="automix-stop" disabled>Stop</button></div>
      <p class="automix-status muted" id="automix-status" aria-live="polite">${crates.length ? 'Pick a crate and press Start.' : 'Make a crate in your library first, then come back here.'}</p>
      <ol class="automix-queue" id="automix-queue"></ol>`;
  }
  function renderStatus(st){
    const box = D.getElementById('automix-status'); if(box) box.textContent = st.message || '';
    const startBtn = D.getElementById('automix-start'); const stopBtn = D.getElementById('automix-stop');
    if(startBtn) startBtn.disabled = st.running || D.getElementById('automix-crate').disabled;
    if(stopBtn) stopBtn.disabled = !st.running;
    const panel = D.getElementById('automix-panel'); if(panel) panel.classList.toggle('automix-on', st.running);
    const list = D.getElementById('automix-queue'); const h = hooks();
    if(list && h && engine){
      const info = new Map(state.queue.map(t => [t.id, t]));
      list.innerHTML = queueHtml(engine.state.queue.map(id => info.get(id) || { id, match:null, camelot:'' }), st.index);
    }
  }
  function ensureEngine(){
    if(engine) return engine;
    const h = hooks();
    engine = createEngine({
      runtime: h.runtime(),
      getAudio: deck => D.getElementById(`audio-${deck}`),
      canLoad: id => h.canLoad(id),
      setXfader: v => { const xf = D.getElementById('xfader'); if(xf){ xf.value = String(Math.round(v * 100) / 100); xf.dispatchEvent(new W.Event('input', { bubbles:true })); } },
      matchTempo: () => { const box = D.getElementById('automix-sync'); return !box || box.checked; },
      onChange: renderStatus
    });
    return engine;
  }
  function mount(){
    const studio = D.getElementById('studio');
    if(!studio || !hooks()) return;
    let panel = D.getElementById('automix-panel');
    if(panel && panel.classList.contains('automix-on')) return; // keep a running mix's panel as is
    if(!panel){
      panel = D.createElement('section');
      panel.className = 'panel compact-system-panel automix-panel';
      panel.id = 'automix-panel';
      const anchor = D.getElementById('controller-panel');
      if(anchor && anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor); else studio.appendChild(panel);
    }
    panel.innerHTML = panelHtml();
    D.getElementById('automix-length').onchange = e => { try{ W.localStorage.setItem('djbAutomixTransition', e.target.value); }catch(_){ /* storage off */ } };
    D.getElementById('automix-start').onclick = () => {
      const crate = selectedCrate();
      if(!crate) return;
      state.queue = crateQueue(crate, D.getElementById('automix-keyorder').checked);
      ensureEngine().start(state.queue.map(t => t.id), { transitionSec:D.getElementById('automix-length').value });
    };
    D.getElementById('automix-keyorder').onchange = e => { try{ W.localStorage.setItem('djbAutomixKeyOrder', e.target.checked ? '1' : '0'); }catch(_){ /* storage off */ } previewQueue(); };
    D.getElementById('automix-crate').onchange = previewQueue;
    previewQueue();
    D.getElementById('automix-stop').onclick = () => { if(engine) engine.stop(); };
  }
  function onView(view){ if(view === 'studio') mount(); }

  W.DJBAutomix = { parseCamelot, keyDistance, harmonicOrder, crateQueue, TRANSITIONS, cleanTransition, fadePosition, fadeStartAt, createEngine, mount, onView, engine:() => engine };
})(window);

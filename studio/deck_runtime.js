(function(global){
  function createDeckRuntime(deps){
    const win = deps.window || global;
    const doc = deps.document || win.document;
    const state = deps.state;
    const store = deps.localStorage || win.localStorage;
    const esc = deps.esc || (value => String(value ?? ''));
    const now = deps.now || (() => Date.now());

    let audioCtx = null;
    let recordingDestination = null;
    let sources = {};
    let gains = {};
    let focusedDeck = 'a';
    const deckFiles = {};
    const meterIntervals = {};
    const localObjectUrls = {};

    function isValidDeck(deck){
      return ['a','b'].includes(String(deck));
    }

    function validDeck(deck){
      return String(deck) === 'b' ? 'b' : 'a';
    }

    function deckAudio(deck){
      return doc.getElementById(`audio-${validDeck(deck)}`);
    }

    function persistDecks(){
      if(store && store.setItem) store.setItem('djBattleDecks', JSON.stringify(state.decks));
    }

    function applyMix(){
      const xf = doc.getElementById('xfader');
      const vaEl = doc.getElementById('vol-a');
      const vbEl = doc.getElementById('vol-b');
      const x = xf ? Number(xf.value) : 0;
      const va = vaEl ? Number(vaEl.value) : 1;
      const vb = vbEl ? Number(vbEl.value) : 1;
      try{ if(gains.a && gains.a.gain) gains.a.gain.value = va * Math.cos((x + 1) * Math.PI / 4); }catch(e){}
      try{ if(gains.b && gains.b.gain) gains.b.gain.value = vb * Math.sin((x + 1) * Math.PI / 4); }catch(e){}
      return { a:gains.a && gains.a.gain ? gains.a.gain.value : null, b:gains.b && gains.b.gain ? gains.b.gain.value : null };
    }

    function ensureAudioGraph(){
      if(audioCtx && recordingDestination) return { ok:true, audioContext:audioCtx, destination:recordingDestination };
      const AudioContextCtor = win.AudioContext || win.webkitAudioContext;
      if(!AudioContextCtor) throw new Error('AudioContext is unavailable in this browser.');
      const nextCtx = new AudioContextCtor();
      if(!nextCtx.createMediaStreamDestination) throw new Error('Recording graph is unavailable in this browser.');
      const nextDestination = nextCtx.createMediaStreamDestination();
      const nextSources = {};
      const nextGains = {};
      try{
        ['a','b'].forEach(deck => {
          const audio = deckAudio(deck);
          if(!audio) return;
          const source = nextCtx.createMediaElementSource(audio);
          const gain = nextCtx.createGain();
          source.connect(gain);
          gain.connect(nextCtx.destination);
          gain.connect(nextDestination);
          nextSources[deck] = source;
          nextGains[deck] = gain;
        });
      }catch(error){
        Object.values(nextSources).forEach(source => { try{ source.disconnect(); }catch(e){} });
        Object.values(nextGains).forEach(gain => { try{ gain.disconnect(); }catch(e){} });
        if(nextCtx.close){
          const closing = nextCtx.close();
          if(closing && typeof closing.catch === 'function') closing.catch(()=>{});
        }
        throw error;
      }
      audioCtx = nextCtx;
      recordingDestination = nextDestination;
      sources = nextSources;
      gains = nextGains;
      applyMix();
      return { ok:true, audioContext:audioCtx, destination:recordingDestination };
    }

    async function teardownAudioGraph(){
      ['a','b'].forEach(stopMeterAnimation);
      Object.values(sources).forEach(source => { try{ source.disconnect(); }catch(e){} });
      Object.values(gains).forEach(gain => { try{ gain.disconnect(); }catch(e){} });
      Object.values(localObjectUrls).forEach(url => {
        try{ if(url && win.URL && win.URL.revokeObjectURL) win.URL.revokeObjectURL(url); }catch(e){}
      });
      const closing = audioCtx && audioCtx.close ? audioCtx.close() : null;
      audioCtx = null;
      recordingDestination = null;
      sources = {};
      gains = {};
      Object.keys(localObjectUrls).forEach(key => { delete localObjectUrls[key]; });
      if(closing && typeof closing.then === 'function') await closing.catch(()=>{});
      return { ok:true };
    }

    function renderWaveformForDeck(deckInput, rec){
      const deck = validDeck(deckInput);
      const w = doc.getElementById(`wave-${deck}`);
      if(!w) return;
      w.innerHTML = '';
      const overview = doc.createElement('div');
      overview.className = 'wave-overview';
      const segCount = 48;
      for(let i = 0; i < segCount; i += 1){
        const segment = doc.createElement('div');
        segment.className = 'wave-seg';
        if(i % 4 === 0) segment.classList.add('beat-division');
        segment.style.height = `${20 + Math.round(Math.sin((i / segCount) * Math.PI * 4 + (rec && rec.title ? rec.title.length : 0)) * 20)}px`;
        overview.appendChild(segment);
      }
      w.appendChild(overview);
      const pos = doc.createElement('div');
      pos.className = 'position-marker';
      w.appendChild(pos);

      const deckState = state.decks && state.decks[deck] || { cues:[], hotcues:[] };
      const audio = deckAudio(deck);
      if(audio && (!isFinite(audio.duration) || audio.duration === 0)){
        audio.onloadedmetadata = () => {
          try{ renderWaveformForDeck(deck, rec); }catch(e){}
        };
      }
      deckState.cues.forEach((cue, index) => {
        const el = doc.createElement('div');
        el.className = 'cue-marker';
        let left = 10 + index * (70 / Math.max(1, deckState.cues.length));
        try{
          if(audio && audio.duration && cue.time) left = Math.max(2, Math.min(98, (cue.time / audio.duration) * 100));
        }catch(e){}
        el.style.left = `${left}%`;
        w.appendChild(el);
      });
      deckState.hotcues.forEach(hotcue => {
        const el = doc.createElement('div');
        el.className = 'hotcue';
        el.style.left = `${Math.max(1, Math.min(99, (hotcue.pct || 0.05) * 100))}%`;
        w.appendChild(el);
      });
      const loop = doc.createElement('div');
      loop.className = 'loop-region';
      loop.style.left = '50%';
      loop.style.width = '12%';
      w.appendChild(loop);
    }

    function stopMeterAnimation(deckInput){
      const deck = validDeck(deckInput);
      if(meterIntervals[deck]){
        clearInterval(meterIntervals[deck]);
        delete meterIntervals[deck];
      }
    }

    function startMeterAnimation(deckInput){
      const deck = validDeck(deckInput);
      stopMeterAnimation(deck);
      const el = doc.getElementById(`meter-${deck}`);
      const userAgent = win && win.navigator && win.navigator.userAgent || '';
      if(/jsdom/i.test(userAgent)) return;
      if(!el){
        const parent = doc.querySelector(`.deck[data-deck="${deck}"]`);
        if(parent){
          const meter = doc.createElement('div');
          meter.className = 'level-meter';
          for(let i = 0; i < 6; i += 1){
            const segment = doc.createElement('div');
            segment.className = 'seg';
            meter.appendChild(segment);
          }
          parent.appendChild(meter);
        }
      }
      meterIntervals[deck] = setInterval(() => {
        const level = Math.random();
        const levelMeter = doc.querySelector(`.deck[data-deck="${deck}"] .level-meter`);
        if(levelMeter){
          const segments = Array.from(levelMeter.children);
          const onCount = Math.round(level * segments.length);
          segments.forEach((segment, index) => segment.classList.toggle('on', index < onCount));
          return;
        }
        const bar = doc.querySelector(`#meter-${deck} > i`);
        if(bar) bar.style.width = `${20 + Math.round(level * 80)}%`;
      }, 180);
      if(meterIntervals[deck] && typeof meterIntervals[deck].unref === 'function') meterIntervals[deck].unref();
    }

    function renderDeckCues(deckInput){
      const deck = validDeck(deckInput);
      const wrap = doc.getElementById(`cues-${deck}`);
      if(!wrap) return;
      wrap.innerHTML = '';
      const data = state.decks && state.decks[deck] || { cues:[], hotcues:[] };
      data.cues.forEach((cue, index) => {
        const button = doc.createElement('button');
        button.textContent = `Cue ${index + 1}`;
        button.onclick = () => {
          const audio = deckAudio(deck);
          if(audio && !isNaN(cue.time)){
            audio.currentTime = cue.time;
            audio.play();
          }
        };
        wrap.appendChild(button);
      });
      const add = doc.createElement('button');
      add.textContent = 'Add Cue';
      add.onclick = () => setCue(deck);
      wrap.appendChild(add);
      const addHot = doc.createElement('button');
      addHot.textContent = 'Add Hotcue';
      addHot.onclick = () => addHotcue(deck);
      wrap.appendChild(addHot);
    }

    function setCue(deckInput){
      const deck = validDeck(deckInput);
      const audio = deckAudio(deck);
      let time = 0;
      if(audio){
        try{ time = Math.round((audio.currentTime || 0) * 1000) / 1000; }catch(e){ time = 0; }
      }
      state.decks[deck] = state.decks[deck] || { cues:[], hotcues:[] };
      state.decks[deck].cues.push({ time, created:now() });
      persistDecks();
      renderDeckCues(deck);
      renderWaveformForDeck(deck, {});
      return { ok:true, deck, time };
    }

    function addHotcue(deckInput){
      const deck = validDeck(deckInput);
      const audio = deckAudio(deck);
      let pct = 0.05;
      if(audio && audio.duration > 0) pct = Math.max(0, Math.min(1, (audio.currentTime || 0) / audio.duration));
      state.decks[deck] = state.decks[deck] || { cues:[], hotcues:[] };
      state.decks[deck].hotcues.push({ pct, created:now() });
      persistDecks();
      renderDeckCues(deck);
      renderWaveformForDeck(deck, {});
      return { ok:true, deck, pct };
    }

    function setFocusedDeck(deckInput){
      focusedDeck = validDeck(deckInput);
      doc.querySelectorAll('.deck').forEach(el => el.classList.toggle('focused', el.dataset.deck === focusedDeck));
      return focusedDeck;
    }

    function loadTrackToDeck(rec, deckInput){
      if(deckInput != null && !isValidDeck(deckInput)) return { ok:false, error:'Choose Deck A or Deck B.' };
      const deck = validDeck(deckInput);
      if(!rec) return { ok:false, error:'Track is unavailable.' };
      try{
        const artEl = doc.getElementById(`art-${deck}`);
        const nameEl = doc.getElementById(`name-${deck}`);
        const artistEl = doc.getElementById(`artist-${deck}`);
        const bpmEl = doc.getElementById(`bpm-${deck}`);
        const keyEl = doc.getElementById(`key-${deck}`);
        const timeEl = doc.getElementById(`time-${deck}`);
        if(nameEl) nameEl.textContent = rec.title;
        if(artistEl) artistEl.textContent = rec.artist || 'Unknown';
        if(bpmEl) bpmEl.textContent = rec.bpm || '--';
        if(keyEl) keyEl.innerHTML = deps.keyBadgeHtml ? deps.keyBadgeHtml(rec.key || rec.camelotKey || '--') : esc(rec.key || rec.camelotKey || '--');
        if(timeEl) timeEl.textContent = rec.dur || '0:00';
        if(artEl) artEl.innerHTML = rec.artwork ? `<img src="${esc(rec.artwork)}" alt="${esc(rec.title)} artwork" style="width:100%;height:100%;object-fit:cover">` : esc(rec.source || '');

        const audio = deckAudio(deck);
        if(audio && rec.libraryId && deps.getLibraryTrackById && deps.securePlaybackSource){
          const track = deps.getLibraryTrackById(rec.libraryId);
          const src = deps.securePlaybackSource(track);
          if(src) audio.setAttribute('src', src);
        }

        const deckEl = doc.querySelector(`.deck[data-deck="${deck}"]`);
        if(deckEl) deckEl.dataset.loaded = '1';
        if(deckEl && rec.libraryId) deckEl.dataset.libraryTrackId = rec.libraryId;
        renderWaveformForDeck(deck, rec);
        startMeterAnimation(deck);
        renderDeckCues(deck);
        return { ok:true, deck, track:rec };
      }catch(error){
        if(win.console && win.console.warn) win.console.warn('loadTrackToDeck error', error);
        return { ok:false, error:String(error && error.message || error) };
      }
    }

    function loadLibraryTrackToDeck(trackId, deckInput){
      const requestedDeck = deckInput == null ? 'a' : String(deckInput);
      const deck = validDeck(requestedDeck);
      const track = deps.getLibraryTrackById(trackId);
      const eligibility = deps.libraryTrackLoadEligibility(track, requestedDeck);
      if(!eligibility.allowed){
        deps.setStudioRuleStatus(eligibility.reason, 'denied');
        return { ok:false, error:eligibility.reason };
      }
      const record = deps.normalizedDeckRecord(track);
      loadTrackToDeck(record, deck);
      if(deps.ensureLibraryPlaybackAccess) deps.ensureLibraryPlaybackAccess(track);
      state.studioDecks[deck] = {
        trackId:track.libraryId,
        title:record.title,
        artist:record.artist,
        bpm:record.bpm,
        key:record.key,
        camelotKey:record.camelotKey,
        genre:record.genre,
        artwork:record.artwork,
        sourceType:record.sourceType,
        linkedSubmissionId:record.linkedSubmissionId,
        loadedAt:new Date(now()).toISOString()
      };
      const session = deps.activeStudioBattleSession();
      const snapshot = deps.battlePrepSnapshotForUser(session);
      if(snapshot && Array.isArray(snapshot.tracks)){
        const match = snapshot.tracks.find(item => item.libraryId === track.libraryId);
        if(match){
          match.loadedDeck = deck;
          match.loadedAt = state.studioDecks[deck].loadedAt;
          session.battlePrepSnapshot = snapshot;
          win.activeBattleSession = session;
          deps.persistActiveBattleSession(session);
        }
      }
      deps.recordLibraryTrackUsageLocal(track, { type:'battle', id:session && session.battleId || 'studio' });
      deps.persistStudioDeckState();
      deps.setStudioRuleStatus(`${record.title} loaded to Deck ${deck.toUpperCase()}.`, 'ok');
      renderDrawer();
      return { ok:true, deck, track:record };
    }

    function selectLibraryRecordingForSubmission(trackId){
      const track = deps.getLibraryTrackById(trackId);
      const eligibility = deps.libraryTrackLoadEligibility(track, 'a');
      if(!eligibility.allowed) return { ok:false, error:eligibility.reason };
      if(!track.linkedSubmissionId && !['submission', 'practice_recording'].includes(track.sourceType)) return { ok:false, error:'This track does not have a reusable recording yet.' };
      const session = deps.activeStudioBattleSession();
      if(!session) return { ok:false, error:'Start a battle before selecting a submission recording.' };
      session.librarySubmissionTrackId = track.libraryId;
      session.submissionId = track.linkedSubmissionId || session.submissionId || null;
      win.activeBattleSession = session;
      deps.persistActiveBattleSession(session);
      deps.recordLibraryTrackUsageLocal(track, { type:'submission', id:session.battleId || session.id });
      deps.setStudioRuleStatus(`${deps.trackTitle(track)} selected for battle submission without re-upload.`, 'ok');
      return { ok:true, session };
    }

    function openDrawer(deckInput){
      state.studioLibraryDrawer = { ...state.studioLibraryDrawer, open:true, deck:validDeck(deckInput) };
      renderDrawer();
      return true;
    }

    function closeDrawer(){
      state.studioLibraryDrawer.open = false;
      renderDrawer();
    }

    function renderDrawer(){
      const drawer = doc.getElementById('studio-library-drawer');
      if(!drawer) return;
      if(!state.studioLibraryDrawer.open){
        drawer.classList.add('hidden');
        drawer.innerHTML = '';
        return;
      }
      drawer.classList.remove('hidden');
      const deck = validDeck(state.studioLibraryDrawer.deck || 'a');
      const validatedPrepOrder = Array.isArray(state.studioLibraryDrawer.validatedOrder) ? state.studioLibraryDrawer.validatedOrder : [];
      const activePrepCrate = state.studioLibraryDrawer.battlePrepCrateId ? deps.getLibraryCrateById(state.studioLibraryDrawer.battlePrepCrateId) : null;
      const activePrepName = activePrepCrate && activePrepCrate.name || state.studioLibraryDrawer.battlePrepCrateName || '';
      const activePrepPurpose = state.studioLibraryDrawer.battlePrepPurpose === 'reference' ? 'ASSIGNED REFERENCE' : state.studioLibraryDrawer.battlePrepPurpose ? 'OWN-SELECTION SNAPSHOT' : '';
      const rows = validatedPrepOrder.length
        ? validatedPrepOrder.map(id => deps.getLibraryTrackById(id)).filter(Boolean)
        : deps.sortLibraryTracks(deps.allLibraryTracks()).slice(0, 30);
      const session = deps.activeStudioBattleSession();
      const prepCrates = deps.allLibraryCrates().filter(crate => crate.type === 'battle_prep' && deps.resolveCrateTrackIds(crate).length);
      drawer.innerHTML = `
    <div class="studio-library-drawer-head"><div><span class="eyebrow">COMPACT LIBRARY</span><h3>Load Deck ${esc(deck.toUpperCase())}</h3></div><div class="studio-library-actions"><button class="ghost small" data-drawer-deck="a">Deck A</button><button class="ghost small" data-drawer-deck="b">Deck B</button><button class="ghost small" id="close-studio-library-drawer">Close</button></div></div>
    <div class="library-status-strip"><span>${session ? esc(session.title || session.mode || 'Active battle') : 'Free studio mode'}</span>${activePrepName ? `<span>${activePrepPurpose ? `${esc(activePrepPurpose)} / ` : ''}Validated order: ${esc(activePrepName)}</span>` : ''}</div>
    ${prepCrates.length ? `<div class="battle-prep-strip">${prepCrates.map(crate => `<button class="ghost small" data-prep-next="${esc(crate.crateId)}">${esc(crate.name)} / next ${esc(deck.toUpperCase())}</button>`).join('')}</div>` : ''}
    <div class="studio-library-drawer-list">${rows.map(track => {
        const eligibility = deps.libraryTrackLoadEligibility(track, deck, session);
        const otherDeck = deck === 'a' ? 'b' : 'a';
        const compatibility = state.studioDecks[otherDeck] && deps.compatibleTracksFor(track).some(match => match.libraryId === state.studioDecks[otherDeck].trackId);
        return `<div class="studio-library-drawer-row ${eligibility.allowed ? '' : 'denied'}">
        ${deps.artworkMarkup(track)}
        <div><strong>${esc(deps.trackTitle(track))}</strong><small class="library-track-meta">${esc(deps.trackArtist(track))} / ${esc(track.genre || 'Unsorted')} / ${esc(deps.parseBpm(track) || '--')} BPM / ${deps.keyBadgeHtml(track.key)} ${compatibility ? '/ compatible' : ''}</small><div class="studio-library-wave"></div><small class="library-track-meta">${esc(eligibility.reason)}</small></div>
        <div class="studio-library-actions"><button class="primary small" data-drawer-load="${esc(track.libraryId)}" ${eligibility.allowed ? '' : 'disabled'}>Load</button><button class="ghost small" data-drawer-submit="${esc(track.libraryId)}" ${eligibility.allowed ? '' : 'disabled'}>Submit</button></div>
      </div>`;
      }).join('')}</div>
  `;
      doc.querySelectorAll('[data-drawer-deck]').forEach(button => {
        button.onclick = () => {
          state.studioLibraryDrawer.deck = validDeck(button.dataset.drawerDeck);
          renderDrawer();
        };
      });
      const close = doc.getElementById('close-studio-library-drawer');
      if(close) close.onclick = closeDrawer;
      doc.querySelectorAll('[data-prep-next]').forEach(button => button.onclick = () => deps.loadNextFromBattlePrepCrate(button.dataset.prepNext, state.studioLibraryDrawer.deck));
      doc.querySelectorAll('[data-drawer-load]').forEach(button => button.onclick = () => loadLibraryTrackToDeck(button.dataset.drawerLoad, state.studioLibraryDrawer.deck));
      doc.querySelectorAll('[data-drawer-submit]').forEach(button => button.onclick = () => selectLibraryRecordingForSubmission(button.dataset.drawerSubmit));
    }

    function loadLocalFileToDeck(deckInput, file){
      const deck = validDeck(deckInput);
      if(!file) return { ok:false, error:'No file selected.' };
      deckFiles[deck] = file;
      const audio = deckAudio(deck);
      if(audio && win.URL && win.URL.createObjectURL){
        if(localObjectUrls[deck] && win.URL.revokeObjectURL){
          try{ win.URL.revokeObjectURL(localObjectUrls[deck]); }catch(e){}
        }
        localObjectUrls[deck] = win.URL.createObjectURL(file);
        audio.src = localObjectUrls[deck];
      }
      const nameEl = doc.getElementById(`name-${deck}`);
      if(nameEl) nameEl.textContent = file.name;
      const meta = doc.getElementById(`meta-${deck}`);
      if(meta) meta.textContent = `${(Number(file.size || 0) / 1024 / 1024).toFixed(1)} MB`;
      const wave = doc.getElementById(`wave-${deck}`);
      if(wave) wave.style.background = `repeating-linear-gradient(90deg,#334050 0 ${2 + Math.random() * 3}px,transparent ${3 + Math.random() * 3}px 7px),linear-gradient(180deg,#121820,#171e28)`;
      return { ok:true, deck, file };
    }

    async function playDeck(deckInput){
      const deck = validDeck(deckInput);
      try{
        ensureAudioGraph();
        if(audioCtx && audioCtx.resume) await audioCtx.resume();
        const audio = deckAudio(deck);
        if(!audio) return { ok:false, error:'Deck audio element is unavailable.' };
        if(audio.paused) await audio.play();
        else audio.pause();
        return { ok:true, deck, playing:!audio.paused };
      }catch(error){
        deps.setStudioRuleStatus(String(error && error.message || error), 'denied');
        return { ok:false, error:String(error && error.message || error) };
      }
    }

    function resetDeckCue(deckInput){
      const deck = validDeck(deckInput);
      const audio = deckAudio(deck);
      if(audio){
        audio.pause();
        audio.currentTime = 0;
      }
    }

    function updateDeckTime(deckInput){
      const deck = validDeck(deckInput);
      const audio = deckAudio(deck);
      const seconds = Math.floor(audio && audio.currentTime || 0);
      const target = doc.getElementById(`time-${deck}`);
      if(target) target.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }

    function wireControls(){
      ['a','b'].forEach(deck => {
        const loadBtn = doc.querySelector(`[data-load="${deck}"]`);
        if(loadBtn) loadBtn.onclick = () => doc.getElementById(`file-${deck}`).click();
        const fileInput = doc.getElementById(`file-${deck}`);
        if(fileInput) fileInput.onchange = event => loadLocalFileToDeck(deck, event.target.files && event.target.files[0]);
        const playBtn = doc.querySelector(`[data-play="${deck}"]`);
        if(playBtn) playBtn.onclick = () => playDeck(deck);
        const cueBtn = doc.querySelector(`[data-cue="${deck}"]`);
        if(cueBtn) cueBtn.onclick = () => resetDeckCue(deck);
        const setCueBtn = doc.querySelector(`[data-set-cue="${deck}"]`);
        if(setCueBtn) setCueBtn.onclick = () => setCue(deck);
        const hotcueBtn = doc.querySelector(`[data-hotcue="${deck}"]`);
        if(hotcueBtn) hotcueBtn.onclick = () => addHotcue(deck);
        const pitch = doc.getElementById(`pitch-${deck}`);
        if(pitch) pitch.oninput = event => {
          const audio = deckAudio(deck);
          if(audio) audio.playbackRate = Number(event.target.value);
          const out = doc.getElementById(`pitch-out-${deck}`);
          if(out) out.textContent = `${((Number(event.target.value) - 1) * 100).toFixed(1)}%`;
        };
        const vol = doc.getElementById(`vol-${deck}`);
        if(vol) vol.oninput = applyMix;
        const audio = deckAudio(deck);
        if(audio) audio.ontimeupdate = () => updateDeckTime(deck);
      });
      const xfader = doc.getElementById('xfader');
      if(xfader) xfader.oninput = applyMix;
      setTimeout(() => {
        setFocusedDeck('a');
        doc.querySelectorAll('.deck').forEach(el => {
          el.onclick = () => setFocusedDeck(el.dataset.deck);
        });
      }, 200);
      setTimeout(() => {
        renderDeckCues('a');
        renderDeckCues('b');
      }, 400);
    }

    function diagnostics(){
      return {
        audioContextActive:Boolean(audioCtx),
        recordingDestinationActive:Boolean(recordingDestination),
        sourceCount:Object.keys(sources).length,
        gainCount:Object.keys(gains).length,
        focusedDeck,
        deckFiles:Object.keys(deckFiles),
        meterCount:Object.keys(meterIntervals).length
      };
    }

    return {
      applyMix,
      ensureAudioGraph,
      teardownAudioGraph,
      getAudioContext:() => audioCtx,
      getRecordingDestination:() => recordingDestination,
      loadTrackToDeck,
      loadLibraryTrackToDeck,
      selectLibraryRecordingForSubmission,
      openDrawer,
      closeDrawer,
      renderDrawer,
      renderWaveformForDeck,
      startMeterAnimation,
      stopMeterAnimation,
      setFocusedDeck,
      getFocusedDeck:() => focusedDeck,
      renderDeckCues,
      setCue,
      addHotcue,
      persistDecks,
      loadLocalFileToDeck,
      playDeck,
      wireControls,
      diagnostics
    };
  }

  global.DJBattleDeckRuntime = { create:createDeckRuntime };
})(typeof window !== 'undefined' ? window : globalThis);

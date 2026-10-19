(function(global){
  function createStudioRecording(deps){
    const win = deps.window || global;
    const doc = deps.document || win.document;
    const state = deps.state;
    const store = deps.localStorage || win.localStorage;
    const esc = deps.esc || (value => String(value ?? ''));
    const now = deps.now || (() => Date.now());
    let objectUrl = '';
    let recordingTimer = null;
    let meterTimer = null;
    let recorder = null;
    let chunks = [];
    let countInTimer = null;
    let reviewPeaks = null;
    const setT = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const clearT = deps.clearTimeout || (h => clearTimeout(h));
    const pro = () => deps.studioPro || win.DJBattleStudioPro || global.DJBattleStudioPro || null;
    function clock(ms){ return pro() ? pro().clockText(ms) : elapsedText(ms); }

    function isActive(){
      return state.studioRecording && state.studioRecording.state === 'recording';
    }

    function elapsedText(ms){
      const seconds = Math.floor(Number(ms || 0) / 1000);
      return `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
    }

    function persist(){
      const safe = { ...state.studioRecording, objectUrl:'', blob:null };
      if(store && store.setItem) store.setItem('djBattleStudioRecording', JSON.stringify(safe));
    }

    function updateUi(){
      const recordState = state.studioRecording || {};
      const armed = recordState.state === 'armed';
      const recording = recordState.state === 'recording';
      const review = recordState.state === 'review' || recordState.state === 'draft';
      const arm = doc.getElementById('arm-record');
      const rec = doc.getElementById('record-mix');
      const stop = doc.getElementById('stop-record');
      const status = doc.getElementById('record-status');
      const timer = doc.getElementById('record-timer');
      const reviewPanel = doc.getElementById('recording-review');
      const audio = doc.getElementById('recording-review-audio');
      const metadata = doc.getElementById('recording-metadata');
      const duration = doc.getElementById('recording-duration');
      if(arm) arm.classList.toggle('active', armed || recording);
      if(arm) arm.disabled = recording;
      if(rec) rec.disabled = !armed || recording;
      if(stop) stop.disabled = !recording;
      const dl = doc.getElementById('download-recording');
      if(dl) dl.disabled = !win.lastRecordedMixFile;
      if(status) status.textContent = recordState.error || (recordState.state === 'countin' ? 'Get ready…' : recording ? (recordState.limitMs ? 'REC battle take' : 'REC active') : armed ? 'Armed' : review ? (recordState.autoStopped ? 'Battle time reached. Take stopped.' : 'Review take ready') : 'Recording idle');
      if(timer) timer.textContent = elapsedText(recording && recordState.startedAt ? now() - recordState.startedAt : recordState.elapsedMs);
      const left = doc.getElementById('record-time-left');
      if(left){
        const limit = recordState.limitMs;
        const show = recording && limit > 0;
        left.classList.toggle('hidden', !show);
        const remaining = show ? limit - (now() - recordState.startedAt) : 0;
        left.textContent = show ? `Time left ${clock(remaining)} of ${clock(limit)}` : '';
        left.classList.toggle('low', show && remaining <= 30000);
      }
      const countIn = doc.getElementById('record-countin');
      if(countIn){
        const counting = recordState.state === 'countin';
        countIn.classList.toggle('hidden', !counting);
        countIn.textContent = counting ? String(recordState.countIn || '') : '';
      }
      if(rec && recordState.state === 'countin') rec.disabled = true;
      if(reviewPanel) reviewPanel.classList.toggle('hidden', !review);
      if(audio && objectUrl && audio.src !== objectUrl) audio.src = objectUrl;
      if(metadata) metadata.innerHTML = review ? `<span>File</span><strong>${esc(recordState.fileName || 'Recorded take')}</strong><span>State</span><strong>${esc(recordState.state)}</strong><span>Submit</span><strong>${recordState.submitted ? 'Submitted' : 'Not submitted'}</strong>${recordState.draftSaved ? '<span>Draft</span><strong>Saved to Library → Drafts</strong>' : ''}` : '';
      const saveBtn = doc.getElementById('save-recording-draft');
      if(saveBtn){ saveBtn.textContent = recordState.draftSaved ? 'Draft Saved' : 'Save Draft'; saveBtn.disabled = Boolean(recordState.draftSaved); }
      if(duration) duration.textContent = recordState.duration || elapsedText(recordState.elapsedMs);
      const audioRecording = doc.getElementById('audio-recording-state');
      if(audioRecording) audioRecording.textContent = recording ? 'Recording' : armed ? 'Armed' : review ? 'Review' : 'Not Armed';
    }

    function animateMeters(active){
      clearInterval(meterTimer);
      const left = doc.getElementById('record-meter-l');
      const right = doc.getElementById('record-meter-r');
      if(!active){
        if(left) left.style.width = '8%';
        if(right) right.style.width = '8%';
        return;
      }
      // Real master levels (AnalyserNode RMS) from the deck runtime; 0 when nothing is playing.
      meterTimer = setInterval(()=>{
        const levels = deps.getMasterLevels ? deps.getMasterLevels() : null;
        const toPct = lv => {
          if(!lv || !(lv.rms > 0)) return 0;
          const db = 20 * Math.log10(lv.rms * 1.41);
          return Math.round(Math.max(0, Math.min(1, (db + 48) / 48)) * 100);
        };
        [[left, levels && levels.left], [right, levels && levels.right]].forEach(([el, lv]) => {
          if(!el) return;
          el.style.width = `${toPct(lv)}%`;
          el.classList.toggle('clip', Boolean(lv && lv.clip));
        });
      }, 100);
      if(meterTimer && typeof meterTimer.unref === 'function') meterTimer.unref();
    }

    function arm(){
      state.studioRecording = { ...state.studioRecording, state:'armed', armed:true, error:'', submitted:false, draftSaved:false };
      persist();
      updateUi();
      return { ok:true };
    }

    function tracklistLines(list){
      const fmt = deps.formatTracklistTime || (ms => { const t = Math.floor(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2,'0')}`; });
      return (list || []).map(t => ({ time:fmt(t.ms), title:t.title, artist:t.artist || '', text:`${fmt(t.ms)} ${t.title}${t.artist ? ` - ${t.artist}` : ''}` }));
    }

    function renderTracklist(){
      const target = doc.getElementById('recording-tracklist');
      if(!target) return;
      const lines = tracklistLines(state.studioRecording && state.studioRecording.tracklist);
      if(!lines.length){
        target.innerHTML = `<div class="tracklist-head"><span class="eyebrow">TRACKLIST</span></div><small class="tracklist-empty">No tracks were played on the decks during this take.</small>`;
        return;
      }
      target.innerHTML = `<div class="tracklist-head"><span class="eyebrow">TRACKLIST</span><button class="ghost small" id="copy-tracklist" type="button">Copy</button></div><ol class="tracklist-lines">${lines.map(l => `<li><time>${esc(l.time)}</time><span>${esc(l.title)}${l.artist ? ` <small>${esc(l.artist)}</small>` : ''}</span></li>`).join('')}</ol>`;
      const copy = doc.getElementById('copy-tracklist');
      if(copy) copy.onclick = () => copyTracklist().then(r => { copy.textContent = r.ok ? 'Copied' : 'Copy failed'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); });
    }

    async function copyTracklist(){
      const text = tracklistLines(state.studioRecording && state.studioRecording.tracklist).map(l => l.text).join('\n');
      if(!text) return { ok:false, text };
      try{
        const nav = win.navigator;
        if(nav && nav.clipboard && nav.clipboard.writeText){ await nav.clipboard.writeText(text); return { ok:true, text }; }
      }catch(e){}
      try{
        const ta = doc.createElement('textarea');
        ta.value = text; doc.body.appendChild(ta); ta.select();
        const ok = doc.execCommand ? doc.execCommand('copy') : false;
        ta.remove();
        return { ok:Boolean(ok), text };
      }catch(e){ return { ok:false, text }; }
    }

    function finishRecording(){
      clearInterval(recordingTimer);
      const startedAtMs = state.studioRecording.startedAt;
      const tracklist = deps.getTracklist && startedAtMs ? deps.getTracklist(startedAtMs, now()) : [];
      animateMeters(false);
      const elapsedMs = state.studioRecording.elapsedMs || (state.studioRecording.startedAt ? now() - state.studioRecording.startedAt : 0);
      const name = `dj-battle-take-${now()}.webm`;
      const BlobCtor = win.Blob || global.Blob;
      const FileCtor = win.File || global.File;
      const blob = BlobCtor ? new BlobCtor(chunks, { type:'audio/webm' }) : null;
      win.lastRecordedMixFile = FileCtor && blob ? new FileCtor([blob], name, { type:'audio/webm' }) : blob;
      if(objectUrl && win.URL && win.URL.revokeObjectURL) win.URL.revokeObjectURL(objectUrl);
      objectUrl = blob && win.URL && win.URL.createObjectURL ? win.URL.createObjectURL(blob) : '';
      state.studioRecording = { ...state.studioRecording, state:'review', armed:false, startedAt:null, elapsedMs, fileName:name, duration:elapsedText(elapsedMs), error:'', submitted:false, tracklist };
      persist();
      reviewPeaks = null;
      renderWaveform();
      renderTracklist();
      updateUi();
      if(blob) decodeReviewPeaks(blob);
    }

    async function decodeReviewPeaks(blob){
      const Offline = win.OfflineAudioContext || win.webkitOfflineAudioContext;
      const compute = deps.computePeaks;
      if(!Offline || !compute || !blob || typeof blob.arrayBuffer !== 'function') return null;
      try{
        const data = await blob.arrayBuffer();
        const buffer = await new Offline(1, 1, 44100).decodeAudioData(data);
        const channels = [];
        for(let c = 0; c < buffer.numberOfChannels; c += 1) channels.push(buffer.getChannelData(c));
        setReviewPeaks(compute(channels, 160), buffer.duration * 1000);
        return reviewPeaks;
      }catch(e){
        const target = doc.getElementById('recording-waveform');
        if(target) target.innerHTML = '<span class="wave-pending">Waveform unavailable for this take</span>';
        return null;
      }
    }

    function setReviewPeaks(peaks, durationMs){
      reviewPeaks = { peaks:peaks || [], durationMs:Number(durationMs) || state.studioRecording.elapsedMs || 0 };
      renderWaveform();
      return reviewPeaks;
    }

    function seekReview(frac){
      const audio = doc.getElementById('recording-review-audio');
      const f = Math.max(0, Math.min(1, Number(frac) || 0));
      const dur = audio && isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (reviewPeaks ? reviewPeaks.durationMs / 1000 : 0);
      if(!audio || !(dur > 0)) return { ok:false };
      try{ audio.currentTime = f * dur; }catch(e){}
      try{ const p = audio.play && audio.play(); if(p && p.catch) p.catch(()=>{}); }catch(e){}
      return { ok:true, time:f * dur };
    }

    async function start(){
      const limitMs = deps.getBattleLimitMs ? deps.getBattleLimitMs() : null;
      if(!(limitMs > 0)) return beginRecording(null);
      if(state.studioRecording && state.studioRecording.state === 'countin') return { ok:false, error:'Count-in already running.' };
      state.studioRecording = { ...state.studioRecording, state:'countin', countIn:3, limitMs, error:'', autoStopped:false };
      updateUi();
      return new Promise(resolve => {
        const step = () => {
          if(!state.studioRecording || state.studioRecording.state !== 'countin') return resolve({ ok:false, cancelled:true });
          const n = state.studioRecording.countIn - 1;
          if(n <= 0){ countInTimer = null; beginRecording(limitMs).then(resolve); return; }
          state.studioRecording.countIn = n;
          updateUi();
          countInTimer = setT(step, 1000);
        };
        countInTimer = setT(step, 1000);
      });
    }

    function cancelCountIn(){
      if(countInTimer) clearT(countInTimer);
      countInTimer = null;
      if(state.studioRecording && state.studioRecording.state === 'countin'){ state.studioRecording = { ...state.studioRecording, state:'armed', countIn:0 }; updateUi(); return { ok:true }; }
      return { ok:false };
    }

    async function beginRecording(limitMs){
      const MediaRecorderCtor = deps.getMediaRecorder ? deps.getMediaRecorder() : (win.MediaRecorder || global.MediaRecorder);
      if(typeof MediaRecorderCtor === 'undefined'){
        state.studioRecording = { ...state.studioRecording, state:'idle', armed:false, error:'Recording is unavailable in this browser.' };
        persist();
        updateUi();
        return { ok:false, error:state.studioRecording.error };
      }
      try{
        deps.ensureAudioGraph();
        const audioCtx = deps.getAudioContext();
        const dest = deps.getRecordingDestination();
        if(!audioCtx || !dest || !dest.stream) throw new Error('Recording graph is unavailable.');
        if(audioCtx.resume) await audioCtx.resume();
        chunks = [];
        recorder = new MediaRecorderCtor(dest.stream);
        recorder.ondataavailable = event => { if(event.data && event.data.size) chunks.push(event.data); };
        recorder.onerror = event => {
          state.studioRecording = { ...state.studioRecording, state:'armed', error:event.error && event.error.message || 'Recording error.' };
          persist();
          updateUi();
        };
        recorder.onstop = finishRecording;
        recorder.start();
        state.studioRecording = { ...state.studioRecording, state:'recording', armed:true, startedAt:now(), elapsedMs:0, fileName:'', error:'', limitMs:limitMs || null, countIn:0, autoStopped:false };
        persist();
        recordingTimer = setInterval(()=>{
          if(!isActive()) return;
          state.studioRecording.elapsedMs = now() - state.studioRecording.startedAt;
          checkLimit();
          updateUi();
        }, 250);
        if(recordingTimer && typeof recordingTimer.unref === 'function') recordingTimer.unref();
        animateMeters(true);
        updateUi();
        return { ok:true };
      }catch(error){
        state.studioRecording = { ...state.studioRecording, state:'armed', error:String(error && error.message || error) };
        persist();
        updateUi();
        return { ok:false, error:state.studioRecording.error };
      }
    }

    // Battle takes stop on their own at the battle length; practice takes (no limit) are unchanged.
    function checkLimit(){
      const r = state.studioRecording;
      if(!r || r.state !== 'recording' || !(r.limitMs > 0)) return false;
      if(now() - r.startedAt < r.limitMs) return false;
      r.autoStopped = true;
      r.elapsedMs = r.limitMs;
      stop();
      return true;
    }

    function stop(){
      if(state.studioRecording && state.studioRecording.state === 'countin') return cancelCountIn();
      if(recorder && recorder.state !== 'inactive'){
        recorder.stop();
        return { ok:true };
      }
      return { ok:false, error:'No active recording.' };
    }

    // Review waveform drawn from the recorded take's real peaks, with tracklist change markers and click-to-seek.
    function renderWaveform(){
      const target = doc.getElementById('recording-waveform');
      if(!target) return;
      if(!reviewPeaks || !reviewPeaks.peaks.length){
        target.classList.remove('real');
        target.innerHTML = '<span class="wave-pending">Reading waveform…</span>';
        target.onclick = null;
        return;
      }
      target.classList.add('real');
      const durationMs = reviewPeaks.durationMs || state.studioRecording.elapsedMs || 0;
      const markers = pro() ? pro().trackMarkers(state.studioRecording && state.studioRecording.tracklist, durationMs) : [];
      target.innerHTML = reviewPeaks.peaks.map(v => `<i style="height:${Math.max(2, Math.round(v * 100))}%"></i>`).join('') +
        markers.map(m => `<b class="review-marker" style="left:${(m.frac * 100).toFixed(2)}%" title="${esc(m.title)}"><span>${esc(m.title)}</span></b>`).join('') +
        '<u class="review-playhead" style="left:0%"></u>';
      target.onclick = event => {
        const rect = target.getBoundingClientRect();
        if(rect.width > 0) seekReview((event.clientX - rect.left) / rect.width);
      };
      const audio = doc.getElementById('recording-review-audio');
      if(audio) audio.ontimeupdate = () => {
        const head = target.querySelector('.review-playhead');
        const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : durationMs / 1000;
        if(head && dur > 0) head.style.left = `${Math.min(100, audio.currentTime / dur * 100)}%`;
      };
    }

    async function confirmDiscard(){
      if(typeof deps.confirm === 'function') return Boolean(await deps.confirm('Restart this take?', 'Restarting throws away the take you just recorded. Saved drafts stay in your Library.', 'Discard and restart'));
      if(typeof win.confirm === 'function') return win.confirm('Restarting will discard the current unsent take. Continue?');
      return true;
    }

    async function restart(){
      const hasUnsavedTake = Boolean(win.lastRecordedMixFile) && !state.studioRecording.draftSaved && !state.studioRecording.submitted;
      if(hasUnsavedTake && !(await confirmDiscard())) return { ok:false, cancelled:true };
      if(objectUrl && win.URL && win.URL.revokeObjectURL) win.URL.revokeObjectURL(objectUrl);
      objectUrl = '';
      reviewPeaks = null;
      win.lastRecordedMixFile = null;
      state.studioRecording = { state:'armed', armed:true, startedAt:null, elapsedMs:0, fileName:'', duration:'', error:'', submitted:false, draftSaved:false, tracklist:[] };
      persist();
      updateUi();
      // Battles with a time limit go straight back into the 3-2-1 count-in; open practice just re-arms.
      const limitMs = deps.getBattleLimitMs ? deps.getBattleLimitMs() : null;
      if(limitMs > 0 && deps.autoCountInOnRestart !== false){
        start();
        return { ok:true, countIn:true };
      }
      return { ok:true, countIn:false };
    }

    async function saveDraft(){
      if(!win.lastRecordedMixFile){
        state.studioRecording.error = 'No recorded take is available to save.';
        updateUi();
        return { ok:false };
      }
      if(state.studioRecording.draftSaved) return { ok:true, duplicate:true };
      if(typeof deps.saveDraftToLibrary === 'function'){
        const session = deps.activeStudioBattleSession ? deps.activeStudioBattleSession() : null;
        const saved = await deps.saveDraftToLibrary(win.lastRecordedMixFile, {
          duration: state.studioRecording.duration,
          tracklist: state.studioRecording.tracklist || [],
          battleId: session && (session.battleId || session.id) || null,
          genre: session && session.genre || ''
        });
        if(!saved || !saved.ok){
          state.studioRecording.error = saved && saved.error || 'Could not save this draft.';
          updateUi();
          return { ok:false, error:state.studioRecording.error };
        }
        state.studioRecording = { ...state.studioRecording, state:'draft', draftSaved:true, draftTrackId:saved.track && saved.track.id || null, error:'' };
      }else{
        state.studioRecording = { ...state.studioRecording, state:'draft', draftSaved:true, error:'' };
      }
      persist();
      updateUi();
      return { ok:true, trackId:state.studioRecording.draftTrackId || null };
    }

    // Safe filename from the battle title and the take date, e.g. "friday-night-house-battle-2026-10-18.webm".
    function downloadFileName(title, date){
      // Duck-typed so a Date from another realm (e.g. a test harness) is still honoured.
      const d = date && typeof date.getFullYear === 'function' && !isNaN(date.getTime()) ? date : new Date(now());
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const slug = String(title || '')
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .replace(/-+$/g, '');
      return `${slug || 'dj-battle-mix'}-${stamp}.webm`;
    }

    function download(){
      const file = win.lastRecordedMixFile;
      if(!file){
        state.studioRecording.error = 'Record a take before downloading.';
        updateUi();
        return { ok:false, error:'no_take' };
      }
      const session = deps.activeStudioBattleSession ? deps.activeStudioBattleSession() : null;
      const title = session && (session.title || session.name) || 'Practice mix';
      const name = downloadFileName(title, new Date(now()));
      const URLs = win.URL || global.URL;
      const url = URLs && URLs.createObjectURL ? URLs.createObjectURL(file) : '';
      if(!url) return { ok:false, error:'download_unavailable', name };
      const a = doc.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      a.style.display = 'none';
      doc.body.appendChild(a);
      a.click();
      a.remove();
      setT(() => { if(URLs.revokeObjectURL) URLs.revokeObjectURL(url); }, 4000);
      return { ok:true, name };
    }

    function submit(){
      if(!win.lastRecordedMixFile){
        state.studioRecording.error = 'Record and review a take before submitting.';
        updateUi();
        return { ok:false };
      }
      const session = deps.activeStudioBattleSession();
      if(!session){
        state.studioRecording.error = 'Start or enter a battle before submitting this take.';
        updateUi();
        return { ok:false };
      }
      state.studioRecording = { ...state.studioRecording, submitted:true, error:'' };
      persist();
      updateUi();
      win.pendingBattleSubmissionSource = 'battle_studio';
      deps.switchView('battle-room');
      setTimeout(()=>{
        const status = doc.getElementById('br-upload-status');
        if(status) status.textContent = `Draft: ${win.lastRecordedMixFile.name}`;
        const button = doc.getElementById('br-upload-btn');
        if(button) button.click();
      },0);
      return { ok:true };
    }

    function wireControls(){
      const armButton = doc.getElementById('arm-record');
      const recordButton = doc.getElementById('record-mix');
      const stopButton = doc.getElementById('stop-record');
      const restartButton = doc.getElementById('restart-recording');
      const saveButton = doc.getElementById('save-recording-draft');
      const submitButton = doc.getElementById('submit-recording');
      if(armButton) armButton.onclick = arm;
      if(recordButton) recordButton.onclick = start;
      if(stopButton) stopButton.onclick = stop;
      if(restartButton) restartButton.onclick = restart;
      if(saveButton) saveButton.onclick = saveDraft;
      if(submitButton) submitButton.onclick = submit;
      const downloadButton = doc.getElementById('download-recording');
      if(downloadButton) downloadButton.onclick = download;
      updateUi();
      renderTracklist();
    }

    return {
      renderTracklist,
      copyTracklist,
      tracklistLines,
      finishRecording,
      isActive,
      elapsedText,
      persist,
      updateUi,
      animateMeters,
      arm,
      start,
      stop,
      renderWaveform,
      restart,
      saveDraft,
      submit,
      download,
      downloadFileName,
      wireControls,
      setReviewPeaks,
      seekReview,
      checkLimit,
      cancelCountIn,
      getReviewPeaks: () => reviewPeaks,
      getObjectUrl: () => objectUrl
    };
  }

  global.DJBattleStudioRecording = { create: createStudioRecording };
})(typeof window !== 'undefined' ? window : globalThis);

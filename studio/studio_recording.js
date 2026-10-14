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
      if(status) status.textContent = recordState.error || (recording ? 'REC active' : armed ? 'Armed' : review ? 'Review take ready' : 'Recording idle');
      if(timer) timer.textContent = elapsedText(recording && recordState.startedAt ? now() - recordState.startedAt : recordState.elapsedMs);
      if(reviewPanel) reviewPanel.classList.toggle('hidden', !review);
      if(audio && objectUrl && audio.src !== objectUrl) audio.src = objectUrl;
      if(metadata) metadata.innerHTML = review ? `<span>File</span><strong>${esc(recordState.fileName || 'Recorded take')}</strong><span>State</span><strong>${esc(recordState.state)}</strong><span>Submit</span><strong>${recordState.submitted ? 'Submitted' : 'Not submitted'}</strong>` : '';
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
      renderWaveform();
      renderTracklist();
      updateUi();
    }

    async function start(){
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
        state.studioRecording = { ...state.studioRecording, state:'recording', armed:true, startedAt:now(), elapsedMs:0, fileName:'', error:'' };
        persist();
        recordingTimer = setInterval(()=>{
          if(!isActive()) return;
          state.studioRecording.elapsedMs = now() - state.studioRecording.startedAt;
          updateUi();
        }, 500);
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

    function stop(){
      if(recorder && recorder.state !== 'inactive'){
        recorder.stop();
        return { ok:true };
      }
      return { ok:false, error:'No active recording.' };
    }

    function renderWaveform(){
      const target = doc.getElementById('recording-waveform');
      if(!target) return;
      target.innerHTML = Array.from({ length:64 }, (_, index)=>`<i style="height:${18 + Math.round(Math.abs(Math.sin(index * 0.7)) * 58)}%"></i>`).join('');
    }

    function restart(){
      if(win.lastRecordedMixFile && typeof win.confirm === 'function' && !win.confirm('Restarting will discard the current unsent take. Continue?')) return { ok:false, cancelled:true };
      if(objectUrl && win.URL && win.URL.revokeObjectURL) win.URL.revokeObjectURL(objectUrl);
      objectUrl = '';
      win.lastRecordedMixFile = null;
      state.studioRecording = { state:'armed', armed:true, startedAt:null, elapsedMs:0, fileName:'', duration:'', error:'', submitted:false, draftSaved:false };
      persist();
      updateUi();
      return { ok:true };
    }

    function saveDraft(){
      if(!win.lastRecordedMixFile){
        state.studioRecording.error = 'No recorded take is available to save.';
        updateUi();
        return { ok:false };
      }
      state.studioRecording = { ...state.studioRecording, state:'draft', draftSaved:true, error:'' };
      persist();
      updateUi();
      return { ok:true };
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
      wireControls,
      getObjectUrl: () => objectUrl
    };
  }

  global.DJBattleStudioRecording = { create: createStudioRecording };
})(typeof window !== 'undefined' ? window : globalThis);

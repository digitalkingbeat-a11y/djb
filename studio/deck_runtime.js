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
    // Studio audio: per-channel trim + 3-band EQ, analysers, sync/key lock/loop, real waveform, play log.
    let fx = {};
    let masterTap = null;
    let masterAnalysers = [];
    const mixerValues = { a:{ gain:1, high:0, mid:0, low:0 }, b:{ gain:1, high:0, mid:0, low:0 } };
    // Oct 29: EQ kill switches. A killed band is cut fully (-40 dB, the deepest a shelf/peaking filter goes);
    // a second tap brings back whatever the slider says.
    const EQ_KILL_DB = -40;
    const eqKills = { a:{ high:false, mid:false, low:false }, b:{ high:false, mid:false, low:false } };
    const keyLock = { a:false, b:false };
    const syncRate = { a:null, b:null };
    const loops = { a:null, b:null };
    const loopSize = { a:4, b:4 };
    const peakCache = {};
    const deckPeakKey = { a:'', b:'' };
    const playLog = [];
    let tickHandle = null;
    const pro = () => deps.studioPro || win.DJBattleStudioPro || global.DJBattleStudioPro || null;
    // Studio Pro: per-channel filter + echo/reverb sends, PFL cue bus and headphone output.
    const fxValues = { a:{ filter:0, echoBeats:0, echoWet:0.35, reverbWet:0 }, b:{ filter:0, echoBeats:0, echoWet:0.35, reverbWet:0 } };
    const pfl = { a:false, b:false };
    let cueMix = 0.5;
    let cueBus = null;
    let headphone = { deviceId:'', status:'' };
    const detectedBpm = { a:null, b:null };
    // Oct 25 Studio: beat jump, loop roll, slip mode, key shift and play counts.
    const perf = () => deps.deckPerf || win.DJBattleDeckPerf || global.DJBattleDeckPerf || null;
    const jumpSize = { a:4, b:4 };
    const slipOn = { a:false, b:false };
    const slipState = { a:null, b:null };
    const rolls = { a:null, b:null };
    const keyShift = { a:0, b:0 };
    const shifters = { a:null, b:null };
    const baseKey = { a:'', b:'' };
    const playCounted = { a:false, b:false };
    const pointerCue = { a:false, b:false };
    const perfNow = () => (win.performance && win.performance.now ? win.performance.now() : now());
    const isJsdom = () => /jsdom/i.test(win && win.navigator && win.navigator.userAgent || '');

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

    // Mic talkover: 1 = music at normal level, 0.5 = music at half level while the DJ talks.
    let duckLevel = 1;
    let duckRamp = false;
    function setDuck(level){
      const next = Math.max(0, Math.min(1, Number(level)));
      duckLevel = Number.isFinite(next) ? next : 1;
      duckRamp = true;
      try{ return applyMix(); }finally{ duckRamp = false; }
    }

    // Waveform zoom: everything on the waveform lives in one layer so zooming keeps markers lined up.
    function waveLayer(w){
      let layer = w.querySelector('.wave-layer');
      if(!layer){ layer = doc.createElement('div'); layer.className = 'wave-layer'; w.appendChild(layer); }
      return layer;
    }

    function applyMix(){
      const xf = doc.getElementById('xfader');
      const vaEl = doc.getElementById('vol-a');
      const vbEl = doc.getElementById('vol-b');
      const x = xf ? Number(xf.value) : 0;
      const va = vaEl ? Number(vaEl.value) : 1;
      const vb = vbEl ? Number(vbEl.value) : 1;
      const curve = crossfadeCurve(x);
      const levels = { a:Math.max(0, Math.min(1, va * curve.a * duckLevel)), b:Math.max(0, Math.min(1, vb * curve.b * duckLevel)) };
      ['a','b'].forEach(deck => {
        const audio = deckAudio(deck);
        if(gains[deck] && gains[deck].gain){
          try{
            const g = gains[deck].gain;
            // Mic talkover ducks smoothly instead of clicking; ordinary fader moves stay instant.
            if(duckRamp && g.setTargetAtTime && audioCtx){ g.cancelScheduledValues && g.cancelScheduledValues(audioCtx.currentTime); g.setTargetAtTime(levels[deck], audioCtx.currentTime, 0.06); }
            else g.value = levels[deck];
          }catch(e){}
          if(audio) try{ audio.volume = 1; }catch(e){}
        }else if(audio){
          // No Web Audio graph yet (before first Play): blend with element volume.
          try{ audio.volume = levels[deck]; }catch(e){}
        }
      });
      const out = doc.getElementById('xfader-out');
      if(out) out.textContent = `A ${Math.round(curve.a * 100)}% / B ${Math.round(curve.b * 100)}%`;
      return levels;
    }

    // Equal-power crossfade: x=-1 full A, 0 both ~71%, +1 full B.
    function crossfadeCurve(x){
      const v = Math.max(-1, Math.min(1, Number(x) || 0));
      const a = Math.cos((v + 1) * Math.PI / 4);
      const b = Math.sin((v + 1) * Math.PI / 4);
      return { a:Math.abs(a) < 1e-9 ? 0 : a, b:Math.abs(b) < 1e-9 ? 0 : b };
    }

    function pitchRate(deck){
      const el = doc.getElementById(`pitch-${validDeck(deck)}`);
      const rate = el ? Number(el.value) : 1;
      return isFinite(rate) && rate > 0 ? rate : 1;
    }

    function applyPitch(deckInput){
      const deck = validDeck(deckInput);
      const rate = syncRate[deck] || pitchRate(deck);
      const audio = deckAudio(deck);
      if(audio){
        // Vinyl-style pitch by default (speed and pitch together); Key lock keeps the pitch.
        const keep = Boolean(keyLock[deck]);
        try{ audio.preservesPitch = keep; audio.mozPreservesPitch = keep; audio.webkitPreservesPitch = keep; }catch(e){}
        audio.defaultPlaybackRate = rate;
        audio.playbackRate = rate;
      }
      const out = doc.getElementById(`pitch-out-${deck}`);
      const pct = (rate - 1) * 100;
      if(out) out.textContent = `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
      return rate;
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
      const nextFx = {};
      let nextMaster = null;
      try{
        ['a','b'].forEach(deck => {
          const audio = deckAudio(deck);
          if(!audio) return;
          const source = nextCtx.createMediaElementSource(audio);
          const gain = nextCtx.createGain();
          const chain = buildChannelChain(nextCtx);
          source.connect(chain.input);
          chain.output.connect(gain);
          gain.connect(nextCtx.destination);
          gain.connect(nextDestination);
          if(!nextMaster && nextCtx.createAnalyser) nextMaster = buildMasterTap(nextCtx);
          if(nextMaster) gain.connect(nextMaster.tap);
          nextFx[deck] = chain;
          if(nextCtx.createMediaStreamDestination){
            const pflGain = nextCtx.createGain(); pflGain.gain.value = 0;
            chain.output.connect(pflGain);
            chain.pfl = pflGain;
          }
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
      fx = nextFx;
      masterTap = nextMaster ? nextMaster.tap : null;
      masterAnalysers = nextMaster ? nextMaster.analysers : [];
      buildCueBus(nextCtx, nextFx, nextMaster);
      ['a','b'].forEach(applyChannelFx);
      applyMix();
      applyCue();
      startTick();
      return { ok:true, audioContext:audioCtx, destination:recordingDestination };
    }

    // source -> trim gain -> low shelf -> mid peaking -> high shelf -> analyser -> (channel/crossfader gain)
    function buildChannelChain(ctx){
      const trim = ctx.createGain();
      if(!ctx.createBiquadFilter || !ctx.createAnalyser){
        // Minimal/legacy contexts: keep a working trim stage, skip EQ and metering.
        return { input:trim, output:trim, trim, low:null, mid:null, high:null, analyser:null };
      }
      const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 250;
      const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1000; if(mid.Q) mid.Q.value = 0.9;
      const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 4000;
      const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
      trim.connect(low); low.connect(mid); mid.connect(high);
      // high shelf -> one-knob filter -> mix bus (dry + echo return + reverb return) -> analyser
      const filter = ctx.createBiquadFilter(); filter.type = 'allpass'; filter.frequency.value = 20000; if(filter.Q) filter.Q.value = 0.9;
      const mix = ctx.createGain();
      high.connect(filter); filter.connect(mix);
      let echoSend = null, delay = null, feedback = null, reverbSend = null, convolver = null;
      if(ctx.createDelay){
        echoSend = ctx.createGain(); echoSend.gain.value = 0;
        delay = ctx.createDelay(4); delay.delayTime.value = 0.5;
        feedback = ctx.createGain(); feedback.gain.value = 0.35;
        filter.connect(echoSend); echoSend.connect(delay); delay.connect(feedback); feedback.connect(delay); delay.connect(mix);
      }
      if(ctx.createConvolver && pro() && ctx.createBuffer){
        reverbSend = ctx.createGain(); reverbSend.gain.value = 0;
        convolver = ctx.createConvolver();
        try{ convolver.buffer = pro().makeImpulse(ctx, 2.4, 3); }catch(e){}
        filter.connect(reverbSend); reverbSend.connect(convolver); convolver.connect(mix);
      }
      mix.connect(analyser);
      return { input:trim, output:analyser, trim, low, mid, high, filter, mix, echoSend, delay, feedback, reverbSend, convolver, analyser };
    }

    function buildMasterTap(ctx){
      const tap = ctx.createGain();
      if(!ctx.createChannelSplitter){
        const one = ctx.createAnalyser(); one.fftSize = 2048; tap.connect(one);
        return { tap, analysers:[one, one] };
      }
      const split = ctx.createChannelSplitter(2);
      tap.connect(split);
      const l = ctx.createAnalyser(); l.fftSize = 2048;
      const r = ctx.createAnalyser(); r.fftSize = 2048;
      split.connect(l, 0); split.connect(r, 1);
      return { tap, analysers:[l, r] };
    }

    const MIXER_DEFAULTS = { gain:1, high:0, mid:0, low:0 };
    function mixerInputId(deck, band){ return band === 'gain' ? `gain-${deck}` : `eq-${band}-${deck}`; }
    function formatMixerValue(band, value){
      if(band === 'gain'){
        const db = value > 0 ? 20 * Math.log10(value) : -Infinity;
        return isFinite(db) ? `${db > 0 ? '+' : ''}${db.toFixed(1)} dB` : '-inf dB';
      }
      return `${value > 0 ? '+' : ''}${Number(value).toFixed(0)} dB`;
    }

    function readMixer(deckInput){
      const deck = validDeck(deckInput);
      Object.keys(MIXER_DEFAULTS).forEach(band => {
        const el = doc.getElementById(mixerInputId(deck, band));
        const v = el ? Number(el.value) : NaN;
        if(isFinite(v)) mixerValues[deck][band] = v;
      });
      return mixerValues[deck];
    }

    function applyChannelFx(deckInput){
      const deck = validDeck(deckInput);
      const v = readMixer(deck);
      const chain = fx[deck];
      if(chain){
        try{ chain.trim.gain.value = v.gain; }catch(e){}
        const k = eqKills[deck];
        if(chain.low) try{ chain.low.gain.value = k.low ? EQ_KILL_DB : v.low; }catch(e){}
        if(chain.mid) try{ chain.mid.gain.value = k.mid ? EQ_KILL_DB : v.mid; }catch(e){}
        if(chain.high) try{ chain.high.gain.value = k.high ? EQ_KILL_DB : v.high; }catch(e){}
      }
      applySendFx(deck);
      Object.keys(MIXER_DEFAULTS).forEach(band => {
        const out = doc.getElementById(`${mixerInputId(deck, band)}-out`);
        if(out) out.textContent = band !== 'gain' && eqKills[deck][band] ? 'KILL' : formatMixerValue(band, v[band]);
      });
      updateKillButtons(deck);
      return { ...v, connected:Boolean(chain), kills:{ ...eqKills[deck] } };
    }

    function updateKillButtons(deckInput){
      const deck = validDeck(deckInput);
      ['high','mid','low'].forEach(band => {
        const btn = doc.querySelector(`[data-eq-kill="${band}"][data-deck="${deck}"]`);
        if(!btn) return;
        const on = Boolean(eqKills[deck][band]);
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        const label = btn.closest('label') || (btn.parentNode && btn.parentNode.classList && btn.parentNode.classList.contains('eq-band') ? btn.parentNode : null);
        if(label && label.classList) label.classList.toggle('eq-killed', on);
      });
    }
    function toggleEqKill(deckInput, band, force){
      const deck = validDeck(deckInput);
      if(!['high','mid','low'].includes(band)) return { ok:false, error:'Unknown EQ band.' };
      eqKills[deck][band] = typeof force === 'boolean' ? force : !eqKills[deck][band];
      applyChannelFx(deck);
      return { ok:true, deck, band, killed:eqKills[deck][band] };
    }
    function eqKillState(deckInput){ return { ...eqKills[validDeck(deckInput)] }; }

    function resetMixerControl(deckInput, band){
      const deck = validDeck(deckInput);
      const el = doc.getElementById(mixerInputId(deck, band));
      if(el) el.value = String(MIXER_DEFAULTS[band]);
      return applyChannelFx(deck);
    }

    // Pure: RMS and peak (0..1) of a block of samples; clip when peak reaches full scale.
    function levelsFromSamples(samples){
      let sum = 0, peak = 0;
      const n = samples && samples.length || 0;
      for(let i = 0; i < n; i += 1){ const v = Math.abs(samples[i]); sum += v * v; if(v > peak) peak = v; }
      const rms = n ? Math.sqrt(sum / n) : 0;
      return { rms, peak, clip:peak >= 0.99 };
    }

    function analyserLevels(analyser){
      if(!analyser || !analyser.getFloatTimeDomainData) return { rms:0, peak:0, clip:false };
      const buf = new Float32Array(analyser.fftSize || 2048);
      analyser.getFloatTimeDomainData(buf);
      return levelsFromSamples(buf);
    }

    // Meter scale: -48 dBFS..0 dBFS mapped to 0..1.
    function meterFraction(level){
      if(!(level > 0)) return 0;
      const db = 20 * Math.log10(level);
      return Math.max(0, Math.min(1, (db + 48) / 48));
    }

    function deckLevels(deckInput){ return analyserLevels(fx[validDeck(deckInput)] && fx[validDeck(deckInput)].analyser); }
    function masterLevels(){
      if(!masterAnalysers.length) return null;
      return { left:analyserLevels(masterAnalysers[0]), right:analyserLevels(masterAnalysers[1]) };
    }

    const clipHold = {};
    function paintMeter(el, level, key){
      if(!el) return;
      const frac = meterFraction(level.rms * 1.41);
      el.style.width = el.dataset.vertical ? '' : `${Math.round(frac * 100)}%`;
      el.style.setProperty('--level', String(frac));
      const t = now();
      if(level.clip) clipHold[key] = t;
      const clipping = clipHold[key] && t - clipHold[key] < 1200;
      const host = el.parentElement;
      if(host) host.classList.toggle('clipping', Boolean(clipping));
    }

    function updateMeters(){
      ['a','b'].forEach(deck => {
        const lv = deckLevels(deck);
        const levelMeter = doc.querySelector(`.deck[data-deck="${deck}"] .level-meter`);
        if(levelMeter){
          const segments = Array.from(levelMeter.children);
          const onCount = Math.round(meterFraction(lv.rms * 1.41) * segments.length);
          segments.forEach((segment, index) => segment.classList.toggle('on', index < onCount));
        }
        paintMeter(doc.querySelector(`#meter-${deck} > i`), lv, `deck-${deck}`);
      });
      const channelMeters = doc.querySelectorAll('.mixer-meter-stack .channel-meter i');
      const m = masterLevels();
      const mono = m ? { rms:Math.max(m.left.rms, m.right.rms), peak:Math.max(m.left.peak, m.right.peak), clip:m.left.clip || m.right.clip } : { rms:0, peak:0, clip:false };
      [deckLevels('a'), mono, deckLevels('b')].forEach((lv, i) => { if(channelMeters[i]){ channelMeters[i].dataset.vertical = '1'; paintMeter(channelMeters[i], lv, `ch-${i}`); } });
    }

    function tick(){
      tickHandle = null;
      try{
        updateMeters();
        ['a','b'].forEach(deck => { enforceLoop(deck); tickSlip(deck); updatePlayhead(deck); });
      }catch(e){}
      if(audioCtx) startTick();
    }

    function startTick(){
      if(tickHandle || isJsdom()) return;
      const raf = win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : (fn => setTimeout(fn, 50));
      tickHandle = raf(tick);
    }

    // ---- Filter + send FX ----
    function readSendFx(deck){
      const v = fxValues[deck];
      const num = (id, fallback) => { const el = doc.getElementById(id); const n = el ? Number(el.value) : NaN; return isFinite(n) ? n : fallback; };
      v.filter = num(`filter-${deck}`, v.filter);
      v.echoBeats = num(`echo-beats-${deck}`, v.echoBeats);
      v.echoWet = num(`echo-wet-${deck}`, v.echoWet);
      v.reverbWet = num(`reverb-wet-${deck}`, v.reverbWet);
      return v;
    }

    function applySendFx(deckInput){
      const deck = validDeck(deckInput);
      const v = readSendFx(deck);
      const P = pro();
      const filt = P ? P.filterSettings(v.filter) : { type:'allpass', frequency:20000, label:'Off', mode:'off' };
      const bpm = effectiveBpm(deck);
      const delaySec = P ? P.echoDelaySeconds(bpm, v.echoBeats || 0.5) : 0.5;
      const chain = fx[deck];
      if(chain){
        if(chain.filter) try{ chain.filter.type = filt.type; chain.filter.frequency.value = filt.frequency; }catch(e){}
        if(chain.echoSend) try{ chain.echoSend.gain.value = v.echoBeats > 0 ? v.echoWet : 0; }catch(e){}
        if(chain.delay) try{ chain.delay.delayTime.value = delaySec; }catch(e){}
        if(chain.reverbSend) try{ chain.reverbSend.gain.value = v.reverbWet; }catch(e){}
      }
      const fOut = doc.getElementById(`filter-${deck}-out`);
      if(fOut) fOut.textContent = filt.label;
      const eOut = doc.getElementById(`echo-${deck}-out`);
      if(eOut) eOut.textContent = v.echoBeats > 0 ? `${Math.round(delaySec * 1000)} ms${bpm ? '' : ' (no BPM)'} / ${Math.round(v.echoWet * 100)}%` : 'Off';
      const rOut = doc.getElementById(`reverb-${deck}-out`);
      if(rOut) rOut.textContent = v.reverbWet > 0 ? `${Math.round(v.reverbWet * 100)}%` : 'Off';
      return { deck, filter:filt, echo:{ beats:v.echoBeats, delaySeconds:delaySec, wet:v.echoBeats > 0 ? v.echoWet : 0 }, reverb:{ wet:v.reverbWet }, connected:Boolean(chain) };
    }

    // ---- Headphone cue (PFL) ----
    function buildCueBus(ctx, chains, master){
      if(!ctx.createMediaStreamDestination) return null;
      const dest = ctx.createMediaStreamDestination();
      const cue = ctx.createGain();
      const masterSend = ctx.createGain();
      Object.values(chains).forEach(chain => { if(chain.pfl) chain.pfl.connect(cue); });
      if(master && master.tap) master.tap.connect(masterSend);
      cue.connect(dest); masterSend.connect(dest);
      let element = null;
      if(doc.createElement && !isJsdom()){
        element = doc.createElement('audio');
        element.id = 'headphone-cue-out';
        element.hidden = true;
        try{ element.srcObject = dest.stream; }catch(e){}
        if(doc.body) doc.body.appendChild(element);
      }
      cueBus = { cue, master:masterSend, dest, element };
      if(headphone.deviceId) setHeadphoneDevice(headphone.deviceId);
      return cueBus;
    }

    function applyCue(){
      const P = pro();
      const knob = doc.getElementById('cue-mix');
      if(knob && isFinite(Number(knob.value))) cueMix = Number(knob.value);
      const g = P ? P.cueMixGains(cueMix) : { cue:1 - cueMix, master:cueMix };
      ['a','b'].forEach(deck => {
        const chain = fx[deck];
        if(chain && chain.pfl) try{ chain.pfl.gain.value = pfl[deck] ? 1 : 0; }catch(e){}
        const btn = doc.querySelector(`[data-pfl="${deck}"]`);
        if(btn){ btn.classList.toggle('active', pfl[deck]); btn.setAttribute('aria-pressed', pfl[deck] ? 'true' : 'false'); }
      });
      if(cueBus){
        try{ cueBus.cue.gain.value = g.cue; cueBus.master.gain.value = g.master; }catch(e){}
      }
      const out = doc.getElementById('cue-mix-out');
      if(out) out.textContent = `Cue ${Math.round(g.cue * 100)}% / Master ${Math.round(g.master * 100)}%`;
      return { pfl:{ ...pfl }, cueMix, gains:g, connected:Boolean(cueBus) };
    }

    function togglePfl(deckInput, force){
      const deck = validDeck(deckInput);
      pfl[deck] = typeof force === 'boolean' ? force : !pfl[deck];
      const r = applyCue();
      if(cueBus && cueBus.element && pfl[deck] && cueBus.element.paused !== false){ try{ const p = cueBus.element.play(); if(p && p.catch) p.catch(()=>{}); }catch(e){} }
      return { ok:true, deck, on:pfl[deck], ...r };
    }

    function headphoneSupport(){
      const P = pro();
      return P ? P.headphoneSupport(win) : { supported:false };
    }

    function renderHeadphoneUi(devices){
      const note = doc.getElementById('headphone-note');
      const select = doc.getElementById('headphone-output');
      const support = headphoneSupport();
      if(!support.supported){
        if(select){ select.disabled = true; select.innerHTML = '<option value="">Not available</option>'; }
        if(note) note.textContent = 'Headphone output not supported in this browser';
        return support;
      }
      if(select){
        select.disabled = false;
        const list = (devices || []).filter(d => d.kind === 'audiooutput');
        select.innerHTML = '<option value="">Choose headphones…</option>' + list.map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === headphone.deviceId ? 'selected' : ''}>${esc(d.label || `Output ${i + 1}`)}</option>`).join('');
      }
      if(note) note.textContent = headphone.status || 'Pick a second output for the cue mix. The crowd hears the browser default output.';
      return support;
    }

    async function refreshHeadphoneDevices(){
      const md = win.navigator && win.navigator.mediaDevices;
      let devices = [];
      try{ if(md && md.enumerateDevices) devices = await md.enumerateDevices(); }catch(e){}
      renderHeadphoneUi(devices);
      return devices;
    }

    async function setHeadphoneDevice(deviceId){
      headphone.deviceId = String(deviceId || '');
      const support = headphoneSupport();
      if(!support.supported){ headphone.status = 'Headphone output not supported in this browser'; renderHeadphoneUi(); return { ok:false, error:headphone.status }; }
      if(!cueBus || !cueBus.element){ headphone.status = 'Headphones set. Cue starts when a deck plays.'; renderHeadphoneUi(); return { ok:true, pending:true }; }
      try{
        await cueBus.element.setSinkId(headphone.deviceId);
        const p = cueBus.element.play(); if(p && p.catch) p.catch(()=>{});
        headphone.status = 'Cue mix playing on the chosen headphones.';
        renderHeadphoneUi();
        return { ok:true };
      }catch(error){
        headphone.status = `Could not switch output: ${String(error && error.message || error)}`;
        renderHeadphoneUi();
        return { ok:false, error:headphone.status };
      }
    }

    // ---- Auto BPM ----
    function applyDetectedBpm(deckInput, result){
      const deck = validDeck(deckInput);
      if(!result || !(result.bpm > 0)) return { ok:false };
      const loaded = state.studioDecks && state.studioDecks[deck];
      if(loaded && parseFloat(loaded.bpm) > 0) return { ok:false, skipped:'already-set' };
      if(state.studioDecks){ state.studioDecks[deck] = { ...(loaded || {}), bpm:result.bpm, bpmSource:'detected' }; }
      detectedBpm[deck] = result.bpm;
      const bpmEl = doc.getElementById(`bpm-${deck}`);
      if(bpmEl){
        bpmEl.dataset.trackBpm = String(result.bpm);
        bpmEl.innerHTML = `${esc(result.bpm)} <span class="bpm-detected-tag" title="Detected from the audio. Edit or Tap Tempo to override.">Detected</span>`;
      }
      updateDeckButtons(deck);
      applySendFx(deck);
      if(loaded && loaded.trackId && deps.saveDetectedBpm) deps.saveDetectedBpm(loaded.trackId, result.bpm);
      return { ok:true, deck, bpm:result.bpm };
    }

    // ---- Sync / Key lock / Loop ----
    function trackBpm(deckInput){
      const deck = validDeck(deckInput);
      const loaded = state.studioDecks && state.studioDecks[deck];
      const fromState = loaded && parseFloat(loaded.bpm);
      if(fromState > 0) return fromState;
      const el = doc.getElementById(`bpm-${deck}`);
      const fromEl = el && el.dataset.trackBpm ? parseFloat(el.dataset.trackBpm) : (el ? parseFloat(el.textContent) : NaN);
      return fromEl > 0 ? fromEl : null;
    }

    function effectiveRate(deck){
      const audio = deckAudio(deck);
      const r = audio && Number(audio.playbackRate);
      return r > 0 ? r : (syncRate[deck] || pitchRate(deck));
    }

    function effectiveBpm(deckInput){
      const deck = validDeck(deckInput);
      const bpm = trackBpm(deck);
      return bpm ? bpm * effectiveRate(deck) : null;
    }

    function syncDeck(deckInput){
      const deck = validDeck(deckInput);
      const other = deck === 'a' ? 'b' : 'a';
      const mine = trackBpm(deck);
      const target = effectiveBpm(other);
      if(!mine || !target) return { ok:false, deck, error:'Both decks need a BPM to sync. Add BPM in the Library.' };
      const rate = Math.max(0.5, Math.min(2, target / mine));
      syncRate[deck] = rate;
      const pitch = doc.getElementById(`pitch-${deck}`);
      if(pitch) pitch.value = String(rate);
      applyPitch(deck);
      updateDeckButtons(deck);
      return { ok:true, deck, rate, bpm:mine * rate };
    }

    function toggleKeyLock(deckInput, force){
      const deck = validDeck(deckInput);
      keyLock[deck] = force == null ? !keyLock[deck] : Boolean(force);
      applyPitch(deck);
      updateDeckButtons(deck);
      return { ok:true, deck, keyLock:keyLock[deck] };
    }

    function setLoopSize(deckInput, beats){
      const deck = validDeck(deckInput);
      const b = Number(beats);
      if(![1,2,4,8,16].includes(b)) return { ok:false, error:'Loop size must be 1, 2, 4, 8 or 16 beats.' };
      loopSize[deck] = b;
      if(loops[deck]) setLoop(deck, loops[deck].start);
      updateDeckButtons(deck);
      return { ok:true, deck, beats:b };
    }

    function setLoop(deck, start){
      const bpm = trackBpm(deck);
      if(!bpm) return { ok:false, deck, error:'Add BPM to this track to use beat loops.' };
      const length = loopSize[deck] * 60 / bpm;
      loops[deck] = { start, end:start + length, beats:loopSize[deck], length };
      renderLoopRegion(deck);
      updateDeckButtons(deck);
      return { ok:true, deck, loop:loops[deck] };
    }

    function toggleLoop(deckInput){
      const deck = validDeck(deckInput);
      if(loops[deck]) return exitLoop(deck);
      const audio = deckAudio(deck);
      const start = audio ? Number(audio.currentTime) || 0 : 0;
      const r = setLoop(deck, Math.round(start * 1000) / 1000);
      if(r.ok && slipOn[deck]) slipBegin(deck, 'loop');
      return r;
    }

    function exitLoop(deckInput){
      const deck = validDeck(deckInput);
      loops[deck] = null;
      renderLoopRegion(deck);
      updateDeckButtons(deck);
      if(slipState[deck] && slipState[deck].reason === 'loop') slipEnd(deck);
      return { ok:true, deck, loop:null };
    }

    function enforceLoop(deckInput){
      const deck = validDeck(deckInput);
      const loop = loops[deck];
      const audio = deckAudio(deck);
      if(!loop || !audio) return false;
      const t = Number(audio.currentTime) || 0;
      if(t >= loop.end || t < loop.start - 0.05){
        try{ audio.currentTime = loop.start + (t >= loop.end ? (t - loop.end) % loop.length : 0); }catch(e){}
        return true;
      }
      return false;
    }


    // ---- Oct 25: beat jump, loop roll, slip mode, key shift ----
    function deckDuration(deck){ const a = deckAudio(deck); return a && a.duration > 0 && isFinite(a.duration) ? a.duration : 0; }
    // The app has no beat-grid analysis yet, so the first beat is 0:00 unless the track carries firstBeat (seconds).
    function firstBeat(deck){
      const loaded = state.studioDecks && state.studioDecks[deck] || {};
      const track = loaded.trackId && deps.getLibraryTrackById ? deps.getLibraryTrackById(loaded.trackId) : null;
      const v = Number(loaded.firstBeat != null ? loaded.firstBeat : track && track.firstBeat);
      return v > 0 ? v : 0;
    }
    function deckRate(deck){ const a = deckAudio(deck); const r = a && Number(a.playbackRate); return r > 0 ? r : 1; }
    function seek(deck, t){ const a = deckAudio(deck); if(a){ try{ a.currentTime = Math.max(0, t); }catch(e){} } }

    function slipBegin(deckInput, reason){
      const deck = validDeck(deckInput);
      const P = perf(); const audio = deckAudio(deck);
      if(!P || !audio) return null;
      if(slipState[deck]) return slipState[deck];
      slipState[deck] = { ...P.createSlip(Number(audio.currentTime) || 0, perfNow()), reason:reason || 'slip', playing:!audio.paused };
      updatePerfButtons(deck);
      return slipState[deck];
    }
    function tickSlip(deck){
      const st = slipState[deck]; const P = perf(); const audio = deckAudio(deck);
      if(!st || !P || !audio) return null;
      return P.advanceSlip(st, perfNow(), deckRate(deck), !audio.paused, deckDuration(deck));
    }
    function slipPosition(deckInput){ const deck = validDeck(deckInput); return slipState[deck] ? tickSlip(deck) : null; }
    function slipEnd(deckInput){
      const deck = validDeck(deckInput);
      if(!slipState[deck]) return { ok:false, deck };
      const pos = tickSlip(deck);
      slipState[deck] = null;
      if(pos != null) seek(deck, pos);
      updatePerfButtons(deck);
      return { ok:true, deck, resumedAt:pos };
    }
    function toggleSlip(deckInput, force){
      const deck = validDeck(deckInput);
      slipOn[deck] = force == null ? !slipOn[deck] : Boolean(force);
      if(!slipOn[deck] && slipState[deck] && slipState[deck].reason !== 'roll') slipState[deck] = null;
      updatePerfButtons(deck);
      return { ok:true, deck, slip:slipOn[deck] };
    }
    function setJumpSize(deckInput, beats){
      const deck = validDeck(deckInput); const b = Number(beats);
      const P = perf();
      if(!P || !P.JUMP_SIZES.includes(b)) return { ok:false, error:'Beat jump size must be 1, 4, 8 or 16 beats.' };
      jumpSize[deck] = b; updatePerfButtons(deck);
      return { ok:true, deck, beats:b };
    }
    function beatJump(deckInput, beats){
      const deck = validDeck(deckInput);
      const P = perf(); const audio = deckAudio(deck); const bpm = trackBpm(deck);
      if(!P || !audio) return { ok:false, deck, error:'Load a track first.' };
      if(!bpm) return { ok:false, deck, error:'Add BPM to this track to use beat jump.' };
      const from = Number(audio.currentTime) || 0;
      const target = P.beatJumpTarget(from, Number(beats), bpm, deckDuration(deck), firstBeat(deck));
      if(target == null) return { ok:false, deck, error:'Could not jump.' };
      if(loops[deck] && !rolls[deck]){ const shift = target - from; loops[deck] = { ...loops[deck], start:loops[deck].start + shift, end:loops[deck].end + shift }; renderLoopRegion(deck); }
      seek(deck, target);
      return { ok:true, deck, from, to:target, beats:Number(beats) };
    }
    function rollStart(deckInput, fraction){
      const deck = validDeck(deckInput);
      const P = perf(); const audio = deckAudio(deck); const bpm = trackBpm(deck);
      if(!P || !audio) return { ok:false, deck, error:'Load a track first.' };
      if(!bpm) return { ok:false, deck, error:'Add BPM to this track to use loop rolls.' };
      const w = P.rollWindow(Number(audio.currentTime) || 0, Number(fraction), bpm, firstBeat(deck));
      if(!w) return { ok:false, deck, error:'Could not roll.' };
      if(!rolls[deck]){ rolls[deck] = { prevLoop:loops[deck], fraction:Number(fraction) }; slipBegin(deck, 'roll'); }
      else rolls[deck].fraction = Number(fraction);
      loops[deck] = { start:w.start, end:w.end, beats:w.beats, length:w.length, roll:true };
      renderLoopRegion(deck); updatePerfButtons(deck);
      return { ok:true, deck, roll:loops[deck] };
    }
    function rollEnd(deckInput){
      const deck = validDeck(deckInput);
      if(!rolls[deck]) return { ok:false, deck };
      loops[deck] = rolls[deck].prevLoop || null;
      rolls[deck] = null;
      const r = slipEnd(deck);
      renderLoopRegion(deck); updateDeckButtons(deck); updatePerfButtons(deck);
      return { ok:true, deck, resumedAt:r.resumedAt };
    }
    // Key shift: semitone steps, routed through a pitch-shift AudioWorklet so the tempo never changes.
    function shiftedKey(deckInput){
      const deck = validDeck(deckInput);
      const P = perf(); const raw = baseKey[deck];
      if(!keyShift[deck] || !P) return raw;
      const cam = deps.parseCamelotKey ? deps.parseCamelotKey(raw) : raw;
      return P.shiftCamelot(cam, keyShift[deck]) || raw;
    }
    function renderDeckKey(deck){
      const keyEl = doc.getElementById(`key-${deck}`);
      if(!keyEl) return;
      const k = shiftedKey(deck) || '--';
      const P = perf();
      keyEl.innerHTML = (deps.keyBadgeHtml ? deps.keyBadgeHtml(k) : esc(k)) + (keyShift[deck] && P ? ` <small class="keyshift-tag" title="Key shifted from ${esc(baseKey[deck] || '--')}">${esc(P.shiftLabel(keyShift[deck]))}</small>` : '');
    }
    async function attachShifter(deck){
      if(shifters[deck]) return { ok:true };
      const P = perf(); const source = sources[deck]; const chain = fx[deck];
      if(!P || !audioCtx || !source || !chain) return { ok:false, error:'Press Play once so the deck audio can start, then shift the key.' };
      const made = await P.createPitchShifter(audioCtx, win);
      if(!made.ok) return made;
      if(shifters[deck]) { try{ made.node.disconnect(); }catch(e){} return { ok:true }; }
      try{ source.disconnect(chain.input); }catch(e){ try{ source.disconnect(); }catch(err){} }
      source.connect(made.node); made.node.connect(chain.input);
      shifters[deck] = made.node;
      return { ok:true };
    }
    async function setKeyShift(deckInput, n){
      const deck = validDeck(deckInput);
      const P = perf();
      if(!P) return { ok:false, deck, error:'Key shift is unavailable.' };
      const value = P.clampShift(n);
      keyShift[deck] = value;
      renderDeckKey(deck); renderMixesWellNext(deck); updatePerfButtons(deck);
      let audio = { ok:true };
      if(value !== 0 || shifters[deck]){
        if(!audioCtx && !isJsdom()){ try{ ensureAudioGraph(); }catch(e){} }
        if(audioCtx) audio = await attachShifter(deck);
        else audio = { ok:false, error:'Press Play once so the deck audio can start, then shift the key.' };
      }
      if(shifters[deck]){ const param = shifters[deck].parameters && shifters[deck].parameters.get && shifters[deck].parameters.get('ratio'); if(param) param.value = P.semitoneRatio(value); }
      if(!audio.ok && deps.setStudioRuleStatus) deps.setStudioRuleStatus(audio.error, 'denied');
      return { ok:true, deck, semitones:value, key:shiftedKey(deck), audio:audio.ok };
    }
    function nudgeKeyShift(deckInput, step){ const deck = validDeck(deckInput); return setKeyShift(deck, keyShift[deck] + Number(step || 0)); }

    function updatePerfButtons(deckInput){
      const deck = validDeck(deckInput);
      const wrap = doc.getElementById(`deck-perf-${deck}`);
      if(!wrap) return;
      const noBpm = !trackBpm(deck);
      wrap.querySelectorAll('[data-beatjump]').forEach(b => { b.disabled = noBpm; b.title = noBpm ? 'Add BPM to this track to use beat jump.' : `Jump ${b.dataset.beatjump === '-1' ? 'back' : 'forward'} ${jumpSize[deck]} beat${jumpSize[deck] === 1 ? '' : 's'}`; });
      wrap.querySelectorAll('[data-roll]').forEach(b => { b.disabled = noBpm; b.classList.toggle('active', Boolean(rolls[deck] && rolls[deck].fraction === Number(b.dataset.roll))); });
      const size = wrap.querySelector('[data-jump-size]'); if(size) size.value = String(jumpSize[deck]);
      const slip = wrap.querySelector('[data-slip]');
      if(slip){ slip.classList.toggle('active', slipOn[deck]); slip.setAttribute('aria-pressed', slipOn[deck] ? 'true' : 'false'); slip.classList.toggle('slipping', Boolean(slipState[deck])); slip.title = slipOn[deck] ? 'Slip on: loops, jumps and Cue snap back to where the track would be' : 'Slip off'; }
      const out = wrap.querySelector('[data-keyshift-out]'); const P = perf();
      if(out && P) out.textContent = P.shiftLabel(keyShift[deck]);
      const down = wrap.querySelector('[data-keyshift="-1"]'); if(down && P) down.disabled = keyShift[deck] <= P.KEY_SHIFT_MIN;
      const up = wrap.querySelector('[data-keyshift="1"]'); if(up && P) up.disabled = keyShift[deck] >= P.KEY_SHIFT_MAX;
    }
    function renderPerfControls(deckInput){
      const deck = validDeck(deckInput);
      const P = perf();
      if(!P) return null;
      let wrap = doc.getElementById(`deck-perf-${deck}`);
      if(!wrap){
        const anchor = doc.getElementById(`cues-${deck}`);
        if(!anchor || !anchor.parentNode) return null;
        wrap = doc.createElement('div'); wrap.id = `deck-perf-${deck}`; wrap.className = 'deck-perf';
        anchor.parentNode.insertBefore(wrap, anchor);
      }
      const D = deck.toUpperCase();
      const rollLabel = f => f === 1 ? '1' : `1/${Math.round(1 / f)}`;
      wrap.innerHTML = `<div class="deck-perf-group" role="group" aria-label="Deck ${D} beat jump"><span class="deck-perf-label">Jump</span><button type="button" class="ghost small" data-beatjump="-1" aria-label="Deck ${D} jump back">◀</button><select data-jump-size aria-label="Deck ${D} jump size">${P.JUMP_SIZES.map(b => `<option value="${b}">${b}</option>`).join('')}</select><button type="button" class="ghost small" data-beatjump="1" aria-label="Deck ${D} jump forward">▶</button></div>`
        + `<div class="deck-perf-group deck-roll-pads" role="group" aria-label="Deck ${D} loop roll (hold)"><span class="deck-perf-label">Roll</span>${P.ROLL_SIZES.map(f => `<button type="button" class="roll-pad" data-roll="${f}" aria-label="Deck ${D} loop roll ${rollLabel(f)} beat (hold)">${rollLabel(f)}</button>`).join('')}</div>`
        + `<div class="deck-perf-group"><button type="button" class="ghost small" data-slip aria-pressed="false">Slip</button></div>`
        + `<div class="deck-perf-group" role="group" aria-label="Deck ${D} key shift"><span class="deck-perf-label">Key</span><button type="button" class="ghost small" data-keyshift="-1" aria-label="Deck ${D} key down a semitone">−</button><output data-keyshift-out>0</output><button type="button" class="ghost small" data-keyshift="1" aria-label="Deck ${D} key up a semitone">+</button></div>`;
      const say = r => { if(r && r.ok === false && r.error && deps.setStudioRuleStatus) deps.setStudioRuleStatus(r.error, 'denied'); };
      wrap.querySelectorAll('[data-beatjump]').forEach(b => {
        const dir = Number(b.dataset.beatjump);
        let viaPointer = false;
        b.onpointerdown = ev => { viaPointer = true; if(ev && ev.preventDefault) ev.preventDefault(); if(slipOn[deck]) slipBegin(deck, 'jump'); say(beatJump(deck, dir * jumpSize[deck])); };
        b.onpointerup = b.onpointercancel = b.onpointerleave = () => { if(slipState[deck] && slipState[deck].reason === 'jump') slipEnd(deck); };
        b.onclick = () => { if(viaPointer){ viaPointer = false; return; } say(beatJump(deck, dir * jumpSize[deck])); };
      });
      const size = wrap.querySelector('[data-jump-size]'); if(size) size.onchange = () => setJumpSize(deck, size.value);
      wrap.querySelectorAll('[data-roll]').forEach(b => {
        b.onpointerdown = ev => { if(ev && ev.preventDefault) ev.preventDefault(); say(rollStart(deck, Number(b.dataset.roll))); };
        b.onpointerup = b.onpointercancel = b.onpointerleave = () => { if(rolls[deck]) rollEnd(deck); };
        b.oncontextmenu = ev => { if(ev && ev.preventDefault) ev.preventDefault(); };
      });
      const slip = wrap.querySelector('[data-slip]'); if(slip) slip.onclick = () => toggleSlip(deck);
      wrap.querySelectorAll('[data-keyshift]').forEach(b => b.onclick = () => nudgeKeyShift(deck, Number(b.dataset.keyshift)));
      updatePerfButtons(deck);
      return wrap;
    }
    // Slip + Cue: hold Cue to play from the cue point, let go to drop back in where the track would be.
    function cueSlipStart(deck){
      const audio = deckAudio(deck); if(!audio) return;
      const cues = state.decks && state.decks[deck] && Array.isArray(state.decks[deck].cues) ? state.decks[deck].cues : [];
      const cueTime = cues.length ? Number(cues[cues.length - 1].time) || 0 : 0;
      slipBegin(deck, 'cue');
      seek(deck, cueTime);
      try{ const p = audio.play && audio.play(); if(p && p.catch) p.catch(() => {}); }catch(e){}
    }
    function trackPlayed(deck){
      if(playCounted[deck]) return;
      const loaded = state.studioDecks && state.studioDecks[deck];
      if(!loaded || !loaded.trackId || !deps.onTrackPlayed) return;
      playCounted[deck] = true;
      try{ deps.onTrackPlayed(loaded.trackId, deck); }catch(e){}
    }

    function updateDeckButtons(deckInput){
      const deck = validDeck(deckInput);
      const other = deck === 'a' ? 'b' : 'a';
      updatePerfButtons(deck);
      const sync = doc.querySelector(`[data-sync="${deck}"]`);
      if(sync){
        const missing = !trackBpm(deck) ? 'This track has no BPM. Add it in the Library to use Sync.' : !trackBpm(other) ? `Deck ${other.toUpperCase()} has no BPM to sync to.` : '';
        sync.disabled = Boolean(missing);
        sync.title = missing || `Match Deck ${other.toUpperCase()} tempo`;
        sync.classList.toggle('active', Boolean(syncRate[deck]));
      }
      const key = doc.querySelector(`[data-keylock="${deck}"]`);
      if(key){
        key.classList.toggle('active', keyLock[deck]);
        key.setAttribute('aria-pressed', keyLock[deck] ? 'true' : 'false');
        key.title = keyLock[deck] ? 'Key lock on: tempo changes keep the original pitch' : 'Key lock off: pitch moves with speed (vinyl)';
      }
      const loop = doc.querySelector(`[data-loop="${deck}"]`);
      if(loop){
        const noBpm = !trackBpm(deck);
        loop.disabled = noBpm && !loops[deck];
        loop.title = noBpm ? 'Add BPM to this track to use beat loops.' : loops[deck] ? 'Exit loop' : `Loop ${loopSize[deck]} beats from here`;
        loop.textContent = loops[deck] ? `Exit ${loops[deck].beats}` : 'Loop';
        loop.classList.toggle('active', Boolean(loops[deck]));
      }
      const size = doc.getElementById(`loop-size-${deck}`);
      if(size) size.value = String(loopSize[deck]);
      const sync2 = doc.querySelector(`[data-sync="${other}"]`);
      if(sync2){
        const missing = !trackBpm(other) ? 'This track has no BPM. Add it in the Library to use Sync.' : !trackBpm(deck) ? `Deck ${deck.toUpperCase()} has no BPM to sync to.` : '';
        sync2.disabled = Boolean(missing);
        sync2.title = missing || `Match Deck ${deck.toUpperCase()} tempo`;
      }
    }

    // ---- Real waveform ----
    // Pure: split samples into N buckets and keep the max absolute value of each, normalised to 0..1.
    function computePeaks(channels, buckets){
      const list = Array.isArray(channels) ? channels : [channels];
      const len = list[0] ? list[0].length : 0;
      const n = Math.max(1, buckets | 0);
      const out = new Array(n).fill(0);
      if(!len) return out;
      const step = len / n;
      for(let b = 0; b < n; b += 1){
        const from = Math.floor(b * step), to = Math.max(from + 1, Math.floor((b + 1) * step));
        let m = 0;
        list.forEach(ch => { for(let i = from; i < to && i < len; i += 1){ const v = Math.abs(ch[i]); if(v > m) m = v; } });
        out[b] = m;
      }
      const max = Math.max(...out);
      return max > 0 ? out.map(v => Math.round(v / max * 1000) / 1000) : out;
    }

    async function decodePeaks(key, getArrayBuffer){
      if(!key) return null;
      if(peakCache[key]) return peakCache[key];
      const Offline = win.OfflineAudioContext || win.webkitOfflineAudioContext;
      if(!Offline || !getArrayBuffer) return null;
      const data = await getArrayBuffer();
      const ctx = new Offline(1, 1, 44100);
      const buffer = await ctx.decodeAudioData(data);
      const channels = [];
      for(let c = 0; c < buffer.numberOfChannels; c += 1) channels.push(buffer.getChannelData(c));
      let bpm = null;
      try{ bpm = pro() ? pro().detectBpm(channels, buffer.sampleRate) : null; }catch(e){}
      peakCache[key] = { peaks:computePeaks(channels, 160), duration:buffer.duration, bpm };
      return peakCache[key];
    }

    function loadDeckPeaks(deck, key, getArrayBuffer){
      deckPeakKey[deck] = key || '';
      if(!key) return Promise.resolve(null);
      return decodePeaks(key, getArrayBuffer).then(result => {
        if(deckPeakKey[deck] === key){
          renderWaveformForDeck(deck, {});
          if(result && result.bpm && !trackBpm(deck)) applyDetectedBpm(deck, result.bpm);
        }
        return result;
      }).catch(() => null);
    }

    function setDeckPeaks(deckInput, key, peaks, duration){
      const deck = validDeck(deckInput);
      peakCache[key] = { peaks, duration };
      deckPeakKey[deck] = key;
      renderWaveformForDeck(deck, {});
    }

    function updatePlayhead(deckInput){
      const deck = validDeck(deckInput);
      const audio = deckAudio(deck);
      const marker = doc.querySelector(`#wave-${deck} .position-marker`);
      if(!marker || !audio || !(audio.duration > 0)) return;
      const frac = Math.max(0, Math.min(1, audio.currentTime / audio.duration));
      marker.style.left = `${frac * 100}%`;
      if(win.DJBStudio26 && win.DJBStudio26.followPlayhead) try{ win.DJBStudio26.followPlayhead(deck, frac); }catch(e){}
    }

    function seekDeckToFraction(deckInput, frac){
      const deck = validDeck(deckInput);
      const audio = deckAudio(deck);
      if(!audio || !(audio.duration > 0)) return { ok:false, error:'Track length unknown yet.' };
      const time = Math.max(0, Math.min(1, frac)) * audio.duration;
      try{ audio.currentTime = time; }catch(e){}
      if(loops[deck] && (time < loops[deck].start || time >= loops[deck].end)) exitLoop(deck);
      updatePlayhead(deck);
      return { ok:true, deck, time };
    }

    function renderLoopRegion(deckInput){
      const deck = validDeck(deckInput);
      const w = doc.getElementById(`wave-${deck}`);
      if(!w) return;
      let el = w.querySelector('.loop-region');
      const loop = loops[deck];
      const audio = deckAudio(deck);
      const dur = audio && audio.duration > 0 ? audio.duration : (peakCache[deckPeakKey[deck]] && peakCache[deckPeakKey[deck]].duration);
      if(!loop || !dur){ if(el) el.remove(); return; }
      if(!el){ el = doc.createElement('div'); el.className = 'loop-region'; waveLayer(w).appendChild(el); }
      el.style.left = `${(loop.start / dur) * 100}%`;
      el.style.width = `${Math.max(0.4, (loop.length / dur) * 100)}%`;
      el.title = `${loop.beats}-beat loop`;
    }

    // ---- Play log / tracklist ----
    function logDeckEvent(type, deckInput, extra){
      const deck = validDeck(deckInput);
      const loaded = state.studioDecks && state.studioDecks[deck] || {};
      const nameEl = doc.getElementById(`name-${deck}`);
      const artistEl = doc.getElementById(`artist-${deck}`);
      const entry = { type, deck, at:now(), title:(extra && extra.title) || loaded.title || (nameEl && nameEl.textContent) || 'Untitled', artist:(extra && extra.artist) || loaded.artist || (artistEl && artistEl.textContent !== '--' ? artistEl.textContent : '') || '' };
      playLog.push(entry);
      if(type === 'play') trackPlayed(deck);
      if(playLog.length > 500) playLog.splice(0, playLog.length - 500);
      return entry;
    }

    async function teardownAudioGraph(){
      ['a','b'].forEach(stopMeterAnimation);
      ['a','b'].forEach(d => { if(shifters[d]){ try{ shifters[d].disconnect(); }catch(e){} shifters[d] = null; } });
      Object.values(sources).forEach(source => { try{ source.disconnect(); }catch(e){} });
      Object.values(gains).forEach(gain => { try{ gain.disconnect(); }catch(e){} });
      Object.values(fx).forEach(chain => ['trim','low','mid','high','analyser'].forEach(k => { try{ chain[k] && chain[k].disconnect(); }catch(e){} }));
      try{ if(masterTap) masterTap.disconnect(); }catch(e){}
      Object.values(fx).forEach(chain => ['filter','mix','echoSend','delay','feedback','reverbSend','convolver','pfl'].forEach(k => { try{ chain[k] && chain[k].disconnect(); }catch(e){} }));
      if(cueBus){ ['cue','master','dest'].forEach(k => { try{ cueBus[k] && cueBus[k].disconnect && cueBus[k].disconnect(); }catch(e){} }); try{ if(cueBus.element){ cueBus.element.pause(); cueBus.element.srcObject = null; } }catch(e){} }
      cueBus = null;
      fx = {}; masterTap = null; masterAnalysers = [];
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
      const layer = waveLayer(w);
      const overview = doc.createElement('div');
      overview.className = 'wave-overview';
      const cached = peakCache[deckPeakKey[deck]];
      if(cached && cached.peaks && cached.peaks.length){
        overview.classList.add('real');
        cached.peaks.forEach(v => {
          const segment = doc.createElement('div');
          segment.className = 'wave-seg';
          segment.style.height = `${Math.max(2, Math.round(v * 100))}%`;
          overview.appendChild(segment);
        });
      }else{
        overview.classList.add('pending');
        const note = doc.createElement('span');
        note.className = 'wave-pending';
        note.textContent = deckPeakKey[deck] ? 'Reading waveform…' : 'No waveform yet';
        overview.appendChild(note);
      }
      layer.appendChild(overview);
      w.onclick = event => {
        if(event.target && event.target.closest && event.target.closest('.hotcue')) return;
        const rect = layer.getBoundingClientRect();
        if(rect.width > 0) seekDeckToFraction(deck, (event.clientX - rect.left) / rect.width);
      };
      const pos = doc.createElement('div');
      pos.className = 'position-marker';
      layer.appendChild(pos);

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
        layer.appendChild(el);
      });
      hotcueSlots(deck).forEach((hotcue, slot) => {
        if(!hotcue) return;
        const el = doc.createElement('div');
        el.className = `hotcue hotcue-${slot + 1}`;
        el.style.background = HOTCUE_COLORS[slot];
        el.title = `Hot cue ${slot + 1}`;
        el.style.left = `${Math.max(1, Math.min(99, hotcuePct(deck, hotcue) * 100))}%`;
        layer.appendChild(el);
      });
      renderLoopRegion(deck);
      updatePlayhead(deck);
      if(win.DJBStudio26 && win.DJBStudio26.waveRendered) try{ win.DJBStudio26.waveRendered(deck); }catch(e){}
    }

    function stopMeterAnimation(deckInput){
      const deck = validDeck(deckInput);
      if(meterIntervals[deck]) delete meterIntervals[deck];
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
      // Real levels come from the deck's AnalyserNode in tick(); nothing random here.
      meterIntervals[deck] = true;
      updateMeters();
      startTick();
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

    const HOTCUE_COLORS = ['#c6ff00', '#00d1ff', '#ff4fa3', '#ffb020'];

    // Normalises saved hotcues into 4 slots. Older entries without a slot fill free slots in order.
    function hotcueSlots(deckInput){
      const deck = validDeck(deckInput);
      state.decks[deck] = state.decks[deck] || { cues:[], hotcues:[] };
      const list = Array.isArray(state.decks[deck].hotcues) ? state.decks[deck].hotcues : [];
      const slots = [null, null, null, null];
      list.filter(h => h && Number.isInteger(h.slot) && h.slot >= 0 && h.slot < 4).forEach(h => { if(!slots[h.slot]) slots[h.slot] = h; });
      list.filter(h => h && !Number.isInteger(h.slot)).forEach(h => {
        const free = slots.indexOf(null);
        if(free >= 0){ h.slot = free; slots[free] = h; }
      });
      state.decks[deck].hotcues = slots.filter(Boolean);
      return slots;
    }

    function hotcuePct(deck, hotcue){
      const audio = deckAudio(deck);
      if(hotcue && isFinite(hotcue.time) && audio && audio.duration > 0) return Math.max(0, Math.min(1, hotcue.time / audio.duration));
      return hotcue && isFinite(hotcue.pct) ? hotcue.pct : 0.05;
    }

    function setHotcueSlot(deckInput, slot){
      const deck = validDeck(deckInput);
      const audio = deckAudio(deck);
      const time = audio ? Math.round((audio.currentTime || 0) * 1000) / 1000 : 0;
      const pct = audio && audio.duration > 0 ? Math.max(0, Math.min(1, time / audio.duration)) : 0;
      hotcueSlots(deck);
      state.decks[deck].hotcues = state.decks[deck].hotcues.filter(h => h.slot !== slot).concat([{ slot, time, pct, created:now() }]);
      persistDecks();
      renderHotcuePads(deck);
      renderWaveformForDeck(deck, {});
      return { ok:true, deck, slot, time };
    }

    function clearHotcueSlot(deckInput, slot){
      const deck = validDeck(deckInput);
      hotcueSlots(deck);
      state.decks[deck].hotcues = state.decks[deck].hotcues.filter(h => h.slot !== slot);
      persistDecks();
      renderHotcuePads(deck);
      renderWaveformForDeck(deck, {});
      return { ok:true, deck, slot };
    }

    function triggerHotcue(deckInput, slot){
      const deck = validDeck(deckInput);
      const hotcue = hotcueSlots(deck)[slot];
      if(!hotcue) return setHotcueSlot(deck, slot);
      const audio = deckAudio(deck);
      let time = isFinite(hotcue.time) ? hotcue.time : null;
      if(time == null && audio && audio.duration > 0) time = (hotcue.pct || 0) * audio.duration;
      if(audio && time != null){
        try{ audio.currentTime = time; }catch(e){}
        try{ const p = audio.play && audio.play(); if(p && p.catch) p.catch(()=>{}); }catch(e){}
      }
      return { ok:true, deck, slot, jumped:true, time };
    }

    function formatCueTime(seconds){
      const s = Math.max(0, Math.floor(Number(seconds) || 0));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    function renderHotcuePads(deckInput){
      const deck = validDeck(deckInput);
      const wrap = doc.getElementById(`hotcue-pads-${deck}`);
      if(!wrap) return;
      const slots = hotcueSlots(deck);
      wrap.innerHTML = slots.map((hotcue, slot) => `<button type="button" class="hotcue-pad ${hotcue ? 'set' : 'empty'}" data-hotcue-pad="${slot}" style="--pad:${HOTCUE_COLORS[slot]}" title="${hotcue ? 'Tap to jump. Right-click or hold to clear.' : 'Tap to set at the current position.'}"><b>${slot + 1}</b><small>${hotcue ? (isFinite(hotcue.time) ? formatCueTime(hotcue.time) : 'Set') : 'Empty'}</small></button>`).join('');
      wrap.querySelectorAll('[data-hotcue-pad]').forEach(button => {
        const slot = Number(button.dataset.hotcuePad);
        let holdTimer = null;
        let held = false;
        button.onclick = () => { if(held){ held = false; return; } triggerHotcue(deck, slot); };
        button.oncontextmenu = event => { event.preventDefault(); clearHotcueSlot(deck, slot); };
        button.onpointerdown = () => { held = false; holdTimer = setTimeout(() => { held = true; clearHotcueSlot(deck, slot); }, 600); };
        button.onpointerup = button.onpointerleave = () => { if(holdTimer) clearTimeout(holdTimer); holdTimer = null; };
      });
    }

    function renderMixesWellNext(deckInput){
      const deck = validDeck(deckInput);
      const wrap = doc.getElementById(`mixes-next-${deck}`);
      if(!wrap) return { matches:[] };
      const loaded = state.studioDecks && state.studioDecks[deck];
      if(!loaded || !loaded.trackId){ wrap.innerHTML = ''; return { matches:[] }; }
      const base = deps.getLibraryTrackById(loaded.trackId);
      const otherDeck = deck === 'a' ? 'b' : 'a';
      const hasBpm = base && deps.parseBpm && deps.parseBpm(base);
      const hasKey = base && base.key && !['--', '—', ''].includes(String(base.key));
      if(!base || !hasBpm || !hasKey){
        wrap.innerHTML = `<span class="eyebrow">MIXES WELL NEXT</span><small class="mixes-next-empty">Add BPM and key to this track in the Library to see matches.</small>`;
        return { matches:[], empty:'no-data' };
      }
      const shifted = keyShift[deck] ? shiftedKey(deck) : '';
      const matchBase = shifted ? { ...base, key:shifted, camelotKey:shifted } : base;
      const matches = deps.compatibleTracksFor(matchBase).filter(t => t.libraryId !== base.libraryId).slice(0, 5);
      if(!matches.length){
        wrap.innerHTML = `<span class="eyebrow">MIXES WELL NEXT</span><small class="mixes-next-empty">No tracks in your library match this BPM and key yet.</small>`;
        return { matches:[], empty:'no-matches' };
      }
      wrap.innerHTML = `<span class="eyebrow">MIXES WELL NEXT${shifted ? ` (KEY ${esc(shifted)})` : ''}</span><div class="mixes-next-list">${matches.map(t => `<button type="button" class="mixes-next-item" data-mix-next="${esc(t.libraryId)}" title="Load onto Deck ${otherDeck.toUpperCase()}"><span><strong>${esc(deps.trackTitle(t))}</strong><small>${esc(deps.parseBpm(t) || '--')} BPM / ${esc(t.key || '--')}</small></span><em>&rarr; ${otherDeck.toUpperCase()}</em></button>`).join('')}</div>`;
      wrap.querySelectorAll('[data-mix-next]').forEach(button => button.onclick = () => loadLibraryTrackToDeck(button.dataset.mixNext, otherDeck));
      return { matches };
    }

    function addHotcue(deckInput){
      const deck = validDeck(deckInput);
      const audio = deckAudio(deck);
      let pct = 0.05;
      if(audio && audio.duration > 0) pct = Math.max(0, Math.min(1, (audio.currentTime || 0) / audio.duration));
      state.decks[deck] = state.decks[deck] || { cues:[], hotcues:[] };
      const free = hotcueSlots(deck).indexOf(null);
      if(free < 0) return { ok:false, deck, error:'All 4 hot cues are set. Clear one first.' };
      state.decks[deck].hotcues.push({ slot:free, pct, time:audio ? Math.round((audio.currentTime || 0) * 1000) / 1000 : 0, created:now() });
      persistDecks();
      renderDeckCues(deck);
      renderHotcuePads(deck);
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
        if(bpmEl){
          bpmEl.textContent = rec.bpm || '--';
          bpmEl.dataset.trackBpm = parseFloat(rec.bpm) > 0 ? String(parseFloat(rec.bpm)) : '';
          if(rec.bpmSource === 'detected' && parseFloat(rec.bpm) > 0) bpmEl.innerHTML = `${esc(rec.bpm)} <span class="bpm-detected-tag" title="Detected from the audio. Edit in the Library to override.">Detected</span>`;
        }
        detectedBpm[deck] = null;
        syncRate[deck] = null;
        loops[deck] = null;
        rolls[deck] = null; slipState[deck] = null; playCounted[deck] = false;
        baseKey[deck] = rec.key || rec.camelotKey || '';
        if(keyShift[deck]){ keyShift[deck] = 0; const ratio = shifters[deck] && shifters[deck].parameters && shifters[deck].parameters.get && shifters[deck].parameters.get('ratio'); if(ratio) ratio.value = 1; }
        if(keyEl) keyEl.innerHTML = deps.keyBadgeHtml ? deps.keyBadgeHtml(rec.key || rec.camelotKey || '--') : esc(rec.key || rec.camelotKey || '--');
        if(timeEl) timeEl.textContent = rec.dur || '0:00';
        if(artEl) artEl.innerHTML = rec.artwork ? `<img src="${esc(rec.artwork)}" alt="${esc(rec.title)} artwork" style="width:100%;height:100%;object-fit:cover">` : esc(rec.source || '');

        const audio = deckAudio(deck);
        if(audio && rec.libraryId && deps.getLibraryTrackById && deps.securePlaybackSource){
          const track = deps.getLibraryTrackById(rec.libraryId);
          const src = deps.securePlaybackSource(track);
          if(src) audio.setAttribute('src', src);
        }
        const peakKey = rec.libraryId ? `lib:${rec.libraryId}` : (audio && audio.getAttribute('src') ? `src:${audio.getAttribute('src')}` : '');
        const peakSrc = audio && audio.getAttribute('src');
        deckPeakKey[deck] = peakKey;
        if(peakKey && peakSrc && win.fetch && !isJsdom()) loadDeckPeaks(deck, peakKey, () => win.fetch(peakSrc).then(r => r.arrayBuffer()));

        const deckEl = doc.querySelector(`.deck[data-deck="${deck}"]`);
        if(deckEl) deckEl.dataset.loaded = '1';
        if(deckEl && rec.libraryId) deckEl.dataset.libraryTrackId = rec.libraryId;
        renderWaveformForDeck(deck, rec);
        startMeterAnimation(deck);
        renderDeckCues(deck);
        renderHotcuePads(deck);
        applyPitch(deck);
        updateDeckButtons(deck);
        if(audio && !audio.paused) logDeckEvent('play', deck, rec);
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
      renderMixesWellNext(deck);
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
      if(state.studioDecks) state.studioDecks[deck] = { title:file.name, artist:'', bpm:null, loadedAt:new Date(now()).toISOString(), local:true };
      const bpmEl = doc.getElementById(`bpm-${deck}`);
      if(bpmEl){ bpmEl.textContent = '--'; bpmEl.dataset.trackBpm = ''; }
      syncRate[deck] = null; loops[deck] = null;
      const key = `file:${file.name}:${file.size}:${file.lastModified || 0}`;
      deckPeakKey[deck] = key;
      renderWaveformForDeck(deck, {});
      updateDeckButtons(deck);
      if(typeof file.arrayBuffer === 'function' && !isJsdom()) loadDeckPeaks(deck, key, () => file.arrayBuffer());
      return { ok:true, deck, file };
    }

    async function playDeck(deckInput){
      const deck = validDeck(deckInput);
      try{
        ensureAudioGraph();
        if(audioCtx && audioCtx.resume) await audioCtx.resume();
        const audio = deckAudio(deck);
        if(!audio) return { ok:false, error:'Deck audio element is unavailable.' };
        if(audio.paused){ await audio.play(); logDeckEvent('play', deck); }
        else { audio.pause(); logDeckEvent('pause', deck); }
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
        if(cueBtn) cueBtn.onclick = () => { if(pointerCue[deck]){ pointerCue[deck] = false; return; } resetDeckCue(deck); };
        if(cueBtn){
          cueBtn.onpointerdown = () => { if(!slipOn[deck]) return; pointerCue[deck] = true; cueSlipStart(deck); };
          cueBtn.onpointerup = cueBtn.onpointercancel = cueBtn.onpointerleave = () => { if(slipState[deck] && slipState[deck].reason === 'cue') slipEnd(deck); };
        }
        renderPerfControls(deck);
        const setCueBtn = doc.querySelector(`[data-set-cue="${deck}"]`);
        if(setCueBtn) setCueBtn.onclick = () => setCue(deck);
        const hotcueBtn = doc.querySelector(`[data-hotcue="${deck}"]`);
        if(hotcueBtn) hotcueBtn.onclick = () => addHotcue(deck);
        const pitch = doc.getElementById(`pitch-${deck}`);
        if(pitch) pitch.oninput = () => { syncRate[deck] = null; applyPitch(deck); updateDeckButtons(deck); };
        if(pitch) pitch.ondblclick = () => { syncRate[deck] = null; pitch.value = '1'; applyPitch(deck); updateDeckButtons(deck); };
        const syncBtn = doc.querySelector(`[data-sync="${deck}"]`);
        if(syncBtn) syncBtn.onclick = event => { if(event && event.stopPropagation) event.stopPropagation(); const r = syncDeck(deck); if(!r.ok && deps.setStudioRuleStatus) deps.setStudioRuleStatus(r.error, 'denied'); };
        const keyBtn = doc.querySelector(`[data-keylock="${deck}"]`);
        if(keyBtn) keyBtn.onclick = () => toggleKeyLock(deck);
        const loopBtn = doc.querySelector(`[data-loop="${deck}"]`);
        if(loopBtn) loopBtn.onclick = () => { const r = toggleLoop(deck); if(!r.ok && deps.setStudioRuleStatus) deps.setStudioRuleStatus(r.error, 'denied'); };
        const sizeSel = doc.getElementById(`loop-size-${deck}`);
        if(sizeSel) sizeSel.onchange = () => setLoopSize(deck, sizeSel.value);
        Object.keys(MIXER_DEFAULTS).forEach(band => {
          const el = doc.getElementById(mixerInputId(deck, band));
          if(!el) return;
          el.oninput = () => applyChannelFx(deck);
          el.ondblclick = () => resetMixerControl(deck, band);
        });
        ['high','mid','low'].forEach(band => {
          const btn = doc.querySelector(`[data-eq-kill="${band}"][data-deck="${deck}"]`);
          if(btn) btn.onclick = event => { if(event){ if(event.preventDefault) event.preventDefault(); if(event.stopPropagation) event.stopPropagation(); } toggleEqKill(deck, band); };
        });
        ['filter','echo-beats','echo-wet','reverb-wet'].forEach(id => {
          const el = doc.getElementById(`${id}-${deck}`);
          if(!el) return;
          el.oninput = () => applySendFx(deck);
          el.onchange = () => applySendFx(deck);
        });
        const filterEl = doc.getElementById(`filter-${deck}`);
        if(filterEl) filterEl.ondblclick = () => { filterEl.value = '0'; applySendFx(deck); };
        const pflBtn = doc.querySelector(`[data-pfl="${deck}"]`);
        if(pflBtn) pflBtn.onclick = event => { if(event && event.stopPropagation) event.stopPropagation(); togglePfl(deck); };
        applyChannelFx(deck);
        updateDeckButtons(deck);
        const vol = doc.getElementById(`vol-${deck}`);
        if(vol) vol.oninput = applyMix;
        const audio = deckAudio(deck);
        if(audio){
          audio.ontimeupdate = () => updateDeckTime(deck);
          // Loading a new src resets playbackRate, so re-apply pitch.
          audio.addEventListener('loadedmetadata', () => { applyPitch(deck); renderHotcuePads(deck); renderLoopRegion(deck); updatePlayhead(deck); });
          audio.addEventListener('ended', () => logDeckEvent('pause', deck));
        }
        renderHotcuePads(deck);
      });
      applyMix();
      const xfader = doc.getElementById('xfader');
      if(xfader) xfader.oninput = applyMix;
      const cueKnob = doc.getElementById('cue-mix');
      if(cueKnob) cueKnob.oninput = applyCue;
      const hpSelect = doc.getElementById('headphone-output');
      if(hpSelect) hpSelect.onchange = () => setHeadphoneDevice(hpSelect.value);
      const hpRefresh = doc.getElementById('headphone-refresh');
      if(hpRefresh) hpRefresh.onclick = () => refreshHeadphoneDevices();
      applyCue();
      renderHeadphoneUi();
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
        meterCount:Object.keys(meterIntervals).length,
        fxCount:Object.keys(fx).length,
        masterMeter:Boolean(masterTap)
      };
    }

    return {
      applyMix,
      setDuck,
      getDuck:() => duckLevel,
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
      hotcueSlots,
      setHotcueSlot,
      clearHotcueSlot,
      triggerHotcue,
      renderHotcuePads,
      renderMixesWellNext,
      applyPitch,
      crossfadeCurve,
      persistDecks,
      loadLocalFileToDeck,
      playDeck,
      wireControls,
      diagnostics,
      syncDeck,
      toggleKeyLock,
      toggleLoop,
      setLoopSize,
      exitLoop,
      enforceLoop,
      getLoop:deck => loops[validDeck(deck)],
      getKeyLock:deck => keyLock[validDeck(deck)],
      trackBpm,
      effectiveBpm,
      updateDeckButtons,
      applyChannelFx,
      resetMixerControl,
      toggleEqKill,
      eqKillState,
      formatMixerValue,
      levelsFromSamples,
      meterFraction,
      deckLevels,
      masterLevels,
      updateMeters,
      computePeaks,
      setDeckPeaks,
      loadDeckPeaks,
      seekDeckToFraction,
      getPeakCacheKeys:() => Object.keys(peakCache),
      logDeckEvent,
      getPlayLog:() => playLog.slice(),
      tracklistBetween:(start, end) => buildTracklist(playLog, start, end),
      applySendFx,
      togglePfl,
      applyCue,
      setHeadphoneDevice,
      refreshHeadphoneDevices,
      renderHeadphoneUi,
      applyDetectedBpm,
      getDetectedBpm:deck => detectedBpm[validDeck(deck)],
      getChain:deck => fx[validDeck(deck)] || null,
      getCueBus:() => cueBus,
      beatJump, setJumpSize, getJumpSize:deck => jumpSize[validDeck(deck)],
      rollStart, rollEnd, getRoll:deck => rolls[validDeck(deck)],
      toggleSlip, getSlip:deck => slipOn[validDeck(deck)], slipBegin, slipEnd, slipPosition, isSlipping:deck => Boolean(slipState[validDeck(deck)]),
      setKeyShift, nudgeKeyShift, getKeyShift:deck => keyShift[validDeck(deck)], shiftedKey, renderPerfControls, updatePerfButtons
    };
  }

  // Pure: tracklist for a recording from the deck play log. Tracks already playing at start get 0:00.
  function buildTracklist(log, startMs, endMs){
    const events = (Array.isArray(log) ? log : []).slice().sort((x, y) => x.at - y.at);
    const playing = {};
    const out = [];
    const push = (ms, e) => {
      const last = out[out.length - 1];
      if(last && last.title === e.title && last.artist === e.artist) return;
      out.push({ ms:Math.max(0, ms), title:e.title, artist:e.artist || '', deck:e.deck });
    };
    events.forEach(e => {
      if(e.at < startMs){
        if(e.type === 'play') playing[e.deck] = e; else if(e.type === 'pause') delete playing[e.deck];
      }
    });
    Object.values(playing).sort((x, y) => x.at - y.at).forEach(e => push(0, e));
    events.filter(e => e.at >= startMs && (endMs == null || e.at <= endMs) && e.type === 'play').forEach(e => push(e.at - startMs, e));
    return out;
  }

  function formatTracklistTime(ms){
    const s = Math.floor(Math.max(0, ms) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
  }

  function tracklistText(list){
    return (list || []).map(t => `${formatTracklistTime(t.ms)} ${t.title}${t.artist ? ` - ${t.artist}` : ''}`).join('\n');
  }

  global.DJBattleDeckRuntime = { create:createDeckRuntime, buildTracklist, formatTracklistTime, tracklistText };
})(typeof window !== 'undefined' ? window : globalThis);

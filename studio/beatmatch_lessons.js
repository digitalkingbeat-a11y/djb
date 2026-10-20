// Oct 20b: Beatmatching lessons in Battle Studio → Learn. Four short hands-on lessons (tempo
// match, beat alignment, a clean transition, an EQ bass swap). Every sound here is synthesized
// live in the browser with the Web Audio API (sine-sweep kicks, noise hi-hats, a sine bass line):
// no recordings or samples are used, so there is nothing copyrighted and nothing to license.
// The graders are pure functions so they can be tested without audio.
(function(){
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;

  /* ------------------------------ graders ------------------------------ */
  const TEMPO_TOLERANCE_BPM = 0.3;
  const ALIGN_TOLERANCE_MS = 15;
  // 1) Tempo: is the moving deck within 0.3 BPM of the reference?
  function gradeTempo(targetBpm, userBpm){
    const diff = Math.round((Number(userBpm) - Number(targetBpm)) * 100) / 100;
    const pass = Math.abs(diff) <= TEMPO_TOLERANCE_BPM;
    const tip = pass ? 'Locked in. The kicks stay together bar after bar.'
      : diff > 0 ? `About ${Math.abs(diff).toFixed(1)} BPM too fast. Your kicks run ahead of the other deck, so slow the pitch down a touch.`
        : `About ${Math.abs(diff).toFixed(1)} BPM too slow. Your kicks drag behind, so push the pitch up a touch.`;
    return { pass, diff, tip, toleranceBpm:TEMPO_TOLERANCE_BPM };
  }
  // Offsets wrap around the beat: being 490 ms late at 120 BPM is the same as 10 ms early.
  function wrapOffsetMs(offsetMs, bpm){
    const beat = 60000 / Number(bpm);
    let o = ((Number(offsetMs) % beat) + beat) % beat;
    if(o > beat / 2) o -= beat;
    return Math.round(o * 10) / 10;
  }
  // 2) Alignment: are the two decks' kicks within 15 ms of each other?
  function gradeAlignment(offsetMs, bpm){
    const o = wrapOffsetMs(offsetMs, bpm);
    const pass = Math.abs(o) <= ALIGN_TOLERANCE_MS;
    const tip = pass ? 'Tight. The two kicks sound like one.'
      : Math.abs(o) > 60 ? `Way off (${Math.round(Math.abs(o))} ms): you hear two separate kicks, a "flam". ${o > 0 ? 'Slow your deck for a moment (drag the platter back).' : 'Nudge your deck forward.'}`
        : `Close, ${Math.round(Math.abs(o))} ms ${o > 0 ? 'late' : 'early'}. ${o > 0 ? 'Nudge back' : 'Nudge forward'} just a little.`;
    return { pass, offsetMs:o, tip, toleranceMs:ALIGN_TOLERANCE_MS };
  }
  // 3) Transition. samples = [{ beat, x }] with x the crossfader (0 = deck A, 1 = deck B).
  function gradeTransition(samples){
    const pts = (Array.isArray(samples) ? samples : []).filter(p => Number.isFinite(p.beat) && Number.isFinite(p.x)).sort((a, b) => a.beat - b.beat);
    if(pts.length < 2) return { pass:false, tip:'Move the crossfader from deck A over to deck B while the lesson plays.' };
    const start = pts.find(p => p.x >= 0.1);
    const end = pts.find(p => p.x >= 0.9);
    const last = pts[pts.length - 1];
    let reversal = 0, peak = 0;
    pts.forEach(p => { peak = Math.max(peak, p.x); reversal = Math.max(reversal, peak - p.x); });
    if(!start || !end || last.x < 0.95) return { pass:false, tip:'Finish the move: the crossfader should end all the way on deck B.' };
    const length = end.beat - start.beat;
    const startBar = start.beat / 4;
    const onPhrase = Math.abs(startBar - Math.round(startBar / 4) * 4) <= 0.5; // start near a 4-bar phrase line
    if(length < 4) return { pass:false, length, tip:'Too fast. That was a slam cut. Spread the move over at least one bar (4 beats).' };
    if(length > 32) return { pass:false, length, tip:'Too slow. Both tracks played together for over 8 bars and it gets muddy. Aim for 1 to 8 bars.' };
    if(reversal > 0.2) return { pass:false, length, tip:'The fader went back and forth. Keep it moving one way, towards deck B.' };
    if(!onPhrase) return { pass:false, length, tip:'Smooth move, but start it on a phrase: count 4 bars and begin right on the "1".' };
    return { pass:true, length, tip:`Clean ${Math.round(length / 4 * 10) / 10}-bar blend that started on the phrase.` };
  }
  // 4) EQ swap. samples = [{ beat, a, b }] with a/b each deck's low (bass) EQ, 0 = cut, 1 = full.
  function gradeEqSwap(samples){
    const pts = (Array.isArray(samples) ? samples : []).filter(p => Number.isFinite(p.beat)).sort((x, y) => x.beat - y.beat);
    if(pts.length < 2) return { pass:false, tip:'Swap the bass: bring deck B\u2019s low up and deck A\u2019s low down.' };
    let clash = 0, gap = 0;
    for(let i = 1; i < pts.length; i++){
      const dt = pts[i].beat - pts[i - 1].beat;
      const p = pts[i - 1];
      if(p.a > 0.5 && p.b > 0.5) clash += dt;
      if(p.a < 0.25 && p.b < 0.25) gap += dt;
    }
    const last = pts[pts.length - 1];
    if(!(last.a <= 0.15 && last.b >= 0.85)) return { pass:false, clashBeats:clash, tip:'End with deck A\u2019s bass fully cut and deck B\u2019s bass fully up.' };
    const swap = pts.find(p => p.b > 0.5);
    const swapOffBar = swap ? Math.abs(swap.beat / 4 - Math.round(swap.beat / 4)) * 4 : 4;
    if(clash > 1) return { pass:false, clashBeats:clash, tip:`Both basslines played together for ${Math.round(clash * 10) / 10} beats, which muddies it. Cut A\u2019s bass at the same moment you bring B\u2019s in.` };
    if(gap > 2) return { pass:false, gapBeats:gap, tip:'There was a hole with no bass at all. Do the swap in one quick move.' };
    if(swapOffBar > 0.5) return { pass:false, tip:'Good swap, but do it right on the "1" of a bar so it lands with the kick.' };
    return { pass:true, clashBeats:clash, tip:'Clean swap on the bar. Only one bassline at a time.' };
  }

  /* ------------------------------ synthesized loops ------------------------------ */
  // A loop player that schedules synthesized drums (and optionally a bass line) ahead of time.
  function createLoop(ctx, dest, opts){
    const state = { bpm:opts.bpm, startAt:0, timer:null, nextBeat:0, offsetSec:(opts.offsetMs || 0) / 1000, gain:ctx.createGain(), low:ctx.createBiquadFilter(), started:false };
    state.low.type = 'lowshelf'; state.low.frequency.value = 220; state.low.gain.value = 0;
    state.gain.connect(state.low); state.low.connect(dest);
    const noise = (() => { const b = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate); const d = b.getChannelData(0); for(let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; })();
    function kick(t){ const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(opts.kickHz || 150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(g); g.connect(state.gain); o.start(t); o.stop(t + 0.32); }
    function hat(t){ const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = noise; f.type = 'highpass'; f.frequency.value = opts.hatHz || 7000; g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); s.connect(f); f.connect(g); g.connect(state.gain); s.start(t); s.stop(t + 0.06); }
    function bass(t, beat){ if(!opts.bass) return; const notes = opts.bass; const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = notes[Math.floor(beat) % notes.length]; g.gain.setValueAtTime(0.0001, t + 0.5 * 60 / state.bpm); g.gain.exponentialRampToValueAtTime(0.5, t + 0.55 * 60 / state.bpm); g.gain.exponentialRampToValueAtTime(0.001, t + 0.95 * 60 / state.bpm); o.connect(g); g.connect(state.gain); o.start(t); o.stop(t + 60 / state.bpm); }
    function tick(){
      const spb = 60 / state.bpm;
      while(state.started && state.nextTime < ctx.currentTime + 0.2){
        kick(state.nextTime); hat(state.nextTime + spb / 2); bass(state.nextTime, state.nextBeat);
        state.nextBeat += 1; state.nextTime += spb;
      }
    }
    return {
      start(at){ state.started = true; state.nextTime = at + state.offsetSec; state.nextBeat = 0; tick(); state.timer = setInterval(tick, 50); },
      stop(){ state.started = false; clearInterval(state.timer); try{ state.gain.disconnect(); }catch(e){} },
      setBpm(b){ state.bpm = b; },
      nudge(ms){ state.nextTime += ms / 1000; },
      setVolume(v){ state.gain.gain.setTargetAtTime(v, ctx.currentTime, 0.01); },
      setLow(v){ state.low.gain.setTargetAtTime(v >= 1 ? 0 : -40 * (1 - v), ctx.currentTime, 0.01); },
      state
    };
  }

  /* ------------------------------ lessons UI ------------------------------ */
  const LESSONS = [
    { id:'tempo', title:'1. Match the tempo', blurb:'Deck A plays at a fixed BPM. Move deck B\u2019s pitch slider until the two kick drums stay together, then press Check.' },
    { id:'align', title:'2. Line up the beats', blurb:'Same tempo, but deck B\u2019s kick is off. Use the nudge buttons until both kicks hit as one, then press Check.' },
    { id:'transition', title:'3. Clean transition', blurb:'Press Start, count the bars, and move the crossfader from A to B over 1 to 8 bars, starting on a 4-bar phrase.' },
    { id:'eq', title:'4. EQ bass swap', blurb:'Both decks have a bassline. Swap them on the "1" of a bar: cut A\u2019s bass at the same moment you bring B\u2019s in.' }
  ];
  const lesson = { current:'tempo', ctx:null, loops:[], startTime:0, samples:[], targetBpm:124, userBpm:120, offsetMs:0, x:0, lowA:1, lowB:0, results:{}, timer:null };
  const DONE_KEY = 'djbLessonsDone';
  function doneSet(){ try{ return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]')); }catch(e){ return new Set(); } }
  function markDone(id){ const s = doneSet(); s.add(id); try{ localStorage.setItem(DONE_KEY, JSON.stringify([...s])); }catch(e){} }
  const rand = (a, b) => a + Math.random() * (b - a);
  function resetLesson(id){
    stopAudio();
    lesson.current = id; lesson.samples = []; lesson.x = 0; lesson.lowA = 1; lesson.lowB = 0;
    lesson.targetBpm = Math.round(rand(118, 128));
    lesson.userBpm = id === 'tempo' ? Math.round((lesson.targetBpm + (Math.random() < 0.5 ? -1 : 1) * rand(2.5, 6)) * 10) / 10 : lesson.targetBpm;
    lesson.offsetMs = id === 'align' ? Math.round((Math.random() < 0.5 ? -1 : 1) * rand(60, 180)) : 0;
    delete lesson.results[id];
  }
  function currentBeat(){ return lesson.ctx ? (lesson.ctx.currentTime - lesson.startTime) * lesson.targetBpm / 60 : 0; }
  function startAudio(){
    const AC = W.AudioContext || W.webkitAudioContext;
    if(!AC) return false;
    stopAudio();
    lesson.ctx = lesson.ctx || new AC();
    if(lesson.ctx.resume) lesson.ctx.resume();
    const ctx = lesson.ctx; const out = ctx.destination;
    const a = createLoop(ctx, out, { bpm:lesson.targetBpm, kickHz:150, hatHz:8000, bass:lesson.current === 'eq' ? [55, 55, 65.4, 49] : null });
    const b = createLoop(ctx, out, { bpm:lesson.userBpm, offsetMs:lesson.offsetMs, kickHz:120, hatHz:5000, bass:lesson.current === 'eq' ? [73.4, 73.4, 82.4, 61.7] : null });
    const t = ctx.currentTime + 0.1;
    lesson.startTime = t;
    a.start(t); b.start(t);
    if(lesson.current === 'transition'){ a.setVolume(1); b.setVolume(0); }
    if(lesson.current === 'eq'){ a.setLow(1); b.setLow(0); }
    lesson.loops = [a, b];
    lesson.samples = [];
    if(lesson.current === 'transition' || lesson.current === 'eq'){
      lesson.timer = setInterval(() => { record(); const beatEl = document.getElementById('lesson-beat'); if(beatEl){ const beat = Math.max(0, currentBeat()); beatEl.textContent = `Bar ${Math.floor(beat / 4) + 1} · beat ${Math.floor(beat % 4) + 1}`; } if(currentBeat() > 64) finishTimed(); }, 60);
    }
    return true;
  }
  function stopAudio(){ lesson.loops.forEach(l => l.stop()); lesson.loops = []; clearInterval(lesson.timer); lesson.timer = null; }
  function record(){
    if(!lesson.ctx) return;
    const beat = currentBeat();
    if(beat < 0) return;
    lesson.samples.push(lesson.current === 'eq' ? { beat, a:lesson.lowA, b:lesson.lowB } : { beat, x:lesson.x });
  }
  function finishTimed(){ stopAudio(); check(); }
  function check(){
    const id = lesson.current;
    const r = id === 'tempo' ? gradeTempo(lesson.targetBpm, lesson.userBpm)
      : id === 'align' ? gradeAlignment(lesson.offsetMs, lesson.targetBpm)
        : id === 'transition' ? gradeTransition(lesson.samples) : gradeEqSwap(lesson.samples);
    lesson.results[id] = r;
    if(r.pass) markDone(id);
    render();
    return r;
  }
  function controlsFor(id){
    if(id === 'tempo') return `<div class="lesson-row"><span>Deck A: <strong>${lesson.targetBpm.toFixed(1)} BPM</strong></span><label>Deck B pitch <input type="range" id="lesson-pitch" min="${lesson.targetBpm - 8}" max="${lesson.targetBpm + 8}" step="0.1" value="${lesson.userBpm}" aria-label="Deck B tempo"></label><button class="ghost small" type="button" data-pitch="-0.1">−0.1</button><button class="ghost small" type="button" data-pitch="0.1">+0.1</button></div><p class="social-note">Listen, don\u2019t look: the BPM number for deck B is hidden on purpose.</p>`;
    if(id === 'align') return `<div class="lesson-row"><span>Both decks at <strong>${lesson.targetBpm} BPM</strong></span><button class="ghost small" type="button" data-nudge="-20">« Nudge back</button><button class="ghost small" type="button" data-nudge="-5">‹</button><button class="ghost small" type="button" data-nudge="5">›</button><button class="ghost small" type="button" data-nudge="20">Nudge forward »</button></div>`;
    if(id === 'transition') return `<div class="lesson-row"><span>A</span><input type="range" id="lesson-xfader" min="0" max="1" step="0.01" value="${lesson.x}" aria-label="Crossfader"><span>B</span><strong id="lesson-beat" class="lesson-beat">Bar 1 · beat 1</strong></div>`;
    return `<div class="lesson-row"><label>Deck A bass <input type="range" id="lesson-low-a" min="0" max="1" step="0.01" value="${lesson.lowA}" aria-label="Deck A low EQ"></label><label>Deck B bass <input type="range" id="lesson-low-b" min="0" max="1" step="0.01" value="${lesson.lowB}" aria-label="Deck B low EQ"></label><button class="ghost small" type="button" id="lesson-swap">Swap now</button><strong id="lesson-beat" class="lesson-beat">Bar 1 · beat 1</strong></div>`;
  }
  function render(){
    const host = document.getElementById('studio-lessons');
    if(!host) return null;
    const esc = s => String(s == null ? '' : s).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
    const done = doneSet();
    const meta = LESSONS.find(l => l.id === lesson.current);
    const r = lesson.results[lesson.current];
    const timed = lesson.current === 'transition' || lesson.current === 'eq';
    host.innerHTML = `<div class="lesson-head"><div><span class="eyebrow accent">LEARN</span><h3>Beatmatching lessons</h3><p class="social-note">Short hands-on drills with pass/tip feedback. ${done.size}/4 passed. All sounds are generated live in your browser, no recordings.</p></div></div>
      <div class="lesson-tabs" role="tablist">${LESSONS.map(l => `<button type="button" role="tab" class="lesson-tab${l.id === lesson.current ? ' active' : ''}" aria-selected="${l.id === lesson.current}" data-lesson="${l.id}">${done.has(l.id) ? '✅ ' : ''}${esc(l.title)}</button>`).join('')}</div>
      <div class="lesson-body"><p>${esc(meta.blurb)}</p>${controlsFor(lesson.current)}
      <div class="lesson-actions"><button class="primary small" type="button" id="lesson-play">${lesson.loops.length ? '■ Stop' : timed ? '▶ Start' : '▶ Play'}</button>${timed ? '' : '<button class="ghost small" type="button" id="lesson-check">Check</button>'}<button class="ghost small" type="button" id="lesson-reset">New round</button></div>
      <div class="lesson-result ${r ? (r.pass ? 'pass' : 'tip') : ''}" id="lesson-result" aria-live="polite">${r ? `<strong>${r.pass ? 'PASS' : 'TIP'}</strong> ${esc(r.tip)}` : ''}</div></div>`;
    host.querySelectorAll('[data-lesson]').forEach(b => { b.onclick = () => { resetLesson(b.dataset.lesson); render(); }; });
    host.querySelector('#lesson-play').onclick = () => { if(lesson.loops.length){ if(timed) finishTimed(); else { stopAudio(); render(); } } else { startAudio(); render(); } };
    const c = host.querySelector('#lesson-check'); if(c) c.onclick = () => check();
    host.querySelector('#lesson-reset').onclick = () => { resetLesson(lesson.current); render(); };
    const pitch = host.querySelector('#lesson-pitch');
    const setBpm = v => { lesson.userBpm = Math.round(v * 10) / 10; if(lesson.loops[1]) lesson.loops[1].setBpm(lesson.userBpm); if(pitch) pitch.value = lesson.userBpm; };
    if(pitch) pitch.oninput = () => setBpm(Number(pitch.value));
    host.querySelectorAll('[data-pitch]').forEach(b => { b.onclick = () => setBpm(lesson.userBpm + Number(b.dataset.pitch)); });
    host.querySelectorAll('[data-nudge]').forEach(b => { b.onclick = () => { const ms = Number(b.dataset.nudge); lesson.offsetMs += ms; if(lesson.loops[1]) lesson.loops[1].nudge(ms); }; });
    const xf = host.querySelector('#lesson-xfader');
    if(xf) xf.oninput = () => { lesson.x = Number(xf.value); if(lesson.loops.length){ lesson.loops[0].setVolume(Math.cos(lesson.x * Math.PI / 2)); lesson.loops[1].setVolume(Math.sin(lesson.x * Math.PI / 2)); } record(); };
    const la = host.querySelector('#lesson-low-a'), lb = host.querySelector('#lesson-low-b');
    const applyLows = () => { if(lesson.loops.length){ lesson.loops[0].setLow(lesson.lowA); lesson.loops[1].setLow(lesson.lowB); } record(); };
    if(la) la.oninput = () => { lesson.lowA = Number(la.value); applyLows(); };
    if(lb) lb.oninput = () => { lesson.lowB = Number(lb.value); applyLows(); };
    const sw = host.querySelector('#lesson-swap');
    if(sw) sw.onclick = () => { lesson.lowA = 0; lesson.lowB = 1; if(la) la.value = 0; if(lb) lb.value = 1; applyLows(); };
    return host;
  }
  function mount(){
    const studio = document.getElementById('studio');
    if(!studio) return null;
    let host = document.getElementById('studio-lessons');
    if(!host){ host = document.createElement('section'); host.id = 'studio-lessons'; host.className = 'panel studio-lessons'; studio.appendChild(host); }
    return render();
  }
  W.DJBLessons = { LESSONS, gradeTempo, gradeAlignment, gradeTransition, gradeEqSwap, wrapOffsetMs, createLoop, mount, render, check, reset:resetLesson, state:() => lesson, doneSet, TEMPO_TOLERANCE_BPM, ALIGN_TOLERANCE_MS };
  if(typeof document !== 'undefined'){ if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { resetLesson('tempo'); mount(); }); else { resetLesson('tempo'); mount(); } }
})();

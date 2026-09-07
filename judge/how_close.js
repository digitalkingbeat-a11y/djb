/* How Close Was I? — Timing analysis utilities for DJ Battle Platform
   Exposes: computeTiming, renderHowClosePanel, saveTimingAnalysis
*/
(function(global){
  const DEFAULT_THRESHOLDS = [
    {name:'Exceptional', maxMs:30},
    {name:'Excellent', maxMs:75},
    {name:'Very Good', maxMs:125},
    {name:'Good', maxMs:200},
    {name:'Noticeable', maxMs:300},
    {name:'Significant', maxMs:500},
    {name:'Major', maxMs:100000}
  ];

  function msPerBeat(bpm){ return 60000 / (bpm || 120); }

  function computeTiming(idealMs, actualMs, bpm){
    const diff = actualMs - idealMs; // positive = late
    const beatMs = msPerBeat(bpm);
    const beats = diff / beatMs;
    const percentOfBeat = beats * 100;
    const direction = diff === 0 ? 'on-time' : (diff > 0 ? 'late' : 'early');
    const absMs = Math.abs(diff);
    const severity = classifySeverity(absMs);
    return {
      idealMs, actualMs, diffMs: diff, diffSec: diff/1000, beats, percentOfBeat, direction, bpm, beatMs, severity
    };
  }

  function classifySeverity(absMs){
    for(const t of DEFAULT_THRESHOLDS){ if(absMs <= t.maxMs) return t.name; }
    return 'Major';
  }

  function formatTimeMs(ms){
    if(ms === null || typeof ms === 'undefined') return '—';
    const s = Math.floor(ms/1000); const mm = Math.floor(s/60); const ss = s%60; const msRem = Math.abs(Math.round(ms%1000));
    return `${mm}:${String(ss).padStart(2,'0')}.${String(msRem).padStart(3,'0')}`;
  }

  // Render a simple panel within the studio view showing events and markers.
  function renderHowClosePanel({ audioEl, events=[] , title='How Close Was I?' }){
    if(!audioEl) return console.warn('audioEl required');
    // ensure duration available
    const containerId = 'how-close-panel';
    let container = document.getElementById(containerId);
    if(!container){
      const studio = document.getElementById('studio');
      container = document.createElement('div'); container.id = containerId; container.className='panel how-close-panel';
      studio.appendChild(container);
    }
    container.innerHTML = `<div><span class="eyebrow">${title}</span><h3>Timing Detail</h3><p style="color:var(--muted)">Click any event to jump playback and inspect the waveform.</p></div><div id="how-close-controls" style="margin:10px 0"><button class="ghost" id="hc-show-ideal">Show Ideal Timing</button><button class="ghost" id="hc-download">Save Analysis</button></div><div id="how-close-wave" style="position:relative;height:96px;background:linear-gradient(90deg,#0f1315,#0b0d0e);margin-bottom:8px;border-radius:6px;overflow:hidden"></div><div id="how-close-list" style="max-height:220px;overflow:auto"></div>`;

    const wave = document.getElementById('how-close-wave');
    // Wait for metadata to get duration
    const ensureRender = ()=>{
      const duration = audioEl.duration || 0;
      wave.innerHTML = '';
      events.forEach((ev, idx)=>{
        const ideal = ev.idealSec || ev.idealMs/1000;
        const actual = ev.actualSec || ev.actualMs/1000;
        const idealPct = Math.min(99.999, (ideal / duration) * 100 || 0);
        const actualPct = Math.min(99.999, (actual / duration) * 100 || 0);
        const idealMark = document.createElement('div');
        idealMark.className='hc-marker ideal'; idealMark.title='IDEAL';
        Object.assign(idealMark.style,{position:'absolute',left:idealPct+'%',top:0,bottom:'50%',width:'2px',background:'#64b5f6'});
        idealMark.onclick = ()=>{ audioEl.currentTime = Math.max(0, ideal); audioEl.play(); };
        const actualMark = document.createElement('div');
        actualMark.className='hc-marker actual'; actualMark.title='ACTUAL';
        Object.assign(actualMark.style,{position:'absolute',left:actualPct+'%',top:'50%',bottom:0,width:'2px',background:'#ffb74d'});
        actualMark.onclick = ()=>{ audioEl.currentTime = Math.max(0, actual); audioEl.play(); };
        wave.appendChild(idealMark); wave.appendChild(actualMark);
      });
    };

    if(isFinite(audioEl.duration) && audioEl.duration > 0){ ensureRender(); } else { audioEl.onloadedmetadata = ensureRender; }

    // populate list
    const list = document.getElementById('how-close-list');
    list.innerHTML = events.map((ev, idx)=>{
      const bpm = ev.bpm || 120; const idealMs = (ev.idealMs != null) ? ev.idealMs : (ev.idealSec*1000); const actualMs = (ev.actualMs != null) ? ev.actualMs : (ev.actualSec*1000);
      const result = computeTiming(idealMs, actualMs, bpm);
      const phraseImpact = ev.phraseOverlap ? 'Crossed phrase boundary' : 'Within phrase';
      return `<div class="hc-row" data-idx="${idx}" style="padding:8px;border-bottom:1px solid #121314;display:flex;justify-content:space-between;align-items:center"><div><strong>${ev.label||'Event '+(idx+1)}</strong><div style="color:var(--muted)">BPM: ${bpm} • ${result.severity} • ${phraseImpact}</div></div><div style="text-align:right"><div>${formatTimeMs(result.idealMs)} → ${formatTimeMs(result.actualMs)}</div><div style="color:var(--muted)">${(result.diffMs>0?'+':'')+Math.round(result.diffMs)} ms • ${Math.abs(result.beats).toFixed(2)} beats</div><div style="margin-top:6px"><button class="ghost hc-jump" data-idx="${idx}">Jump</button></div></div></div>`;
    }).join('');

    // hook jump buttons
    list.querySelectorAll('.hc-jump').forEach(b=>b.addEventListener('click', (e)=>{
      const idx = Number(e.currentTarget.dataset.idx); const ev = events[idx]; const t = ev.actualSec || (ev.actualMs/1000);
      audioEl.currentTime = Math.max(0, t); audioEl.play();
    }));

    // Save / show ideal handlers
    document.getElementById('hc-download').onclick = ()=>{ saveTimingAnalysis({ events, meta:{ recordedAt: Date.now(), duration: audioEl.duration } }); alert('Analysis saved locally.'); };
    document.getElementById('hc-show-ideal').onclick = ()=>{ alert('Showing ideal timings on waveform (visual markers).'); };
  }

  function saveTimingAnalysis({ events, meta }){
    const key = 'djBattle_timing_history';
    const history = JSON.parse(localStorage.getItem(key) || '[]');
    history.unshift({ id: 'local-'+Date.now(), events, meta });
    localStorage.setItem(key, JSON.stringify(history.slice(0,200)));
    // TODO: when LIVE_MODE and Supabase configured, push to `timing_analysis` table
  }

  global.DJHowClose = { computeTiming, renderHowClosePanel, saveTimingAnalysis, msPerBeat };
})(window);

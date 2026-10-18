(function(global){
  // Studio Pro helpers: BPM detection, filter curve, beat-synced echo, reverb impulse,
  // cue mix, battle-length recording limits and review-waveform markers. Pure where possible.

  function mixdown(channels){
    const list = Array.isArray(channels) ? channels : [channels];
    const len = list[0] ? list[0].length : 0;
    if(list.length === 1) return list[0];
    const out = new Float32Array(len);
    list.forEach(ch => { for(let i = 0; i < len; i += 1) out[i] += ch[i] / list.length; });
    return out;
  }

  // Onset-strength envelope: frame energy, log-compressed, half-wave rectified difference.
  function onsetEnvelope(samples, sampleRate, hop){
    const h = hop || 256;
    const frames = Math.floor(samples.length / h);
    const env = new Float32Array(frames);
    let prev = 0;
    for(let f = 0; f < frames; f += 1){
      let e = 0;
      const base = f * h;
      for(let i = 0; i < h; i += 1){ const v = samples[base + i]; e += v * v; }
      const le = Math.log(1 + 1000 * e / h);
      env[f] = Math.max(0, le - prev);
      prev = le;
    }
    let mean = 0;
    for(let i = 0; i < frames; i += 1) mean += env[i];
    mean /= Math.max(1, frames);
    for(let i = 0; i < frames; i += 1) env[i] -= mean;
    return { env, fps:sampleRate / h };
  }

  function autocorr(env, maxLag){
    const n = env.length;
    const ac = new Float32Array(maxLag + 2);
    for(let lag = 0; lag <= maxLag + 1; lag += 1){
      let s = 0;
      for(let i = 0; i + lag < n; i += 1) s += env[i] * env[i + lag];
      ac[lag] = s / Math.max(1, n - lag);
    }
    return ac;
  }

  function interp(ac, x){
    const i = Math.floor(x), f = x - i;
    if(i + 1 >= ac.length) return ac[ac.length - 1] || 0;
    return ac[i] * (1 - f) + ac[i + 1] * f;
  }

  // Keep a tempo inside [min, max] by halving/doubling.
  function foldBpm(bpm, min, max){
    const lo = min || 70, hi = max || 180;
    let b = Number(bpm);
    if(!(b > 0) || !isFinite(b)) return null;
    let guard = 0;
    while(b < lo && guard++ < 8) b *= 2;
    while(b > hi && guard++ < 16) b /= 2;
    return b;
  }

  // Detect tempo from PCM. Returns { bpm, confidence } or null when nothing rhythmic is found.
  function detectBpm(channels, sampleRate, opts){
    const o = opts || {};
    const min = o.min || 70, max = o.max || 180;
    const sr = Number(sampleRate) || 44100;
    let mono = mixdown(channels);
    if(!mono || mono.length < sr * 3) return null;
    const maxSamples = Math.floor(sr * (o.maxSeconds || 60));
    if(mono.length > maxSamples){
      const start = Math.floor((mono.length - maxSamples) / 2);
      mono = mono.subarray ? mono.subarray(start, start + maxSamples) : mono.slice(start, start + maxSamples);
    }
    const { env, fps } = onsetEnvelope(mono, sr, o.hop || 256);
    const maxLag = Math.ceil(fps * 60 / min * 4) + 2;
    const ac = autocorr(env, Math.min(maxLag, env.length - 2));
    const scoreAt = bpm => {
      const lag = fps * 60 / bpm;
      let score = 0, used = 0;
      for(let k = 1; k <= 4; k += 1){
        const x = lag * k;
        if(x >= ac.length - 1) break;
        score += interp(ac, x); used += 1;
      }
      return used ? score / used : -Infinity;
    };
    let best = null, bestScore = -Infinity, total = 0, count = 0;
    for(let bpm = min; bpm <= max + 1e-9; bpm += 0.05){
      const score = scoreAt(bpm);
      if(!isFinite(score)) continue;
      total += Math.max(0, score); count += 1;
      if(score > bestScore){ bestScore = score; best = bpm; }
    }
    // Half/double fold: a half-tempo comb also hits every beat, so prefer the double when it scores nearly as well.
    if(best != null && best * 2 <= max){
      let dbl = best * 2, dblScore = -Infinity;
      for(let d = best * 2 - 0.3; d <= best * 2 + 0.3; d += 0.05){ const sc = scoreAt(d); if(sc > dblScore){ dblScore = sc; dbl = d; } }
      if(dblScore >= 0.8 * bestScore){ best = dbl; bestScore = dblScore; }
    }
    if(best == null || !(bestScore > 0)) return null;
    const confidence = Math.max(0, Math.min(1, 1 - (total / Math.max(1, count)) / bestScore));
    const bpm = Math.round(foldBpm(best, min, max) * 10) / 10;
    return { bpm, confidence:Math.round(confidence * 100) / 100 };
  }

  // One-knob filter: -1..1. Center (|v| < 0.04) is off; left low-pass, right high-pass.
  function filterSettings(value){
    const v = Math.max(-1, Math.min(1, Number(value) || 0));
    if(Math.abs(v) < 0.04) return { mode:'off', type:'allpass', frequency:20000, label:'Off' };
    if(v < 0){
      const f = Math.round(20000 * Math.pow(0.01, -v));
      return { mode:'lowpass', type:'lowpass', frequency:f, label:`LP ${f >= 1000 ? (f / 1000).toFixed(1) + 'k' : f}` };
    }
    const f = Math.round(20 * Math.pow(250, v));
    return { mode:'highpass', type:'highpass', frequency:f, label:`HP ${f >= 1000 ? (f / 1000).toFixed(1) + 'k' : f}` };
  }

  // Echo delay time for a beat fraction (0.25, 0.5, 1) at the deck's tempo; 0.5 s fallback with no BPM.
  function echoDelaySeconds(bpm, beats){
    const b = Number(bpm);
    const n = [0.25, 0.5, 1].includes(Number(beats)) ? Number(beats) : 0.5;
    if(!(b > 0)) return 0.5 * n * 2;
    return Math.min(4, 60 / b * n);
  }

  // Exponentially decaying stereo noise impulse for the reverb ConvolverNode.
  function impulseSamples(length, decay, seed){
    let s = (seed || 1) >>> 0;
    const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
    const out = new Float32Array(length);
    for(let i = 0; i < length; i += 1) out[i] = rand() * Math.pow(1 - i / length, decay || 3);
    return out;
  }
  function makeImpulse(ctx, seconds, decay){
    const len = Math.max(1, Math.floor(ctx.sampleRate * (seconds || 2.4)));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for(let c = 0; c < 2; c += 1){
      const data = impulseSamples(len, decay, c + 7);
      if(buf.copyToChannel) buf.copyToChannel(data, c); else buf.getChannelData(c).set(data);
    }
    return buf;
  }

  // Cue/Master knob 0..1: 0 = only cue (PFL) in headphones, 1 = only master. Equal power.
  function cueMixGains(x){
    const v = Math.max(0, Math.min(1, Number(x)));
    const cue = Math.cos(v * Math.PI / 2), master = Math.sin(v * Math.PI / 2);
    return { cue:Math.abs(cue) < 1e-9 ? 0 : cue, master:Math.abs(master) < 1e-9 ? 0 : master };
  }

  function headphoneSupport(win){
    const w = win || global;
    const El = w.HTMLMediaElement;
    const ctxProto = w.AudioContext && w.AudioContext.prototype;
    const element = Boolean(El && El.prototype && typeof El.prototype.setSinkId === 'function');
    const context = Boolean(ctxProto && typeof ctxProto.setSinkId === 'function');
    return { supported:element || context, element, context };
  }

  // Battle recording length in ms from battle/session data; null for practice (no battle).
  function battleRecordingLimitMs(session){
    if(!session) return null;
    const m = Number(session.durationMinutes || session.duration || (session.battle && session.battle.durationMinutes));
    if(!(m > 0) || !isFinite(m)) return null;
    return Math.round(m * 60000);
  }

  function clockText(ms){
    const s = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  // Review waveform markers: tracklist entries -> fractions of the take.
  function trackMarkers(tracklist, durationMs){
    const d = Number(durationMs);
    if(!(d > 0)) return [];
    return (tracklist || []).filter(t => t && t.ms > 0 && t.ms < d).map(t => ({ frac:Math.round(t.ms / d * 10000) / 10000, title:t.title || '', ms:t.ms }));
  }

  global.DJBattleStudioPro = { mixdown, onsetEnvelope, detectBpm, foldBpm, filterSettings, echoDelaySeconds, impulseSamples, makeImpulse, cueMixGains, headphoneSupport, battleRecordingLimitMs, clockText, trackMarkers };
})(typeof window !== 'undefined' ? window : globalThis);

// Oct 25 Studio: beat jump, loop roll, slip mode and key shift helpers.
// Pure maths lives here so it can be tested; deck_runtime.js wires it to the decks.
(function(global){
  'use strict';
  const JUMP_SIZES = [1, 4, 8, 16];
  const ROLL_SIZES = [0.125, 0.25, 0.5, 1];
  const KEY_SHIFT_MIN = -6, KEY_SHIFT_MAX = 6;

  function beatLength(bpm){ const b = Number(bpm); return b > 0 ? 60 / b : null; }

  // Jump by whole beats, so the track stays on the same spot in the beat (phase) as before.
  // Never lands before the first beat line or past the end: it steps back in whole beats instead.
  function beatJumpTarget(current, beats, bpm, duration, firstBeat){
    const len = beatLength(bpm);
    if(!len || !isFinite(Number(beats))) return null;
    const t = Math.max(0, Number(current) || 0);
    const fb = Math.max(0, Number(firstBeat) || 0);
    let target = t + Number(beats) * len;
    void fb;
    while(target < 0) target += len;
    const end = Number(duration) > 0 ? Number(duration) - 0.05 : Infinity;
    while(target > end && target - len >= 0) target -= len;
    if(target > end) target = t;
    return Math.round(target * 10000) / 10000;
  }

  // The loop-roll window: a slice of `fraction` beats, starting on the beat line at or before `current`.
  function rollWindow(current, fraction, bpm, firstBeat){
    const len = beatLength(bpm);
    const f = Number(fraction);
    if(!len || !(f > 0)) return null;
    const length = f * len;
    const fb = Number(firstBeat) || 0;
    const t = Math.max(0, Number(current) || 0);
    let start = fb + Math.floor((t - fb) / length) * length;
    if(start < 0) start = 0;
    return { start:Math.round(start * 10000) / 10000, end:Math.round((start + length) * 10000) / 10000, length, beats:f };
  }

  // Slip mode: a hidden play position that keeps running at the deck's speed while you loop, roll or jump.
  function createSlip(position, atMs){ return { position:Math.max(0, Number(position) || 0), at:Number(atMs) || 0 }; }
  function advanceSlip(slip, nowMs, rate, playing, duration){
    if(!slip) return null;
    const dt = Math.max(0, (Number(nowMs) - slip.at) / 1000);
    let pos = slip.position + (playing ? dt * (Number(rate) > 0 ? Number(rate) : 1) : 0);
    if(Number(duration) > 0) pos = Math.min(pos, Number(duration));
    slip.position = pos; slip.at = Number(nowMs);
    return pos;
  }

  function clampShift(n){ const v = Math.round(Number(n) || 0); return Math.max(KEY_SHIFT_MIN, Math.min(KEY_SHIFT_MAX, v)); }
  function semitoneRatio(n){ return Math.pow(2, clampShift(n) / 12); }
  // One semitone up is seven steps round the Camelot wheel; the A/B letter (minor/major) stays.
  function shiftCamelot(camelot, semitones){
    const m = /^(1[0-2]|[1-9])([AB])$/.exec(String(camelot || '').trim().toUpperCase());
    if(!m) return '';
    const n = Number(m[1]);
    const next = (((n - 1 + 7 * clampShift(semitones)) % 12) + 12) % 12 + 1;
    return `${next}${m[2]}`;
  }
  function shiftLabel(n){ const v = clampShift(n); return v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v)}`; }

  // Real-time pitch shifter (AudioWorklet). Method: a granular "two read heads" delay line.
  // Each head reads the recent audio slightly faster (or slower) than it was written, which moves
  // the pitch without changing how fast the song plays. When a head drifts to the end of its 60 ms
  // window it jumps back, and the two heads cross-fade so the jump is hidden. Ratio 1 is a clean bypass.
  const WORKLET_SOURCE = `
class DJBPitchShift extends AudioWorkletProcessor {
  static get parameterDescriptors(){ return [{ name:'ratio', defaultValue:1, minValue:0.5, maxValue:2, automationRate:'k-rate' }]; }
  constructor(){
    super();
    this.win = Math.round(sampleRate * 0.06);
    this.size = 1; while(this.size < this.win * 2 + 8) this.size <<= 1;
    this.mask = this.size - 1;
    this.buf = [new Float32Array(this.size), new Float32Array(this.size)];
    this.w = 0; this.phase = 0;
  }
  read(b, pos){ const i = Math.floor(pos); const f = pos - i; const a = b[i & this.mask], c = b[(i + 1) & this.mask]; return a + (c - a) * f; }
  process(inputs, outputs, params){
    const input = inputs[0] || [], output = outputs[0] || [];
    const ratio = params.ratio[0];
    const n = output[0] ? output[0].length : 128;
    if(Math.abs(ratio - 1) < 1e-4){
      for(let ch = 0; ch < output.length; ch++){ const src = input[ch] || input[0]; if(src) output[ch].set(src); else output[ch].fill(0); }
      for(let i = 0; i < n; i++){ for(let ch = 0; ch < 2; ch++){ const src = input[ch] || input[0]; this.buf[ch][this.w & this.mask] = src ? src[i] : 0; } this.w++; }
      return true;
    }
    const step = (1 - ratio) / this.win;
    for(let i = 0; i < n; i++){
      for(let ch = 0; ch < 2; ch++){ const src = input[ch] || input[0]; this.buf[ch][this.w & this.mask] = src ? src[i] : 0; }
      this.phase += step; if(this.phase >= 1) this.phase -= 1; if(this.phase < 0) this.phase += 1;
      const p2 = (this.phase + 0.5) % 1;
      const d1 = 1 + this.phase * this.win, d2 = 1 + p2 * this.win;
      const g1 = Math.sin(Math.PI * this.phase) ** 2, g2 = Math.sin(Math.PI * p2) ** 2;
      for(let ch = 0; ch < output.length; ch++){
        const b = this.buf[Math.min(ch, 1)];
        output[ch][i] = g1 * this.read(b, this.w - d1) + g2 * this.read(b, this.w - d2);
      }
      this.w++;
    }
    return true;
  }
}
registerProcessor('djb-pitch-shift', DJBPitchShift);`;

  const loadedContexts = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  async function createPitchShifter(ctx, win){
    if(!ctx || !ctx.audioWorklet || typeof (win || global).AudioWorkletNode !== 'function') return { ok:false, error:'Key shift needs a newer browser (AudioWorklet is missing).' };
    try{
      let p = loadedContexts && loadedContexts.get(ctx);
      if(!p){
        const W = win || global;
        const url = W.URL.createObjectURL(new W.Blob([WORKLET_SOURCE], { type:'application/javascript' }));
        p = ctx.audioWorklet.addModule(url);
        if(loadedContexts) loadedContexts.set(ctx, p);
      }
      await p;
      const Node = (win || global).AudioWorkletNode;
      const node = new Node(ctx, 'djb-pitch-shift', { numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[2] });
      return { ok:true, node };
    }catch(error){ return { ok:false, error:'Key shift could not start in this browser.' }; }
  }

  const api = { JUMP_SIZES, ROLL_SIZES, KEY_SHIFT_MIN, KEY_SHIFT_MAX, beatLength, beatJumpTarget, rollWindow, createSlip, advanceSlip, clampShift, semitoneRatio, shiftCamelot, shiftLabel, WORKLET_SOURCE, createPitchShifter };
  global.DJBattleDeckPerf = api;
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

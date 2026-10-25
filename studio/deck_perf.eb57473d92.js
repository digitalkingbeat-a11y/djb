var R=Object.defineProperty;var r=(c,m)=>R(c,"name",{value:m,configurable:!0});(function(c){"use strict";const m=[1,4,8,16],k=[.125,.25,.5,1],b=-6,M=6;function d(t){const e=Number(t);return e>0?60/e:null}r(d,"beatLength");function g(t,e,s,u,h){const n=d(s);if(!n||!isFinite(Number(e)))return null;const i=Math.max(0,Number(t)||0),l=Math.max(0,Number(h)||0);let o=i+Number(e)*n;for(;o<0;)o+=n;const a=Number(u)>0?Number(u)-.05:1/0;for(;o>a&&o-n>=0;)o-=n;return o>a&&(o=i),Math.round(o*1e4)/1e4}r(g,"beatJumpTarget");function S(t,e,s,u){const h=d(s),n=Number(e);if(!h||!(n>0))return null;const i=n*h,l=Number(u)||0,o=Math.max(0,Number(t)||0);let a=l+Math.floor((o-l)/i)*i;return a<0&&(a=0),{start:Math.round(a*1e4)/1e4,end:Math.round((a+i)*1e4)/1e4,length:i,beats:n}}r(S,"rollWindow");function y(t,e){return{position:Math.max(0,Number(t)||0),at:Number(e)||0}}r(y,"createSlip");function W(t,e,s,u,h){if(!t)return null;const n=Math.max(0,(Number(e)-t.at)/1e3);let i=t.position+(u?n*(Number(s)>0?Number(s):1):0);return Number(h)>0&&(i=Math.min(i,Number(h))),t.position=i,t.at=Number(e),i}r(W,"advanceSlip");function f(t){const e=Math.round(Number(t)||0);return Math.max(b,Math.min(M,e))}r(f,"clampShift");function x(t){return Math.pow(2,f(t)/12)}r(x,"semitoneRatio");function I(t,e){const s=/^(1[0-2]|[1-9])([AB])$/.exec(String(t||"").trim().toUpperCase());return s?`${((Number(s[1])-1+7*f(e))%12+12)%12+1}${s[2]}`:""}r(I,"shiftCamelot");function P(t){const e=f(t);return e===0?"0":`${e>0?"+":"−"}${Math.abs(e)}`}r(P,"shiftLabel");const w=`
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
registerProcessor('djb-pitch-shift', DJBPitchShift);`,p=typeof WeakMap<"u"?new WeakMap:null;async function A(t,e){if(!t||!t.audioWorklet||typeof(e||c).AudioWorkletNode!="function")return{ok:!1,error:"Key shift needs a newer browser (AudioWorklet is missing)."};try{let s=p&&p.get(t);if(!s){const n=e||c,i=n.URL.createObjectURL(new n.Blob([w],{type:"application/javascript"}));s=t.audioWorklet.addModule(i),p&&p.set(t,s)}await s;const u=(e||c).AudioWorkletNode;return{ok:!0,node:new u(t,"djb-pitch-shift",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]})}}catch{return{ok:!1,error:"Key shift could not start in this browser."}}}r(A,"createPitchShifter");const N={JUMP_SIZES:m,ROLL_SIZES:k,KEY_SHIFT_MIN:b,KEY_SHIFT_MAX:M,beatLength:d,beatJumpTarget:g,rollWindow:S,createSlip:y,advanceSlip:W,clampShift:f,semitoneRatio:x,shiftCamelot:I,shiftLabel:P,WORKLET_SOURCE:w,createPitchShifter:A};c.DJBattleDeckPerf=N,typeof module<"u"&&module.exports&&(module.exports=N)})(typeof window<"u"?window:globalThis);

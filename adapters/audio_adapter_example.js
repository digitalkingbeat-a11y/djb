// Audio Adapter reference: performs beat detection / transition detection locally.
// Production deployments should connect this boundary to the selected analysis library.
class AudioAdapter {
  constructor(audioEl){ this.audio = audioEl; this.onTelemetryCb = ()=>{}; }
  async init(){ if(!this.audio) throw new Error('audio element required'); return true; }
  async detect(){ return { available: !!this.audio, telemetry: 'audio-only', devices: {} }; }
  onTelemetry(cb){ this.onTelemetryCb = cb; }
  start(){
    // Minimal beat ping every second for local adapter testing.
    this._interval = setInterval(()=>{
      this.onTelemetryCb({ type:'telemetry', source:'audio', timestamp: Date.now(), events:[{ event:'detected_beat', bpm:120, confidence:0.9, timestamp: Date.now() }] });
    },1000);
  }
  stop(){ clearInterval(this._interval); }
}
module.exports = AudioAdapter;

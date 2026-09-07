// Template Adapter - illustrates the adapter interface for DJ Battle Bridge
class TemplateAdapter {
  constructor(){
    this.name = 'template';
    this.mode = 'audio-only';
    this.telemetryCb = ()=>{};
  }

  async init(options){
    // options may include preferences, device identifiers, etc.
    this.options = options || {};
    // perform detection or SDK init here
    return true;
  }

  async detect(){
    // Return availability and suggested telemetry mode
    return { available: true, telemetry: this.mode, devices: {} };
  }

  onTelemetry(cb){ this.telemetryCb = cb; }

  start(){
    // Start emitting telemetry (example simulated)
    this._interval = setInterval(()=>{
      const msg = {
        type: 'telemetry',
        source: this.name,
        timestamp: Date.now(),
        deck: 'A',
        event: 'beat',
        payload: { bpm: 128 }
      };
      this.telemetryCb(msg);
    }, 500);
  }

  stop(){ clearInterval(this._interval); }

  async calibrate(){
    // run latency checks and return measured offsets
    return { measuredMs: 0 };
  }
}

module.exports = TemplateAdapter;

// MIDI Adapter example: listens for MIDI input and emits normalized events
class MidiAdapter {
  constructor(){ this.onTelemetryCb = ()=>{}; }
  async init(){
    if(!navigator.requestMIDIAccess) throw new Error('MIDI not supported');
    this.access = await navigator.requestMIDIAccess();
    for(const inp of this.access.inputs.values()) inp.onmidimessage = this._onMidi.bind(this);
    return true;
  }
  async detect(){ return { available: !!this.access, telemetry: 'limited', devices: Array.from(this.access ? this.access.inputs.values() : []) } }
  onTelemetry(cb){ this.onTelemetryCb = cb; }
  _onMidi(ev){
    const payload = { event:'midi', data: Array.from(new Uint8Array(ev.data)), timestamp: Date.now() };
    this.onTelemetryCb({ type:'telemetry', source:'midi', timestamp: Date.now(), event:'midi_message', payload });
  }
}
module.exports = MidiAdapter;

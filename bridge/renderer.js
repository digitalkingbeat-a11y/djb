const log = (s)=>{ const el=document.getElementById('log'); el.textContent = String(s) + '\n' + el.textContent; };
const stat = (s)=>{ document.getElementById('stat-text').textContent = s; };

async function scanDevices(){
  stat('Scanning devices');
  const midi = await window.bridge.detectMIDIDevices().catch(()=>[]);
  const audio = await window.bridge.listAudioDevices().catch(()=>[]);
  const parts = [];
  if(midi.length) parts.push('MIDI: '+midi.map(m=>m.name).join(', '));
  if(audio.length) parts.push('Audio: '+audio.map(a=>a.label||a.deviceId).join(', '));
  if(parts.length===0) parts.push('No devices detected (grant permission if needed)');
  document.getElementById('detected').textContent = parts.join('\n');
  stat('Ready');
}

document.getElementById('btn-connect').onclick = async ()=>{
  const url = document.getElementById('server-url').value;
  stat('Connecting...');
  try{
    const ws = new WebSocket(url);
    ws.onopen = ()=>{ stat('Connected'); log('Connected to '+url); };
    ws.onmessage = (evt)=>{ log('Recv: '+evt.data); };
    ws.onclose = ()=>{ stat('Disconnected'); log('Disconnected'); };
    ws.onerror = (e)=>{ stat('Error'); log('WS error '+e.message); };
    // example: send a status payload
    ws.addEventListener('open', ()=>{ ws.send(JSON.stringify({ type:'status', software:'DJ Battle Bridge', detectedAt: Date.now(), telemetry: 'available' })); });
  }catch(e){ stat('Connect failed'); log('Connect failed: '+String(e)); }
};

document.getElementById('btn-test-audio').onclick = async ()=>{
  stat('Running signal test');
  try{
    const devices = await window.bridge.listAudioDevices();
    if(!devices || devices.length===0) return alert('No audio devices available');
    const deviceId = devices.find(d=>d.kind==='audioinput')?.deviceId || devices[0].deviceId;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId } });
    const ac = new (window.AudioContext||window.webkitAudioContext)();
    const src = ac.createMediaStreamSource(stream);
    const analyser = ac.createAnalyser(); analyser.fftSize = 2048;
    src.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let peak = 0;
    const start = Date.now();
    const dur = 2000;
    function sample(){ analyser.getFloatTimeDomainData(data); let p=0; for(let i=0;i<data.length;i++){ p = Math.max(p, Math.abs(data[i])); } peak = Math.max(peak, p); if(Date.now()-start < dur) requestAnimationFrame(sample); else { log('Signal test complete — peak: '+peak.toFixed(3)); stat('Ready'); stream.getTracks().forEach(t=>t.stop()); ac.close(); } }
    sample();
    log('Signal test started for device '+(devices[0].label||devices[0].deviceId));
  }catch(e){ stat('Test failed'); log('Signal test failed: '+String(e)); }
};

scanDevices();

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  detectMIDIDevices: async () => {
    if(!navigator.requestMIDIAccess) return [];
    try{
      const access = await navigator.requestMIDIAccess();
      const inputs = [];
      for(const input of access.inputs.values()){ inputs.push({ id: input.id, name: input.name }); }
      return inputs;
    }catch(e){ return []; }
  },
  listAudioDevices: async () => {
    try{
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d=>d.kind==='audioinput' || d.kind==='audiooutput').map(d=>({ deviceId: d.deviceId, label: d.label, kind: d.kind }));
    }catch(e){ return []; }
  },
  connectBridge: (url) => {
    try{
      const ws = new WebSocket(url);
      return new Promise((resolve,reject)=>{
        ws.onopen = ()=>resolve({ ok:true });
        ws.onerror = (e)=>reject(e);
      });
    }catch(e){ return Promise.reject(e); }
  }
});

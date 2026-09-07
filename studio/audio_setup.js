(function(global){
  function createAudioSetup(deps){
    const win = deps.window || global;
    const doc = deps.document || win.document;
    const state = deps.state;
    const esc = deps.esc || (value => String(value ?? ''));
    const readable = deps.readableComponentName || (value => String(value || '').replace(/_/g, ' '));

    function renderPanel(){
      const audioState = doc.getElementById('audio-state');
      const inputSelect = doc.getElementById('audio-input-select');
      const recordingSelect = doc.getElementById('recording-source-select');
      const message = doc.getElementById('audio-setup-message');
      if(audioState) audioState.textContent = readable(state.audioSetup.status || 'unavailable');
      if(inputSelect){
        const current = state.audioSetup.inputDeviceId || '';
        const devices = state.audioSetup.devices || [];
        inputSelect.innerHTML = '<option value="">Browser default</option>' + devices.map(device => `<option value="${esc(device.deviceId)}">${esc(device.label || 'Audio input')}</option>`).join('');
        inputSelect.value = current;
      }
      if(recordingSelect) recordingSelect.value = state.audioSetup.recordingSource || 'master';
      if(message) message.textContent = state.audioSetup.message || 'Browser output routing is not exposed here.';
      if(deps.updateRecordingUi) deps.updateRecordingUi();
    }

    async function refreshDevices(){
      const mediaDevices = deps.getMediaDevices ? deps.getMediaDevices() : (win.navigator && win.navigator.mediaDevices);
      if(!mediaDevices || !mediaDevices.enumerateDevices){
        state.audioSetup.status = 'unavailable';
        state.audioSetup.message = 'This browser does not expose media-device selection.';
        renderPanel();
        return { ok:false };
      }
      try{
        let devices = await mediaDevices.enumerateDevices();
        if(!devices.some(device => device.kind === 'audioinput') && mediaDevices.getUserMedia){
          await mediaDevices.getUserMedia({ audio:true }).then(stream => stream.getTracks().forEach(track => track.stop())).catch(()=>{});
          devices = await mediaDevices.enumerateDevices();
        }
        state.audioSetup.devices = devices.filter(device => device.kind === 'audioinput');
        state.audioSetup.status = state.audioSetup.devices.length ? 'ready' : 'unavailable';
        state.audioSetup.message = state.audioSetup.devices.length ? 'Audio input devices are visible to this browser. Output routing remains browser controlled.' : 'No audio inputs are visible to this browser.';
        renderPanel();
        return { ok:true, devices:state.audioSetup.devices };
      }catch(error){
        state.audioSetup.status = 'blocked';
        state.audioSetup.message = String(error && error.message || error);
        renderPanel();
        return { ok:false, error:state.audioSetup.message };
      }
    }

    function wireControls(){
      const refresh = doc.getElementById('refresh-audio-devices');
      if(refresh) refresh.onclick = () => refreshDevices();
      const input = doc.getElementById('audio-input-select');
      if(input) input.onchange = event => { state.audioSetup.inputDeviceId = event.currentTarget.value || ''; renderPanel(); };
      const source = doc.getElementById('recording-source-select');
      if(source) source.onchange = event => { state.audioSetup.recordingSource = event.currentTarget.value || 'master'; renderPanel(); };
      renderPanel();
    }

    return {
      renderPanel,
      refreshDevices,
      wireControls
    };
  }

  global.DJBattleAudioSetup = { create: createAudioSetup };
})(typeof window !== 'undefined' ? window : globalThis);

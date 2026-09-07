(function(global){
  function createControllerMapping(deps){
    const win = deps.window || global;
    const doc = deps.document || win.document;
    const state = deps.state;
    const store = deps.localStorage || win.localStorage;
    const esc = deps.esc || (value => String(value ?? ''));
    const readable = deps.readableComponentName || (value => String(value || '').replace(/_/g, ' '));

    function persist(){
      if(store && store.setItem) store.setItem('djBattleControllerState', JSON.stringify(state.controller));
    }

    function renderPanel(){
      const controllerName = doc.getElementById('controller-name');
      const controllerStatus = doc.getElementById('controller-status');
      const midiActivity = doc.getElementById('midi-activity');
      const mappingStatus = doc.getElementById('mapping-status');
      const mappingList = doc.getElementById('controller-mapping-list');
      if(controllerName) controllerName.textContent = state.controller.name || 'No controller detected';
      if(controllerStatus) controllerStatus.textContent = readable(state.controller.status || 'disconnected');
      if(midiActivity) midiActivity.textContent = state.controller.midiActivity || 'Idle';
      if(mappingStatus) mappingStatus.textContent = state.controller.mappingStatus || 'Not mapped';
      if(mappingList){
        mappingList.innerHTML = Object.entries(state.controller.mappings || {})
          .map(([control, value]) => `<div><span>${esc(readable(control))}</span><strong>${esc(readable(value))}</strong></div>`)
          .join('');
      }
      const audioController = doc.getElementById('audio-controller-state');
      if(audioController) audioController.textContent = state.controller.status === 'connected' ? 'Connected' : 'Disconnected';
    }

    function midiMappingStatus(inputName){
      const known = /ddj|xone|traktor|launch|mpk|midi|controller/i.test(inputName || '');
      if(known){
        state.controller.mappingStatus = 'Partially supported';
        state.controller.supported = true;
        state.controller.mappings = {
          ...state.controller.mappings,
          playPause:'learn-ready',
          cue:'learn-ready',
          pitch:'learn-ready',
          crossfader:'learn-ready',
          hotCues:'learn-ready'
        };
      }else{
        state.controller.mappingStatus = 'Detected but unmapped';
        state.controller.supported = false;
      }
      return state.controller.mappingStatus;
    }

    function handleMidiMessage(event){
      const data = Array.from(event.data || []);
      state.controller.midiActivity = data.length ? `CC ${data.join(' ')}` : 'Activity';
      persist();
      renderPanel();
    }

    async function scanControllers(){
      const nav = deps.getNavigator ? deps.getNavigator() : (win.navigator || {});
      if(!nav.requestMIDIAccess){
        state.controller = { ...state.controller, status:'unsupported', name:'Web MIDI unavailable', mappingStatus:'Unsupported hardware/browser', midiActivity:'Unavailable', message:'This browser does not expose Web MIDI.' };
        persist();
        renderPanel();
        return { ok:false, error:'web_midi_unavailable' };
      }
      try{
        const access = await nav.requestMIDIAccess({ sysex:false });
        const inputs = Array.from(access.inputs.values());
        if(!inputs.length){
          state.controller = { ...state.controller, status:'disconnected', name:'No controller detected', mappingStatus:'Not mapped', midiActivity:'Idle' };
        }else{
          const input = inputs[0];
          state.controller = { ...state.controller, status:'connected', name:input.name || 'MIDI controller', midiActivity:'Listening' };
          midiMappingStatus(state.controller.name);
          inputs.forEach(device => { device.onmidimessage = handleMidiMessage; });
        }
        persist();
        renderPanel();
        return { ok:true, inputs };
      }catch(error){
        state.controller = { ...state.controller, status:'blocked', name:'MIDI permission blocked', mappingStatus:'Unavailable', midiActivity:'Blocked', message:String(error && error.message || error) };
        persist();
        renderPanel();
        return { ok:false, error:state.controller.message };
      }
    }

    function wireControls(){
      const midi = doc.getElementById('scan-midi');
      if(midi) midi.onclick = () => scanControllers();
      renderPanel();
    }

    return {
      persist,
      renderPanel,
      midiMappingStatus,
      handleMidiMessage,
      scanControllers,
      wireControls
    };
  }

  global.DJBattleControllerMapping = { create: createControllerMapping };
})(typeof window !== 'undefined' ? window : globalThis);

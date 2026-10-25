(function(global){
  function createControllerMapping(deps){
    const win = deps.window || global;
    const doc = deps.document || win.document;
    const state = deps.state;
    const store = deps.localStorage || win.localStorage;
    const esc = deps.esc || (value => String(value ?? ''));
    const readable = deps.readableComponentName || (value => String(value || '').replace(/_/g, ' '));

    const LEARN_KEY = 'djBattleMidiLearn';
    const LEARN_TARGETS = [];
    ['a','b'].forEach(d => {
      const D = d.toUpperCase();
      LEARN_TARGETS.push(
        { id:`play-${d}`, label:`Deck ${D} Play`, selector:`[data-play="${d}"]`, kind:'button', group:`Deck ${D}` },
        { id:`cue-${d}`, label:`Deck ${D} Cue`, selector:`[data-cue="${d}"]`, kind:'button', group:`Deck ${D}` },
        { id:`pitch-${d}`, label:`Deck ${D} Pitch`, selector:`#pitch-${d}`, kind:'range', group:`Deck ${D}` },
        { id:`vol-${d}`, label:`Ch ${D} Volume`, selector:`#vol-${d}`, kind:'range', group:'Mixer' },
        { id:`gain-${d}`, label:`Ch ${D} Gain`, selector:`#gain-${d}`, kind:'range', group:'Mixer' },
        { id:`eq-high-${d}`, label:`Ch ${D} EQ High`, selector:`#eq-high-${d}`, kind:'range', group:'Mixer' },
        { id:`eq-mid-${d}`, label:`Ch ${D} EQ Mid`, selector:`#eq-mid-${d}`, kind:'range', group:'Mixer' },
        { id:`eq-low-${d}`, label:`Ch ${D} EQ Low`, selector:`#eq-low-${d}`, kind:'range', group:'Mixer' }
      );
      LEARN_TARGETS.push(
        { id:`jump-back-${d}`, label:`Deck ${D} Beat Jump Back`, selector:`#deck-perf-${d} [data-beatjump="-1"]`, kind:'button', group:`Deck ${D}` },
        { id:`jump-fwd-${d}`, label:`Deck ${D} Beat Jump Forward`, selector:`#deck-perf-${d} [data-beatjump="1"]`, kind:'button', group:`Deck ${D}` },
        { id:`slip-${d}`, label:`Deck ${D} Slip`, selector:`#deck-perf-${d} [data-slip]`, kind:'button', group:`Deck ${D}` },
        { id:`key-down-${d}`, label:`Deck ${D} Key Down`, selector:`#deck-perf-${d} [data-keyshift="-1"]`, kind:'button', group:`Deck ${D}` },
        { id:`key-up-${d}`, label:`Deck ${D} Key Up`, selector:`#deck-perf-${d} [data-keyshift="1"]`, kind:'button', group:`Deck ${D}` }
      );
      ['0.125','0.25','0.5','1'].forEach(f => LEARN_TARGETS.push({ id:`roll-${d}-${f}`, label:`Deck ${D} Loop Roll ${f === '1' ? '1' : '1/' + Math.round(1 / Number(f))} (hold)`, selector:`#deck-perf-${d} [data-roll="${f}"]`, kind:'hold', group:`Deck ${D}` }));
      [0,1,2,3].forEach(slot => LEARN_TARGETS.push({ id:`hotcue-${d}-${slot + 1}`, label:`Deck ${D} Hot Cue ${slot + 1}`, selector:`#hotcue-pads-${d} [data-hotcue-pad="${slot}"]`, kind:'button', group:`Deck ${D}` }));
    });
    LEARN_TARGETS.push({ id:'xfader', label:'Crossfader', selector:'#xfader', kind:'range', group:'Mixer' });
    let learning = null;
    let learnMessage = '';
    let midiReady = false;
    let midiInputCount = 0;

    function loadLearnMap(){
      try{
        const raw = store && store.getItem ? store.getItem(LEARN_KEY) : null;
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      }catch(e){ return {}; }
    }
    let learnMap = loadLearnMap();
    function saveLearnMap(){
      if(store && store.setItem) store.setItem(LEARN_KEY, JSON.stringify(learnMap));
    }

    // Turn raw MIDI bytes into { type, channel, number, value } for CC and note messages; null otherwise.
    function parseMidi(data){
      const bytes = Array.from(data || []);
      if(bytes.length < 3) return null;
      const status = bytes[0] & 0xF0;
      const channel = (bytes[0] & 0x0F) + 1;
      const number = bytes[1] & 0x7F;
      const value = bytes[2] & 0x7F;
      if(status === 0xB0) return { type:'cc', channel, number, value };
      if(status === 0x90) return { type:'note', channel, number, value, on:value > 0 };
      if(status === 0x80) return { type:'note', channel, number, value:0, on:false };
      return null;
    }
    function bindingKey(b){ return b ? `${b.type}:${b.channel}:${b.number}` : ''; }
    function bindingText(b){
      if(!b) return 'Not mapped';
      return `${b.type === 'cc' ? 'Knob/Fader CC' : 'Button Note'} ${b.number} · Ch ${b.channel}`;
    }

    function startLearn(targetId){
      const target = LEARN_TARGETS.find(t => t.id === targetId);
      if(!target) return { ok:false, error:'unknown_control' };
      if(state.controller.status === 'unsupported'){
        learnMessage = "Your browser doesn't support Web MIDI. Try Chrome or Edge on a computer.";
        renderPanel();
        return { ok:false, error:'web_midi_unavailable' };
      }
      learning = learning === targetId ? null : targetId;
      learnMessage = learning ? `Move a knob or press a button on your controller for ${target.label}. Press Escape to cancel.` : '';
      renderPanel();
      return { ok:true, learning };
    }
    function cancelLearn(){
      if(!learning) return false;
      learning = null;
      learnMessage = 'Learn cancelled.';
      renderPanel();
      return true;
    }
    function clearMapping(targetId){
      delete learnMap[targetId];
      saveLearnMap();
      renderPanel();
    }
    function resetMappings(){
      learnMap = {};
      learning = null;
      learnMessage = 'All controller mappings cleared.';
      saveLearnMap();
      renderPanel();
    }

    function applyBinding(target, msg){
      const el = doc.querySelector(target.selector);
      if(!el) return { ok:false, error:'control_missing' };
      if(target.kind === 'range'){
        const min = Number(el.min || 0);
        const max = Number(el.max || 1);
        const raw = msg.type === 'note' ? (msg.on ? 127 : 0) : msg.value;
        const value = min + (raw / 127) * (max - min);
        el.value = String(value);
        const Ev = win.Event || global.Event;
        el.dispatchEvent(new Ev('input', { bubbles:true }));
        el.dispatchEvent(new Ev('change', { bubbles:true }));
        return { ok:true, value:Number(el.value) };
      }
      const pressed = msg.type === 'note' ? msg.on : msg.value >= 64;
      if(target.kind === 'hold'){
        // Hold controls (loop roll pads): press starts, release lets go.
        const Ev = win.Event || global.Event;
        const type = pressed ? 'pointerdown' : 'pointerup';
        const handler = el['on' + type];
        if(typeof handler === 'function') handler.call(el, { type, preventDefault(){} });
        else el.dispatchEvent(new Ev(type, { bubbles:true }));
        return { ok:true, held:pressed };
      }
      if(!pressed) return { ok:true, ignored:true };
      el.click();
      return { ok:true, clicked:true };
    }

    function routeMidi(data){
      const msg = parseMidi(data);
      if(!msg) return null;
      if(learning){
        if(msg.type === 'note' && !msg.on) return null;
        const key = bindingKey(msg);
        Object.keys(learnMap).forEach(id => { if(bindingKey(learnMap[id]) === key) delete learnMap[id]; });
        learnMap[learning] = { type:msg.type, channel:msg.channel, number:msg.number };
        const target = LEARN_TARGETS.find(t => t.id === learning);
        learnMessage = `${target ? target.label : learning} mapped to ${bindingText(learnMap[learning])}.`;
        const learned = learning;
        learning = null;
        saveLearnMap();
        renderPanel();
        return { learned, binding:learnMap[learned] };
      }
      const key = bindingKey(msg);
      const id = Object.keys(learnMap).find(k => bindingKey(learnMap[k]) === key);
      if(!id) return null;
      const target = LEARN_TARGETS.find(t => t.id === id);
      if(!target) return null;
      return { target:id, ...applyBinding(target, msg) };
    }

    function renderLearnPanel(){
      const wrap = doc.getElementById('midi-learn-panel');
      if(!wrap) return;
      const status = state.controller.status;
      let notice = '';
      if(status === 'unsupported') notice = "Web MIDI isn't supported in this browser, so controller mapping is off. Try Chrome or Edge on a computer.";
      else if(status === 'blocked') notice = 'MIDI access was blocked. Allow MIDI for this site in your browser settings, then press Scan MIDI.';
      else if(midiReady && !midiInputCount) notice = 'No MIDI controller found. Plug one in and press Scan MIDI.';
      else if(!midiReady) notice = 'Press Scan MIDI to connect your controller, then press Learn next to any control.';
      const mapped = Object.keys(learnMap).filter(id => LEARN_TARGETS.some(t => t.id === id)).length;
      const groups = ['Deck A', 'Mixer', 'Deck B'];
      wrap.innerHTML = `
        <div class="midi-learn-head"><strong>MIDI Learn</strong><span class="midi-learn-count">${mapped} of ${LEARN_TARGETS.length} mapped</span><button class="ghost small" id="midi-learn-reset" type="button" ${mapped ? '' : 'disabled'}>Reset all</button></div>
        ${notice ? `<p class="midi-learn-notice" role="status">${esc(notice)}</p>` : ''}
        <p class="midi-learn-message" aria-live="polite">${esc(learnMessage)}</p>
        ${groups.map(group => `<div class="midi-learn-group"><span class="midi-learn-group-title">${esc(group)}</span>${LEARN_TARGETS.filter(t => t.group === group).map(t => {
          const b = learnMap[t.id];
          const active = learning === t.id;
          return `<div class="midi-learn-row ${active ? 'learning' : ''} ${b ? 'mapped' : ''}" data-learn-row="${t.id}"><span>${esc(t.label)}</span><small>${esc(active ? 'Waiting for controller…' : bindingText(b))}</small><button class="ghost small" type="button" data-midi-learn="${t.id}" aria-pressed="${active ? 'true' : 'false'}" aria-label="Learn ${esc(t.label)}">${active ? 'Cancel' : 'Learn'}</button><button class="ghost small" type="button" data-midi-clear="${t.id}" aria-label="Clear ${esc(t.label)} mapping" ${b ? '' : 'disabled'}>Clear</button></div>`;
        }).join('')}</div>`).join('')}`;
      wrap.querySelectorAll('[data-midi-learn]').forEach(btn => { btn.onclick = () => startLearn(btn.dataset.midiLearn); });
      wrap.querySelectorAll('[data-midi-clear]').forEach(btn => { btn.onclick = () => clearMapping(btn.dataset.midiClear); });
      const reset = wrap.querySelector('#midi-learn-reset');
      if(reset) reset.onclick = () => resetMappings();
    }

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
      renderLearnPanel();
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
      const routed = routeMidi(data);
      if(!routed || !routed.learned) renderPanel();
      return routed;
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
        midiReady = true;
        midiInputCount = inputs.length;
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
      if(doc && doc.addEventListener && !doc.__midiLearnEscape){
        doc.__midiLearnEscape = true;
        doc.addEventListener('keydown', event => { if(event.key === 'Escape' && learning) cancelLearn(); });
      }
      renderPanel();
    }

    return {
      persist,
      renderPanel,
      midiMappingStatus,
      handleMidiMessage,
      scanControllers,
      wireControls,
      parseMidi,
      routeMidi,
      startLearn,
      cancelLearn,
      clearMapping,
      resetMappings,
      getLearnMap: () => ({ ...learnMap }),
      getLearning: () => learning,
      learnTargets: () => LEARN_TARGETS.map(t => ({ ...t }))
    };
  }

  global.DJBattleControllerMapping = { create: createControllerMapping };
})(typeof window !== 'undefined' ? window : globalThis);

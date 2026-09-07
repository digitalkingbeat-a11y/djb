const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP_FILES = [
  'api_client.js',
  'submission_upload.js',
  'battle_modes.js',
  'studio/studio_recording.js',
  'studio/controller_mapping.js',
  'studio/audio_setup.js',
  'studio/streaming.js',
  'studio/playlist_transfer.js',
  'studio/studio_browser.js',
  'studio/deck_runtime.js',
  'app.js'
];

function tick(){
  return new Promise(resolve => setTimeout(resolve, 0));
}

function loadAppDom(options = {}){
  const root = path.join(__dirname, '..');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(index, {
    url: 'http://127.0.0.1/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.alert = () => {};
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal(){ this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function close(){ this.removeAttribute('open'); };
  if(options.recordingMocks) installRecordingMocks(window);
  APP_FILES.forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  return window;
}

function installRecordingMocks(window){
  window.__audioGraphStats = { contexts:0, sources:0, closed:0 };
  class FakeNode {
    connect(){
      return this;
    }
    disconnect(){}
  }
  class FakeGain extends FakeNode {
    constructor(){
      super();
      this.gain = { value:1 };
    }
  }
  class FakeAudioContext {
    constructor(){
      window.__audioGraphStats.contexts += 1;
      this.destination = new FakeNode();
    }
    createMediaStreamDestination(){
      return { stream:{ id:'studio-recording-stream' } };
    }
    createMediaElementSource(){
      window.__audioGraphStats.sources += 1;
      return new FakeNode();
    }
    createGain(){
      return new FakeGain();
    }
    resume(){
      return Promise.resolve();
    }
    close(){
      window.__audioGraphStats.closed += 1;
      return Promise.resolve();
    }
  }
  class FakeMediaRecorder {
    constructor(stream){
      this.stream = stream;
      this.state = 'inactive';
    }
    start(){
      this.state = 'recording';
    }
    stop(){
      this.state = 'inactive';
      if(this.ondataavailable){
        this.ondataavailable({ data:new window.Blob(['recorded mix'], { type:'audio/webm' }) });
      }
      if(this.onstop) this.onstop();
    }
  }
  window.AudioContext = FakeAudioContext;
  window.MediaRecorder = FakeMediaRecorder;
  window.URL.createObjectURL = () => 'blob:studio-recording';
  window.URL.revokeObjectURL = () => {};
}

function demoTrack(){
  return {
    id:'alpha',
    name:'Alpha Deck Tool',
    artist:'DJ One',
    album:'Night Crate',
    genre:'House',
    bpm:128,
    key:'A minor',
    duration:'3:20',
    source:'MY_LIBRARY',
    rightsCategory:'Original / I Own the Rights',
    battleEligible:true,
    permissions:{ download:false }
  };
}

function bravoTrack(){
  return {
    id:'bravo',
    name:'Bravo Deck Tool',
    artist:'DJ Two',
    album:'Night Crate',
    genre:'House',
    bpm:126,
    key:'D minor',
    duration:'3:10',
    source:'MY_LIBRARY',
    rightsCategory:'Original / I Own the Rights',
    battleEligible:true,
    permissions:{ download:false }
  };
}

test('Battle Studio recording moves STOP to REVIEW and blocks unsafe navigation', async () => {
  const window = loadAppDom({ recordingMocks:true });
  const { document } = window;
  const hooks = window.__DJBattleTestHooks;

  hooks.switchView('studio');
  hooks.armStudioRecording();
  assert.equal(document.getElementById('record-status').textContent, 'Armed');

  const started = await hooks.startStudioRecording();
  assert.equal(started.ok, true);
  assert.equal(hooks.isStudioRecordingActive(), true);
  assert.equal(document.getElementById('record-status').textContent, 'REC active');

  let confirmCalls = 0;
  window.confirm = () => {
    confirmCalls += 1;
    return false;
  };
  assert.equal(hooks.switchView('library'), false);
  assert.equal(confirmCalls, 1);
  assert.equal(document.getElementById('studio').classList.contains('active'), true);

  const stopped = hooks.stopStudioRecording();
  assert.equal(stopped.ok, true);
  await tick();

  const recording = hooks.getStudioRecordingState();
  assert.equal(recording.state, 'review');
  assert.match(recording.fileName, /^dj-battle-take-\d+\.webm$/);
  assert.equal(document.getElementById('record-status').textContent, 'Review take ready');
  assert.equal(document.getElementById('recording-review').classList.contains('hidden'), false);
  assert.ok(window.lastRecordedMixFile);
  assert.equal(hooks.isStudioRecordingActive(), false);
});

test('MIDI controller scan reports unavailable, unmapped, and mapped states', async () => {
  const window = loadAppDom();
  const { document } = window;
  const hooks = window.__DJBattleTestHooks;

  Object.defineProperty(window.navigator, 'requestMIDIAccess', { configurable:true, value:undefined });
  const unsupported = await hooks.scanMidiControllers();
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error, 'web_midi_unavailable');
  assert.equal(hooks.getControllerState().status, 'unsupported');
  assert.equal(document.getElementById('mapping-status').textContent, 'Unsupported hardware/browser');

  const unknownInput = { name:'Mystery Surface' };
  Object.defineProperty(window.navigator, 'requestMIDIAccess', {
    configurable:true,
    value:async () => ({ inputs:new Map([['unknown', unknownInput]]) })
  });
  const unmapped = await hooks.scanMidiControllers();
  assert.equal(unmapped.ok, true);
  assert.equal(hooks.getControllerState().status, 'connected');
  assert.equal(hooks.getControllerState().mappingStatus, 'Detected but unmapped');
  unknownInput.onmidimessage({ data:[176, 10, 64] });
  assert.equal(hooks.getControllerState().midiActivity, 'CC 176 10 64');

  const mappedInput = { name:'Pioneer DDJ-400 MIDI' };
  Object.defineProperty(window.navigator, 'requestMIDIAccess', {
    configurable:true,
    value:async () => ({ inputs:new Map([['mapped', mappedInput]]) })
  });
  const mapped = await hooks.scanMidiControllers();
  assert.equal(mapped.ok, true);
  assert.equal(hooks.getControllerState().mappingStatus, 'Partially supported');
  assert.equal(hooks.getControllerState().mappings.playPause, 'learn-ready');
  assert.equal(typeof mappedInput.onmidimessage, 'function');
  mappedInput.onmidimessage({ data:[144, 1, 127] });
  assert.equal(hooks.getControllerState().midiActivity, 'CC 144 1 127');
});

test('playlist parser handles M3U, M3U8, and quoted CSV metadata', () => {
  const window = loadAppDom();
  const { parsePlaylistText } = window.__DJBattleTestHooks;

  const m3uRows = parsePlaylistText(String.raw`#EXTM3U
#EXTINF:203,DJ One - Alpha Deck Tool
C:\Music\Alpha Deck Tool.mp3`, 'battle-crate.m3u');
  assert.equal(m3uRows.length, 1);
  assert.equal(m3uRows[0].artist, 'DJ One');
  assert.equal(m3uRows[0].title, 'Alpha Deck Tool');
  assert.equal(m3uRows[0].sourceTrackId, String.raw`C:\Music\Alpha Deck Tool.mp3`);
  assert.equal(m3uRows[0].transferType, 'local_file_reference');

  const m3u8Rows = parsePlaylistText(`#EXTM3U
#EXTINF:180,Open Format Intro
relative/path/intro.wav`, 'warmup.m3u8');
  assert.equal(m3u8Rows.length, 1);
  assert.equal(m3u8Rows[0].title, 'Open Format Intro');
  assert.equal(m3u8Rows[0].sourcePlaylistId, 'warmup.m3u8');

  const csvRows = parsePlaylistText('title,artist,album,bpm,key,sourceTrackId,sourcePlaylistId,transferType\n"Alpha, Extended","DJ ""One""","Night Crate",128,8A,srv-alpha,crate-1,metadata_only', 'metadata.csv');
  assert.equal(csvRows.length, 1);
  assert.equal(csvRows[0].title, 'Alpha, Extended');
  assert.equal(csvRows[0].artist, 'DJ "One"');
  assert.equal(csvRows[0].sourceTrackId, 'srv-alpha');
  assert.equal(csvRows[0].transferType, 'metadata_only');
});

test('playlist export CSV round-trips back through the parser', () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  window.HTMLAnchorElement.prototype.click = () => {};
  window.URL.createObjectURL = () => 'blob:playlist-export';
  window.URL.revokeObjectURL = () => {};
  hooks.setLibraryTracks([demoTrack()]);
  hooks.setLibraryCrates([{
    id:'crate-1',
    name:'Round Trip Crate',
    type:'playlist',
    visibility:'private',
    trackIds:['my:alpha'],
    items:[{
      title:'Metadata Only Link',
      artist:'Remote DJ',
      bpm:'126',
      key:'D minor',
      source:'CSV',
      sourceTrackId:'remote-1',
      sourcePlaylistId:'remote-crate',
      transferType:'metadata_only'
    }]
  }]);
  hooks.setLibraryFilters({ crate:'crate-1' });

  const exported = hooks.exportActiveStudioPlaylist();
  assert.equal(exported.ok, true);
  assert.equal(exported.rows.length, 2);
  assert.match(exported.csv, /Alpha Deck Tool/);

  const roundTripRows = hooks.parsePlaylistText(exported.csv, 'round-trip.csv');
  assert.equal(roundTripRows.length, 2);
  assert.equal(roundTripRows[0].title, 'Alpha Deck Tool');
  assert.equal(roundTripRows[0].artist, 'DJ One');
  assert.equal(roundTripRows[0].sourcePlaylistId, 'crate-1');
  assert.equal(roundTripRows[1].title, 'Metadata Only Link');
  assert.equal(roundTripRows[1].transferType, 'metadata_only');
});

['m3u', 'm3u8'].forEach(format => {
  test(`playlist export ${format.toUpperCase()} round-trips order and metadata`, () => {
    const window = loadAppDom();
    const hooks = window.__DJBattleTestHooks;
    window.HTMLAnchorElement.prototype.click = () => {};
    window.URL.createObjectURL = () => 'blob:playlist-export';
    window.URL.revokeObjectURL = () => {};
    hooks.setLibraryTracks([demoTrack()]);
    hooks.setLibraryCrates([{
      id:'crate-1', name:'Round Trip Crate', type:'playlist', visibility:'private', trackIds:['my:alpha'],
      items:[{ title:'Metadata Only Link', artist:'Remote DJ', bpm:'126', key:'D minor', source:'CSV', sourceTrackId:'remote-1', sourcePlaylistId:'remote-crate', transferType:'metadata_only' }]
    }]);
    hooks.setLibraryFilters({ crate:'crate-1' });

    const exported = hooks.exportActiveStudioPlaylist(format);
    const roundTripRows = hooks.parsePlaylistText(exported.content, `round-trip.${format}`);
    assert.equal(exported.format, format);
    assert.equal(roundTripRows.length, 2);
    assert.equal(roundTripRows[0].title, 'Alpha Deck Tool');
    assert.equal(roundTripRows[0].artist, 'DJ One');
    assert.equal(roundTripRows[0].sourcePlaylistId, 'crate-1');
    assert.equal(roundTripRows[1].title, 'Metadata Only Link');
    assert.equal(roundTripRows[1].key, 'D minor');
    assert.equal(roundTripRows[1].playlistOrder, 2);
  });
});

test('deck loading keeps Deck A and Deck B state isolated', () => {
  const window = loadAppDom();
  const { document } = window;
  const hooks = window.__DJBattleTestHooks;

  hooks.setLibraryTracks([demoTrack(), bravoTrack()]);

  const deckA = hooks.loadLibraryTrackToDeck('my:alpha', 'a');
  assert.equal(deckA.ok, true);
  assert.equal(hooks.getStudioDeckState().a.trackId, 'my:alpha');
  assert.equal(hooks.getStudioDeckState().b, null);
  assert.equal(document.getElementById('name-a').textContent, 'Alpha Deck Tool');
  assert.equal(document.getElementById('name-b').textContent, 'No Track');

  const deckB = hooks.loadLibraryTrackToDeck('my:bravo', 'b');
  assert.equal(deckB.ok, true);
  assert.equal(hooks.getStudioDeckState().a.trackId, 'my:alpha');
  assert.equal(hooks.getStudioDeckState().b.trackId, 'my:bravo');
  assert.equal(document.getElementById('name-a').textContent, 'Alpha Deck Tool');
  assert.equal(document.getElementById('name-b').textContent, 'Bravo Deck Tool');
});

test('deck loading fails safely for missing tracks and invalid deck names', () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;

  hooks.setLibraryTracks([demoTrack()]);

  const missing = hooks.loadLibraryTrackToDeck('my:missing', 'a');
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'Track is unavailable.');

  const invalidDeck = hooks.loadLibraryTrackToDeck('my:alpha', 'x');
  assert.equal(invalidDeck.ok, false);
  assert.equal(invalidDeck.error, 'Choose Deck A or Deck B.');
  assert.equal(hooks.getStudioDeckState().a, null);
  assert.equal(hooks.getStudioDeckState().b, null);
});

test('drawer load action sends the selected track to the intended deck', () => {
  const window = loadAppDom();
  const { document } = window;
  const hooks = window.__DJBattleTestHooks;

  hooks.setLibraryTracks([demoTrack()]);
  assert.equal(hooks.openStudioLibraryDrawer('b'), true);

  const loadButton = document.querySelector('[data-drawer-load="my:alpha"]');
  assert.ok(loadButton);
  loadButton.click();

  assert.equal(hooks.getLibraryState().studioLibraryDrawer.deck, 'b');
  assert.equal(hooks.getStudioDeckState().a, null);
  assert.equal(hooks.getStudioDeckState().b.trackId, 'my:alpha');
  assert.equal(document.getElementById('name-b').textContent, 'Alpha Deck Tool');
});

test('deck audio graph is initialized once and teardown clears runtime references', async () => {
  const window = loadAppDom({ recordingMocks:true });
  const hooks = window.__DJBattleTestHooks;

  const first = hooks.ensureAudioGraph();
  const second = hooks.ensureAudioGraph();

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(window.__audioGraphStats.contexts, 1);
  assert.equal(window.__audioGraphStats.sources, 2);
  const diagnostics = hooks.getDeckRuntimeDiagnostics();
  assert.equal(diagnostics.audioContextActive, true);
  assert.equal(diagnostics.recordingDestinationActive, true);
  assert.equal(diagnostics.sourceCount, 2);
  assert.equal(diagnostics.gainCount, 2);
  assert.equal(diagnostics.focusedDeck, 'a');
  assert.equal(diagnostics.deckFiles.length, 0);
  assert.equal(diagnostics.meterCount, 0);

  const tornDown = await hooks.teardownDeckAudioGraph();
  assert.equal(tornDown.ok, true);
  assert.equal(window.__audioGraphStats.closed, 1);
  assert.equal(hooks.getDeckRuntimeDiagnostics().audioContextActive, false);
  assert.equal(hooks.getDeckRuntimeDiagnostics().sourceCount, 0);
  assert.equal(hooks.getDeckRuntimeDiagnostics().gainCount, 0);
});

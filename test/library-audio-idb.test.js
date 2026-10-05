const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');

function installMemoryIndexedDb(window){
  const stores = new Map();
  class MemoryRequest{
    constructor(result, error){
      this.result = result;
      this.error = error || null;
      Promise.resolve().then(() => {
        if(this.error){ if(this.onerror) this.onerror({ target:this }); }
        else if(this.onsuccess) this.onsuccess({ target:this });
      });
    }
  }
  class MemoryStore{
    constructor(name){ this.name = name; if(!stores.has(name)) stores.set(name, new Map()); }
    map(){ return stores.get(this.name); }
    put(value, key){ this.map().set(String(key), value); return new MemoryRequest(key); }
    get(key){ return new MemoryRequest(this.map().get(String(key))); }
    delete(key){ this.map().delete(String(key)); return new MemoryRequest(undefined); }
  }
  class MemoryTx{
    constructor(store){ this._store = store; Promise.resolve().then(() => { if(this.oncomplete) this.oncomplete(); }); }
    objectStore(){ return this._store; }
  }
  class MemoryDb{
    constructor(){ this.objectStoreNames = { contains: () => true }; }
    transaction(){ return new MemoryTx(new MemoryStore('blobs')); }
    close(){}
  }
  window.indexedDB = {
    open(){ return new MemoryRequest(new MemoryDb()); }
  };
}

function loadAppDom(before){
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(index, { url:'http://127.0.0.1/index.html', runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom;
  window.alert = () => {};
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal(){ this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function close(){ this.removeAttribute('open'); };
  window.fetch = async () => ({ ok:false, status:503, text: async () => '{}' });
  let objectUrls = 0;
  window.URL.createObjectURL = () => `blob:memory-${++objectUrls}`;
  window.URL.revokeObjectURL = () => {};
  installMemoryIndexedDb(window);
  if(before) before(window);
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  return window;
}

test('local library audio blobs persist in IndexedDB and restore object URLs', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setLibraryTracks([{
    id:'u-audio-1', title:'Local Flip', name:'Local Flip', artist:'Guest', source:'MY_LIBRARY',
    genre:'Bass House', bpm:'--', key:'--', size:12, localAudioPersisted:false, audioMissing:false
  }]);
  const blob = new window.Blob([new Uint8Array([1,2,3,4])], { type:'audio/wav' });
  const saved = await hooks.attachLibraryAudioBlob('u-audio-1', blob);
  assert.equal(saved.ok, true);
  assert.ok(hooks.getLibrarySessionAudioUrls().get('u-audio-1'));
  assert.ok(await hooks.loadLibraryAudioBlob('u-audio-1'));
  hooks.getLibrarySessionAudioUrls().clear();
  const track = hooks.getLibraryState().library.find(row => row.id === 'u-audio-1');
  track.localAudioPersisted = true;
  track.audioMissing = false;
  await hooks.restoreLibraryAudioFromIndexedDb();
  assert.ok(hooks.getLibrarySessionAudioUrls().get('u-audio-1'));
  assert.equal(hooks.libraryAudioStatusLabel(track), 'Audio ready');
});

test('missing IndexedDB blobs are marked audio missing - re-attach', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.setLibraryTracks([{
    id:'u-missing-1', title:'Gone Mix', name:'Gone Mix', artist:'Guest', source:'MY_LIBRARY',
    genre:'Bass House', size:9, localAudioPersisted:true, audioMissing:false
  }]);
  await hooks.restoreLibraryAudioFromIndexedDb();
  const track = hooks.getLibraryState().library.find(row => row.id === 'u-missing-1');
  assert.equal(track.audioMissing, true);
  assert.equal(hooks.libraryAudioStatusLabel(track), 'audio missing - re-attach');
});

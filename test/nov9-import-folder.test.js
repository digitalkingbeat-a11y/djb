// Nov 9: Import a music folder (webkitdirectory) into the Library.
const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const windows = [];
test.after(() => windows.forEach(w => { try{ w.close(); }catch(e){} }));

function loadAppDom(setup){
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(index, { url:'http://127.0.0.1/index.html', runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom;
  window.alert = () => {};
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function(){ this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function(){ this.removeAttribute('open'); };
  window.fetch = async () => ({ ok:false, status:503, text: async () => '{}', json: async () => ({}) });
  if(!window.File.prototype.arrayBuffer){
    window.File.prototype.arrayBuffer = function(){
      return new Promise((resolve, reject) => {
        const r = new window.FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsArrayBuffer(this);
      });
    };
  }
  if(setup) setup(window);
  const files = ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'];
  files.forEach(file => {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    window.eval(file === 'app.js' ? `${code}\n;window.__inApp = source => eval(source);` : code);
  });
  windows.push(window);
  return window;
}

function F(name, type, size, pathHint){
  const file = new File([new Uint8Array(Math.max(4, size || 8))], name, { type: type || 'audio/mpeg' });
  Object.defineProperty(file, 'size', { value: size || 8 });
  if(pathHint) Object.defineProperty(file, 'webkitRelativePath', { value: pathHint });
  return file;
}

function stubFolderSupport(win, supported){
  const orig = win.document.createElement.bind(win.document);
  win.document.createElement = function(tag, options){
    const el = orig(tag, options);
    if(String(tag).toLowerCase() === 'input'){
      Object.defineProperty(el, 'webkitdirectory', {
        configurable:true,
        enumerable:true,
        get(){ return supported ? false : undefined; },
        set(){}
      });
      if(!supported){
        Object.defineProperty(el, 'directory', { configurable:true, get(){ return undefined; }, set(){} });
      } else {
        Object.defineProperty(el, 'directory', { configurable:true, get(){ return false; }, set(){} });
      }
    }
    return el;
  };
}

test('Library has an Import folder control with webkitdirectory, plus a phone fallback note', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="library-folder-import"[^>]*webkitdirectory/);
  assert.match(html, /id="library-folder-import-label"/);
  assert.match(html, /id="library-folder-hint"/);
  assert.match(html, /On iPhone, use Upload Tracks/);
  assert.match(html, /id="library-folder-progress"/);
  const css = fs.readFileSync(path.join(root, 'professional-redesign.css'), 'utf8');
  assert.match(css, /\.library-folder-progress/);
});

test('supported browsers show Import folder and hide the iPhone note', () => {
  const w = loadAppDom(win => stubFolderSupport(win, true));
  const h = w.__DJBattleTestHooks;
  assert.equal(h.folderImportSupported(), true);
  assert.equal(w.document.getElementById('library-folder-import-label').hidden, false);
  assert.equal(w.document.getElementById('library-folder-hint').hidden, true);
});

test('unsupported browsers hide the button and show the iPhone note', () => {
  // jsdom has no webkitdirectory boolean, matching iPhone Safari.
  const w = loadAppDom();
  const h = w.__DJBattleTestHooks;
  assert.equal(h.folderImportSupported(), false);
  assert.equal(w.document.getElementById('library-folder-import-label').hidden, true);
  assert.equal(w.document.getElementById('library-folder-hint').hidden, false);
  assert.match(w.document.getElementById('library-folder-hint').textContent, /iPhone/);
});

test('folder import keeps only audio, skips duplicates, and reports Added / skipped', async () => {
  const w = loadAppDom(win => stubFolderSupport(win, true));
  const h = w.__DJBattleTestHooks;
  w.__inApp(`state.library.push({ id:'existing', title:'Keep', name:'Keep', fileName:'keep.mp3', size:100, source:'MY_LIBRARY' })`);
  const files = [
    F('keep.mp3', 'audio/mpeg', 100, 'Mixes/keep.mp3'),
    F('new-heat.mp3', 'audio/mpeg', 220, 'Mixes/new-heat.mp3'),
    F('notes.txt', 'text/plain', 12, 'Mixes/notes.txt'),
    F('cover.png', 'image/png', 50, 'Mixes/cover.png'),
    F('new-heat.mp3', 'audio/mpeg', 220, 'Mixes/copy/new-heat.mp3')
  ];
  const result = await h.handleLibraryFolderFiles(files);
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 2);
  assert.equal(result.rejected, 2);
  assert.ok(w.__inApp(`state.library.some(t => /new-heat/i.test(t.fileName || t.title || ''))`));
  const toast = w.document.querySelector('#notification-toast-rack .notification-toast');
  assert.ok(toast);
  assert.match(toast.textContent, /Added 1/);
  assert.match(toast.textContent, /skipped/);
});

test('folder import reuses the existing audio filter, duplicate check and metadata paths', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /async function handleLibraryFolderFiles/);
  assert.match(app, /splitDroppedFiles\(incoming\)/);
  assert.match(app, /findDuplicateUpload\(f, list\)/);
  assert.match(app, /extractAudioFileMetadata\(f\)/);
  assert.match(app, /createServerBackedLibraryTrackFromFile/);
  assert.match(app, /attachLibraryAudioBlob/);
  assert.match(app, /wireLibraryFolderImport\(\)/);
});

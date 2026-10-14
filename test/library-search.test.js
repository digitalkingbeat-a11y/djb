const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');

function loadAppDom(){
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(index, { url:'http://127.0.0.1/index.html', runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom;
  window.alert = () => {};
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal(){ this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function close(){ this.removeAttribute('open'); };
  window.fetch = async () => ({ ok:false, status:503, text: async () => '{}', json: async () => ({}) });
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    window.eval(file === 'app.js' ? `${code}\n;window.__inApp = source => eval(source);` : code);
  });
  return { window };
}

function seed(window){
  window.__inApp(`state.library.length = 0; state.libraryFilters.crate = 'my'; state.libraryFilters.compatibleOnly = false;
    ['Night Drive','Sunrise Groove','Night Owl'].forEach((t,i)=>state.library.push({ id:'s'+i, libraryId:'s'+i, title:t, name:t, artist:'DK', bpm:'124', key:'8A', duration:'3:25', size:10, _libraryOrigin:'my' }));
    switchView('library'); state.libraryFilters.search=''; renderLibrary();`);
}
function type(window, value){
  const input = window.document.getElementById('global-search');
  input.value = value;
  input.dispatchEvent(new window.Event('input'));
}

test('search shows a live "N of M tracks" count and a clear button', () => {
  const { window } = loadAppDom(); seed(window);
  const doc = window.document;
  const total = window.__inApp(`libraryTotalBeforeSearch()`);
  assert.equal(doc.getElementById('library-search-clear').hidden, true);
  assert.match(doc.getElementById('library-search-count').textContent, new RegExp(`^${total} tracks?$`));
  type(window, 'night');
  const shown = doc.querySelectorAll('#library-table tr[data-library-row]').length;
  assert.ok(shown >= 2 && shown < total + 1);
  assert.equal(doc.getElementById('library-search-count').textContent, `${shown} of ${total} tracks`);
  assert.equal(doc.getElementById('library-search-clear').hidden, false);
  assert.equal(doc.getElementById('library-search-clear').getAttribute('aria-label'), 'Clear search');
  doc.getElementById('library-search-clear').click();
  assert.equal(doc.getElementById('global-search').value, '');
  assert.equal(doc.getElementById('library-search-clear').hidden, true);
});

test('no results shows "Nothing matches" with a reset that clears the search', () => {
  const { window } = loadAppDom(); seed(window);
  const doc = window.document;
  type(window, 'zzqx-none');
  assert.match(doc.getElementById('library-table').textContent, /Nothing matches “zzqx-none”/);
  assert.match(doc.getElementById('library-search-count').textContent, /^0 of \d+ tracks$/);
  doc.querySelector('[data-library-search-reset]').click();
  assert.equal(doc.getElementById('global-search').value, '');
  assert.ok(doc.querySelectorAll('#library-table tr[data-library-row]').length >= 3);
});

test('Escape in the search box clears it', () => {
  const { window } = loadAppDom(); seed(window);
  type(window, 'night');
  const input = window.document.getElementById('global-search');
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
  assert.equal(input.value, '');
});

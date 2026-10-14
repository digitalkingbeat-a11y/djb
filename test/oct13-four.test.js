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
const tick = (w, ms=5) => new Promise(r => w.setTimeout(r, ms));

test('sign out asks about removing data; Keep leaves data, Remove clears only app keys', async () => {
  const { window } = loadAppDom();
  window.DJB_NO_RELOAD = true;
  let signedOut = 0;
  window.supabase = { auth:{ signOut: async () => { signedOut++; } } };
  window.localStorage.setItem('djBattleTestMarker', 'x');
  window.localStorage.setItem('otherSite', 'keep');
  let p = window.__inApp('signOutWithDataPrompt()');
  const doc = window.document;
  assert.match(doc.getElementById('signout-title').textContent, /Also remove my data from this device\?/);
  doc.querySelector('[data-signout-keep]').click();
  let r = await p;
  assert.equal(r.removed, false); assert.equal(signedOut, 1);
  assert.equal(window.localStorage.getItem('djBattleTestMarker'), 'x');
  p = window.__inApp('signOutWithDataPrompt()');
  doc.querySelector('[data-signout-remove]').click();
  r = await p;
  assert.equal(r.removed, true);
  assert.equal(window.localStorage.getItem('djBattleTestMarker'), null);
  assert.equal(window.localStorage.getItem('otherSite'), 'keep');
  p = window.__inApp('signOutWithDataPrompt()');
  doc.querySelector('[data-signout-cancel]').click();
  r = await p; assert.equal(r.cancelled, true); assert.equal(signedOut, 2);
});

test('xhrUpload reports progress and can be cancelled', async () => {
  const { window } = loadAppDom();
  class FakeXHR { constructor(){ this.upload = {}; FakeXHR.last = this; } open(){} setRequestHeader(){} send(){ setTimeout(() => { this.upload.onprogress({ lengthComputable:true, loaded:50, total:100 }); }, 1); } abort(){ this.onabort(); } }
  const seen = [];
  const ctrl = new window.AbortController();
  const pending = window.DJBattleSubmission.xhrUpload({ url:'http://x/u', file:{}, onProgress:f => seen.push(f), signal:ctrl.signal, XHR:FakeXHR });
  await tick(window, 10);
  assert.deepEqual(seen, [0.5]);
  ctrl.abort();
  const res = await pending;
  assert.equal(res.cancelled, true);
  // success path
  class OkXHR extends FakeXHR { send(){ this.upload.onprogress({ lengthComputable:true, loaded:100, total:100 }); this.status = 200; this.onload(); } }
  const ok = await window.DJBattleSubmission.xhrUpload({ url:'http://x/u', file:{}, onProgress:f => seen.push(f), XHR:OkXHR });
  assert.equal(ok.ok, true);
});

test('upload UI shows percent, Cancel, and Retry that keeps the file', () => {
  const { window } = loadAppDom(); const doc = window.document;
  const up = window.__inApp("beginMixUploadUi({ name:'mix.mp3' })");
  assert.equal(doc.getElementById('br-upload-cancel').hidden, false);
  up.onProgress(0.42);
  assert.equal(doc.getElementById('br-upload-percent').textContent, '42%');
  assert.equal(doc.querySelector('#br-upload-progress i').style.width, '42%');
  assert.equal(window.__inApp('cancelMixUpload()'), true);
  window.__inApp("finishMixUploadUi({ error:'Upload cancelled.', cancelled:true })");
  const retry = doc.getElementById('br-submit-btn');
  assert.equal(retry.hidden, false);
  assert.match(retry.textContent, /mix\.mp3/);
  assert.equal(window.__inApp('mixUploadState.file.name'), 'mix.mp3');
});

test('archiving a crate shows Undo and lands in the Archived list for restore', () => {
  const { window } = loadAppDom(); const doc = window.document;
  window.__inApp("state.playlists.push({ id:'crate-test', name:'Warmup', trackIds:[] }); persist();");
  const before = window.__inApp('state.playlists.length');
  const id = window.__inApp("normalizeLibraryCrate(state.playlists.find(c=>c.id==='crate-test')).crateId");
  window.__inApp(`archiveCrateWithUndo(${JSON.stringify(id)})`);
  assert.equal(window.__inApp('state.playlists.length'), before - 1);
  const toast = doc.querySelector('.crate-undo-toast');
  assert.match(toast.textContent, /Crate archived/);
  toast.querySelector('button').click();
  assert.equal(window.__inApp('state.playlists.length'), before);
  assert.equal(doc.querySelector('.crate-undo-toast'), null);
  window.__inApp(`archiveCrateWithUndo(${JSON.stringify(id)})`);
  window.__inApp('renderArchivedCrates()');
  const restore = doc.querySelector('[data-crate-restore="crate-test"]');
  assert.ok(restore, 'archived list shows the crate');
  restore.click();
  assert.ok(window.__inApp("state.playlists.some(c=>c.id==='crate-test')"));
  assert.equal(window.__inApp('loadArchivedCrates().length'), 0);
});

test('rating history: empty state, chart and +N since last week', () => {
  const { window } = loadAppDom(); const doc = window.document;
  window.__inApp('state.battleResults = []; renderRatingHistory()');
  assert.match(doc.getElementById('profile-rating-history').textContent, /No battles yet/);
  const now = Date.now(), day = 86400000;
  const mk = (t, b, a) => ({ completedAt:new Date(t).toISOString(), progressBefore:{ rating:b }, progressAfter:{ rating:a } });
  window.__inApp(`state.battleResults = ${JSON.stringify([mk(now - 10*day, 40, 50), mk(now - 3*day, 50, 58), mk(now - day, 58, 62)])}; renderRatingHistory()`);
  const el = doc.getElementById('profile-rating-history');
  assert.match(el.textContent, /\+12 since last week/);
  assert.equal(el.querySelectorAll('svg circle').length, 3);
});

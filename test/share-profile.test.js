const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');

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
  if(before) before(window);
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  return window;
}

test('guest Share explains local-only profile and does not invent a public link', async () => {
  const window = loadAppDom();
  assert.ok(window.document.getElementById('share-profile-button'));
  const result = await window.__DJBattleTestHooks.shareCurrentProfile();
  assert.equal(result.shared, false);
  assert.equal(result.reason, 'local_only');
  assert.match(window.document.getElementById('share-profile-local-note').textContent, /local only/i);
  assert.match(window.document.getElementById('share-profile-local-note').textContent, /Sign in/i);
});

test('signed-in Share copies a #dj= deep link and shows a toast', async () => {
  let copied = '';
  const window = loadAppDom(win => {
    win.navigator.clipboard = { writeText: async (value) => { copied = value; } };
  });
  window.__DJBattleTestHooks.updateAuthUI({ id:'abc-123', email:'nova@example.com', user_metadata:{ full_name:'Nova Cut' } });
  const result = await window.__DJBattleTestHooks.shareCurrentProfile();
  assert.equal(result.shared, true);
  assert.match(result.url, /#dj=dj_abc123/);
  assert.equal(copied, result.url);
  const toast = window.document.querySelector('#notification-toast-rack .notification-toast');
  assert.ok(toast);
  assert.match(toast.textContent, /Profile link copied/i);
});

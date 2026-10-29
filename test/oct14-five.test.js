const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function loadAppDom(){
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(index, { url:'http://127.0.0.1/index.html', runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom;
  window.__alerts = [];
  window.alert = m => window.__alerts.push(m);
  window.confirm = () => { throw new Error('window.confirm should not be used'); };
  window.scrollTo = () => {};
  window.HTMLDialogElement.prototype.showModal = function(){ this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function(){ this.removeAttribute('open'); };
  window.fetch = async () => ({ ok:false, status:503, text: async () => '{}', json: async () => ({}) });
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    window.eval(file === 'app.js' ? `${code}\n;window.__inApp = source => eval(source);` : code);
  });
  return { window };
}
const tick = (w, ms=5) => new Promise(r => w.setTimeout(r, ms));
const SCRIPT = '<script>window.__pwned=1</script>';
const IMG = '<img src=x onerror="window.__pwned=1">';

test('escapeHtml turns script and img-onerror payloads into plain text', () => {
  const { window } = loadAppDom();
  const host = window.document.createElement('div');
  host.innerHTML = `<p>${window.escapeHtml(SCRIPT)}</p><p>${window.escapeHtml(IMG)}</p>`;
  assert.equal(host.querySelector('script'), null);
  assert.equal(host.querySelector('img'), null);
  assert.equal(host.textContent, SCRIPT + IMG);
});

test('community post, comment and toast render payloads as text, keep markup', () => {
  const { window } = loadAppDom();
  const host = window.document.createElement('div');
  host.innerHTML = window.__inApp(`communityPostHtml({ id:'p1', title:${JSON.stringify(IMG)}, body:${JSON.stringify(SCRIPT)}, authorName:${JSON.stringify(IMG)}, reactions:{}, createdAt:new Date().toISOString() })`);
  assert.equal(host.querySelector('img[onerror]'), null);
  assert.equal(host.querySelector('script'), null);
  assert.ok(host.textContent.includes(IMG));
  assert.ok(host.querySelector('article, div, button'), 'intended markup still rendered');
  const c = window.document.createElement('div');
  c.innerHTML = window.__inApp(`communityCommentHtml({ id:'c1', body:${JSON.stringify(IMG)}, authorName:${JSON.stringify(SCRIPT)}, createdAt:new Date().toISOString() })`);
  assert.equal(c.querySelector('img[onerror]'), null);
  assert.equal(c.querySelector('script'), null);
  const toast = window.appAlert(IMG);
  assert.equal(toast.querySelector('img'), null);
  assert.ok(toast.textContent.includes(IMG));
  assert.equal(window.__pwned, undefined);
});

test('premium modal escapes battle titles', () => {
  const { window } = loadAppDom();
  window.__inApp(`openPremium(${JSON.stringify('"' + IMG + '" requires Premium')})`);
  const modal = window.document.getElementById('modal-content');
  assert.equal(modal.querySelector('img[onerror]'), null);
  assert.ok(modal.textContent.includes(IMG));
});

test('text boxes get maxlength and a live N/max counter, including dynamic forms', async () => {
  const { window } = loadAppDom();
  const doc = window.document;
  const form = doc.createElement('div');
  form.innerHTML = '<input id="crate-name-x" type="text"><textarea id="post-body-x"></textarea><textarea id="comment-x"></textarea><input id="bio-x">';
  doc.body.appendChild(form);
  await tick(window, 20);
  const crate = doc.getElementById('crate-name-x');
  assert.equal(crate.getAttribute('maxlength'), '60');
  assert.equal(doc.getElementById('post-body-x').getAttribute('maxlength'), '2000');
  assert.equal(doc.getElementById('comment-x').getAttribute('maxlength'), '500');
  assert.equal(doc.getElementById('bio-x').getAttribute('maxlength'), '280');
  crate.value = 'Friday Night';
  crate.dispatchEvent(new window.Event('input'));
  assert.equal(crate.nextElementSibling.textContent, '12/60');
});

test('battle room actions ask in-app first and block double taps', async () => {
  const { window } = loadAppDom();
  const doc = window.document;
  const btn = doc.getElementById('br-start');
  let runs = 0;
  btn.onclick = async () => { runs++; };
  window.guardBattleRoomButtons();
  btn.onclick();
  btn.onclick();
  assert.equal(btn.disabled, true);
  assert.equal(doc.querySelectorAll('.app-confirm-overlay').length, 1);
  doc.querySelector('[data-app-confirm-cancel]').click();
  await tick(window);
  assert.equal(runs, 0); assert.equal(btn.disabled, false);
  btn.onclick();
  doc.querySelector('[data-app-confirm-ok]').click();
  await tick(window);
  assert.equal(runs, 1); assert.equal(btn.disabled, false);
  window.guardBattleRoomButtons();
  btn.onclick();
  assert.equal(doc.querySelectorAll('.app-confirm-overlay').length, 1, 'not double-wrapped');
});

test('no bare alert() left and appAlert shows a toast', () => {
  assert.equal((appSource.match(/(?<![\w.])alert\(/g) || []).length, 0);
  const { window } = loadAppDom();
  window.appAlert('Choose a mix file first.');
  assert.match(window.document.getElementById('notification-toast-rack').textContent, /Choose a mix file first/);
  assert.equal(window.__alerts.length, 0);
});

test('copyright check never invents a result; judge preview has no random scores', async () => {
  const { window } = loadAppDom();
  const track = { title:'My Track' };
  // Oct 29: the coming-soon check became an "I own or have the rights" tick; still no invented result.
  const pending = window.__inApp('runCopyrightCheck')(track);
  assert.match(window.document.getElementById('modal-content').textContent, /I own or have the rights to this music/);
  assert.doesNotMatch(window.document.getElementById('modal-content').textContent, /Coming soon/);
  window.document.querySelector('#modal-content button[value="cancel"]').click();
  const r = await pending;
  assert.equal(r.cancelled, true);
  assert.equal(r.rightsConfirmed, false);
  const fnSrc = appSource.slice(appSource.indexOf('async function runCopyrightCheck'), appSource.indexOf('async function runCopyrightCheck') + 900);
  assert.doesNotMatch(fnSrc, /Math\.random/);
  window.document.getElementById('judge-score-preview').click();
  const t = window.document.getElementById('score-breakdown').textContent;
  assert.match(t, /PREVIEW/); assert.match(t, /— \/ 100/);
});

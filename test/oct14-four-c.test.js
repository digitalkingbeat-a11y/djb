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
const src = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

test('no window.confirm left for the six risky actions; they use the red in-app confirm', () => {
  assert.doesNotMatch(src, /confirm\('(Delete this post|Cancel this battle|Withdraw from this battle|Archive this crate|Block this DJ|A recording is in progress)/);
  ['Delete post','Cancel battle','Withdraw','Archive crate','Block DJ','Leave Studio'].forEach(l => assert.match(src, new RegExp(`'${l}'\\)`)));
});

test('danger confirm shows a red button and resolves from the in-app box', async () => {
  const { window } = loadAppDom(); let used = 0; window.confirm = () => { used++; return true; };
  const h = window.__DJBattleTestHooks;
  const p = h.appConfirmDanger('Delete this post?', 'Gone for good.', 'Delete post');
  const ok = window.document.querySelector('.app-confirm-overlay--danger [data-app-confirm-ok]');
  assert.ok(ok.classList.contains('danger-btn'));
  assert.equal(ok.textContent, 'Delete post');
  ok.click();
  assert.equal(await p, true);
  assert.equal(used, 0);
});

test('report shows Spam/Harassment/Copyright/Other and sends the chosen reason and note', async () => {
  const { window } = loadAppDom();
  const calls = [];
  window.__inApp('communityServerMode = () => true');
  window.DJBattleApi.apiRequest = async (url, opts) => { calls.push({ url, body:opts.body }); return { data:{} }; };
  const p = window.__inApp('reportCommunityPost("post-9")');
  await tick(window);
  const labels = [...window.document.querySelectorAll('.report-reason strong')].map(n => n.textContent);
  assert.deepEqual(labels, ['Spam','Harassment','Copyright','Other']);
  window.document.querySelector('input[value="copyright"]').checked = true;
  window.document.getElementById('report-note').value = 'My own track re-uploaded';
  window.document.querySelector('[data-report-send]').click();
  await p;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/community/reports');
  assert.equal(calls[0].body.reason, 'copyright');
  assert.equal(calls[0].body.note, 'My own track re-uploaded');
  assert.match(calls[0].body.context, /My own track re-uploaded/);
});

test('cancelling the report menu sends nothing', async () => {
  const { window } = loadAppDom(); let n = 0;
  window.__inApp('communityServerMode = () => true');
  window.DJBattleApi.apiRequest = async () => { n++; return { data:{} }; };
  const p = window.__inApp('reportCommunityPost("p")'); await tick(window);
  window.document.querySelector('[data-report-cancel]').click();
  assert.equal((await p).cancelled, true); assert.equal(n, 0);
});

test('failed action shows an error toast whose Retry runs it again', async () => {
  const { window } = loadAppDom(); const h = window.__DJBattleTestHooks; let runs = 0;
  await h.runAction(async () => { runs++; return runs === 1 ? { error:'Server busy' } : { ok:true }; }, { label:'Refreshing' });
  const btn = window.document.querySelector('.notification-toast--error [data-toast-retry]');
  assert.ok(btn); assert.match(btn.parentElement.textContent, /Refreshing failed: Server busy/);
  btn.click(); await tick(window);
  assert.equal(runs, 2);
});

test('global error handler shows a friendly toast, rate-limited', () => {
  const { window } = loadAppDom(); const h = window.__DJBattleTestHooks;
  assert.equal(h.handleGlobalError(new Error('x')), true);
  assert.equal(h.handleGlobalError(new Error('y')), false);
  assert.equal(window.document.querySelectorAll('.notification-toast--error').length, 1);
  assert.match(src, /addEventListener\('unhandledrejection'/);
});

test('relative times: min ago, Yesterday, days ago, then a date', () => {
  const { window } = loadAppDom(); const r = window.__DJBattleTestHooks.relativeTimeLabel;
  const now = new Date(2026, 9, 14, 15, 0, 0).getTime();
  assert.equal(r(now - 10000, now), 'Just now');
  assert.equal(r(now - 5*60000, now), '5 min ago');
  assert.equal(r(now - 3*3600000, now), '3 hr ago');
  assert.equal(r(new Date(2026, 9, 13, 20).getTime(), now), 'Yesterday');
  assert.equal(r(new Date(2026, 9, 10, 12).getTime(), now), '4 days ago');
  assert.doesNotMatch(r(new Date(2026, 8, 1).getTime(), now), /ago|Yesterday/);
});

test('artwork images lazy-load and feed/comments use relative times', () => {
  assert.equal((src.match(/artwork" loading="lazy" decoding="async"/g) || []).length, 2);
  assert.match(src, /relativeTimeHtml\(post\.createdAt\)/);
  assert.match(src, /relativeTimeHtml\(comment\.createdAt\)/);
});

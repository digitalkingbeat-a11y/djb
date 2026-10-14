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

test('rank movement never uses built-in sample DJs; uses live rows when synced', () => {
  const { window } = loadAppDom();
  assert.equal(window.__inApp('localRankForRating(1900)'), null);
  assert.match(window.__inApp('rankMovementModule(null, null)'), /Local estimate/);
  window.__inApp(`state.publicRankings.status='synced'; state.publicRankings.rows=[{displayName:'Real A', rating:2000},{displayName:'Real B', rating:1500}]`);
  assert.equal(window.__inApp('localRankForRating(1800)'), 2);
  assert.equal(window.__inApp('localRankForRating(2100)'), 1);
  assert.match(window.__inApp('rankMovementModule(3, 2)'), /#3 -> #2.*Moved up/);
});

test('battles never get placeholder tracks and show Need N more tracks', () => {
  const { window } = loadAppDom();
  window.__inApp(`state.platformLibrary=[]; state.library=[{name:'Real One', battleEligible:true}]`);
  const assigned = window.__inApp('assignTracksForBattle({}, 3)');
  assert.deepEqual(Array.from(assigned), ['Real One']);
  assert.equal(window.__inApp('missingBattleTracks(assignTracksForBattle({}, 3), 3)'), 2);
  window.__inApp(`showNeedMoreTracks({title:'Test Battle'}, 2)`);
  assert.match(window.document.getElementById('modal-content').textContent, /Need 2 more tracks/);
  assert.ok(!/Assignment pending track/.test(appSource));
});

test('index.html has favicon and Open Graph / Twitter meta; share meta updates', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(index, /rel="icon"[^>]*favicon\.svg/);
  assert.match(index, /favicon-64\.png/);
  ['og:title','og:description','og:image'].forEach(k => assert.ok(index.includes(`property="${k}"`), k));
  ['twitter:card','twitter:title','twitter:description','twitter:image'].forEach(k => assert.ok(index.includes(`name="${k}"`), k));
  assert.ok(fs.existsSync(path.join(root, 'assets/favicon.svg')) && fs.existsSync(path.join(root, 'assets/og-image.png')));
  const { window } = loadAppDom();
  window.__inApp(`setShareMeta('DJ Test — DJ Battle profile', 'Desc here')`);
  assert.equal(window.document.title, 'DJ Test — DJ Battle profile');
  assert.equal(window.document.querySelector('meta[property="og:title"]').getAttribute('content'), 'DJ Test — DJ Battle profile');
  assert.equal(window.document.querySelector('meta[name="twitter:description"]').getAttribute('content'), 'Desc here');
});

test('unread alerts show in tab title and clear when Activity opens', () => {
  const { window } = loadAppDom();
  window.__inApp(`state.djNotifications.counts={unreadTotal:2}; renderNotificationCountPill()`);
  assert.equal(window.document.title, '(2) DJ Battle');
  window.__inApp(`switchView('activity')`);
  assert.equal(window.document.title, 'DJ Battle — Battle Studio');
  window.__inApp(`state.djNotifications.counts={unreadTotal:3}; renderNotificationCountPill()`);
  assert.equal(window.document.title, '(1) DJ Battle');
});

test('offline rankings show sample tag and the user as Unranked', () => {
  const { window } = loadAppDom();
  window.__inApp(`state.publicRankings.status='failed'; state.publicRankings.rows=[]; renderRankingRows(); renderAiLeaderboard()`);
  const list = window.document.getElementById('rankings-list');
  assert.match(list.textContent, /Sample rankings — not live/);
  assert.match(list.querySelector('.sample-you-row').textContent, /Unranked/);
  assert.ok(window.document.getElementById('ai-sample-tag'));
});

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
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  return { window };
}

test('nav has a Home item that opens Battle Home', () => {
  const { window } = loadAppDom();
  const doc = window.document;
  const home = doc.querySelector('#nav .nav-btn[data-view="dashboard"]');
  assert.ok(home, 'expected a Home nav button');
  assert.match(home.textContent, /Home/);
  doc.querySelector('#nav .nav-btn[data-view="battles"]').click();
  home.click();
  assert.ok(doc.getElementById('dashboard').classList.contains('active'));
  assert.equal(doc.getElementById('page-title').textContent, 'Battle Home');
});

test('clicking the DB logo opens Battle Home', () => {
  const { window } = loadAppDom();
  const doc = window.document;
  doc.querySelector('#nav .nav-btn[data-view="battles"]').click();
  doc.getElementById('brand-home').click();
  assert.ok(doc.getElementById('dashboard').classList.contains('active'));
});

test('hero shows empty state with no battles, never a fake 91', () => {
  const { window } = loadAppDom();
  const doc = window.document;
  assert.notEqual(doc.getElementById('hero-score-value').textContent, '91');
  assert.equal(doc.getElementById('hero-score-value').textContent, '--');
  assert.match(doc.getElementById('hero-score-unit').textContent, /No battles yet/);
});

test('hero shows the latest real battle score', () => {
  const { window } = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  const results = hooks.getBattleResults();
  results.push({ title:'Old Mix', score:70, completedAt:'2026-01-01T00:00:00Z', date:'1/1/2026', outcome:'loss' });
  results.push({ title:'Fresh Mix', score:83.4, completedAt:'2026-10-01T00:00:00Z', date:'10/1/2026', outcome:'win' });
  hooks.renderHeroScore();
  const doc = window.document;
  assert.equal(doc.getElementById('hero-score-value').textContent, '83');
  assert.equal(doc.getElementById('hero-score-unit').textContent, '/100');
  assert.match(doc.getElementById('hero-score-title').textContent, /Fresh Mix/);
  assert.equal(hooks.latestBattleScore([]), null);
});

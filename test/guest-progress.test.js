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

test('new guests start at 0-0 / White / 0 XP and dashboard stats follow battleProgress', () => {
  const window = loadAppDom();
  const progress = window.__DJBattleTestHooks.getBattleProgress();
  assert.equal(progress.wins, 0);
  assert.equal(progress.losses, 0);
  assert.equal(progress.xp, 0);
  assert.equal(progress.rating, 0);
  assert.equal(progress.belt, 'White');
  assert.equal(window.document.getElementById('dashboard-wins').textContent, '0');
  assert.equal(window.document.getElementById('dashboard-losses').textContent, '0');
  assert.equal(window.document.getElementById('dashboard-ai-avg').textContent, '0');
  assert.equal(window.document.getElementById('dashboard-rank').textContent, 'Unranked');
  assert.match(window.document.getElementById('dashboard-xp-label').textContent, /^0 \/ /);
});

test('existing localStorage battleProgress values are kept', () => {
  const window = loadAppDom(win => {
    win.localStorage.setItem('djBattleBattleProgress', JSON.stringify({
      xp: 620, rating: 87, rankingRating: 1744, wins: 12, losses: 4, belt: 'White'
    }));
  });
  const progress = window.__DJBattleTestHooks.getBattleProgress();
  assert.equal(progress.wins, 12);
  assert.equal(progress.losses, 4);
  assert.equal(progress.xp, 620);
  assert.equal(progress.rating, 87);
  assert.equal(window.document.getElementById('dashboard-wins').textContent, '12');
  assert.equal(window.document.getElementById('dashboard-losses').textContent, '4');
  assert.equal(window.document.getElementById('dashboard-ai-avg').textContent, '87');
});

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
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal(){ this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function close(){ this.removeAttribute('open'); };
  window.fetch = async () => ({ ok:false, status:503, text: async () => '{}' });
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  return window;
}

test('local Join with required opponent opens a waiting room instead of fabricating Rival DJ', async () => {
  const window = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  const battle = window.DJBattleModes.createBattleRecord({
    id: 'no-rival-local-1',
    modeId: 'transition_battle',
    genre: 'Bass House',
    title: 'No Rival Transition',
    status: 'open',
    opponentRequirement: 'required',
    assignedTracks: ['Platform Beat 001', 'Platform Loop 02']
  }, { requireAssignedTracks: false }).battle;
  hooks.getBattles().unshift(battle);

  hooks.openBattleLifecycle(battle.id);
  await new Promise(r => setTimeout(r, 0));
  assert.ok(window.document.getElementById('find-opponent'));
  await hooks.joinBattleFromModal(battle);
  await new Promise(r => setTimeout(r, 0));

  const modalText = window.document.getElementById('modal-content').textContent;
  assert.match(modalText, /WAITING ROOM/i);
  assert.match(modalText, /Waiting for opponent/i);
  assert.doesNotMatch(modalText, /Opponent: Rival DJ/);
  assert.ok(window.document.getElementById('waiting-solo-ai'));
  assert.ok(window.document.getElementById('waiting-find-match'));

  const saved = hooks.getBattles().find(row => String(row.id) === String(battle.id));
  assert.ok(saved);
  assert.equal(saved.status, 'waiting');
  assert.ok(!(saved.participants || []).some(p => hooks.isFabricatedLocalOpponent(p)));
  assert.equal(hooks.realOpponentFromBattle(saved), null);
});

test('openBattle no longer invents a Rival DJ mock opponent', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.doesNotMatch(source, /const opponent = \{ name: 'Rival DJ'/);
  assert.match(source, /showLocalWaitingRoom/);
  assert.match(source, /We no longer invent a Rival DJ/);
});

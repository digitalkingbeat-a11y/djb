const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function loadAppDom(){
  const root = path.join(__dirname, '..');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(index, {
    url: 'http://127.0.0.1/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });

  const { window } = dom;
  window.alert = () => {};
  window.scrollTo = () => {};

  const errors = [];
  window.addEventListener('error', event => {
    errors.push(event.error || event.message);
  });

  let showModalCalls = 0;
  window.HTMLDialogElement.prototype.showModal = function showModal(){
    showModalCalls += 1;
    if(this.hasAttribute('open')) throw new Error('dialog already open');
    this.setAttribute('open', '');
  };
  window.HTMLDialogElement.prototype.close = function close(){
    this.removeAttribute('open');
  };

  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });

  return { window, errors, getShowModalCalls: () => showModalCalls };
}

test('battle entry modal opens once with complete controls', () => {
  const { window, errors, getShowModalCalls } = loadAppDom();
  const enterFiveSongMix = window.document.querySelector('[data-enter="4"]');

  assert.ok(enterFiveSongMix, 'expected 5-Song Mix battle entry button');
  enterFiveSongMix.click();

  assert.deepEqual(errors, []);
  assert.equal(getShowModalCalls(), 1);
  assert.ok(window.document.getElementById('modal').hasAttribute('open'));
  assert.ok(window.document.getElementById('enter-mode'));
  assert.ok(window.document.getElementById('enter-genre'));
  assert.equal(window.document.getElementById('enter-length').value, '20');
});

test('producer battle creation keeps open-library defaults', async () => {
  const { window, errors } = loadAppDom();
  const hooks = window.__DJBattleTestHooks;

  hooks.openCreateBattleModal();
  await new Promise(resolve => setTimeout(resolve, 0));

  const mode = window.document.getElementById('new-battle-mode');
  const trackRule = window.document.getElementById('new-battle-track-rule');
  assert.ok([...mode.options].some(option => option.value === 'open_beat_battle'));
  assert.ok([...trackRule.options].some(option => option.value === 'open_library'));

  mode.value = 'open_beat_battle';
  mode.onchange();

  assert.deepEqual(errors, []);
  assert.equal(trackRule.value, 'open_library');
  const created = window.DJBattleModes.createBattleRecord({
    modeId: 'open_beat_battle',
    genre: 'Hip-Hop',
    title: 'Open Beat Test'
  }, { requireAssignedTracks: false });
  assert.ifError(created.error);
  assert.equal(created.battle.discipline, 'producer');
  assert.equal(window.DJBattleModes.buildBattleRules(created.battle).discipline, 'producer');
});

test('judge result completion updates battle status, progression, rankings, and bitcoin metadata', () => {
  const { window, errors } = loadAppDom();
  const created = window.DJBattleModes.createBattleRecord({
    id: 'bitcoin-lifecycle-test',
    modeId: 'bitcoin_battle',
    genre: 'Open Format',
    title: 'Bitcoin Lifecycle Test',
    status: 'submission_pending',
    assignedTracks: ['Platform Beat 001', 'Platform Loop 02'],
    reward: { type: 'bitcoin', metadata: { network: 'bitcoin', custody: 'external_pending', walletConnected: false, amountSats: 2500 } },
    participants: [
      { userId: 'local-profile-digital-king', name: 'Digital King', status: 'submitted', submissionId: 'sub-btc' },
      { userId: 'local-opponent-bitcoin-lifecycle-test', name: 'Rival DJ', status: 'joined' }
    ]
  }, { requireAssignedTracks: false });

  assert.ifError(created.error);
  window.__DJBattleTestHooks.getBattles().unshift(created.battle);

  const completed = window.__DJBattleTestHooks.completeBattleWithJudgeResult({
    id: 'bitcoin-lifecycle-test',
    battleId: 'bitcoin-lifecycle-test',
    title: 'Bitcoin Lifecycle Test',
    participants: created.battle.participants,
    status: 'submission_pending',
    submissionId: 'sub-btc'
  }, {
    overallScore: 88,
    won: true,
    opponentScore: 81,
    components: { timing: 92, phrasing: 86 },
    evidenceType: 'server_judge_result',
    explanation: 'Server judge evidence completed.'
  }, 'sub-btc');

  assert.deepEqual(errors, []);
  assert.ifError(completed.error);
  assert.equal(completed.battle.status, 'completed');
  assert.equal(completed.result.reward.type, 'bitcoin');
  assert.equal(completed.result.reward.metadata.amountSats, 2500);
  assert.equal(window.__DJBattleTestHooks.getBattleProgress().wins, 13);
  assert.ok(window.__DJBattleTestHooks.getBattleProgress().xp > 620);
  const awardedProgress = { ...window.__DJBattleTestHooks.getBattleProgress() };
  const duplicate = window.__DJBattleTestHooks.completeBattleWithJudgeResult({
    id: 'bitcoin-lifecycle-test',
    battleId: 'bitcoin-lifecycle-test',
    participants: created.battle.participants,
    status: 'completed',
    submissionId: 'sub-btc'
  }, { overallScore: 88 }, 'sub-btc');
  assert.equal(duplicate.duplicate, true);
  assert.equal(window.__DJBattleTestHooks.getBattleProgress().wins, awardedProgress.wins);
  assert.equal(window.__DJBattleTestHooks.getBattleProgress().xp, awardedProgress.xp);
  assert.match(window.document.getElementById('br-judge-placeholder').textContent, /Bitcoin metadata preserved/);
  window.__DJBattleTestHooks.renderRankingsPage();
  assert.match(window.document.getElementById('rankings-status').textContent, /No browser ranking formula|Ready for authoritative rankings/);
});

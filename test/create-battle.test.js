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
  window.alert = () => {};
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal(){ this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function close(){ this.removeAttribute('open'); };
  window.fetch = async () => ({ ok:false, status:503, text: async () => '{}', json: async () => ({}) });
  const errors = [];
  window.addEventListener('error', event => errors.push(event.error || event.message));
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  return { window, errors };
}

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

async function openFromButton(window){
  window.document.getElementById('create-battle').click();
  await tick();
}

function setField(window, id, value){
  const el = window.document.getElementById(id);
  assert.ok(el, `expected #${id} in the Create Battle form`);
  el.value = String(value);
  if(typeof el.onchange === 'function') el.onchange();
}

async function save(window){
  window.document.getElementById('save-new-battle').click();
  await tick(10);
}

test('old Create Battle modal and its random people count are gone from app.js', () => {
  assert.doesNotMatch(appSource, /new-battle-type/, 'old "Battle type" select should be removed');
  assert.doesNotMatch(appSource, /Create Draft/, 'old "Create Draft" button should be removed');
  assert.doesNotMatch(appSource, /people:\s*Math\.floor\([^)]*Math\.random/, 'no random people count');
  const handlers = appSource.match(/getElementById\('create-battle'\)\.onclick\s*=/g) || [];
  assert.equal(handlers.length, 1, 'exactly one Create Battle click handler');
  assert.match(appSource, /getElementById\('create-battle'\)\.onclick\s*=\s*openCreateBattleModal;/);
  const start = appSource.indexOf('function openCreateBattleModal(){');
  const end = appSource.indexOf("getElementById('create-battle').onclick", start);
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(appSource.slice(start, end), /Math\.random/, 'Create Battle must not use random values');
});

test('Create Battle button opens the rules-based modal', async () => {
  const { window, errors } = loadAppDom();
  await openFromButton(window);
  const doc = window.document;
  assert.ok(doc.getElementById('modal').hasAttribute('open'));
  for(const id of ['new-battle-mode', 'new-battle-title', 'new-battle-genre', 'new-battle-duration', 'new-battle-track-rule', 'new-battle-track-count', 'new-battle-opponent', 'new-battle-visibility', 'new-battle-reward', 'new-battle-sats', 'new-battle-prep-crate']){
    assert.ok(doc.getElementById(id), `expected #${id}`);
  }
  assert.equal(doc.getElementById('new-battle-type'), null);
  assert.equal(doc.getElementById('save-new-battle').textContent, 'Create Battle');
  assert.deepEqual(errors, []);
});

test('Create Battle saves exactly what the form says', async () => {
  const { window, errors } = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  const before = hooks.getBattles().length;
  await openFromButton(window);

  setField(window, 'new-battle-mode', 'five_song_mix_battle');
  setField(window, 'new-battle-title', '  Friday Night Five  ');
  setField(window, 'new-battle-genre', 'Hip-Hop');
  setField(window, 'new-battle-duration', '30');
  setField(window, 'new-battle-track-count', '4');
  setField(window, 'new-battle-opponent', 'optional');
  setField(window, 'new-battle-visibility', 'private');

  const realRandom = window.Math.random;
  let randomCalls = 0;
  window.Math.random = () => { randomCalls += 1; return realRandom(); };
  await save(window);
  window.Math.random = realRandom;

  assert.equal(window.document.getElementById('new-battle-error')?.textContent || '', '');
  assert.equal(hooks.getBattles().length, before + 1);
  const battle = hooks.getBattles()[0];
  assert.equal(battle.modeId, 'five_song_mix_battle');
  assert.equal(battle.title, 'Friday Night Five');
  assert.equal(battle.genre, 'Hip-Hop');
  assert.equal(battle.durationMinutes, 30);
  assert.equal(battle.time, '30 min');
  assert.equal(battle.trackSelectionMethod, 'assigned');
  assert.equal(battle.trackCount, 4);
  assert.ok(battle.assignedTracks.length <= 4 && battle.assignedTracks.every(t => !/Assignment pending/.test(t)), 'no placeholder tracks');
  assert.equal(battle.opponentRequirement, 'optional');
  assert.equal(battle.visibility, 'private');
  assert.equal(battle.rewardType, 'standard');
  assert.equal(battle.status, 'open');
  assert.equal(battle.people, 0, 'a new battle has nobody in it yet');
  assert.equal(battle.participants.length, 0);
  assert.equal(randomCalls, 0, 'saving a battle must not use Math.random');
  assert.ok(!window.document.getElementById('modal').hasAttribute('open'));
  assert.deepEqual(errors, []);
});

test('Create Battle keeps the bitcoin amount and falls back to a plain default title', async () => {
  const { window, errors } = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  await openFromButton(window);

  setField(window, 'new-battle-mode', 'bitcoin_battle');
  setField(window, 'new-battle-title', '   ');
  setField(window, 'new-battle-genre', 'Bass House');
  setField(window, 'new-battle-reward', 'bitcoin');
  setField(window, 'new-battle-sats', '2500');
  await save(window);

  const battle = hooks.getBattles()[0];
  assert.equal(battle.modeId, 'bitcoin_battle');
  assert.equal(battle.genre, 'Bass House');
  assert.equal(battle.title, `Bass House ${battle.type}`);
  assert.equal(battle.reward.type, 'bitcoin');
  assert.equal(battle.reward.metadata.amountSats, 2500);
  assert.equal(battle.reward.metadata.walletConnected, false);
  assert.equal(battle.people, 0);
  assert.deepEqual(errors, []);
});

test('saving the same form twice gives the same player count every time', async () => {
  const counts = [];
  for(let i = 0; i < 2; i += 1){
    const { window } = loadAppDom();
    await openFromButton(window);
    setField(window, 'new-battle-mode', 'transition_battle');
    setField(window, 'new-battle-genre', 'Tech House');
    await save(window);
    const battle = window.__DJBattleTestHooks.getBattles()[0];
    assert.equal(battle.genre, 'Tech House');
    counts.push(battle.people);
  }
  assert.deepEqual(counts, [0, 0]);
});

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
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal(){ this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function close(){ this.removeAttribute('open'); };
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  return window;
}

test('professional shell locks the requested navigation and default Battles view', () => {
  const window = loadAppDom();
  const labels = [...window.document.querySelectorAll('#nav .nav-btn > span:first-of-type')].map(node => node.textContent.trim());
  assert.deepEqual(labels, ['Battles', 'Battle Studio', 'Music Library', 'Community', 'Rankings', 'Virtual Tour', 'Activity', 'Profile', 'Settings']);
  assert.equal(window.document.querySelector('#battles')?.classList.contains('active'), true);
  assert.equal(window.document.getElementById('page-title')?.textContent.trim(), 'Battles');
  assert.equal(window.document.getElementById('operator-nav')?.classList.contains('hidden'), true);
});

test('Battle Studio exposes decks mixer browser recording controller and audio setup', () => {
  const window = loadAppDom();
  window.__DJBattleTestHooks.switchView('studio');
  const document = window.document;
  assert.ok(document.querySelector('#studio.active .professional-studio-grid .deck-left'));
  assert.ok(document.querySelector('#studio.active .professional-studio-grid .professional-mixer'));
  assert.ok(document.querySelector('#studio.active .professional-studio-grid .deck-right'));
  assert.deepEqual(
    [...document.querySelectorAll('#studio .hardware-source button')].map(button => button.textContent.trim()),
    ['MY MUSIC', 'STREAMING', 'PLAYLISTS']
  );
  assert.ok(document.getElementById('controller-panel'));
  assert.ok(document.getElementById('audio-setup-panel'));
  assert.ok(document.getElementById('studio-recording-panel'));
  assert.equal(document.getElementById('record-status')?.textContent.trim(), 'Recording idle');
  assert.ok(document.getElementById('recording-review')?.classList.contains('hidden'));

  document.getElementById('arm-record').click();
  assert.equal(document.getElementById('record-status')?.textContent.trim(), 'Armed');
});

test('streaming controls stay scoped to Battle Studio and not the Music Library', () => {
  const window = loadAppDom();
  const document = window.document;
  window.__DJBattleTestHooks.switchView('studio');
  document.querySelector('#studio [data-src="STREAMING"]').click();
  assert.ok(document.querySelector('#studio #streaming-services .stream-service'));
  assert.ok(document.getElementById('stream-browser')?.textContent.includes('Metadata'));

  window.__DJBattleTestHooks.switchView('library');
  assert.equal(document.querySelector('#library #streaming-services'), null);
  assert.equal(document.querySelector('#library #stream-browser'), null);
});

test('activity, guided tour, and settings render without obsolete product copy', () => {
  const window = loadAppDom();
  const document = window.document;
  ['activity', 'settings'].forEach(view => {
    window.__DJBattleTestHooks.switchView(view);
    assert.equal(document.getElementById(view)?.classList.contains('active'), true);
  });
  window.__DJBattleTestHooks.switchView('tour');
  assert.ok(document.getElementById('guided-tour-overlay'));
  assert.doesNotMatch(document.body.textContent, /\b(Demo|Prototype|Mock Data|Placeholder|Lorem|Coming Soon|Under Construction)\b/);
});

test('guided tour navigates to live controls and persists progress', async () => {
  const window = loadAppDom();
  const document = window.document;
  window.__DJBattleTestHooks.startGuidedTour();
  await new Promise(resolve => window.requestAnimationFrame(resolve));
  assert.equal(document.getElementById('battles')?.classList.contains('active'), true);
  assert.equal(document.querySelector('#nav [data-view="battles"]')?.classList.contains('guided-tour-target'), true);
  assert.match(document.getElementById('guided-tour-overlay')?.textContent || '', /1 of 12/);

  document.getElementById('guided-tour-next').click();
  await new Promise(resolve => window.requestAnimationFrame(resolve));
  document.getElementById('guided-tour-next').click();
  await new Promise(resolve => window.requestAnimationFrame(resolve));
  document.getElementById('guided-tour-next').click();
  await new Promise(resolve => window.requestAnimationFrame(resolve));
  assert.equal(document.getElementById('studio')?.classList.contains('active'), true);
  assert.ok(document.querySelector('#studio .professional-studio-grid.guided-tour-target'));
  assert.equal(window.localStorage.getItem('djBattleTourStep'), '3');

  document.getElementById('guided-tour-back').click();
  await new Promise(resolve => window.requestAnimationFrame(resolve));
  assert.equal(document.getElementById('battles')?.classList.contains('active'), true);
  document.getElementById('guided-tour-exit').click();
  assert.equal(document.getElementById('guided-tour-overlay'), null);
});

test('Battles and Community controls are styled and label/value pairs stay separated', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'professional-redesign.css'), 'utf8');
  [
    /\.compact-tabs button\.active\s*\{[^}]*var\(--accent\)/,
    /\.battle-filter-row select,/,
    /\.community-filters select\s*\{/,
    /\.battle-format-tour button,\s*\.community-reaction,\s*#community-category-rail button\s*\{[^}]*gap:/,
    /\.battle-lobby-counts\s*\{[^}]*gap:/,
    /\.battle-row-main small\s*\{[^}]*display:block/,
    /#community-category-rail button\.active\s*\{/,
    /\.community-attachment small\s*\{[^}]*margin-top/
  ].forEach(pattern => assert.match(css, pattern));

  const window = loadAppDom();
  const document = window.document;
  assert.ok(document.querySelector('#battle-tabs.compact-tabs'));
  assert.ok(document.querySelector('.battle-filter-row #battle-lobby-mode-filter'));
  const counts = [...document.querySelectorAll('.battle-lobby-counts .tag')].map(node => node.textContent.trim());
  assert.deepEqual(counts.map(text => text.split(':')[0]), ['OPEN', 'WAITING', 'FULL', 'STARTED', 'EXPIRED']);
  const firstRowMain = document.querySelector('.battle-row-main > div');
  assert.ok(firstRowMain.querySelector('strong') && firstRowMain.querySelector('small'));

  window.__DJBattleTestHooks.switchView('community');
  const chips = [...document.querySelectorAll('#community-category-rail button[data-community-category]')];
  assert.ok(chips.length > 1);
  chips.filter(chip => chip.dataset.communityCategory !== 'all').forEach(chip => {
    assert.equal(chip.querySelector('b'), null);
    assert.equal(chip.textContent.trim(), chip.querySelector('span').textContent.trim());
  });
  assert.ok(chips.find(chip => chip.dataset.communityCategory === 'all').querySelector('b'));
});

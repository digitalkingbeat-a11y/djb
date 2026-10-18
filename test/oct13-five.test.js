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

test('Studio export downloads the library as CSV, M3U and M3U8 when no playlist is chosen', () => {
  const { window } = loadAppDom();
  window.__inApp(`state.library.push({ id:'t1', libraryId:'t1', title:'Night Drive', name:'Night Drive', artist:'DK', bpm:'124', key:'8A', duration:'3:25', size:10 }); window.__lib = state.library.length;`);
  for(const fmt of ['csv','m3u','m3u8']){
    const r = window.__inApp(`exportActiveStudioPlaylist('${fmt}')`);
    assert.equal(r.ok, true, fmt);
    assert.equal(r.format, fmt);
    assert.match(r.content, /Night Drive/);
  }
  const m3u = window.__inApp(`exportActiveStudioPlaylist('m3u')`).content;
  assert.match(m3u, /#EXTINF:205,DK - Night Drive/);
  assert.match(window.__inApp(`exportActiveStudioPlaylist('csv')`).content.split('\n')[0], /duration/);
});

test('Studio import puts playlist rows into the library without duplicates', () => {
  const { window } = loadAppDom();
  const before = window.__inApp('state.library.length');
  const csv = 'title,artist,bpm\nTrack One,DJ A,120\nTrack Two,DJ B,128\nTrack One,DJ A,120';
  const items = window.__inApp(`playlistTransferManager.parsePlaylistText(${JSON.stringify(csv)}, 'set.csv')`);
  window.__items = items;
  const added = window.__inApp('addImportedItemsToLibrary(window.__items, "set.csv")');
  assert.equal(added, 2);
  assert.equal(window.__inApp('state.library.length'), before + 2);
  assert.equal(window.__inApp('addImportedItemsToLibrary(window.__items, "set.csv")'), 0);
  const parsed = window.__inApp(`playlistTransferManager.parsePlaylistText('#EXTM3U\\n#EXTINF:200,DJ C - Three\\nthree.mp3', 'x.m3u8')`);
  assert.equal(parsed[0].title, 'Three');
  assert.equal(parsed[0].artist, 'DJ C');
});

test('upload duration formatting and duplicate detection', () => {
  const { window } = loadAppDom();
  assert.equal(window.__inApp('formatTrackDuration(205.4)'), '3:25');
  assert.equal(window.__inApp('formatTrackDuration(3725)'), '1:02:05');
  assert.equal(window.__inApp('formatTrackDuration(NaN)'), '');
  window.__inApp(`state.library.push({ id:'u1', title:'Beat', name:'Beat', fileName:'beat.mp3', size:1234 })`);
  assert.ok(window.__inApp(`findDuplicateUpload({ name:'beat.mp3', size:1234 })`));
  assert.equal(window.__inApp(`findDuplicateUpload({ name:'beat.mp3', size:999 })`), null);
  assert.ok(window.__inApp(`findDuplicateUpload({ name:'new.mp3', size:5 }, [{ name:'new.mp3', size:5 }])`));
});

test('upload stores real duration instead of --', async () => {
  const src = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(src, /duration: realDuration \|\| '--'/);
  assert.match(src, /readAudioDuration\(f\)/);
});

test('Settings has back up, restore and reset, and they round-trip app data', async () => {
  const { window } = loadAppDom();
  window.DJB_NO_RELOAD = true; window.DJB_NO_DOWNLOAD = true;
  const doc = window.document;
  ['settings-backup','settings-restore','settings-reset','settings-restore-file'].forEach(id => assert.ok(doc.getElementById(id), id));
  window.localStorage.setItem('djBattleTest', 'hello');
  window.localStorage.setItem('otherApp', 'keep');
  const backup = await window.__inApp('buildAppBackup()');
  assert.equal(backup.format, 'djb-backup');
  assert.equal(backup.localStorage.djBattleTest, 'hello');
  assert.equal(backup.localStorage.otherApp, undefined);
  let asked = 0; window.confirm = () => { asked += 1; return false; };
  const cancelled = await window.__inApp('confirmAndResetAppData()');
  assert.equal(cancelled.cancelled, true); assert.equal(asked, 1);
  assert.equal(window.localStorage.getItem('djBattleTest'), 'hello');
  window.confirm = () => true;
  await window.__inApp('confirmAndResetAppData()');
  assert.equal(window.localStorage.getItem('djBattleTest'), null);
  assert.equal(window.localStorage.getItem('otherApp'), 'keep');
  window.__b = backup;
  const restored = await window.__inApp('restoreAppBackup(window.__b)');
  assert.equal(restored.ok, true);
  assert.equal(window.localStorage.getItem('djBattleTest'), 'hello');
  assert.equal((await window.__inApp('restoreAppBackup({ format:"nope" })')).ok, false);
});

test('duplicate Library, Community feed and old New Post definitions are gone', () => {
  const src = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.equal((src.match(/^function renderLibrary\(\)/gm) || []).length, 1);
  assert.equal((src.match(/^function renderPosts\(\)/gm) || []).length, 1);
  assert.equal((src.match(/getElementById\('new-post'\)\.onclick/g) || []).length, 0);
  const { window } = loadAppDom();
  window.openCommunityPostComposer = window.openCommunityPostComposer;
  assert.ok(window.document.getElementById('new-post').onclick);
});

test('Activity sorts newest first, shows times, and filters by type', () => {
  const { window } = loadAppDom();
  const doc = window.document;
  const now = Date.now();
  window.__inApp(`state.djNotifications.rows = [{ title:'Old alert', createdAt:new Date(${now - 3*86400000}).toISOString() }, { title:'New alert', createdAt:new Date(${now - 120000}).toISOString() }];
    state.djChallenges.rows = [{ title:'Mid challenge', createdAt:new Date(${now - 3600000}).toISOString() }];`);
  doc.querySelector('#nav .nav-btn[data-view="activity"]').click();
  window.__inApp('renderActivityPage()');
  const titles = [...doc.querySelectorAll('#activity-feed .activity-row strong')].map(n => n.textContent);
  assert.ok(titles.indexOf('New alert') < titles.indexOf('Mid challenge'));
  assert.ok(titles.indexOf('Mid challenge') < titles.indexOf('Old alert'));
  const newRow = [...doc.querySelectorAll('#activity-feed .activity-row')].find(r => /New alert/.test(r.textContent));
  assert.match(newRow.querySelector('.activity-time').textContent, /2 min ago/);
  const labels = [...doc.querySelectorAll('#activity-filters [data-activity-filter]')].map(b => b.textContent.replace(/\d+$/, ''));
  assert.deepEqual(labels, ['All','Alerts','Battles','Community','Challenges']);
  doc.querySelector('[data-activity-filter="challenge"]').click();
  const kinds = [...doc.querySelectorAll('#activity-feed .activity-row')].map(r => r.dataset.activityKind);
  assert.deepEqual(kinds, ['challenge']);
  assert.equal(window.__inApp('formatRelativeTime(null)'), 'Time unknown');
});

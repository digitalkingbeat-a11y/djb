const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const windows = [];
test.after(() => windows.forEach(w => { try{ w.close(); }catch(e){} }));

const root = path.join(__dirname, '..');

function loadAppDom(setup){
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
  window.fetch = async () => ({ ok:false, status:503, text: async () => '{}', json: async () => ({}) });
  if(setup) setup(window);
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  windows.push(window);
  return window;
}

const bassBattle = { id:'b-bass-1', title:'Bass House Sprint', genre:'Bass House', modeId:'transition_battle', durationMinutes:5, status:'open' };
const hipBattle = { id:'b-hh-1', title:'Hip-Hop Cuts', genre:'Hip-Hop', modeId:'genre_specific_battle', durationMinutes:5, status:'open' };

test('saved search: matches filters, only new battles alert, one alert per battle id', () => {
  const window = loadAppDom();
  const h = window.__DJBattleTestHooks;
  h.setDiscoveryBattles([bassBattle]);
  assert.equal(h.battleMatchesSavedFilters(bassBattle, { genre:'Bass House', duration:'short' }), true);
  assert.equal(h.battleMatchesSavedFilters(hipBattle, { genre:'Bass House' }), false);
  assert.equal(h.battleMatchesSavedFilters({ ...bassBattle, status:'completed' }, { genre:'Bass House' }), false);
  const saved = h.createSavedSearch('Bass 5-min', { genre:'Bass House', duration:'short' }, [bassBattle]);
  assert.equal(saved.ok, true);
  assert.equal(h.createSavedSearch('bass 5-min', {}, []).error.includes('already'), true);
  assert.equal(h.createSavedSearch('  ', {}, []).error, 'Give the search a name.');
  h.createSavedSearch('Any short', { duration:'short' }, []);
  // existing battle was seeded as seen for the first search; the second search alerts once for it
  const newOne = { ...bassBattle, id:'b-bass-2', title:'Bass House Night' };
  const created = h.checkSavedSearchMatches([bassBattle, newOne, hipBattle]);
  const ids = JSON.parse(JSON.stringify(created.map(a => a.battleId))).sort();
  assert.deepEqual(ids, ['b-bass-1', 'b-bass-2', 'b-hh-1']);
  assert.equal(new Set(ids).size, ids.length, 'deduped by battle id across searches');
  assert.equal(h.checkSavedSearchMatches([bassBattle, newOne, hipBattle]).length, 0, 'no repeat alerts');
  const activity = h.collectActivityEntries().filter(e => e.label === 'Saved search');
  assert.equal(activity.length, 3);
  assert.match(activity.map(e => e.title).join(' '), /Bass House Night/);
  h.removeSavedSearch(saved.search.id);
  assert.deepEqual(JSON.parse(JSON.stringify(h.loadSavedSearches().map(s => s.name))), ['Any short']);
});

test('saved search panel renders in the lobby and saves current filters', () => {
  const window = loadAppDom();
  const h = window.__DJBattleTestHooks;
  h.discoveryState().battleLobby.filters.genre = 'Hip-Hop';
  h.renderBattles('All');
  const panel = window.document.getElementById('saved-searches');
  assert.ok(panel);
  panel.querySelector('#saved-search-name').value = 'HH';
  panel.querySelector('#saved-search-form').dispatchEvent(new window.Event('submit', { cancelable:true }));
  const chip = window.document.querySelector('[data-saved-search]');
  assert.ok(chip);
  assert.match(chip.textContent, /HH/);
  assert.match(chip.textContent, /Hip-Hop/);
  chip.querySelector('[data-saved-search-remove]').click();
  assert.equal(window.document.querySelector('[data-saved-search]'), null);
});

test('community room chips show counts, filter the feed and persist', () => {
  const window = loadAppDom(w => {
    w.localStorage.setItem('djBattleCommunityRoom', 'scratching');
  });
  const h = window.__DJBattleTestHooks;
  h.renderPosts();
  const chips = Array.from(window.document.querySelectorAll('[data-room-chip]'));
  assert.equal(chips[0].dataset.roomChip, 'all');
  assert.match(chips[0].textContent, /All\s*3/);
  const active = window.document.querySelector('.room-chip.active');
  assert.equal(active.dataset.roomChip, 'scratching');
  assert.equal(window.document.querySelectorAll('#forum-feed .community-post').length, 1);
  window.document.querySelector('[data-room-chip="all"]').click();
  assert.equal(window.localStorage.getItem('djBattleCommunityRoom'), 'all');
  assert.equal(window.document.querySelectorAll('#forum-feed .community-post').length, 3);
  const counts = h.communityRoomCounts([{ categoryId:'house' }, { categoryId:'house' }, { categoryId:'gear' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(counts.map(c => [c.id, c.count]))), [['house', 2], ['gear', 1]]);
});

test('leaderboards: period tabs, server query param, honest sample label and local monthly fallback', () => {
  const now = new Date();
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12)).toISOString();
  const window = loadAppDom(w => {
    w.localStorage.setItem('djBattleBattleResults', JSON.stringify([
      { outcome:'win', genre:'House', score:88, completedAt:thisMonth },
      { outcome:'loss', genre:'House', score:70, completedAt:'2020-01-05T00:00:00Z' }
    ]));
  });
  const h = window.__DJBattleTestHooks;
  assert.equal(h.leaderboardMonthStartIso(new Date('2026-10-14T12:00:00Z')), '2026-10-01T00:00:00.000Z');
  const st = h.discoveryState();
  st.publicRankings.period = 'month';
  assert.match(h.publicRankingQuery(1), /period=month/);
  st.publicRankings.period = 'all';
  assert.doesNotMatch(h.publicRankingQuery(1), /period=/);
  assert.deepEqual(JSON.parse(JSON.stringify(h.localPeriodSummary('month'))), { battles:1, wins:1, losses:0, ties:0, best:88 });
  assert.equal(h.localPeriodSummary('all').battles, 2);
  st.publicRankings.status = 'failed';
  st.publicRankings.period = 'month';
  h.renderRankingsPage();
  const tabs = window.document.querySelectorAll('[data-rankings-period]');
  assert.deepEqual(Array.from(tabs).map(t => t.textContent), ['This month', 'All-time']);
  assert.equal(window.document.getElementById('rankings-period-source').textContent, 'Sample, not live');
  assert.match(window.document.getElementById('rankings-local-period').textContent, /FROM THIS DEVICE/);
  assert.match(window.document.getElementById('rankings-local-period').textContent, /Not a ranking/);
});

test('ai leaderboard live fetch adds a created_at date filter for this month', () => {
  const src = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(src, /query\.gte\('created_at', leaderboardMonthStartIso\(\)\)/);
});

test('profile genre stats: W-L-T per genre, best genre highlighted, empty state', () => {
  const window = loadAppDom();
  const h = window.__DJBattleTestHooks;
  h.renderProfileGenreStats();
  assert.match(window.document.getElementById('profile-genre-stats').textContent, /No head-to-head battles yet/);
  const results = [
    { outcome:'win', genre:'Hip-Hop' }, { outcome:'win', genre:'Hip-Hop' }, { outcome:'loss', genre:'Hip-Hop' },
    { outcome:'win', genre:'Bass House' }, { outcome:'loss', genre:'Bass House' }, { outcome:'tie', genre:'Bass House' },
    { outcome:'practice', genre:'Techno' }
  ];
  const stats = h.genreStats(results);
  assert.deepEqual(JSON.parse(JSON.stringify(stats.rows.map(r => [r.genre, r.wins, r.losses, r.ties]))), [['Hip-Hop', 2, 1, 0], ['Bass House', 1, 1, 1]]);
  assert.equal(stats.best, 'Hip-Hop');
  h.discoveryState().battleResults.push(...results);
  h.renderProfileGenreStats();
  const best = window.document.querySelector('.genre-stat.best');
  assert.equal(best.dataset.genreStat, 'Hip-Hop');
  assert.match(best.textContent, /2–1/);
  assert.match(window.document.querySelector('[data-genre-stat="Bass House"]').textContent, /1–1–1/);
});

test('battle reminders: toggle, fire 10 min before once, activity alert, Notification when granted, persisted', () => {
  let permissionAsked = 0; const shown = [];
  const window = loadAppDom(w => {
    function FakeNotification(title, opts){ shown.push({ title, opts }); }
    FakeNotification.permission = 'default';
    FakeNotification.requestPermission = () => { permissionAsked += 1; FakeNotification.permission = 'granted'; return Promise.resolve('granted'); };
    w.Notification = FakeNotification;
  });
  const h = window.__DJBattleTestHooks;
  assert.equal(permissionAsked, 0, 'no permission prompt on load');
  const now = Date.now();
  const startAt = new Date(now + 60 * 60 * 1000).toISOString();
  const battle = { id:'b-sched', title:'Friday Clash', genre:'House', modeId:'transition_battle', status:'matched', scheduledStartAt:startAt };
  h.setDiscoveryBattles([battle]);
  assert.equal(h.reminderTarget(battle, now).kind, 'start');
  assert.equal(h.reminderTarget({ ...battle, scheduledStartAt:null, deadlineAt:startAt }, now).kind, 'deadline');
  assert.equal(h.reminderTarget({ id:'x', status:'open' }, now), null);
  assert.match(h.battleReminderButtonHtml(battle), /Remind me/);
  assert.equal(h.battleReminderButtonHtml({ id:'x', status:'open' }), '');
  const on = h.toggleBattleReminder('b-sched', now);
  assert.equal(on.on, true);
  assert.equal(permissionAsked, 1, 'permission asked on click');
  assert.match(h.battleReminderButtonHtml(battle), /Reminder on/);
  assert.equal(h.checkBattleReminders(now).length, 0, 'not yet');
  const fireTime = new Date(startAt).getTime() - 9 * 60 * 1000;
  const fired = h.checkBattleReminders(fireTime);
  assert.equal(fired.length, 1);
  assert.equal(h.checkBattleReminders(fireTime + 1000).length, 0, 'fires once');
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, 'Battle starts in 10 min');
  const toastBtn = window.document.querySelector('[data-reminder-open-studio="b-sched"]');
  assert.ok(toastBtn, 'toast has Open Studio');
  assert.ok(h.collectActivityEntries().some(e => e.label === 'Reminder' && /Friday Clash starts soon/.test(e.title)));
  assert.equal(JSON.parse(window.localStorage.getItem('djBattleReminders'))['b-sched'].fired, true);
  const off = h.toggleBattleReminder('b-sched', now);
  assert.equal(off.on, false);
  assert.equal(Object.keys(h.loadReminders()).length, 0);
});

test('battle card shows Remind me and the click toggles it', () => {
  const window = loadAppDom(w => { w.Notification = undefined; });
  const h = window.__DJBattleTestHooks;
  const battle = { id:'b-card', title:'Card Clash', genre:'House', modeId:'transition_battle', status:'open', deadlineAt:new Date(Date.now() + 3600e3).toISOString() };
  h.setDiscoveryBattles([battle]);
  h.renderBattles('All');
  const btn = window.document.querySelector('#battle-grid [data-battle-remind="b-card"]');
  assert.ok(btn);
  btn.click();
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.ok(h.loadReminders()['b-card']);
});

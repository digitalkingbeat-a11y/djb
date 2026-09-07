const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function loadAppDom(url = 'http://127.0.0.1/index.html'){
  const root = path.join(__dirname, '..');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(index, {
    url,
    runScripts:'outside-only',
    pretendToBeVisual:true
  });
  const { window } = dom;
  window.alert = () => {};
  window.scrollTo = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal(){ this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function close(){ this.removeAttribute('open'); };
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  return { window };
}

function nextTick(){
  return new Promise(resolve => setTimeout(resolve, 0));
}

function rankingRow(overrides = {}){
  return {
    rank:1,
    previousRank:3,
    movement:2,
    publicProfileId:'dj_ledger',
    djName:'Ledger DJ',
    profileVisibility:'public',
    country:'US',
    countryCode:'US',
    belt:'Blue',
    rating:1810,
    eligibleWins:2,
    eligibleLosses:1,
    eligibleTies:0,
    qualifyingBattles:3,
    averageScore:91.3,
    bestScore:96,
    lastQualifyingActivity:'2026-08-27T12:00:00.000Z',
    minimumEligibility:{ requiredBattles:1, met:true },
    ...overrides
  };
}

function leaderboardPayload(rows, overrides = {}){
  const normalizedRows = rows.map(rankingRow);
  return {
    success:true,
    leaderboard:{
      category:overrides.category || 'competitive_battles',
      categoryLabel:'Global Competitive',
      source:'award_ledger',
      calculationVersion:'public-ledger-leaderboards-v1',
      rows:normalizedRows,
      categories:{
        competitive_battles:{ label:'Global Competitive', rows:normalizedRows },
        country_rankings:{ label:'Country Rankings', rows:normalizedRows },
        bitcoin_battles:{ label:'Bitcoin Battles', rows:[] },
        ai_only_high_scores:{ label:'AI High Scores', rows:overrides.aiRows || [] }
      },
      pagination:overrides.pagination || { page:1, limit:20, total:normalizedRows.length, hasMore:false, nextPage:null }
    },
    rows:normalizedRows,
    categories:{
      competitive_battles:{ label:'Global Competitive', rows:normalizedRows },
      country_rankings:{ label:'Country Rankings', rows:normalizedRows },
      bitcoin_battles:{ label:'Bitcoin Battles', rows:[] },
      ai_only_high_scores:{ label:'AI High Scores', rows:overrides.aiRows || [] }
    },
    pagination:overrides.pagination || { page:1, limit:20, total:normalizedRows.length, hasMore:false, nextPage:null },
    source:'award_ledger',
    calculationVersion:'public-ledger-leaderboards-v1'
  };
}

function rankingDetailPayload(overrides = {}){
  const category = overrides.category || 'competitive_battles';
  return {
    success:true,
    detail:{
      scope:overrides.scope || 'public',
      profile:overrides.profile || { publicProfileId:'dj_ledger', djName:'Ledger DJ', displayName:'Ledger DJ', country:'US', countryCode:'US', belt:'Blue', profileVisibility:'public' },
      category,
      categoryLabel:'Global Competitive',
      source:'award_ledger',
      calculationVersion:'public-ledger-leaderboards-v1',
      current:overrides.current || { rank:1, previousRank:3, movement:2, movementStatus:'up', rating:1810, belt:'Blue', qualifyingBattles:3 },
      eligibility:overrides.eligibility || { status:'fully_ranked', qualifyingBattleCount:3, requiredBattles:3, remainingBattles:0, blockers:[] },
      beltProgression:overrides.beltProgression || { currentXp:920, currentBelt:'Blue', nextBelt:'Purple', nextThresholdXp:1300, remainingXp:380, promotions:[{ from:'Green', to:'Blue', awardedAt:'2026-08-26T12:00:00.000Z' }] },
      movementHistory:overrides.movementHistory || [
        { historyId:'rh-2', rankingPeriod:'2026-08-27T12:00:00.000Z', rank:1, previousRank:3, movement:2, movementStatus:'up', ratingAfter:1810 }
      ],
      qualifyingBattles:overrides.qualifyingBattles || [
        { battleRef:'qb-1', score:96, source:'verified_result', result:{ verifiedResultId:'vr_11111111111111111111', verifiedResultUrl:'/results/vr_11111111111111111111', battle:{ title:'Ledger Finals' }, outcome:'win', progression:{ ratingDelta:18 }, reward:{ type:'bitcoin', transferStatus:'untransferred' }, scoringSource:['measured','rule-based'] } }
      ],
      pagination:overrides.pagination || { cursor:null, nextCursor:null, limit:10, total:1, hasMore:false }
    }
  };
}

test('Rankings page loads authoritative server rows and personal ranks without a browser ranking table', async () => {
  const { window } = loadAppDom();
  const requested = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    requested.push({ url, options });
    if(url === '/api/myRankings'){
      return { status:200, data:{ rankings:{ competitive_battles:rankingRow({ rank:4, movement:-1, djName:'Digital King', publicProfileId:'dj_me' }), bitcoin_battles:{ status:'not_yet_ranked', requirement:'Complete one eligible Bitcoin Battle.' } }, source:'award_ledger' } };
    }
    return { status:200, data:leaderboardPayload([{}]) };
  };

  window.__DJBattleTestHooks.switchView('rankings');
  await nextTick();
  await nextTick();

  assert.match(requested[0].url, /^\/api\/publicLeaderboards\?/);
  assert.equal(requested[0].options.public, true);
  assert.equal(requested[1].url, '/api/myRankings');
  assert.equal(window.document.getElementById('ranking-table'), null);
  assert.match(window.document.getElementById('rankings-list').textContent, /Ledger DJ/);
  assert.match(window.document.getElementById('rankings-status').textContent, /Award ledger rankings/);
  assert.match(window.document.getElementById('rankings-my-summary').textContent, /Global Competitive: #4/);
  assert.match(window.document.getElementById('rankings-my-summary').textContent, /Complete one eligible Bitcoin Battle/);
});

test('Rankings category switching and country/belt filters use server query parameters', async () => {
  const { window } = loadAppDom();
  const requested = [];
  window.DJBattleApi.apiRequest = async (url) => {
    requested.push(url);
    return { status:200, data:leaderboardPayload([rankingRow({ country:'GB', belt:'Orange', djName:'Filter DJ', publicProfileId:'dj_filter' })]) };
  };

  await window.__DJBattleTestHooks.loadRankingsPage();
  window.document.querySelector('[data-ranking-category="bitcoin_battles"]').click();
  await nextTick();
  window.document.getElementById('rankings-filter-country').value = 'GB';
  window.document.getElementById('rankings-filter-country').dispatchEvent(new window.Event('change'));
  await nextTick();
  window.document.getElementById('rankings-filter-belt').value = 'Orange';
  window.document.getElementById('rankings-filter-belt').dispatchEvent(new window.Event('change'));
  await nextTick();

  assert.ok(requested.some(url => /category=bitcoin_battles/.test(url)));
  assert.ok(requested.some(url => /country=GB/.test(url)));
  assert.ok(requested.some(url => /belt=Orange/.test(url)));
  assert.match(window.document.getElementById('rankings-active-filters').textContent, /Bitcoin Battles/);
  assert.match(window.location.hash, /category=bitcoin_battles/);
});

test('Rankings private DJ rows never expose profile links or identifiers', async () => {
  const { window } = loadAppDom();
  window.DJBattleApi.apiRequest = async () => ({
    status:200,
    data:leaderboardPayload([rankingRow({ djName:'Private DJ', profileVisibility:'private', publicProfileId:'', country:'US' })])
  });

  await window.__DJBattleTestHooks.loadRankingsPage();
  const list = window.document.getElementById('rankings-list');

  assert.match(list.textContent, /Private DJ/);
  assert.equal(list.querySelector('[data-ranking-profile]'), null);
  assert.equal(list.querySelector('[data-ranking-detail]'), null);
  assert.doesNotMatch(list.innerHTML, /dj_private|auth|user_id|private\/|signedurl/i);
});

test('Rankings deep links restore category filters page and selected DJ while handling invalid categories', async () => {
  const { window } = loadAppDom('http://127.0.0.1/index.html#rankings?category=not_real&country=US&belt=Blue&page=2&dj=dj_ledger');
  window.DJBattleApi.apiRequest = async (url) => {
    const page = new URL(`http://local${url}`).searchParams.get('page') || '1';
    return { status:200, data:leaderboardPayload([{}], { pagination:{ page:Number(page), limit:20, total:21, hasMore:false, nextPage:null } }) };
  };

  await nextTick();
  await nextTick();
  const state = window.__DJBattleTestHooks.getPublicRankingsState();

  assert.equal(state.category, 'competitive_battles');
  assert.equal(state.filters.country, 'US');
  assert.equal(state.filters.belt, 'Blue');
  assert.equal(state.page, 2);
  assert.equal(state.selectedDj, 'dj_ledger');
  assert.match(window.document.getElementById('rankings-status').textContent, /Invalid ranking category link/);
});

test('Rankings pagination deduplicates overlapping rows from bounded server pages', async () => {
  const { window } = loadAppDom();
  let call = 0;
  window.DJBattleApi.apiRequest = async () => {
    call += 1;
    if(call === 1){
      return { status:200, data:leaderboardPayload([rankingRow({ rank:1, publicProfileId:'dj_a', djName:'A DJ' }), rankingRow({ rank:2, publicProfileId:'dj_b', djName:'B DJ' })], { pagination:{ page:1, limit:2, total:3, hasMore:true, nextPage:2 } }) };
    }
    return { status:200, data:leaderboardPayload([rankingRow({ rank:2, publicProfileId:'dj_b', djName:'B DJ' }), rankingRow({ rank:3, publicProfileId:'dj_c', djName:'C DJ' })], { pagination:{ page:2, limit:2, total:3, hasMore:false, nextPage:null } }) };
  };

  await window.__DJBattleTestHooks.loadRankingsPage();
  await window.__DJBattleTestHooks.loadRankingsPage({ append:true });

  const rows = window.__DJBattleTestHooks.getPublicRankingsState().rows;
  assert.deepEqual(Array.from(rows, row => row.djName), ['A DJ', 'B DJ', 'C DJ']);
  assert.equal(rows.length, 3);
});

test('Rankings rejects stale out-of-order leaderboard responses', async () => {
  const { window } = loadAppDom();
  const pending = [];
  window.DJBattleApi.apiRequest = async (url) => new Promise(resolve => pending.push({ url, resolve }));

  const first = window.__DJBattleTestHooks.loadRankingsPage();
  const second = window.__DJBattleTestHooks.loadRankingsPage();
  pending[1].resolve({ status:200, data:leaderboardPayload([rankingRow({ djName:'Fresh DJ', publicProfileId:'dj_fresh' })]) });
  await second;
  pending[0].resolve({ status:200, data:leaderboardPayload([rankingRow({ djName:'Stale DJ', publicProfileId:'dj_stale' })]) });
  const stale = await first;

  assert.equal(stale.stale, true);
  assert.match(window.document.getElementById('rankings-list').textContent, /Fresh DJ/);
  assert.doesNotMatch(window.document.getElementById('rankings-list').textContent, /Stale DJ/);
});

test('Rankings preserves the separated AI board and Bitcoin metadata warning', async () => {
  const { window } = loadAppDom();
  window.DJBattleApi.apiRequest = async () => ({ status:200, data:leaderboardPayload([], { category:'ai_only_high_scores', aiRows:[rankingRow({ djName:'AI DJ', outcome:'recorded' })] }) });

  window.__DJBattleTestHooks.setPublicRankingsState({ category:'ai_only_high_scores', rows:[], filters:{ country:'all', belt:'all' } });
  window.__DJBattleTestHooks.renderRankingsPage();

  assert.match(window.document.getElementById('ai-ranking-table').textContent, /DJ Nova|Digital King/);
  assert.match(window.document.querySelector('.rankings-bitcoin-panel').textContent, /metadata and untransferred/);
  assert.doesNotMatch(window.document.querySelector('.rankings-bitcoin-panel').textContent, /claim|deposit|payout|wallet controls/i);
});

test('Rankings keeps last safe rows stale when a refresh fails', async () => {
  const { window } = loadAppDom();
  let fail = false;
  window.DJBattleApi.apiRequest = async () => fail
    ? { status:503, error:'Leaderboard configuration missing' }
    : { status:200, data:leaderboardPayload([rankingRow({ djName:'Safe DJ', publicProfileId:'dj_safe' })]) };

  await window.__DJBattleTestHooks.loadRankingsPage();
  fail = true;
  await window.__DJBattleTestHooks.loadRankingsPage();

  assert.equal(window.__DJBattleTestHooks.getPublicRankingsState().status, 'stale');
  assert.match(window.document.getElementById('rankings-list').textContent, /Safe DJ/);
  assert.match(window.document.getElementById('rankings-status').textContent, /Stale data/);
  assert.match(window.document.getElementById('rankings-status').textContent, /Leaderboard configuration missing/);
});

test('Ranking row opens authoritative movement and qualifying battle detail', async () => {
  const { window } = loadAppDom();
  const requested = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    requested.push({ url, options });
    if(url.startsWith('/api/publicRankings/dj_ledger/history?')) return { status:200, data:rankingDetailPayload() };
    return { status:200, data:leaderboardPayload([{}]) };
  };

  await window.__DJBattleTestHooks.loadRankingsPage();
  window.document.querySelector('[data-ranking-detail="dj_ledger"]').click();
  await nextTick();

  const detail = window.document.getElementById('rankings-detail');
  assert.ok(requested.some(req => /^\/api\/publicRankings\/dj_ledger\/history\?/.test(req.url) && req.options.public === true));
  assert.match(detail.textContent, /Ledger DJ/);
  assert.match(detail.textContent, /Ledger Finals/);
  assert.match(detail.textContent, /Bitcoin metadata: untransferred/);
  assert.match(detail.textContent, /Award ledger/);
  assert.doesNotMatch(detail.innerHTML, /storage|signedurl|service_role|private\//i);
});

test('Rankings relationship filter uses protected server discovery and trusted follower counts', async () => {
  const { window } = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.getLibraryState().sync.accountId = 'user-1';
  hooks.setPublicRankingsState({ rows:[], filters:{ country:'all', belt:'all', relationship:'following' } });
  const requested = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    requested.push({ url, options });
    if(url.startsWith('/api/challenges/eligibility/dj_ledger')) return { status:200, data:{ eligibility:{ available:true } } };
    return { status:200, data:leaderboardPayload([rankingRow({ followerCount:7, relationshipSource:'server' })]) };
  };

  await hooks.loadRankingsPage();
  assert.ok(requested[0].url.startsWith('/api/relationshipLeaderboards?'));
  assert.equal(requested[0].options.public, undefined);
  assert.match(requested[0].url, /relationship=following/);
  assert.match(window.document.getElementById('rankings-list').textContent, /7 follower/);
  window.document.querySelector('[data-ranking-challenge="dj_ledger"]').click();
  await nextTick();

  assert.ok(requested.some(call => call.url === '/api/challenges/eligibility/dj_ledger'));
  assert.match(window.document.getElementById('modal-content').textContent, /Challenge Ledger DJ/);
  assert.doesNotMatch(window.document.getElementById('rankings-list').innerHTML, /user_id|auth_id|private\/|service_key/i);
});

test('Personal ranking widget opens authenticated ranking detail without public fallback', async () => {
  const { window } = loadAppDom();
  const requested = [];
  window.DJBattleApi.apiRequest = async (url) => {
    requested.push(url);
    if(url.startsWith('/api/myRankings/history?')) return { status:200, data:rankingDetailPayload({ scope:'owned', profile:{ djName:'Digital King', displayName:'Digital King', country:'US', belt:'Blue' } }) };
    return { status:200, data:{ rankings:{ competitive_battles:rankingRow({ rank:4, djName:'Digital King', publicProfileId:'dj_me' }) }, source:'award_ledger' } };
  };

  await window.__DJBattleTestHooks.loadRankingsPersonalSummary();
  window.document.querySelector('[data-personal-ranking-detail="competitive_battles"]').click();
  await nextTick();

  assert.ok(requested.some(url => /^\/api\/myRankings\/history\?category=competitive_battles/.test(url)));
  assert.match(window.document.getElementById('rankings-detail').textContent, /Personal Rank/);
  assert.match(window.document.getElementById('rankings-detail').textContent, /Digital King/);
});

test('Ranking detail rejects stale out-of-order responses and preserves last safe detail on failure', async () => {
  const { window } = loadAppDom();
  const pending = [];
  let fail = false;
  window.DJBattleApi.apiRequest = async (url) => {
    if(url.startsWith('/api/publicRankings/')){
      if(fail) return { status:503, error:'Ranking history configuration missing' };
      return new Promise(resolve => pending.push({ url, resolve }));
    }
    return { status:200, data:leaderboardPayload([{}]) };
  };

  const first = window.__DJBattleTestHooks.loadPublicRankingDetail('dj_ledger');
  const second = window.__DJBattleTestHooks.loadPublicRankingDetail('dj_second');
  pending[1].resolve({ status:200, data:rankingDetailPayload({ profile:{ publicProfileId:'dj_second', djName:'Fresh Detail', displayName:'Fresh Detail', country:'US', belt:'Blue' } }) });
  await second;
  pending[0].resolve({ status:200, data:rankingDetailPayload({ profile:{ publicProfileId:'dj_ledger', djName:'Stale Detail', displayName:'Stale Detail', country:'US', belt:'Blue' } }) });
  const stale = await first;
  fail = true;
  await window.__DJBattleTestHooks.loadPublicRankingDetail('dj_second');

  const detail = window.document.getElementById('rankings-detail');
  assert.equal(stale.stale, true);
  assert.match(detail.textContent, /Fresh Detail/);
  assert.doesNotMatch(detail.textContent, /Stale Detail/);
  assert.match(detail.textContent, /Ranking history configuration missing/);
  assert.equal(window.__DJBattleTestHooks.getRankingDetailState().status, 'stale');
});

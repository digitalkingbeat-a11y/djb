// Oct 20b: crews + 2-vs-2, Tip a DJ, Beat Store discount codes, Who's watching, beatmatching lessons.
const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const windows = [];
test.after(() => windows.forEach(w => { try{ w.close(); }catch(e){} }));

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const settle = async (n = 8) => { for(let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

function loadAppDom({ matchLight = false, theme = null } = {}){
  const dom = new JSDOM(read('index.html'), { url:'http://127.0.0.1/index.html', runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom;
  window.alert = () => {};
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = function(){};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function(){ this.setAttribute('open', ''); this.open = true; };
  window.HTMLDialogElement.prototype.close = function(){ this.removeAttribute('open'); this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.fetch = async () => ({ ok:false, status:503, text:async () => '{}', json:async () => ({}) });
  window.matchMedia = q => ({ matches:/light/.test(q) ? matchLight : false, media:q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} });
  if(theme) window.localStorage.setItem('djbTheme', theme);
  const inline = Array.from(window.document.querySelectorAll('script:not([src])'));
  const prePaint = inline.find(s => s.textContent.includes('djbTheme'));
  if(prePaint) window.eval(prePaint.textContent);
  const beltScript = inline.find(s => s.textContent.includes('setCurrentBelt'));
  if(beltScript) window.eval(beltScript.textContent);
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/beatmatch_lessons.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js', 'social.js', 'connect.js', 'oct20.js', 'oct20b.js'].forEach(file => window.eval(read(file)));
  windows.push(window);
  return window;
}
function signIn(window, id = 'user-1'){
  window.__DJBattleTestHooks.updateAuthUI({ id, email:`${id}@example.com`, user_metadata:{ full_name:'Crew DJ' } });
}
function stubApi(window, handler){
  const calls = [];
  window.DJBattleApi.apiRequest = async (p, opts = {}) => {
    calls.push({ path:p, method:opts.method || 'GET', body:opts.body });
    const out = await handler(p, opts);
    return out || { error:'Not found', status:404 };
  };
  return calls;
}
const ok = data => ({ data, status:200 });
const crew = (o = {}) => ({ id:'crew_a', name:'Night Shift', logo:{ emoji:'🔥', color:'#ff4d6d', url:null }, wins:3, losses:1, draws:0, points:9, memberCount:2, maxMembers:4, members:[{ publicProfileId:'dj_1111111111111111', displayName:'DJ Nova', role:'owner', isMe:true }, { publicProfileId:'dj_2222222222222222', displayName:'DJ Kilo', role:'member', isMe:false }], isMember:true, isOwner:true, inviteCode:'AB12CD34', ...o });

test('Oct 20b scripts are wired into the page, the offline cache, the Pages build and the build checks', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('oct20b.js') > html.indexOf('oct20.js'));
  assert.match(html, /studio\/beatmatch_lessons\.js/);
  assert.match(read('sw.js'), /'oct20b\.js'/);
  assert.match(read('sw.js'), /studio\/beatmatch_lessons\.js/);
  assert.match(read('scripts/build-pages.js'), /'oct20b\.js'/);
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.build, /node --check oct20b\.js/);
  assert.match(pkg.scripts.test, /oct20b-five\.test\.js/);
  assert.match(read('app.js'), /\['crews','CR','Crews'\]/);
});

test('Crews page: start a crew form, rankings table, and my crew with join code and battles', async () => {
  const w = loadAppDom();
  signIn(w);
  let mine = null;
  const calls = stubApi(w, (p, o) => {
    if(p === '/api/crews' && o.method === 'POST'){ mine = crew(); return ok({ crew:mine }); }
    if(p === '/api/crews') return ok({ crews:[{ rank:1, ...crew() }, { rank:2, ...crew({ id:'crew_b', name:'Bass <Heads>', points:6, isMember:false, isOwner:false, inviteCode:undefined }) }] });
    if(p === '/api/crews/mine') return ok({ crew:mine, battles:mine ? [{ id:'cbat_1', status:'complete', winnerCrewId:'crew_a', challenger:{ crewId:'crew_a', name:'Night Shift', logo:mine.logo, total:171.5, lineup:[{ displayName:'DJ Nova', score:88, submitted:true }, { displayName:'DJ Kilo', score:83.5, submitted:true }] }, opponent:{ crewId:'crew_b', name:'Bass Heads', logo:null, total:160, lineup:[{ displayName:'A', score:80, submitted:true }, { displayName:'B', score:80, submitted:true }] } }] : [] });
  });
  w.switchView('crews');
  await settle(12);
  const view = w.document.getElementById('crews');
  assert.ok(view.classList.contains('active'));
  assert.ok(w.document.getElementById('crew-create-form'));
  assert.match(w.document.getElementById('crew-rankings').textContent, /Night Shift/);
  assert.ok(!w.document.getElementById('crew-rankings').innerHTML.includes('<Heads>'), 'crew names are escaped');
  w.document.getElementById('crew-name').value = 'Night Shift';
  w.document.getElementById('crew-create-form').dispatchEvent(new w.Event('submit', { cancelable:true }));
  await settle(14);
  const post = calls.find(c => c.path === '/api/crews' && c.method === 'POST');
  assert.equal(post.body.name, 'Night Shift');
  assert.equal(post.body.logoEmoji, '🎧');
  assert.match(w.document.getElementById('crew-mine').textContent, /AB12CD34/);
  assert.match(w.document.getElementById('crew-mine').textContent, /171\.5/);
  assert.match(w.document.getElementById('crew-mine').textContent, /Your crew won/);
});

test('Crews: a 2-vs-2 challenge sends the opponent and exactly the two picked DJs', async () => {
  const w = loadAppDom();
  signIn(w);
  const calls = stubApi(w, (p, o) => {
    if(p === '/api/crews') return ok({ crews:[{ rank:1, ...crew() }, { rank:2, ...crew({ id:'crew_b', name:'Bass Heads', isOwner:false, isMember:false }) }] });
    if(p === '/api/crews/mine') return ok({ crew:crew(), battles:[] });
    if(p === '/api/crewBattles') return ok({ battle:{ id:'cbat_2' } });
  });
  await w.DJBOct20b.crews.load();
  const dlg = w.DJBOct20b.crews.openChallenge('crew_b');
  assert.equal(dlg.querySelector('#crew-opponent').value, 'crew_b');
  dlg.querySelectorAll('input[name="crew-lineup"]').forEach(i => { i.checked = true; });
  dlg.querySelector('form').dispatchEvent(new w.Event('submit', { cancelable:true }));
  await settle(10);
  const post = calls.find(c => c.path === '/api/crewBattles');
  assert.deepEqual(JSON.parse(JSON.stringify(post.body)), { opponentCrewId:'crew_b', lineup:['dj_1111111111111111', 'dj_2222222222222222'] });
});

test('Tip a DJ: preset and custom amounts, the note, and only a Stripe checkout redirect', async () => {
  const w = loadAppDom();
  signIn(w);
  const calls = stubApi(w, p => {
    if(p === '/api/tips/config') return ok({ configured:true, presetsCents:[200, 500], noteMax:280 });
    if(p.startsWith('/api/tips/eligibility/')) return ok({ canTip:true });
    if(p === '/api/tips/checkout') return ok({ tip:{ id:'tip_1' }, checkout:{ redirectUrl:'https://evil.example/steal' } });
  });
  const dlg = await w.DJBOct20b.tips.open('dj_1111111111111111', { name:'DJ Nova', verifiedResultId:'vr_aaaaaaaaaaaaaaaaaaaa' });
  assert.match(dlg.textContent, /\$2/);
  assert.match(dlg.textContent, /\$5/);
  assert.equal(dlg.querySelector('#tip-send').disabled, false);
  dlg.querySelector('input[value="custom"]').checked = true;
  dlg.querySelector('#tip-custom').value = '12.5';
  dlg.querySelector('#tip-message').value = 'Great set';
  let assigned = null;
  try{ Object.defineProperty(w.location, 'assign', { value:u => { assigned = u; }, configurable:true }); }catch(e){}
  dlg.querySelector('form').dispatchEvent(new w.Event('submit', { cancelable:true }));
  await settle(10);
  const post = calls.find(c => c.path === '/api/tips/checkout');
  assert.deepEqual(JSON.parse(JSON.stringify(post.body)), { toPublicProfileId:'dj_1111111111111111', amountCents:1250, message:'Great set', verifiedResultId:'vr_aaaaaaaaaaaaaaaaaaaa' });
  assert.equal(assigned, null, 'never redirects anywhere but checkout.stripe.com');
});

test('Tip a DJ: disabled with a plain reason when the DJ has no Stripe payouts', async () => {
  const w = loadAppDom();
  stubApi(w, p => {
    if(p === '/api/tips/config') return ok({ configured:true, presetsCents:[200, 500] });
    if(p.startsWith('/api/tips/eligibility/')) return ok({ canTip:false });
  });
  const dlg = await w.DJBOct20b.tips.open('dj_1111111111111111', { name:'DJ Nova' });
  assert.equal(dlg.querySelector('#tip-send').disabled, true);
  assert.match(dlg.querySelector('#tip-status').textContent, /hasn.t set up Stripe payouts/);
});

test('Tip button is added to public profile and public result actions', () => {
  const w = loadAppDom();
  const mc = w.document.getElementById('modal-content') || (() => { const d = w.document.createElement('div'); d.id = 'modal-content'; w.document.body.appendChild(d); return d; })();
  mc.innerHTML = '<div class="modal-actions"><button>Close</button></div>';
  const b = w.DJBOct20b.onPublicProfile({ id:'dj_1111111111111111', displayName:'DJ Nova' });
  assert.equal(b.dataset.tipDj, 'dj_1111111111111111');
  assert.equal(w.DJBOct20b.onPublicProfile({ id:'dj_1111111111111111' }), null, 'only one tip button');
  mc.innerHTML = '<div class="modal-actions"></div>';
  const r = w.DJBOct20b.onPublicResult({ verifiedResultId:'vr_1', profile:{ publicProfileId:'dj_2222222222222222', displayName:'Kilo' } });
  assert.equal(r.dataset.tipDj, 'dj_2222222222222222');
});

test('Discount codes: sellers create codes, buyers apply one and checkout sends it', async () => {
  const w = loadAppDom();
  signIn(w);
  const calls = stubApi(w, (p, o) => {
    if(p === '/api/marketplace/discountCodes' && o.method === 'POST') return ok({ code:{ code:'BATTLE20' } });
    if(p === '/api/marketplace/discountCodes') return ok({ codes:[{ id:'bdc_1', code:'BATTLE20', kind:'percent', percentOff:20, timesUsed:3, usageLimit:50, endsAt:null, active:true, state:'live' }] });
    if(/discountPreview$/.test(p)) return ok({ preview:{ code:'BATTLE20', originalCents:2500, discountCents:500, finalCents:2000 } });
  });
  const mine = w.document.createElement('section'); mine.id = 'store-mine'; w.document.body.appendChild(mine);
  await w.DJBOct20b.codes.load();
  assert.match(w.document.getElementById('store-codes').textContent, /BATTLE20/);
  assert.match(w.document.getElementById('store-codes').textContent, /20% off/);
  assert.match(w.document.getElementById('store-codes').textContent, /3\/50 used/);
  w.document.getElementById('code-name').value = 'SUMMER5';
  w.document.getElementById('code-kind').value = 'fixed';
  w.document.getElementById('code-amount').value = '5';
  w.document.getElementById('code-form').dispatchEvent(new w.Event('submit', { cancelable:true }));
  await settle(8);
  const post = calls.find(c => c.path === '/api/marketplace/discountCodes' && c.method === 'POST');
  assert.equal(post.body.kind, 'fixed');
  assert.equal(post.body.amountOffCents, 500);
  const dlg = w.DJBOct20b.codes.openEntry('lst_1', null);
  dlg.querySelector('#code-entry').value = 'battle20';
  dlg.querySelector('form').dispatchEvent(new w.Event('submit', { cancelable:true }));
  await settle(8);
  assert.equal(w.djbDiscountCodeFor('lst_1'), 'BATTLE20');
  assert.match(read('app.js'), /discountCode \? \{ discountCode \}/);
});

test("Who's watching: weekly total, trend, per-kind counts, bars and sources", async () => {
  const w = loadAppDom();
  signIn(w);
  stubApi(w, p => {
    if(p === '/api/insights/views') return ok({ insights:{ weeks:['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'], totals:[1, 2, 3, 4, 5, 6, 20, 30], thisWeek:{ total:30, profile:12, result:10, listing:8 }, lastWeek:{ total:20 }, trend:{ changePercent:50, direction:'up' }, sources:[{ source:'instagram', label:'Instagram', views:15, percent:50 }, { source:'direct', label:'Direct / typed in', views:15, percent:50 }] } });
    if(p === '/api/tips/mine') return ok({ totalCents:700, tips:[{ amountCents:500, from:{ displayName:'Fan <b>' }, message:'🔥' }] });
  });
  w.switchView('profile');
  await settle(12);
  const panel = w.document.getElementById('profile-insights');
  assert.match(panel.textContent, /30 views this week/);
  assert.match(panel.textContent, /▲ 50% vs last week/);
  assert.match(panel.textContent, /Instagram/);
  assert.equal(panel.querySelectorAll('.watch-bars rect').length, 8);
  const tipsPanel = w.document.getElementById('profile-tips');
  assert.match(tipsPanel.textContent, /\$7 in tips/);
  assert.ok(!tipsPanel.innerHTML.includes('<b>'));
});

test('View tracking sends the referrer, and Beat Store listings are counted once per page', async () => {
  assert.equal((read('app.js').match(/referrer:document\.referrer/g) || []).length, 2);
  const w = loadAppDom();
  const calls = stubApi(w, () => ok({ success:true }));
  w.DJBOct20b.insights.trackListingView('lst_9');
  w.DJBOct20b.insights.trackListingView('lst_9');
  await settle(4);
  assert.equal(calls.filter(c => c.path === '/api/marketplace/listings/lst_9/views').length, 1);
});

test('Beatmatching lessons: graders pass good technique and give tips otherwise', () => {
  const w = loadAppDom();
  const L = w.DJBLessons;
  assert.equal(L.gradeTempo(124, 124.2).pass, true);
  assert.match(L.gradeTempo(124, 126).tip, /too fast/);
  assert.match(L.gradeTempo(124, 121).tip, /too slow/);
  assert.equal(L.wrapOffsetMs(490, 120), -10);
  assert.equal(L.gradeAlignment(10, 124).pass, true);
  assert.equal(L.gradeAlignment(490, 120).pass, true, 'almost a whole beat late is really 10 ms early');
  assert.match(L.gradeAlignment(120, 124).tip, /flam/);
  const ramp = (from, to, n = 40) => Array.from({ length:n + 1 }, (_, i) => ({ beat:from + (to - from) * i / n, x:i / n }));
  assert.equal(L.gradeTransition([{ beat:0, x:0 }, ...ramp(64, 80), { beat:84, x:1 }]).pass, true);
  assert.match(L.gradeTransition([{ beat:0, x:0 }, { beat:64, x:0 }, { beat:65, x:1 }]).tip, /slam/);
  assert.match(L.gradeTransition([{ beat:0, x:0 }, ...ramp(8, 60)]).tip, /Too slow/);
  assert.match(L.gradeTransition([{ beat:0, x:0 }, ...ramp(22, 30)]).tip, /phrase/);
  assert.match(L.gradeTransition([{ beat:0, x:0 }, { beat:64, x:0.5 }]).tip, /Finish/);
  assert.equal(L.gradeEqSwap([{ beat:0, a:1, b:0 }, { beat:31.9, a:1, b:0 }, { beat:32, a:0, b:1 }, { beat:40, a:0, b:1 }]).pass, true);
  assert.match(L.gradeEqSwap([{ beat:0, a:1, b:0 }, { beat:30, a:1, b:1 }, { beat:36, a:0, b:1 }]).tip, /Both basslines/);
  assert.match(L.gradeEqSwap([{ beat:0, a:1, b:0 }, { beat:30, a:0, b:0 }, { beat:36, a:0, b:1 }]).tip, /no bass/);
  assert.match(L.gradeEqSwap([{ beat:0, a:1, b:0 }, { beat:33.9, a:1, b:0 }, { beat:34, a:0, b:1 }]).tip, /"1"/);
});

test('Beatmatching lessons mount in Battle Studio with four tabs and use only synthesized sound', async () => {
  const w = loadAppDom();
  w.switchView('studio');
  await settle(4);
  const host = w.document.getElementById('studio-lessons');
  assert.ok(host);
  assert.equal(host.querySelectorAll('[data-lesson]').length, 4);
  host.querySelector('[data-lesson="align"]').click();
  assert.match(w.document.getElementById('studio-lessons').textContent, /Nudge/);
  const r = w.DJBLessons.check();
  assert.equal(r.pass, false, 'a fresh round starts off-beat');
  const src = read('studio/beatmatch_lessons.js');
  assert.ok(!/\.(mp3|wav|ogg|flac|m4a)['"]/.test(src), 'no audio files are loaded');
  assert.match(src, /createOscillator/);
  assert.match(read('README.md'), /Beatmatching lessons/);
});

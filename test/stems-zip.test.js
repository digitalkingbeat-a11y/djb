// Download all stems as one zip on remix contest pages (store-only zip built in the browser).
const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const windows = [];
test.after(() => windows.forEach(w => { try{ w.close(); }catch(e){} }));
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const settle = async (n = 10) => { for(let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

function loadAppDom({ url = 'https://127.0.0.1/index.html' } = {}){
  const dom = new JSDOM(read('index.html'), { url, runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom;
  window.alert = () => {}; window.confirm = () => true; window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = function(){};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function(){ this.setAttribute('open', ''); this.open = true; };
  window.HTMLDialogElement.prototype.close = function(){ this.removeAttribute('open'); this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.fetch = async () => ({ ok:false, status:503, text:async () => '{}', json:async () => ({}) });
  window.matchMedia = q => ({ matches:false, media:q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} });
  const beltScript = Array.from(window.document.querySelectorAll('script:not([src])')).find(s => s.textContent.includes('setCurrentBelt'));
  if(beltScript) window.eval(beltScript.textContent);
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/beatmatch_lessons.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js', 'social.js', 'connect.js', 'oct20.js', 'oct20b.js', 'passkeys.js', 'invites.js', 'stems_zip.js', 'remix_contests.js'].forEach(f => window.eval(read(f)));
  windows.push(window);
  return window;
}
function stubApi(window, handler){
  const calls = [];
  window.DJBattleApi.apiRequest = async (p, opts = {}) => {
    calls.push({ path:p, method:opts.method || 'GET', body:opts.body, public:opts.public });
    const out = await handler(p, opts);
    return out || { error:'Not found', status:404 };
  };
  return calls;
}
const ok = data => ({ data, status:200 });
const signIn = w => w.__DJBattleTestHooks.updateAuthUI({ id:'user-1', email:'dj@example.com', user_metadata:{ full_name:'Sample DJ' } });
const myInvite = (o = {}) => ({ code:'NOVA2345', joinCount:3, badge:{ key:'recruiter', emoji:'📣', label:'Crew Recruiter' }, next:{ label:'Scene Builder', emoji:'🌟', needed:7 }, friends:[{ displayName:'DJ Kilo', publicProfileId:'dj_2', joinedAt:'2026-10-24T12:00:00Z' }, { displayName:'DJ Echo', publicProfileId:'dj_3', joinedAt:'2026-10-23T12:00:00Z' }], ...o });

const later = h => new Date(Date.now() + h * 3600e3).toISOString();
const contest = (o = {}) => ({ id:'rmx_abc123abc123', title:'Flip My Beat (SAMPLE)', description:'Any genre welcome.', phase:'open', host:{ displayName:'DJ Host', publicProfileId:'dj_h' }, isHost:false,
  rights:{ classification:'original', label:'I made it (original)' }, submissionDeadline:later(30), votingDeadline:later(80), countdown:{ endsAt:later(30), what:'Submissions close' },
  parts:[{ id:'part_1', label:'Drums', filename:'drums.wav', size:10, uploaded:true }, { id:'part_2', label:'Bass', filename:'bass.wav', size:10, uploaded:true }],
  entryCount:2, winner:null, store:{ status:'none', listingId:null }, canEdit:false,
  entries:[{ id:'rmxe_1', title:'Night Flip', notes:'Half-time', dj:{ displayName:'DJ Alpha', publicProfileId:'dj_a' }, isMine:false, isWinner:false, votes:null, hidden:false },
    { id:'rmxe_2', title:'My Flip', notes:'', dj:{ displayName:'Sample DJ', publicProfileId:'dj_me' }, isMine:true, isWinner:false, votes:null, hidden:false }],
  totalVotes:null, viewer:{ signedIn:true, hasEntry:true, entryId:'rmxe_2', votedEntryId:null, canSubmit:true, canVote:false, isWinner:false }, ...o });

const Z = require('../stems_zip.js');
const zlib = require('zlib');

// Minimal reader to prove the zip is valid: walk the central directory and check CRCs.
function readZip(buf){
  const b = Buffer.from(buf); const eocd = b.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  const n = b.readUInt16LE(eocd + 10); let p = b.readUInt32LE(eocd + 16); const out = [];
  for(let i = 0; i < n; i++){
    assert.equal(b.readUInt32LE(p), 0x02014b50);
    const crc = b.readUInt32LE(p + 16), size = b.readUInt32LE(p + 24), nl = b.readUInt16LE(p + 28), off = b.readUInt32LE(p + 42);
    const name = b.slice(p + 46, p + 46 + nl).toString('utf8');
    assert.equal(b.readUInt32LE(off), 0x04034b50);
    const ln = b.readUInt16LE(off + 26), data = b.slice(off + 30 + ln, off + 30 + ln + size);
    assert.equal(zlib.crc32 ? zlib.crc32(data) : Z.crc32(data), crc);
    out.push({ name, data:data.toString() }); p += 46 + nl;
  }
  return out;
}

test('stems_zip.js is wired into the page (before remix_contests.js), offline cache, Pages build and build checks', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('stems_zip.js') > 0 && html.indexOf('stems_zip.js') < html.indexOf('remix_contests.js'));
  assert.match(read('sw.js'), /'stems_zip\.js'/);
  assert.match(read('scripts/build-pages.js'), /'stems_zip\.js'/);
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.build, /node --check stems_zip\.js/);
  assert.match(pkg.scripts.test, /test\/stems-zip\.test\.js/);
});

test('crc32 matches the standard check value and the zip is valid with UTF-8 names', () => {
  assert.equal(Z.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const zip = Z.buildZip([{ name:'drums.wav', data:new TextEncoder().encode('DRUMS') }, { name:'bässline.wav', data:new TextEncoder().encode('BASS') }, { name:'empty.wav', data:new Uint8Array(0) }]);
  assert.deepEqual(readZip(zip), [{ name:'drums.wav', data:'DRUMS' }, { name:'bässline.wav', data:'BASS' }, { name:'empty.wav', data:'' }]);
});

test('zip and part names are safe and never collide', () => {
  assert.equal(Z.zipFileName('Flip My Beat (SAMPLE)'), 'Flip-My-Beat-(SAMPLE)-stems.zip');
  assert.equal(Z.zipFileName('../../etc/pass:wd?'), 'etc-pass-wd-stems.zip');
  assert.equal(Z.zipFileName('   '), 'remix-contest-stems.zip');
  assert.equal(Z.zipFileName('Café Beats'), 'Cafe-Beats-stems.zip');
  assert.deepEqual(Z.uniqueNames(['kick.wav', 'Kick.wav', 'a/b.wav', '']), ['kick.wav', 'Kick (2).wav', 'a b.wav', 'part']);
});

test('collect reports progress, skips parts still uploading, and fails clearly naming the part', async () => {
  const seen = [];
  const parts = [{ id:'1', label:'Drums', filename:'drums.wav', uploaded:true }, { id:'2', label:'Vox', filename:'vox.wav', uploaded:false }, { id:'3', label:'Bass', filename:'bass.wav', uploaded:true }];
  const zip = await Z.collect(parts, { getUrl: async p => ({ url:'u/' + p.id }), fetchImpl: async u => ({ ok:true, arrayBuffer: async () => new TextEncoder().encode(u).buffer }), onProgress: e => seen.push(`${e.done}/${e.total}`) });
  assert.deepEqual(readZip(zip).map(f => f.name), ['drums.wav', 'bass.wav']);
  assert.deepEqual(seen, ['0/2', '1/2', '2/2']);
  await assert.rejects(Z.collect(parts, { getUrl: async () => ({ url:'x' }), fetchImpl: async () => ({ ok:false, status:403 }) }), /“Drums” couldn’t be downloaded \(the server answered 403\)/);
  await assert.rejects(Z.collect([{ id:'9', uploaded:false }], {}), /No parts are ready/);
});

test('contest page: Download all button uses the same per-part endpoint, shows progress, saves a named zip, keeps single downloads', async () => {
  const w = loadAppDom(); signIn(w);
  const calls = stubApi(w, p => {
    if(p === '/api/remix-contests/rmx_abc123abc123') return ok({ contest:contest() });
    if(p.endsWith('/download')) return ok({ url:'https://signed.test/' + p.split('/')[5], filename:'x.wav' });
    return null;
  });
  const fetched = []; w.fetch = async u => { fetched.push(u); return { ok:true, status:200, arrayBuffer: async () => new TextEncoder().encode('AUDIO').buffer }; };
  w.URL.createObjectURL = () => 'blob:zip'; w.URL.revokeObjectURL = () => {};
  let saved = null; w.HTMLAnchorElement.prototype.click = function(){ saved = this.download; };
  await w.DJBRemix.open('rmx_abc123abc123');
  const page = w.document.getElementById('rmx-page');
  assert.equal(page.querySelectorAll('[data-rmx-part]').length, 2, 'single downloads stay');
  const btn = w.document.getElementById('rmx-zip');
  assert.match(btn.textContent, /Download all stems/);
  assert.ok(w.document.getElementById('rmx-zip-progress').hidden);
  btn.click(); await settle(30);
  assert.equal(calls.filter(c => /\/parts\/part_[12]\/download$/.test(c.path) && c.method === 'POST').length, 2);
  assert.deepEqual(fetched, ['https://signed.test/part_1', 'https://signed.test/part_2']);
  assert.equal(saved, 'Flip-My-Beat-(SAMPLE)-stems.zip');
  assert.equal(w.document.getElementById('rmx-zip-progress').value, 2);
  assert.match(w.document.getElementById('rmx-zip-status').textContent, /Saved Flip-My-Beat/);
});

test('Download all shows a clear error when a part is refused, and is hidden when signed out or cancelled', async () => {
  const w = loadAppDom(); signIn(w);
  stubApi(w, p => {
    if(p === '/api/remix-contests/rmx_abc123abc123') return ok({ contest:contest() });
    if(p.endsWith('part_2/download')) return { error:'Forbidden', status:403, data:{ error:'You can\u2019t download this part' } };
    if(p.endsWith('/download')) return ok({ url:'https://signed.test/a' });
    return null;
  });
  w.fetch = async () => ({ ok:true, status:200, arrayBuffer: async () => new ArrayBuffer(3) });
  await w.DJBRemix.open('rmx_abc123abc123');
  w.document.getElementById('rmx-zip').click(); await settle(30);
  assert.match(w.document.getElementById('rmx-zip-status').textContent, /“Bass” couldn’t be downloaded \(You can’t download this part\)/);
  assert.equal(w.document.getElementById('rmx-zip').disabled, false);
  for(const o of [{ viewer:{ signedIn:false } }, { phase:'cancelled' }]){
    stubApi(w, p => p === '/api/remix-contests/rmx_abc123abc123' ? ok({ contest:contest(o) }) : null);
    await w.DJBRemix.open('rmx_abc123abc123');
    assert.equal(w.document.getElementById('rmx-zip'), null);
  }
});

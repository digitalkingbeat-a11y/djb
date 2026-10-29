// Oct 27: website link and booking info on DJ profiles.
const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const windows = [];
test.after(() => windows.forEach(w => { try{ w.close(); }catch(e){} }));

const root = path.join(__dirname, '..');
const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async (n = 6) => { for(let i = 0; i < n; i++) await nextTick(); };
const plain = value => JSON.parse(JSON.stringify(value));

function loadAppDom({ url = 'http://127.0.0.1/index.html', setup } = {}){
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(index, { url, runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom;
  window.alert = () => {};
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = function(){};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal(){ this.setAttribute('open', ''); this.open = true; };
  window.HTMLDialogElement.prototype.close = function close(){ this.removeAttribute('open'); this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.fetch = async () => ({ ok:false, status:503, text: async () => '{}', json: async () => ({}) });
  if(setup) setup(window);
  const beltScript = Array.from(window.document.querySelectorAll('script:not([src])')).find(s => s.textContent.includes('setCurrentBelt'));
  if(beltScript) window.eval(beltScript.textContent);
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_pro.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js', 'social.js', 'beat_store_five.js', 'sales_chart.js', 'automix.js', 'share_links.js', 'studio_five.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  windows.push(window);
  return window;
}
const quietLoad = (opts = {}) => loadAppDom({ ...opts, setup:w => { w.__DJBattleSkipReturnLinks = true; if(opts.setup) opts.setup(w); } });

test('website: accepts http(s), adds https:// to bare domains, rejects anything unsafe', () => {
  const w = quietLoad();
  assert.equal(w.normalizeProfileWebsite('djdan.com').value, 'https://djdan.com/');
  assert.equal(w.normalizeProfileWebsite(' https://djdan.com/mixes ').value, 'https://djdan.com/mixes');
  assert.equal(w.normalizeProfileWebsite('http://www.djdan.co.uk').value, 'http://www.djdan.co.uk/');
  assert.equal(w.normalizeProfileWebsite('').value, '');
  ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://djdan.com', 'https://user:pw@djdan.com', 'https://localhost', 'not a url', 'https://dj"onmouseover=alert(1).com', 'https://djdan.com/<script>', 'vbscript:x', 'https://' + 'a'.repeat(200) + '.com']
    .forEach(bad => assert.ok(w.normalizeProfileWebsite(bad).error, bad));
});

test('booking info: one short line; emails become mailto links and everything is escaped', () => {
  const w = quietLoad();
  assert.equal(w.normalizeBookingInfo('  DM \n for   bookings ').value, 'DM for bookings');
  assert.ok(w.normalizeBookingInfo('x'.repeat(121)).error);
  const html = w.bookingInfoHtml('Email bookings@djdan.com or call 555-0100 <img src=x onerror=alert(1)>');
  assert.match(html, /<a href="mailto:bookings@djdan\.com">bookings@djdan\.com<\/a>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
  const box = w.document.createElement('div'); box.innerHTML = w.profileLinksHtml({ website:'https://djdan.com/mixes', bookingInfo:'bookings@djdan.com' });
  const a = box.querySelector('a.profile-website-link');
  assert.equal(a.getAttribute('href'), 'https://djdan.com/mixes');
  assert.equal(a.getAttribute('target'), '_blank');
  assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(a.textContent.trim(), 'djdan.com/mixes ↗');
  assert.equal(box.querySelector('.profile-booking-info a').getAttribute('href'), 'mailto:bookings@djdan.com');
  assert.equal(w.profileLinksHtml({ website:'javascript:alert(1)', bookingInfo:'' }), '', 'unsafe website from anywhere is dropped');
});

test('Edit Profile saves website + booking info in this browser and shows them on the profile', async () => {
  const w = quietLoad();
  w.openEditProfileModal();
  const doc = w.document;
  assert.ok(doc.getElementById('edit-profile-website'));
  assert.equal(doc.getElementById('edit-profile-booking').getAttribute('maxlength'), '120');
  doc.getElementById('edit-profile-name').value = 'DJ Dan';
  doc.getElementById('edit-profile-website').value = 'javascript:alert(1)';
  doc.getElementById('edit-profile-booking').value = 'bookings@djdan.com';
  let result = doc.getElementById('save-profile').onclick();
  assert.match(result.error, /Website/);
  assert.match(doc.getElementById('edit-profile-error').textContent, /Website/);
  doc.getElementById('edit-profile-website').value = 'djdan.com';
  result = doc.getElementById('save-profile').onclick();
  assert.ok(!result.error, result.error);
  assert.deepEqual(plain(await result.linksSync), { localOnly:true });
  const user = w.currentUser();
  assert.equal(user.website, 'https://djdan.com/');
  assert.equal(user.bookingInfo, 'bookings@djdan.com');
  const links = doc.getElementById('profile-hero-links');
  assert.ok(!links.classList.contains('hidden'));
  assert.equal(links.querySelector('a[rel="noopener noreferrer"]').getAttribute('href'), 'https://djdan.com/');
  assert.equal(links.querySelector('a[href^="mailto:"]').textContent, 'bookings@djdan.com');
  // Reopening the editor shows the saved values.
  w.openEditProfileModal();
  assert.equal(doc.getElementById('edit-profile-website').value, 'https://djdan.com/');
  // Clearing both hides the row.
  doc.getElementById('edit-profile-website').value = '';
  doc.getElementById('edit-profile-booking').value = '';
  doc.getElementById('save-profile').onclick();
  assert.ok(doc.getElementById('profile-hero-links').classList.contains('hidden'));
});

test('signed in: saving sends website + booking info to the account', async () => {
  const w = quietLoad();
  const calls = [];
  w.DJBattleApi.apiRequest = async (url, opts = {}) => { calls.push({ url, opts }); return { data:{ success:true, links:opts.body || {} } }; };
  w.__DJBattleTestHooks && w.__DJBattleTestHooks.setAuthUser ? w.__DJBattleTestHooks.setAuthUser({ id:'u1', email:'dan@x.com', user_metadata:{} }) : null;
  const out = await w.syncProfileLinksToServer({ signedIn:true, id:'u1', website:'https://djdan.com/', bookingInfo:'DM for bookings' });
  assert.equal(out.saved, true);
  const put = calls.find(c => c.url === '/api/me/profileLinks');
  assert.equal(put.opts.method, 'PUT');
  assert.deepEqual(plain(put.opts.body), { website:'https://djdan.com/', bookingInfo:'DM for bookings', instagram:'', soundcloud:'', mixcloud:'', tiktok:'' });
});

test('public profile shows the website as a safe link and escapes hostile booking text', () => {
  const w = quietLoad();
  w.renderPublicDjProfile({ publicProfileId:'dj_0123456789abcdef', displayName:'SAMPLE DJ', stats:{}, website:'https://sample-dj.com/', bookingInfo:'<script>alert(1)</script> book@sample-dj.com' }, 'server');
  const mod = w.document.querySelector('#modal .public-profile-links');
  assert.ok(mod, 'links module shown');
  assert.equal(mod.querySelector('a.profile-website-link').getAttribute('rel'), 'noopener noreferrer');
  assert.equal(mod.querySelector('script'), null);
  assert.match(mod.textContent, /<script>alert\(1\)<\/script>/);
  assert.equal(mod.querySelector('a[href="mailto:book@sample-dj.com"]').textContent, 'book@sample-dj.com');
  w.renderPublicDjProfile({ publicProfileId:'dj_0123456789abcdef', displayName:'SAMPLE DJ', stats:{}, website:'javascript:alert(1)' }, 'server');
  assert.equal(w.document.querySelector('#modal .public-profile-links'), null);
});

test('server SQL 055 adds both columns', () => {
  const sql = fs.readFileSync(path.join(root, 'server', 'sql', '055_add_profile_links.sql'), 'utf8');
  assert.match(sql, /website_url text/);
  assert.match(sql, /booking_info text/);
});

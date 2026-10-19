// Real-browser phone check: every page fits a 390px and a 360px phone screen with no sideways
// scrolling, and the floating player never hides the bottom of a page. Uses Playwright with the
// bundled Chromium or the system Chrome (GitHub's Ubuntu runners ship /usr/bin/google-chrome);
// skips cleanly when neither browser is available.
const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '..');
const VIEWS = ['dashboard','battles','studio','library','community','verified-results','rankings','activity','notifications','settings','profile','store','practice','battle-room'];
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json', '.wav':'audio/wav' };

function startServer(){
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.normalize(path.join(root, url === '/' ? 'index.html' : url));
    if(!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type':TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function launchBrowser(){
  let playwright;
  try{ playwright = require('playwright'); }catch(e){ return null; }
  try{ return await playwright.chromium.launch(); }catch(e){}
  for(const exe of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']){
    if(fs.existsSync(exe)){ try{ return await playwright.chromium.launch({ executablePath:exe, args:['--no-sandbox'] }); }catch(e){} }
  }
  return null;
}

test('every page fits a phone screen (390px and 360px) with nothing hidden under the player', { timeout:240000 }, async t => {
  const browser = await launchBrowser();
  if(!browser){ t.skip('no Chromium/Chrome available for the browser layout check'); return; }
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  const problems = [];
  try{
    for(const [width, height] of [[390, 844], [360, 740]]){
      const ctx = await browser.newContext({ viewport:{ width, height }, deviceScaleFactor:2, isMobile:true, hasTouch:true, userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', serviceWorkers:'block' });
      await ctx.addInitScript(() => { try{ localStorage.setItem('djBattleTourSeen', '1'); localStorage.setItem('djBattleFirstRunTourDone', '1'); }catch(e){} });
      const page = await ctx.newPage();
      await page.goto(base, { waitUntil:'load' });
      await page.waitForFunction(() => typeof window.switchView === 'function');
      for(const view of VIEWS){
        await page.evaluate(v => { window.switchView(v); window.scrollTo(0, 0); }, view);
        await page.waitForTimeout(250);
        const m = await page.evaluate(() => {
          const vw = window.innerWidth, vh = window.innerHeight;
          window.scrollTo(0, document.documentElement.scrollHeight);
          const fixed = Array.from(document.querySelectorAll('.sidebar, #library-player')).filter(el => getComputedStyle(el).display !== 'none').map(el => el.getBoundingClientRect()).filter(r => r.height > 0 && r.top > vh / 2);
          const barTop = fixed.length ? Math.min(...fixed.map(r => r.top)) : vh;
          const view = document.querySelector('.view.active');
          const lowest = view ? Array.from(view.querySelectorAll('*')).filter(el => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.height > 0; }).reduce((max, el) => Math.max(max, el.getBoundingClientRect().bottom), 0) : 0;
          window.scrollTo(0, 0);
          return { vw, docWidth:document.documentElement.scrollWidth, coveredPx:Math.round(lowest - barTop) };
        });
        if(m.vw !== width || m.docWidth > width) problems.push(`${view} @${width}px: page is ${m.docWidth}px wide (viewport ${m.vw}px)`);
        if(m.coveredPx > 0) problems.push(`${view} @${width}px: last ${m.coveredPx}px hidden under the menu/player`);
      }
      // Key dialogs open centred and on screen.
      await page.evaluate(() => { window.switchView('profile'); window.__DJBattleTestHooks.openEditProfileModal(); });
      await page.waitForTimeout(200);
      const dlg = await page.evaluate(() => { const r = document.querySelector('#modal .modal-card').getBoundingClientRect(); return { left:r.left, right:r.right, vw:window.innerWidth, docWidth:document.documentElement.scrollWidth }; });
      if(dlg.left < 0 || dlg.right > dlg.vw || dlg.docWidth > width) problems.push(`Edit Profile @${width}px is off screen (${Math.round(dlg.left)}..${Math.round(dlg.right)})`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  assert.deepEqual(problems, []);
});

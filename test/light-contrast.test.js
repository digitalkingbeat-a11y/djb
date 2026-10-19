// Real-browser check that light mode text is readable: every visible piece of body text on the
// main pages meets WCAG AA contrast (4.5:1, or 3:1 for large text) against its background.
// Uses Playwright like mobile-layout.test.js and skips cleanly when no browser is available.
const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '..');
const VIEWS = ['dashboard','battles','studio','library','community','verified-results','rankings','activity','settings','profile','store','practice','tournaments','battle-room'];
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };

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

// Runs in the page: returns text elements whose contrast is below AA.
function auditContrast(){
  const parse = c => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if(!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { r:p[0], g:p[1], b:p[2], a:p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, bottom) => ({ r:top.r * top.a + bottom.r * (1 - top.a), g:top.g * top.a + bottom.g * (1 - top.a), b:top.b * top.a + bottom.b * (1 - top.a), a:1 });
  function background(el){
    const layers = [];
    for(let node = el; node && node.nodeType === 1; node = node.parentElement){
      const cs = getComputedStyle(node);
      if(cs.backgroundImage && cs.backgroundImage !== 'none' && !/url\(/.test(cs.backgroundImage)) return null; // gradient: can't know the exact pixel
      const bg = parse(cs.backgroundColor);
      if(bg && bg.a > 0){ layers.push(bg); if(bg.a >= 1) break; }
    }
    let out = { r:255, g:255, b:255, a:1 };
    for(let i = layers.length - 1; i >= 0; i--) out = blend(layers[i], out);
    return out;
  }
  const fails = [];
  const all = document.querySelectorAll('.view.active *, .topbar *, .sidebar *');
  for(const el of all){
    const text = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    if(!text) continue;
    const rect = el.getBoundingClientRect();
    if(!rect.width || !rect.height) continue;
    const cs = getComputedStyle(el);
    if(cs.visibility === 'hidden' || Number(cs.opacity) === 0 || el.closest('[aria-hidden="true"],[disabled],.hidden')) continue;
    let fg = parse(cs.color);
    const bg = background(el);
    if(!fg || !bg) continue;
    if(fg.a < 1) fg = blend(fg, bg);
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || size >= 18.66 && Number(cs.fontWeight) >= 700;
    if(ratio < (large ? 3 : 4.5)) fails.push({ text:text.slice(0, 40), ratio:Math.round(ratio * 100) / 100, cls:String(el.className).slice(0, 50), tag:el.tagName });
  }
  return fails;
}

test('light mode body text meets WCAG AA contrast on the main pages', { timeout:240000 }, async t => {
  const browser = await launchBrowser();
  if(!browser){ t.skip('no Chromium/Chrome available for the contrast check'); return; }
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  const problems = [];
  try{
    for(const [width, height] of [[1280, 900], [390, 844]]){
      const ctx = await browser.newContext({ viewport:{ width, height }, serviceWorkers:'block', reducedMotion:'reduce' });
      await ctx.addInitScript(() => { try{ localStorage.setItem('djBattleTourSeen', '1'); localStorage.setItem('djBattleFirstRunTourDone', '1'); localStorage.setItem('djbTheme', 'light'); }catch(e){} });
      const page = await ctx.newPage();
      await page.goto(base, { waitUntil:'load' });
      await page.waitForFunction(() => window.DJBSocial && document.documentElement.dataset.theme === 'light');
      for(const view of VIEWS){
        await page.evaluate(v => { window.switchView(v); window.scrollTo(0, 0); }, view);
        await page.waitForTimeout(250);
        const fails = await page.evaluate(auditContrast);
        fails.forEach(f => problems.push(`${width}px ${view}: "${f.text}" ${f.tag}.${f.cls} ratio ${f.ratio}`));
      }
      await ctx.close();
    }
  }finally{
    await browser.close();
    server.close();
  }
  assert.deepEqual([...new Set(problems)], []);
});

// Generates iPhone launch images (apple-touch-startup-image) into assets/splash/.
// Run: node scripts/build-splash.js   (needs Playwright + Chrome; outputs are committed)
const fs = require('fs');
const path = require('path');
const SIZES = [ // [css width, css height, device pixel ratio, devices]
  [440, 956, 3, 'iPhone 16/17 Pro Max'], [402, 874, 3, 'iPhone 16 Pro, 17, 17 Pro'], [420, 912, 3, 'iPhone Air'],
  [430, 932, 3, 'iPhone 14 Pro Max, 15/16 Plus, 15 Pro Max'], [393, 852, 3, 'iPhone 14 Pro, 15, 15 Pro, 16'],
  [428, 926, 3, 'iPhone 12/13 Pro Max, 14 Plus'], [390, 844, 3, 'iPhone 12/13/14, 12/13 Pro, 16e'],
  [375, 812, 3, 'iPhone X/XS/11 Pro, 12/13 mini'], [414, 896, 3, 'iPhone XS Max, 11 Pro Max'],
  [414, 896, 2, 'iPhone XR, 11'], [375, 667, 2, 'iPhone SE, 8']
];
const fileFor = ([w, h, r]) => `assets/splash/splash-${w * r}x${h * r}.png`;
const linkTags = () => SIZES.map(s => `  <link rel="apple-touch-startup-image" media="(device-width: ${s[0]}px) and (device-height: ${s[1]}px) and (-webkit-device-pixel-ratio: ${s[2]}) and (orientation: portrait)" href="${fileFor(s)}" />`).join('\n');
const pageHtml = (logo) => `<!doctype html><html><body style="margin:0;height:100vh;background:#0b0f14;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Inter,Arial,sans-serif;background-image:radial-gradient(circle at 50% 42%,rgba(185,255,49,.14),transparent 45%)">
<img src="data:image/png;base64,${logo}" style="width:132px;height:132px;border-radius:30px;box-shadow:0 0 48px rgba(185,255,49,.25)">
<div style="margin-top:26px;color:#f5f7fb;font-weight:900;font-size:30px;letter-spacing:.18em">DJ BATTLE</div>
<div style="margin-top:10px;color:#b9ff31;font-weight:800;font-size:12px;letter-spacing:.32em">MIX · BATTLE · RANK</div></body></html>`;
module.exports = { SIZES, fileFor, linkTags };
if(require.main === module){
  (async () => {
    const { chromium } = require('playwright');
    const root = path.join(__dirname, '..');
    const logo = fs.readFileSync(path.join(root, 'assets/icon-512.png')).toString('base64');
    const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    for(const s of SIZES){
      const p = await b.newPage({ viewport: { width: s[0], height: s[1] }, deviceScaleFactor: s[2] });
      await p.setContent(pageHtml(logo)); await p.screenshot({ path: path.join(root, fileFor(s)) }); await p.close();
      console.log(fileFor(s), s[3]);
    }
    await b.close();
  })();
}

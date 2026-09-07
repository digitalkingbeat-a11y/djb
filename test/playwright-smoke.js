const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async ()=>{
  const out = [];
  const browser = await chromium.launch();
  const context = await browser.newContext();

  // create a tiny silent WAV file
  const wavPath = path.join(__dirname,'silence.wav');
  if(!fs.existsSync(wavPath)){
    const header = Buffer.from([
      0x52,0x49,0x46,0x46, // RIFF
    ]);
    // we'll write a minimal valid WAV using Node built-in approach: 1 second silence, 1 channel, 16-bit, 22050Hz
    const sampleRate = 22050;
    const seconds = 1;
    const numSamples = sampleRate * seconds;
    const data = Buffer.alloc(numSamples * 2);
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.from('fmt '), Buffer.alloc(16), Buffer.alloc(4), Buffer.alloc(4)]);
    // fallback: write a prebuilt small WAV file via simple PCM header
    const fileData = createSimpleWav(numSamples, sampleRate);
    fs.writeFileSync(wavPath, fileData);
  }

  function createSimpleWav(numSamples, sampleRate){
    const byteRate = sampleRate * 2; // 16-bit mono
    const blockAlign = 2;
    const dataSize = numSamples * 2;
    const buf = Buffer.alloc(44 + dataSize);
    buf.write('RIFF',0);
    buf.writeUInt32LE(36 + dataSize,4);
    buf.write('WAVE',8);
    buf.write('fmt ',12);
    buf.writeUInt32LE(16,16);
    buf.writeUInt16LE(1,20); // PCM
    buf.writeUInt16LE(1,22); // channels
    buf.writeUInt32LE(sampleRate,24);
    buf.writeUInt32LE(byteRate,28);
    buf.writeUInt16LE(blockAlign,32);
    buf.writeUInt16LE(16,34);
    buf.write('data',36);
    buf.writeUInt32LE(dataSize,40);
    // data already zeroed (silence)
    return buf;
  }

  // Preload a library item into localStorage before page loads
  await context.addInitScript(() => {
    const lib = [{ id:'t1', title:'Smoke Test Track', artist:'Tester', bpm:120, key:'C', genre:'Test', source:'MY_LIBRARY', rightsCategory:'Original / I Own the Rights', battleEligible:true, duration:'1:00' }];
    localStorage.setItem('djBattleLibrary', JSON.stringify(lib));
  });

  const page = await context.newPage();

  const errors = [];
  page.on('console', msg=>{
    if(msg.type()==='error') errors.push(msg.text());
  });
  page.on('pageerror', e=> errors.push(String(e)));
  page.on('response', response => {
    if(response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', request => {
    errors.push(`${request.failure()?.errorText || 'request failed'} ${request.url()}`);
  });
  await page.route('**/api/battles/lobby**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success:true, battles:[], pagination:{ page:1, limit:20, hasMore:false } })
  }));

  await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'load', timeout: 15000 });

  await page.click('.nav-btn[data-view="studio"]');
  await page.waitForSelector('#studio.active [data-set-cue="a"]');
  await page.waitForSelector('#file-a', { state: 'attached' });

  // attach file to deck A file input
  const input = await page.$('#file-a');
  await input.setInputFiles(wavPath);

  // give time for onchange handlers
  await page.waitForTimeout(500);

  // play a bit to set currentTime (some browsers won't allow autoplay; but we can still set cues based on currentTime 0)
  // click set cue for deck A
  const setCue = await page.$('[data-set-cue="a"]');
  if(!setCue) throw new Error('Set Cue button for A not found');
  await setCue.click();

  // read localStorage djBattleDecks
  const decks = await page.evaluate(()=> localStorage.getItem('djBattleDecks'));
  out.push({ decks });

  // reload page to verify persistence
  await page.reload({ waitUntil: 'load' });
  await page.click('.nav-btn[data-view="studio"]');
  await page.waitForTimeout(300);

  // ensure cues container exists
  const cuesA = await page.$('#cues-a');
  if(!cuesA) throw new Error('Cues container #cues-a missing after reload');
  const cueBtns = await page.$$('#cues-a button');
  out.push({ cueButtonCount: cueBtns.length });

  // double-click first studio row to load into focused deck (focused defaults to a)
  const row = await page.$('tr[data-studio-idx]');
  if(!row) throw new Error('No studio rows found to dblclick');
  await row.dblclick();
  await page.waitForTimeout(400);
  // verify name-a changed
  const nameA = await page.$eval('#name-a', el=>el.textContent.trim());
  out.push({ nameA });
  if(nameA !== 'Smoke Test Track') throw new Error(`Expected Deck A to load Smoke Test Track, got ${nameA}`);

  const responsiveViews = [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 920 },
    { width: 390, height: 844 }
  ];
  for(const viewport of responsiveViews){
    await page.setViewportSize(viewport);
    await page.click('.nav-btn[data-view="battles"]');
    await page.waitForTimeout(120);
    const battlesMetrics = await page.evaluate(() => ({
      active: document.querySelector('#battles')?.classList.contains('active'),
      overflow: document.documentElement.scrollWidth - window.innerWidth
    }));
    if(!battlesMetrics.active) throw new Error(`Battles did not activate at ${viewport.width}px`);
    if(battlesMetrics.overflow > 8) throw new Error(`Battles body overflow ${battlesMetrics.overflow}px at ${viewport.width}px`);

    await page.click('.nav-btn[data-view="studio"]');
    await page.waitForTimeout(120);
    const studioMetrics = await page.evaluate(() => ({
      active: document.querySelector('#studio')?.classList.contains('active'),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      deckCount: document.querySelectorAll('#studio .professional-studio-grid .deck').length,
      hasMixer: Boolean(document.querySelector('#studio .professional-studio-grid .professional-mixer'))
    }));
    if(!studioMetrics.active) throw new Error(`Studio did not activate at ${viewport.width}px`);
    if(studioMetrics.deckCount !== 2 || !studioMetrics.hasMixer) throw new Error(`Studio layout incomplete at ${viewport.width}px`);
    if(studioMetrics.overflow > 8) throw new Error(`Studio body overflow ${studioMetrics.overflow}px at ${viewport.width}px`);
    out.push({ viewport: `${viewport.width}x${viewport.height}`, battlesOverflow: battlesMetrics.overflow, studioOverflow: studioMetrics.overflow });
  }

  await browser.close();
  if(errors.length) throw new Error(`Browser console errors: ${errors.join(' | ')}`);

  console.log(JSON.stringify({ out, errors }, null, 2));
  process.exit(0);
})();

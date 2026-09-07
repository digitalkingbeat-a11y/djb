const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');

(async function(){
  const file = path.resolve(__dirname, '..', 'index.html');
  console.log('Loading', file);
  // Build an HTML string with inline scripts to avoid external resource loading
  let html = fs.readFileSync(file,'utf8');
  // polyfill script to prepend
  const poly = `\n<script>\nwindow.fetch = window.fetch || (async ()=>({ json: async ()=>({ success:true, belts: [], attempts: [] }) }));\n(function(){const store={};window.localStorage={getItem(k){return Object.prototype.hasOwnProperty.call(store,k)?store[k]:null},setItem(k,v){store[k]=String(v)},removeItem(k){delete store[k]},clear(){for(const k in store)delete store[k]}}})();\nwindow.__TEST_ERRORS__=[];const _e=console.error;console.error=(...a)=>{window.__TEST_ERRORS__.push(a.map(String).join(' '));_e.apply(console,a)};\n</script>\n`;
  // inline judge/how_close.js
  const howClosePath = path.resolve(__dirname, '..', 'judge', 'how_close.js');
  const analysisPath = path.resolve(__dirname, '..', 'judge', 'analysis.js');
  const appPath = path.resolve(__dirname, '..', 'app.js');
  const howClose = fs.existsSync(howClosePath)? fs.readFileSync(howClosePath,'utf8') : '';
  const analysis = fs.existsSync(analysisPath)? fs.readFileSync(analysisPath,'utf8') : '';
  const appCode = fs.existsSync(appPath)? fs.readFileSync(appPath,'utf8') : '';
  // replace the linked scripts/styles by injecting the polyfill and inline scripts before </head>
  html = html.replace(/<link rel="stylesheet" href="[^"]+" \/>/g, '');
  html = html.replace('</head>', poly + `<script>${howClose}</script><script>${analysis}</script><script>${appCode}</script></head>`);
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'file://' + file.replace(/\\/g, '/') });
  const { window } = dom;
  const { document, localStorage } = window;

  function wait(ms){ return new Promise(r=>setTimeout(r, ms)); }

  // Wait for initial scripts to load
  await wait(800);

  const results = { errors: [], checks: {} };

  try{
    // 1) Click first Enter Battle if present
    const enterBtn = document.querySelector('[data-enter]');
    if(!enterBtn){ results.checks.enter_present = false; console.warn('No enter button found'); }
    else { results.checks.enter_present = true; enterBtn.click(); }

    await wait(200);

    // Ensure modal present and find buttons
    const findBtn = document.getElementById('find-opponent');
    const practiceBtn = document.getElementById('practice-only');
    results.checks.findBtn = !!findBtn; results.checks.practiceBtn = !!practiceBtn;

    // Try the opponent flow first (if findBtn exists)
    if(findBtn){
      findBtn.click();
      // Wait for matching simulation (code uses ~900ms to 1200ms)
      await wait(1500);
      // After matching, either startBattleSession or openPracticeMode executed
      // Check if we are in battle-room view
      await wait(200);
      const br = document.getElementById('battle-room');
      results.checks.inBattleRoom_after_find = br && br.classList.contains('active');
    }

    // If not in battle room (maybe practice fallback), try practice-only path explicitly
    if(!results.checks.inBattleRoom_after_find && practiceBtn){
      // reopen modal: click the enter button again
      if(enterBtn) enterBtn.click();
      await wait(100);
      const pbtn = document.getElementById('practice-only');
      if(pbtn){ pbtn.click(); await wait(600); }
      const br = document.getElementById('battle-room');
      results.checks.inBattleRoom_after_practice = br && br.classList.contains('active');
    }

    // Now ensure battle-room UI elements exist
    const brStart = document.getElementById('br-start');
    const brPause = document.getElementById('br-pause');
    const brEnd = document.getElementById('br-end');
    results.checks.br_controls = !!brStart && !!brPause && !!brEnd;

    // Start the timer
    if(brStart){
      // capture current clock
      const clockBefore = document.getElementById('br-clock')?.textContent;
      brStart.click();
      await wait(1200);
      const clockAfter = document.getElementById('br-clock')?.textContent;
      results.checks.timer_running = clockBefore !== clockAfter;
      results.clockBefore = clockBefore; results.clockAfter = clockAfter;
    }

    // Upload: set a demo File in the input
    const uploadInput = document.getElementById('br-upload-file');
    const uploadBtn = document.getElementById('br-upload-btn');
    const submitBtn = document.getElementById('br-submit-btn');
    results.checks.upload_elements = !!uploadInput && !!uploadBtn && !!submitBtn;

    if(uploadInput && uploadBtn && submitBtn){
      // create a File via window.File/Blob and attach via DataTransfer if available
      try{
        const blob = new window.Blob(['demo'], { type:'audio/webm' });
        const file = new window.File([blob], 'demo-mix.webm', { type: 'audio/webm' });
        let dataTransfer = null;
        try{ dataTransfer = new window.DataTransfer(); dataTransfer.items.add(file); }
        catch(e){ dataTransfer = null; }
        if(dataTransfer && dataTransfer.files && dataTransfer.files.length>0){
          Object.defineProperty(uploadInput, 'files', { value: dataTransfer.files, configurable: true });
        } else {
          // fallback: define a minimal FileList-like object
          const fl = { 0: file, length: 1, item: (i)=> i===0?file:null };
          Object.defineProperty(uploadInput, 'files', { value: fl, configurable: true });
        }
      }catch(e){ console.warn('file attach failed', e); }
      uploadBtn.click();
      // wait for simulated upload to progress
      await wait(1200);
      submitBtn.click();
      await wait(300);
      const judgePlaceholder = document.getElementById('br-judge-placeholder');
      results.checks.judge_placeholder = !!judgePlaceholder && judgePlaceholder.innerHTML.length>0;
    }

    // If solo mode, check practiceHistory updated
    const stored = JSON.parse(localStorage.getItem('djBattlePracticeHistory') || '[]');
    results.practiceSaved = stored.length>0;

    // Check that no uncaught errors in window
    results.windowErrors = window.__TEST_ERRORS__ || null;

  }catch(err){ results.errors.push(String(err)); console.error(err); }

  console.log('SMOKE TEST RESULTS:', JSON.stringify(results, null, 2));
  // write results file
  try{ fs.writeFileSync(path.resolve(__dirname,'smoke-results.json'), JSON.stringify(results, null, 2)); }catch(e){}
  // exit
  if(results.errors.length>0) process.exit(2);
  process.exit(0);
})();

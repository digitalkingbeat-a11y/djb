const fs = require('fs');
const { JSDOM } = require('jsdom');
(async ()=>{
  try{
    const indexPath = './index.html';
    const appPath = './app.js';
    const html = fs.readFileSync(indexPath,'utf8');
    const app = fs.readFileSync(appPath,'utf8');
    // inject app.js inline to ensure it runs inside jsdom
    const injected = html.replace(/<script src="app.js"><\/script>/, `<script>\n${app.replace(/<\/script>/g,'<\\/script>')}\n</script>`);
    const dom = new JSDOM(injected, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/' });
    // wait for load
    await new Promise(r=>{ dom.window.addEventListener('load', ()=> r(), { once:true }); setTimeout(r,1500); });

    const w = dom.window;
    const doc = w.document;
    const out = { errors: [], steps: [] };
    if(!doc.getElementById('audio-a')) out.errors.push('audio-a missing');
    if(!doc.getElementById('file-a')) out.errors.push('file-a missing');
    // ensure focusedDeck exists and defaults
    out.steps.push({ focusedDeck: typeof w.focusedDeck !== 'undefined' ? w.focusedDeck : null });

    // simulate setting a cue on deck a
    if(typeof w.setCue === 'function'){
      try{ w.setCue('a'); out.steps.push({ setCue: 'ok' }); }catch(e){ out.errors.push('setCue threw '+String(e)); }
    } else out.errors.push('setCue not a function');

    // check localStorage decks
    try{ const raw = w.localStorage.getItem('djBattleDecks'); out.steps.push({ djBattleDecks: raw ? JSON.parse(raw) : null }); }catch(e){ out.errors.push('reading djBattleDecks failed '+String(e)); }

    // render studio library and dblclick a row if present
    if(typeof w.renderStudioLibrary==='function'){
      try{ w.renderStudioLibrary(''); out.steps.push({ renderStudioLibrary: 'ok' }); const row = doc.querySelector('tr[data-studio-idx]'); if(row){ const ev = new w.MouseEvent('dblclick',{ bubbles:true, cancelable:true }); row.dispatchEvent(ev); out.steps.push({ dblclickRow: 'dispatched' }); } else out.steps.push({ dblclickRow: 'no rows' }); }catch(e){ out.errors.push('renderStudioLibrary/dblclick error '+String(e)); }
    } else out.errors.push('renderStudioLibrary not a function');

    // check cues UI container
    const cuesA = doc.getElementById('cues-a'); out.steps.push({ cuesA_exists: !!cuesA });

    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }catch(err){ console.error('smoke error',err); process.exit(2); }
})();

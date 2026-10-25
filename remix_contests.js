// Remix contests page. A host posts a track as parts (stems) or a full track with a submission
// deadline and a voting deadline; DJs and producers download the parts and send one remix each
// (replaceable until submissions close); the crowd votes once per account after submissions close
// (never for your own remix); the winner gets the 🎛️ Remix Champion badge and an alert, and the
// host can ask to list the winning remix in the Beat Store (only with the winner's yes).
// Loaded after app.js and the other feature scripts. User text always goes through esc().
(function(){
  'use strict';
  const W = window;
  const D = document;
  const esc = s => (typeof W.esc === 'function' ? W.esc(s) : String(s == null ? '' : s).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])));
  const hasApi = () => Boolean(W.DJBattleApi && typeof W.DJBattleApi.apiRequest === 'function');
  const api = (path, opts) => hasApi() ? W.DJBattleApi.apiRequest(path, opts) : Promise.resolve({ error:'The server is not connected', status:0 });
  const signedIn = () => typeof W.djbSignedIn === 'function' && W.djbSignedIn();
  const needsServer = r => !r || r.status === 0 || r.status === 404 && !r.data || r.status === 502 || (r.status === 503 && !(r.data && r.data.schemaMissing));
  const schemaMissing = r => r && r.status === 503 && r.data && r.data.schemaMissing;
  const errText = (r, fallback) => (r && r.data && r.data.error) || (r && typeof r.error === 'string' && r.error) || fallback;
  const toast = (title, body) => { if(typeof W.showAppToast === 'function') W.showAppToast(title, body); };
  const confirmDanger = async (title, body, label) => (typeof W.appConfirmDanger === 'function' ? W.appConfirmDanger(title, body, label) : W.confirm(title));
  const VIEW = 'remix-contests';
  const RIGHTS = [['original', 'I made it (original)'], ['licensed', 'I licensed it and may share the parts'], ['royalty_free', 'Royalty-free'], ['platform_cleared', 'Cleared by DJ Battle']];
  const PHASE_LABEL = { draft:'Draft: finish uploading', open:'Taking remixes', voting:'Voting now', ended:'Counting votes', completed:'Finished', cancelled:'Cancelled' };
  const state = { status:'idle', list:[], current:null, error:'', champions:null, opening:false, timer:null };

  function setupNote(r, what){
    if(schemaMissing(r)) return `${what} needs one setup step: run server/sql/${esc(r.data.schema)}.sql in Supabase.`;
    if(needsServer(r)) return `${what} needs the DJ Battle server. It turns on once your server is running.`;
    return esc(errText(r, `${what} could not load.`));
  }
  function ensureRemixView(){
    let section = D.getElementById(VIEW);
    if(section) return section;
    const main = D.querySelector('.main');
    if(!main) return null;
    section = D.createElement('section'); section.id = VIEW; section.className = D.body && D.body.dataset.view === VIEW ? 'view active' : 'view';
    section.innerHTML = `<div class="product-page-head"><div><span class="eyebrow accent">REMIX CONTESTS</span><h2>Remix Contests</h2><p>A producer posts a track, everyone downloads the parts and sends one remix before the deadline. Then the crowd votes, and the winner gets the 🎛️ Remix Champion badge.</p></div><div class="head-actions"><button class="primary small" type="button" id="rmx-new">Host a contest</button></div></div>
      <div class="social-note" id="rmx-status" aria-live="polite"></div><div id="rmx-list" class="rmx-list"></div><section class="panel hidden" id="rmx-page"></section>`;
    main.insertBefore(section, D.getElementById('operations') || null);
    return section;
  }
  function dialog(id, html){
    let dlg = D.getElementById(id);
    if(!dlg){ dlg = D.createElement('dialog'); dlg.id = id; dlg.className = 'oct20b-dialog rmx-dialog'; D.body.appendChild(dlg); }
    dlg.innerHTML = html;
    if(typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal(); else dlg.setAttribute('open', '');
    dlg.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => (dlg.close ? dlg.close() : dlg.removeAttribute('open')); });
    return dlg;
  }
  const closeDlg = dlg => (dlg.close ? dlg.close() : dlg.removeAttribute('open'));
  const when = v => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }); };
  const localInput = d => { const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return x.toISOString().slice(0, 16); };
  // Same countdown wording as tournament round deadlines.
  function countdownText(c){
    if(!c) return '';
    const ms = new Date(c.endsAt).getTime() - Date.now();
    if(!(ms > 0)) return `${c.what}: closed`;
    const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
    return `${c.what} in ${d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${Math.max(1, m)}m`}`;
  }
  const djLink = dj => `<strong>${esc(dj && dj.displayName || 'DJ')}</strong>`;

  /* ----------------------------- list ----------------------------- */
  async function loadList(){
    ensureRemixView();
    state.status = 'loading'; state.error = ''; render();
    const r = await api('/api/remix-contests', { public:!signedIn() });
    if(r.error){ state.status = 'error'; state.error = setupNote(r, 'Remix contests'); state.list = []; render(); return state; }
    state.list = r.data.contests || []; state.status = 'ready'; render();
    return state;
  }
  function card(c){
    return `<article class="rmx-card rmx-${esc(c.phase)}" data-rmx="${esc(c.id)}"><span class="rmx-phase">${esc(PHASE_LABEL[c.phase] || c.phase)}</span><h4>${esc(c.title)}</h4>
      <p class="social-note">Hosted by ${djLink(c.host)} · ${esc(c.entryCount || 0)} remix${c.entryCount === 1 ? '' : 'es'} · ${esc(c.parts.length)} part${c.parts.length === 1 ? '' : 's'}</p>
      ${c.countdown ? `<p class="rmx-countdown" data-rmx-countdown="${esc(c.id)}">⏱ ${esc(countdownText(c.countdown))}</p>` : ''}
      ${c.winner ? `<p>🎛️ Winner: ${djLink(c.winner)}</p>` : ''}
      <button class="ghost small" type="button" data-rmx-open="${esc(c.id)}">${c.phase === 'open' ? 'Get the parts & enter' : c.phase === 'voting' ? 'Listen & vote' : 'View'}</button></article>`;
  }
  function render(){
    const view = ensureRemixView(); if(!view) return null;
    const status = D.getElementById('rmx-status'), list = D.getElementById('rmx-list'), page = D.getElementById('rmx-page');
    status.innerHTML = state.status === 'loading' ? 'Loading remix contests…' : state.error;
    if(state.current){ list.classList.add('hidden'); page.classList.remove('hidden'); renderContest(); }
    else{
      page.classList.add('hidden'); list.classList.remove('hidden');
      list.innerHTML = state.status === 'ready' && !state.list.length ? '<p class="social-note">No remix contests yet. Host the first one!</p>' : state.list.map(card).join('');
    }
    const nb = D.getElementById('rmx-new'); if(nb) nb.onclick = openCreate;
    view.querySelectorAll('[data-rmx-open]').forEach(b => { b.onclick = () => openContest(b.dataset.rmxOpen); });
    return view;
  }

  /* ----------------------------- one contest ----------------------------- */
  async function openContest(id){
    ensureRemixView();
    const r = await api(`/api/remix-contests/${encodeURIComponent(id)}`, { public:!signedIn() });
    if(r.error){ toast('Couldn\u2019t open that contest', errText(r, 'Try again.')); return r; }
    state.current = r.data.contest; render(); startTicker();
    return r;
  }
  async function openFromAnywhere(id){
    state.opening = true;
    try{ if(typeof W.switchView === 'function') W.switchView(VIEW); }finally{ state.opening = false; }
    return openContest(id);
  }
  function startTicker(){
    if(state.timer) clearInterval(state.timer);
    state.timer = setInterval(() => {
      const c = state.current; const el = D.getElementById('rmx-detail-countdown');
      if(!c || !el){ clearInterval(state.timer); state.timer = null; return; }
      el.textContent = `⏱ ${countdownText(c.countdown)}`;
    }, 30000);
    if(state.timer.unref) state.timer.unref();
  }
  function entryRow(e, c){
    const v = c.viewer || {};
    const canVoteThis = v.canVote && !e.isMine && !e.hidden;
    return `<li class="rmx-entry${e.isWinner ? ' is-winner' : ''}${e.isMine ? ' is-mine' : ''}" data-entry="${esc(e.id)}">
      <div class="rmx-entry-main"><button class="rmx-play" type="button" data-rmx-play="${esc(e.id)}" aria-label="Play ${esc(e.title)}">▶</button>
        <div><strong>${e.isWinner ? '🎛️ ' : ''}${esc(e.title)}</strong><small>by ${esc(e.dj.displayName)}${e.isMine ? ' (you)' : ''}${e.hidden ? ' · hidden by a moderator' : ''}</small>${e.notes ? `<p class="rmx-notes">${esc(e.notes)}</p>` : ''}</div></div>
      <div class="rmx-entry-side">${e.votes != null ? `<span class="rmx-votes">${esc(e.votes)} vote${e.votes === 1 ? '' : 's'}</span>` : ''}
        ${v.votedEntryId === e.id ? '<span class="rmx-voted">✓ Your vote</span>' : ''}
        ${canVoteThis ? `<button class="primary small" type="button" data-rmx-vote="${esc(e.id)}">Vote</button>` : ''}
        ${!e.isMine && signedIn() ? `<button class="text-btn" type="button" data-rmx-report-entry="${esc(e.id)}">Report</button>` : ''}</div>
      <audio class="rmx-audio hidden" controls preload="none" data-rmx-audio="${esc(e.id)}"></audio></li>`;
  }
  function hostPanel(c){
    if(!c.isHost) return '';
    const bits = [];
    if(c.phase === 'draft') bits.push('<button class="primary small" type="button" id="rmx-publish">Publish contest</button>');
    if(c.canEdit) bits.push('<button class="ghost small" type="button" id="rmx-edit">Edit</button><button class="ghost small danger" type="button" id="rmx-cancel">Cancel contest</button>');
    if(c.phase === 'completed' && c.winner){
      const s = c.store.status;
      if(s === 'none' || s === 'declined') bits.push(`<span class="social-note">${s === 'declined' ? 'The winner said no to the Beat Store.' : 'Want to sell the winning remix in the Beat Store? The winner has to agree first.'}</span>${s === 'none' ? '<button class="ghost small" type="button" id="rmx-store-offer">Ask the winner</button>' : ''}`);
      if(s === 'offered') bits.push('<span class="social-note">Waiting for the winner to answer your Beat Store request.</span>');
      if(s === 'accepted') bits.push('<span class="social-note">The winner said yes.</span><button class="primary small" type="button" id="rmx-store-list">List it in the Beat Store</button>');
      if(s === 'listed') bits.push('<span class="social-note">✓ The winning remix is in the Beat Store. Sales go to the winner.</span>');
    }
    if(!bits.length && c.phase !== 'completed') bits.push('<span class="social-note">Remixes are in, so the contest can\u2019t be edited or cancelled now.</span>');
    return bits.length ? `<div class="rmx-host"><span class="eyebrow">HOST CONTROLS</span>${bits.join(' ')}</div>` : '';
  }
  function renderContest(){
    const c = state.current, page = D.getElementById('rmx-page');
    if(!c || !page) return;
    const v = c.viewer || {};
    let entryBox = '';
    if(c.phase === 'open'){
      if(!v.signedIn) entryBox = '<p class="social-note">Sign in to download the parts and send a remix.</p>';
      else if(c.isHost) entryBox = '<p class="social-note">You\u2019re the host, so you can\u2019t enter. Share this page with remixers.</p>';
      else entryBox = `<form id="rmx-entry-form" class="rmx-form"><h4>${v.hasEntry ? 'Replace your remix' : 'Send your remix'}</h4><p class="social-note">One remix per person. You can replace it until submissions close.</p>
        <label>Remix title <input id="rmx-entry-title" maxlength="100" placeholder="${esc(c.title)} (my remix)"></label>
        <label>Notes (optional) <textarea id="rmx-entry-notes" maxlength="600" rows="2" placeholder="What did you change?"></textarea></label>
        <label>Audio file <input id="rmx-entry-file" type="file" accept="audio/*" required></label>
        <button class="primary small" type="submit">${v.hasEntry ? 'Replace remix' : 'Send remix'}</button>${v.hasEntry ? ' <button class="text-btn" type="button" id="rmx-withdraw">Withdraw my remix</button>' : ''}<small class="social-note" id="rmx-entry-status" aria-live="polite"></small></form>`;
    }
    const voteNote = c.phase === 'voting' ? (v.votedEntryId ? '<p class="social-note">Thanks for voting! Results show when voting closes.</p>' : !v.signedIn ? '<p class="social-note">Sign in to vote. One vote per account, and you can\u2019t vote for your own remix.</p>' : '<p class="social-note">Listen, then vote for your favourite. One vote per account, and you can\u2019t vote for your own remix. Vote counts stay hidden until voting closes.</p>') : '';
    const consent = v.isWinner && c.store.status === 'offered' ? `<div class="rmx-consent"><strong>🎛️ You won!</strong> The host would like to sell your winning remix in the Beat Store. Sales go to your Stripe payouts. <button class="primary small" type="button" id="rmx-consent-yes">Yes, list it</button><button class="ghost small" type="button" id="rmx-consent-no">No thanks</button></div>` : '';
    page.innerHTML = `<button class="text-btn" type="button" id="rmx-back">← All remix contests</button>
      <div class="rmx-head"><div><span class="rmx-phase">${esc(PHASE_LABEL[c.phase] || c.phase)}</span><h3>${esc(c.title)}</h3><p class="social-note">Hosted by ${djLink(c.host)} · Rights: ${esc(c.rights.label)}</p></div>
        ${signedIn() && !c.isHost && c.phase !== 'draft' ? '<button class="text-btn" type="button" id="rmx-report">Report contest</button>' : ''}</div>
      ${c.description ? `<p class="rmx-desc">${esc(c.description)}</p>` : ''}
      <p class="rmx-dates"><span>📥 Submissions close ${esc(when(c.submissionDeadline))}</span> <span>🗳️ Voting closes ${esc(when(c.votingDeadline))}</span></p>
      ${c.countdown ? `<p class="rmx-countdown" id="rmx-detail-countdown">⏱ ${esc(countdownText(c.countdown))}</p>` : ''}
      ${c.winner ? `<p class="rmx-winner">🎛️ Winner: ${djLink(c.winner)} · Remix Champion</p>` : ''}
      ${consent}${hostPanel(c)}
      <h4>The parts</h4>${c.parts.length && v.signedIn && c.phase !== 'cancelled' && c.parts.some(p => p.uploaded) ? `<div class="rmx-zip"><button class="primary small" type="button" id="rmx-zip">⬇ Download all ${c.parts.length > 1 ? 'stems' : 'parts'} (.zip)</button><progress id="rmx-zip-progress" max="1" value="0" hidden></progress><small class="social-note" id="rmx-zip-status" aria-live="polite"></small></div>` : ''}${c.parts.length ? `<ul class="rmx-parts">${c.parts.map(p => `<li><span>${esc(p.label)} <small>${esc(p.filename)}</small>${p.uploaded ? '' : ' <small>(uploading…)</small>'}</span>${v.signedIn && c.phase !== 'cancelled' ? `<button class="ghost small" type="button" data-rmx-part="${esc(p.id)}">Download</button>` : ''}</li>`).join('')}</ul>${v.signedIn ? '' : '<p class="social-note">Sign in to download the parts.</p>'}` : '<p class="social-note">No parts yet.</p>'}
      ${entryBox}
      <h4>Remixes (${esc(c.entries.length)})</h4>${voteNote}
      ${c.entries.length ? `<ul class="rmx-entries">${c.entries.map(e => entryRow(e, c)).join('')}</ul>` : `<p class="social-note">${c.phase === 'open' ? 'No remixes yet. Be the first!' : 'No remixes were sent.'}</p>`}
      ${c.totalVotes != null ? `<p class="social-note">${esc(c.totalVotes)} vote${c.totalVotes === 1 ? '' : 's'} in total.</p>` : ''}`;
    wireContest(page, c);
  }
  async function downloadAll(c){
    const btn = D.getElementById('rmx-zip'), bar = D.getElementById('rmx-zip-progress'), status = D.getElementById('rmx-zip-status');
    const Z = W.DJBStemsZip;
    if(!btn) return;
    if(!Z) return toast('Couldn\u2019t make the zip', 'Reload the page and try again.');
    btn.disabled = true; bar.hidden = false; bar.value = 0; status.textContent = 'Starting…';
    try{
      const zip = await Z.collect(c.parts, {
        getUrl: async p => {
          const r = await api(`/api/remix-contests/${encodeURIComponent(c.id)}/parts/${encodeURIComponent(p.id)}/download`, { method:'POST', body:{} });
          if(r.error || !r.data || !r.data.url) throw new Error(errText(r, 'not allowed'));
          return r.data;
        },
        fetchImpl: url => W.fetch(url),
        onProgress: ({ done, total, label }) => { bar.max = total; bar.value = done; status.textContent = done < total ? `Downloading ${done + 1} of ${total}: ${label}` : 'Packing zip…'; }
      });
      const name = Z.zipFileName(c.title);
      const blob = new W.Blob([zip], { type:'application/zip' });
      const url = W.URL && W.URL.createObjectURL ? W.URL.createObjectURL(blob) : '';
      const a = D.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener'; D.body.appendChild(a); a.click(); a.remove();
      if(url) setTimeout(() => W.URL.revokeObjectURL(url), 60000);
      status.textContent = `Saved ${name}`;
    }catch(err){
      bar.hidden = true; status.textContent = (err && err.message) || 'The zip couldn\u2019t be made.';
      toast('Couldn\u2019t download all parts', status.textContent);
    }finally{ btn.disabled = false; }
  }
  function wireContest(page, c){
    const $ = id => D.getElementById(id);
    $('rmx-back').onclick = () => { state.current = null; loadList(); };
    page.querySelectorAll('[data-rmx-part]').forEach(b => { b.onclick = async () => {
      const r = await api(`/api/remix-contests/${encodeURIComponent(c.id)}/parts/${encodeURIComponent(b.dataset.rmxPart)}/download`, { method:'POST', body:{} });
      if(r.error) return toast('Couldn\u2019t download', errText(r, 'Try again.'));
      const a = D.createElement('a'); a.href = r.data.url; a.download = r.data.filename || ''; a.rel = 'noopener'; D.body.appendChild(a); a.click(); a.remove();
    }; });
    if($('rmx-zip')) $('rmx-zip').onclick = () => downloadAll(c);
    page.querySelectorAll('[data-rmx-play]').forEach(b => { b.onclick = async () => {
      const audio = Array.from(page.querySelectorAll('audio[data-rmx-audio]')).find(a => a.dataset.rmxAudio === b.dataset.rmxPlay);
      if(!audio) return;
      if(!audio.src){
        const r = await api(`/api/remix-contests/${encodeURIComponent(c.id)}/entries/${encodeURIComponent(b.dataset.rmxPlay)}/play`, { method:'POST', body:{}, public:!signedIn() });
        if(r.error) return toast('Couldn\u2019t play that remix', errText(r, 'Try again.'));
        audio.src = r.data.url;
      }
      page.querySelectorAll('audio[data-rmx-audio]').forEach(a => { if(a !== audio){ a.pause(); } });
      audio.classList.remove('hidden'); audio.play();
    }; });
    page.querySelectorAll('[data-rmx-vote]').forEach(b => { b.onclick = async () => {
      const r = await api(`/api/remix-contests/${encodeURIComponent(c.id)}/vote`, { method:'POST', body:{ entryId:b.dataset.rmxVote } });
      if(r.error) return toast('Vote not counted', errText(r, 'Try again.'));
      toast('Vote counted', 'Results show when voting closes.'); openContest(c.id);
    }; });
    page.querySelectorAll('[data-rmx-report-entry]').forEach(b => { b.onclick = () => report('remix_entry', b.dataset.rmxReportEntry); });
    if($('rmx-report')) $('rmx-report').onclick = () => report('remix_contest', c.id);
    const form = $('rmx-entry-form'); if(form) form.onsubmit = e => { e.preventDefault(); sendEntry(c); };
    if($('rmx-withdraw')) $('rmx-withdraw').onclick = async () => {
      if(!await confirmDanger('Withdraw your remix?', 'You can send a new one until submissions close.', 'Withdraw')) return;
      const r = await api(`/api/remix-contests/${encodeURIComponent(c.id)}/entry`, { method:'DELETE' });
      if(r.error) return toast('Couldn\u2019t withdraw', errText(r, 'Try again.'));
      openContest(c.id);
    };
    if($('rmx-publish')) $('rmx-publish').onclick = async () => {
      const r = await api(`/api/remix-contests/${encodeURIComponent(c.id)}/publish`, { method:'POST', body:{} });
      if(r.error) return toast('Not published yet', errText(r, 'Try again.'));
      toast('Contest is live', 'Remixers can now download the parts.'); openContest(c.id);
    };
    if($('rmx-edit')) $('rmx-edit').onclick = () => openEdit(c);
    if($('rmx-cancel')) $('rmx-cancel').onclick = async () => {
      if(!await confirmDanger('Cancel this contest?', 'It disappears for everyone. This can\u2019t be undone.', 'Cancel contest')) return;
      const r = await api(`/api/remix-contests/${encodeURIComponent(c.id)}/cancel`, { method:'POST', body:{} });
      if(r.error) return toast('Couldn\u2019t cancel', errText(r, 'Try again.'));
      toast('Contest cancelled', ''); state.current = null; loadList();
    };
    if($('rmx-store-offer')) $('rmx-store-offer').onclick = () => openStoreOffer(c);
    if($('rmx-store-list')) $('rmx-store-list').onclick = async () => {
      const r = await api(`/api/remix-contests/${encodeURIComponent(c.id)}/store-listing`, { method:'POST', body:{} });
      if(r.error) return toast('Couldn\u2019t list it', errText(r, 'Try again.'));
      toast('Listed in the Beat Store', 'Sales go to the winner.'); openContest(c.id);
    };
    const answer = accept => async () => {
      const r = await api(`/api/remix-contests/${encodeURIComponent(c.id)}/store-consent`, { method:'POST', body:{ accept } });
      if(r.error) return toast('Couldn\u2019t save your answer', errText(r, 'Try again.'));
      toast(accept ? 'Thanks! The host can list it now' : 'Got it, it won\u2019t be sold', ''); openContest(c.id);
    };
    if($('rmx-consent-yes')) $('rmx-consent-yes').onclick = answer(true);
    if($('rmx-consent-no')) $('rmx-consent-no').onclick = answer(false);
  }
  async function report(targetType, targetId){
    const dlg = dialog('rmx-report-dialog', `<form method="dialog" id="rmx-report-form"><h3>Report</h3><p class="social-note">A moderator will take a look. The person won\u2019t see who reported them.</p>
      <label>Reason <select id="rmx-report-reason"><option value="spam">Spam</option><option value="harassment">Harassment or hate</option><option value="copyright">Stolen or uncleared music</option><option value="unsafe_content">Inappropriate or unsafe</option><option value="other">Something else</option></select></label>
      <label>Details (optional) <textarea id="rmx-report-context" maxlength="800" rows="2"></textarea></label>
      <div class="modal-actions"><button class="ghost small" type="button" data-close>Cancel</button><button class="primary small" type="submit">Send report</button></div></form>`);
    D.getElementById('rmx-report-form').onsubmit = async e => {
      e.preventDefault();
      const r = await api('/api/community/reports', { method:'POST', body:{ targetType, targetId, reason:D.getElementById('rmx-report-reason').value, context:D.getElementById('rmx-report-context').value } });
      closeDlg(dlg);
      toast(r.error ? 'Report not sent' : 'Thanks, report sent', r.error ? errText(r, 'Try again.') : 'A moderator will review it.');
    };
    return dlg;
  }
  async function upload(u, file){
    if(!W.supabase || !W.supabase.storage) return { error:'File uploads need the DJ Battle server and Supabase to be connected' };
    const up = await W.supabase.storage.from(u.bucket).uploadToSignedUrl(u.uploadPath, u.uploadToken, file, { contentType:file.type || 'audio/mpeg' });
    return up && up.error ? { error:up.error.message || 'Upload failed' } : { ok:true };
  }
  async function sendEntry(c){
    const status = D.getElementById('rmx-entry-status');
    const file = D.getElementById('rmx-entry-file').files[0];
    if(!file){ status.textContent = 'Pick your remix file first.'; return; }
    status.textContent = 'Uploading your remix…';
    const r = await api(`/api/remix-contests/${encodeURIComponent(c.id)}/entry`, { method:'POST', body:{ title:D.getElementById('rmx-entry-title').value, notes:D.getElementById('rmx-entry-notes').value, filename:file.name, mimeType:file.type, size:file.size } });
    if(r.error){ status.textContent = errText(r, 'Could not start the upload.'); return; }
    const up = await upload(r.data.upload, file);
    if(up.error){ status.textContent = up.error; return; }
    const done = await api(`/api/remix-contests/${encodeURIComponent(c.id)}/entry/complete`, { method:'POST', body:{} });
    if(done.error){ status.textContent = errText(done, 'Upload didn\u2019t finish. Try again.'); return; }
    toast(done.data.replaced ? 'Remix replaced' : 'Remix sent', 'Good luck! Voting opens when submissions close.'); openContest(c.id);
  }

  /* ----------------------------- host forms ----------------------------- */
  function openCreate(){
    if(!signedIn()){ toast('Sign in first', 'Sign in to host a remix contest.'); return null; }
    const sub = new Date(Date.now() + 7 * 864e5), vote = new Date(Date.now() + 10 * 864e5);
    const dlg = dialog('rmx-create-dialog', `<form id="rmx-create-form" class="rmx-form"><h3>Host a remix contest</h3>
      <label>Title <input id="rmx-title" maxlength="100" required placeholder="e.g. Flip my beat"></label>
      <label>Description <textarea id="rmx-desc" maxlength="1500" rows="3" placeholder="What are you looking for? Any rules?"></textarea></label>
      <label>Parts (stems) or the full track <input id="rmx-files" type="file" accept="audio/*" multiple required></label>
      <div id="rmx-part-labels" class="rmx-part-labels"></div>
      <fieldset class="rmx-rights"><legend>Your rights (same rules as the Beat Store)</legend>
        <label>How do you have the rights? <select id="rmx-rights" required><option value="">Choose…</option>${RIGHTS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" id="rmx-rights-ok"> I own or have cleared this music and allow people to remix it for this contest. If I list the winner in the Beat Store, sales go to the winner.</label></fieldset>
      <div class="rmx-dates-edit"><label>Submissions close <input id="rmx-sub" type="datetime-local" value="${localInput(sub)}" required></label><label>Voting closes <input id="rmx-vote" type="datetime-local" value="${localInput(vote)}" required></label></div>
      <small class="social-note">At least 24 hours for remixes and 24 hours for voting.</small>
      <div class="modal-actions"><button class="ghost small" type="button" data-close>Cancel</button><button class="primary small" type="submit">Create & upload</button></div><small class="social-note" id="rmx-create-status" aria-live="polite"></small></form>`);
    const files = D.getElementById('rmx-files');
    files.onchange = () => { D.getElementById('rmx-part-labels').innerHTML = Array.from(files.files).map((f, i) => `<label>Name for ${esc(f.name)} <input data-part-label="${i}" maxlength="40" value="${files.files.length === 1 ? 'Full track' : esc(f.name.replace(/\.[^.]+$/, '').slice(0, 40))}"></label>`).join(''); };
    D.getElementById('rmx-create-form').onsubmit = async e => {
      e.preventDefault();
      const status = D.getElementById('rmx-create-status');
      if(!D.getElementById('rmx-rights-ok').checked){ status.textContent = 'Please confirm you have the rights to share this music.'; return; }
      const list = Array.from(files.files);
      const body = { title:D.getElementById('rmx-title').value, description:D.getElementById('rmx-desc').value, rightsClassification:D.getElementById('rmx-rights').value, rightsConfirmed:true,
        submissionDeadline:new Date(D.getElementById('rmx-sub').value).toISOString(), votingDeadline:new Date(D.getElementById('rmx-vote').value).toISOString(),
        parts:list.map((f, i) => ({ label:(D.querySelector(`[data-part-label="${i}"]`) || {}).value || '', filename:f.name, mimeType:f.type, size:f.size })) };
      status.textContent = 'Creating…';
      const r = await api('/api/remix-contests', { method:'POST', body });
      if(r.error){ status.textContent = errText(r, 'Could not create the contest.'); return; }
      for(let i = 0; i < (r.data.uploads || []).length; i++){
        status.textContent = `Uploading part ${i + 1} of ${r.data.uploads.length}…`;
        const up = await upload(r.data.uploads[i], list[i]);
        if(up.error){ status.textContent = `${up.error}. Your draft is saved. Open it to try again.`; return; }
      }
      const pub = await api(`/api/remix-contests/${encodeURIComponent(r.data.contest.id)}/publish`, { method:'POST', body:{} });
      closeDlg(dlg);
      toast(pub.error ? 'Saved as a draft' : 'Contest is live', pub.error ? errText(pub, 'Open it to publish.') : 'Share the page with remixers.');
      openContest(r.data.contest.id);
    };
    return dlg;
  }
  function openEdit(c){
    const dlg = dialog('rmx-edit-dialog', `<form id="rmx-edit-form" class="rmx-form"><h3>Edit contest</h3><p class="social-note">You can edit until the first remix arrives.</p>
      <label>Title <input id="rmx-edit-title" maxlength="100" value="${esc(c.title)}"></label>
      <label>Description <textarea id="rmx-edit-desc" maxlength="1500" rows="3">${esc(c.description)}</textarea></label>
      <div class="rmx-dates-edit"><label>Submissions close <input id="rmx-edit-sub" type="datetime-local" value="${localInput(new Date(c.submissionDeadline))}"></label><label>Voting closes <input id="rmx-edit-vote" type="datetime-local" value="${localInput(new Date(c.votingDeadline))}"></label></div>
      <div class="modal-actions"><button class="ghost small" type="button" data-close>Cancel</button><button class="primary small" type="submit">Save</button></div><small class="social-note" id="rmx-edit-status" aria-live="polite"></small></form>`);
    D.getElementById('rmx-edit-form').onsubmit = async e => {
      e.preventDefault();
      const r = await api(`/api/remix-contests/${encodeURIComponent(c.id)}`, { method:'PATCH', body:{ title:D.getElementById('rmx-edit-title').value, description:D.getElementById('rmx-edit-desc').value,
        submissionDeadline:new Date(D.getElementById('rmx-edit-sub').value).toISOString(), votingDeadline:new Date(D.getElementById('rmx-edit-vote').value).toISOString() } });
      if(r.error){ D.getElementById('rmx-edit-status').textContent = errText(r, 'Could not save.'); return; }
      closeDlg(dlg); toast('Saved', ''); openContest(c.id);
    };
    return dlg;
  }
  function openStoreOffer(c){
    const dlg = dialog('rmx-store-dialog', `<form id="rmx-store-form" class="rmx-form"><h3>Sell the winning remix?</h3><p class="social-note">We\u2019ll ask ${esc(c.winner.displayName)} first. It only goes in the Beat Store if they say yes, and sales go to their Stripe payouts.</p>
      <label>Price (USD) <input id="rmx-store-price" type="number" min="1" max="500" step="1" value="5"></label>
      <div class="modal-actions"><button class="ghost small" type="button" data-close>Cancel</button><button class="primary small" type="submit">Ask the winner</button></div><small class="social-note" id="rmx-store-status"></small></form>`);
    D.getElementById('rmx-store-form').onsubmit = async e => {
      e.preventDefault();
      const r = await api(`/api/remix-contests/${encodeURIComponent(c.id)}/store-offer`, { method:'POST', body:{ priceCents:Math.round(Number(D.getElementById('rmx-store-price').value) * 100) } });
      if(r.error){ D.getElementById('rmx-store-status').textContent = errText(r, 'Could not send.'); return; }
      closeDlg(dlg); toast('Request sent', 'You\u2019ll see their answer here.'); openContest(c.id);
    };
    return dlg;
  }

  /* ----------------------------- badge on profiles ----------------------------- */
  async function loadChampions(){
    if(state.champions) return state.champions;
    const r = await api('/api/remix-contests/champions', { public:true });
    state.champions = r.error ? [] : (r.data.champions || []);
    return state.champions;
  }
  async function renderProfileBadge(){
    if(!signedIn()) return null;
    const r = await api('/api/me/remix-contests');
    const head = D.querySelector('#profile .profile-hero h2, #profile h2');
    const old = D.getElementById('profile-remix-badge'); if(old) old.remove();
    if(r.error || !r.data.wins || !head) return null;
    const b = D.createElement('span'); b.id = 'profile-remix-badge'; b.className = 'champion-badge remix-badge'; b.title = `Won ${r.data.wins} remix contest${r.data.wins === 1 ? '' : 's'}`;
    b.textContent = `🎛️ ${r.data.wins > 1 ? `${r.data.wins}× ` : ''}Remix Champion`;
    head.appendChild(b);
    return b;
  }
  async function decorateRankings(){
    const list = await loadChampions();
    const byId = new Map(list.map(c => [String(c.publicProfileId), c.wins]));
    D.querySelectorAll('[data-ranking-dj]').forEach(row => {
      const n = byId.get(String(row.dataset.rankingDj || '')); const title = row.querySelector('.ranking-title strong');
      if(!n || !title || row.querySelector('.ranking-remix')) return;
      const t = D.createElement('span'); t.className = 'ranking-remix'; t.title = `Remix Champion (${n})`; t.setAttribute('aria-label', t.title); t.textContent = '🎛️'; title.after(t);
    });
  }

  function onView(view){
    if(view === VIEW && !state.opening){ state.current = null; loadList(); }
    if(view === 'profile') renderProfileBadge();
    if(view === 'rankings') decorateRankings();
  }
  ensureRemixView();
  (function deepLink(){
    let params; try{ params = new URLSearchParams(W.location.search); }catch(e){ return; }
    const id = params.get('remix');
    if(id && /^rmx_[a-f0-9]{8,40}$/.test(id)){ openFromAnywhere(id); return; }
    if(typeof W.viewFromHash === 'function' && W.viewFromHash() === VIEW && typeof W.switchView === 'function') W.switchView(VIEW, { fromHistory:true });
  })();
  W.DJBRemix = { onView, state:() => state, load:loadList, open:openContest, openFromAnywhere, openCreate, render, renderProfileBadge, decorateRankings, countdownText };
})();

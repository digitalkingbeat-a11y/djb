// Oct 20: phone lock-screen alerts, Add to calendar, result review requests, and
// "Download my data" / "Delete my account". Loaded after app.js, social.js and connect.js.
// Every piece of user text goes through esc() or textContent, never raw HTML.
(function(){
  'use strict';
  const W = window;
  const D = document;
  const esc = s => (typeof W.esc === 'function' ? W.esc(s) : String(s == null ? '' : s).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])));
  const hasApi = () => Boolean(W.DJBattleApi && typeof W.DJBattleApi.apiRequest === 'function');
  const api = (path, opts) => hasApi() ? W.DJBattleApi.apiRequest(path, opts) : Promise.resolve({ error:'The server is not connected', status:0 });
  const signedIn = () => typeof W.djbSignedIn === 'function' && W.djbSignedIn();
  const needsServer = r => !r || r.status === 0 || r.status === 404 && !r.data || r.status === 502 || (r.status === 503 && !(r.data && (r.data.schemaMissing || r.data.pushNotConfigured)));
  const schemaMissing = r => r && r.status === 503 && r.data && r.data.schemaMissing;
  const errText = (r, fallback) => (r && r.data && r.data.error) || (r && typeof r.error === 'string' && r.error) || fallback;
  const toast = (title, body) => { if(typeof W.showAppToast === 'function') W.showAppToast(title, body); };
  const isOperator = () => typeof W.djbIsOperator === 'function' && W.djbIsOperator();
  function setupNote(r, what){
    if(schemaMissing(r)) return `${what} needs one setup step: run server/sql/${esc(r.data.schema)}.sql in Supabase.`;
    if(needsServer(r)) return `${what} needs the DJ Battle server. It turns on once your server is running.`;
    return esc(errText(r, `${what} could not load.`));
  }
  function settingsPanel(id){
    const grid = D.querySelector('#settings .settings-grid');
    if(!grid) return null;
    let panel = D.getElementById(id);
    if(!panel){ panel = D.createElement('section'); panel.className = 'panel'; panel.id = id; grid.appendChild(panel); }
    return panel;
  }
  function downloadText(name, text, type){
    if(!W.Blob || !W.URL || !W.URL.createObjectURL) return false;
    const url = W.URL.createObjectURL(new Blob([text], { type }));
    const a = D.createElement('a'); a.href = url; a.download = name; D.body.appendChild(a);
    try{ a.click(); }catch(e){}
    a.remove();
    setTimeout(() => W.URL.revokeObjectURL(url), 2000);
    return true;
  }

  /* ============================== 1. Lock-screen alerts ============================== */
  const push = { status:'idle', config:null, subscribed:false, endpoint:null, types:null, error:'' };
  const PUSH_TYPE_KEY = 'djBattlePushTypes';
  const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => Boolean((W.matchMedia && W.matchMedia('(display-mode: standalone)').matches) || navigator.standalone);
  const pushSupported = () => Boolean('serviceWorker' in navigator && W.PushManager && W.Notification);
  function urlB64ToUint8Array(base64){
    const pad = '='.repeat((4 - base64.length % 4) % 4);
    const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }
  function chosenTypes(){
    const all = (push.config && push.config.types) || [];
    try{ const saved = JSON.parse(localStorage.getItem(PUSH_TYPE_KEY) || 'null'); if(Array.isArray(saved)) return all.filter(t => saved.includes(t)); }catch(e){}
    return all.slice();
  }
  async function loadPush(){
    push.status = 'loading'; renderPushPanel();
    const r = await api('/api/push/config');
    if(r.error || !r.data){ push.status = 'no-server'; push.error = setupNote(r, 'Lock-screen alerts'); renderPushPanel(); return push; }
    push.config = r.data;
    push.types = chosenTypes();
    push.subscribed = false;
    if(pushSupported() && navigator.serviceWorker.getRegistration){
      try{
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg && reg.pushManager && await reg.pushManager.getSubscription();
        if(sub){ push.subscribed = true; push.endpoint = sub.endpoint; }
      }catch(e){}
    }
    push.status = 'ready'; push.error = '';
    renderPushPanel();
    return push;
  }
  async function enablePush(){
    if(!signedIn()){ push.error = 'Sign in first so alerts go to your account.'; renderPushPanel(); return { error:push.error }; }
    if(!push.config || !push.config.configured){ push.error = 'Alerts aren\u2019t switched on for the server yet. Dan adds the VAPID keys once and then this works.'; renderPushPanel(); return { error:push.error }; }
    if(!pushSupported()){ push.error = isIos() && !isStandalone() ? 'On iPhone, add DJ Battle to your Home Screen first (Share → Add to Home Screen), then open it from there.' : 'This browser can\u2019t show lock-screen alerts.'; renderPushPanel(); return { error:push.error }; }
    const permission = W.Notification.permission === 'granted' ? 'granted' : await W.Notification.requestPermission();
    if(permission !== 'granted'){ push.error = 'Alerts are blocked for this site. Allow notifications in your browser or phone settings, then try again.'; renderPushPanel(); return { error:push.error }; }
    try{
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:urlB64ToUint8Array(push.config.publicKey) });
      const json = typeof sub.toJSON === 'function' ? sub.toJSON() : sub;
      const r = await api('/api/push/subscriptions', { method:'POST', body:{ subscription:json, types:push.types || chosenTypes(), deviceLabel:deviceLabel() } });
      if(r.error){ push.error = setupNote(r, 'Lock-screen alerts'); renderPushPanel(); return { error:push.error }; }
      push.subscribed = true; push.endpoint = json.endpoint; push.error = '';
      renderPushPanel();
      toast('Lock-screen alerts on', 'You\u2019ll get alerts on this device even when the app is closed.');
      return { ok:true };
    }catch(e){
      push.error = 'This device could not turn on alerts. Try again, or check notification settings.'; renderPushPanel(); return { error:push.error };
    }
  }
  async function disablePush(){
    try{
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      const sub = reg && reg.pushManager && await reg.pushManager.getSubscription();
      if(sub){ await api('/api/push/subscriptions', { method:'DELETE', body:{ endpoint:sub.endpoint } }); await sub.unsubscribe(); }
      else if(push.endpoint) await api('/api/push/subscriptions', { method:'DELETE', body:{ endpoint:push.endpoint } });
    }catch(e){}
    push.subscribed = false; push.endpoint = null;
    renderPushPanel();
    return { ok:true };
  }
  async function setPushType(type, on){
    const set = new Set(push.types || chosenTypes());
    if(on) set.add(type); else set.delete(type);
    push.types = ((push.config && push.config.types) || []).filter(t => set.has(t));
    try{ localStorage.setItem(PUSH_TYPE_KEY, JSON.stringify(push.types)); }catch(e){}
    if(push.subscribed && navigator.serviceWorker){
      try{
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg && await reg.pushManager.getSubscription();
        if(sub) await api('/api/push/subscriptions', { method:'POST', body:{ subscription:sub.toJSON(), types:push.types, deviceLabel:deviceLabel() } });
      }catch(e){}
    }
    renderPushPanel();
    return push.types;
  }
  function deviceLabel(){
    const ua = navigator.userAgent || '';
    return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'This device';
  }
  function renderPushPanel(){
    const panel = settingsPanel('settings-push-panel');
    if(!panel) return;
    const cfg = push.config || {};
    const types = cfg.types || [];
    const labels = cfg.labels || {};
    const chosen = new Set(push.types || types);
    const iosNote = isIos() && !isStandalone()
      ? '<p class="push-ios-note"><strong>iPhone:</strong> lock-screen alerts only work after you add DJ Battle to your Home Screen (Share → Add to Home Screen) and open it from there.</p>'
      : '<p class="push-ios-note"><small>On iPhone this only works after DJ Battle is added to the Home Screen.</small></p>';
    const serverLine = push.status === 'no-server' ? `<p class="social-note">${push.error}</p>`
      : cfg.configured === false ? '<p class="social-note">Waiting on a one-time server setup (VAPID keys). Until then this switch stays off.</p>' : '';
    panel.innerHTML = `<span class="eyebrow">LOCK-SCREEN ALERTS</span><h3>Phone alerts</h3><p>Get a buzz on your phone or computer, even when DJ Battle is closed. Alerts show who it's from but never the message itself.</p>
      ${serverLine}
      <label class="push-switch"><input type="checkbox" id="push-enable" ${push.subscribed ? 'checked' : ''} ${push.status === 'loading' ? 'disabled' : ''}> <span>${push.subscribed ? 'On for this device' : 'Off for this device'}</span></label>
      <fieldset class="push-types" ${push.subscribed ? '' : 'disabled'}><legend>Alert me about</legend>${types.map(t => `<label><input type="checkbox" data-push-type="${esc(t)}" ${chosen.has(t) ? 'checked' : ''}> ${esc(labels[t] || t)}</label>`).join('')}</fieldset>
      ${iosNote}
      <div class="social-note" id="push-status" aria-live="polite">${push.status === 'no-server' ? '' : esc(push.error || '')}</div>`;
    const sw = panel.querySelector('#push-enable');
    if(sw) sw.onchange = () => (sw.checked ? enablePush() : disablePush());
    panel.querySelectorAll('[data-push-type]').forEach(box => { box.onchange = () => setPushType(box.dataset.pushType, box.checked); });
  }

  /* ============================== 2. Add to calendar ============================== */
  const icsDate = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  function eventTimes(ev){
    const start = new Date(ev.start);
    const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + 30 * 60000);
    return { start, end:end > start ? end : new Date(start.getTime() + 30 * 60000) };
  }
  function appLink(){ try{ return String(W.location.href).split('#')[0]; }catch(e){ return ''; } }
  function buildIcs(ev, now = new Date()){
    const { start, end } = eventTimes(ev);
    const uid = `djb-${icsDate(start)}-${Math.abs(hashCode(ev.title + ev.kind))}@djbattle`;
    const desc = [ev.kind, ev.details, appLink()].filter(Boolean).join('\n');
    // Folded at 75 chars as the calendar format requires.
    const fold = line => line.length <= 75 ? line : line.match(/.{1,74}/g).join('\r\n ');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DJ Battle//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      `UID:${uid}`, `DTSTAMP:${icsDate(now)}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
      fold(`SUMMARY:${icsText(ev.title)}`), fold(`DESCRIPTION:${icsText(desc)}`),
      'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', fold(`DESCRIPTION:${icsText(ev.title)}`), 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
  }
  function hashCode(s){ let h = 0; for(const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
  function googleUrl(ev){
    const { start, end } = eventTimes(ev);
    const q = new URLSearchParams({ action:'TEMPLATE', text:ev.title, dates:`${icsDate(start)}/${icsDate(end)}`, details:[ev.kind, ev.details, appLink()].filter(Boolean).join('\n') });
    return `https://calendar.google.com/calendar/render?${q}`;
  }
  function outlookUrl(ev){
    const { start, end } = eventTimes(ev);
    const q = new URLSearchParams({ path:'/calendar/action/compose', rru:'addevent', subject:ev.title, startdt:start.toISOString(), enddt:end.toISOString(), body:[ev.kind, ev.details, appLink()].filter(Boolean).join('\n') });
    return `https://outlook.live.com/calendar/0/deeplink/compose?${q}`;
  }
  function icsFileName(ev){ return `${String(ev.title || 'dj-battle').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'dj-battle'}.ics`; }
  function closeCalendarMenu(){ const m = D.getElementById('cal-menu'); if(m) m.remove(); }
  function openCalendarMenu(button){
    closeCalendarMenu();
    let ev;
    try{ ev = JSON.parse(decodeURIComponent(button.dataset.calEvent)); }catch(e){ return null; }
    const menu = D.createElement('div');
    menu.id = 'cal-menu'; menu.className = 'cal-menu'; menu.setAttribute('role', 'menu');
    menu.innerHTML = `<strong></strong><small></small>
      <a role="menuitem" class="ghost small" target="_blank" rel="noopener" data-cal-google>Google Calendar</a>
      <button role="menuitem" class="ghost small" type="button" data-cal-ics>Apple Calendar (.ics)</button>
      <a role="menuitem" class="ghost small" target="_blank" rel="noopener" data-cal-outlook>Outlook</a>
      <button class="ghost small" type="button" data-cal-close aria-label="Close">✕</button>`;
    menu.querySelector('strong').textContent = ev.title;
    menu.querySelector('small').textContent = `${ev.kind ? `${ev.kind} · ` : ''}${new Date(ev.start).toLocaleString([], { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}`;
    menu.querySelector('[data-cal-google]').href = googleUrl(ev);
    menu.querySelector('[data-cal-outlook]').href = outlookUrl(ev);
    menu.querySelector('[data-cal-ics]').onclick = () => { downloadText(icsFileName(ev), buildIcs(ev), 'text/calendar'); closeCalendarMenu(); };
    menu.querySelector('[data-cal-close]').onclick = closeCalendarMenu;
    button.insertAdjacentElement('afterend', menu);
    return menu;
  }
  D.addEventListener('click', e => {
    const btn = e.target && e.target.closest && e.target.closest('[data-cal-event]');
    if(btn){ e.preventDefault(); e.stopPropagation(); openCalendarMenu(btn); return; }
    if(!(e.target && e.target.closest && e.target.closest('#cal-menu'))) closeCalendarMenu();
  }, true);
  D.addEventListener('keydown', e => { if(e.key === 'Escape') closeCalendarMenu(); });

  /* ============================== 4. Result review requests ============================== */
  const reviews = { mine:new Map(), reasons:null, queue:[], queueStatus:'idle', queueError:'' };
  const DEFAULT_REASONS = {
    timing_misread:'The timing / beatmatching score looks wrong', wrong_track:'The wrong audio or track was judged',
    audio_problem:'The upload had an audio problem (silence, clipping, cut off)', scoring_rule:'A scoring rule was applied wrongly', other:'Something else'
  };
  async function loadMyReviews(){
    if(!signedIn()) return reviews.mine;
    const r = await api('/api/resultReviews/mine');
    if(!r.error && r.data){
      reviews.mine = new Map((r.data.reviews || []).map(x => [String(x.submissionId), x]));
      reviews.reasons = r.data.reasons || reviews.reasons;
    }
    return reviews.mine;
  }
  function reviewBadgeHtml(rv){
    if(!rv) return '';
    if(rv.status === 'pending') return '<span class="review-badge pending" title="A judge is checking this score">⚖ Under review</span>';
    if(rv.newScore != null) return `<span class="review-badge rescored">⚖ Rescored ${esc(rv.originalScore == null ? '' : `${rv.originalScore} → `)}${esc(rv.newScore)}/100</span>`;
    return '<span class="review-badge confirmed">⚖ Review done: score confirmed</span>';
  }
  let historyRoot = null;
  function decorateHistory(target){
    const root = target || historyRoot || D.getElementById('profile-media');
    historyRoot = root;
    if(!root) return;
    root.querySelectorAll('[data-history-row]').forEach(row => {
      const id = row.dataset.historyRow;
      const rv = reviews.mine.get(String(id));
      const title = row.querySelector('.battle-history-title');
      if(title && !title.querySelector('.review-badge') && rv) title.insertAdjacentHTML('beforeend', reviewBadgeHtml(rv));
      const actions = row.querySelector('.battle-history-actions');
      if(actions && !actions.querySelector('[data-review-request]') && (!rv || rv.status !== 'pending')){
        const b = D.createElement('button'); b.type = 'button'; b.className = 'ghost'; b.dataset.reviewRequest = id; b.textContent = 'Request a review';
        b.onclick = () => openReviewDialog(id);
        actions.appendChild(b);
      }
    });
    if(signedIn() && !reviews.loadedOnce){ reviews.loadedOnce = true; loadMyReviews().then(() => decorateHistory(root)).catch(() => {}); }
  }
  function openReviewDialog(submissionId){
    const reasons = reviews.reasons || DEFAULT_REASONS;
    let dlg = D.getElementById('review-dialog');
    if(dlg) dlg.remove();
    dlg = D.createElement('dialog'); dlg.id = 'review-dialog'; dlg.className = 'social-dialog';
    dlg.innerHTML = `<form method="dialog" class="review-form"><h3>Request a review</h3><p>Think a score is wrong? Tell the judges why. Your result shows "Under review" until a judge confirms the score or changes it. Each result can be reviewed twice at most.</p>
      <fieldset><legend>What looks wrong?</legend>${Object.entries(reasons).map(([k, label], i) => `<label><input type="radio" name="review-reason" value="${esc(k)}" ${i === 0 ? 'checked' : ''}> ${esc(label)}</label>`).join('')}</fieldset>
      <label>Anything the judges should know? <small>(optional, required for "Something else")</small><textarea id="review-note" maxlength="600" rows="3" placeholder="For example: the transition at 1:42 is on beat; the analyzer missed it."></textarea></label>
      <div class="social-note" id="review-status" aria-live="polite"></div>
      <div class="modal-actions"><button class="ghost" value="cancel" type="button" data-review-cancel>Cancel</button><button class="primary" type="button" data-review-send>Send request</button></div></form>`;
    D.body.appendChild(dlg);
    dlg.querySelector('[data-review-cancel]').onclick = () => dlg.close();
    dlg.querySelector('[data-review-send]').onclick = () => {
      const reason = (dlg.querySelector('input[name="review-reason"]:checked') || {}).value;
      return sendReviewRequest(submissionId, reason, dlg.querySelector('#review-note').value);
    };
    if(typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    return dlg;
  }
  async function sendReviewRequest(submissionId, reason, note){
    const status = D.getElementById('review-status');
    const r = await api(`/api/battleResults/${encodeURIComponent(submissionId)}/review`, { method:'POST', body:{ reason, note } });
    if(r.error){ if(status) status.innerHTML = setupNote(r, 'Review requests'); return { error:errText(r, 'failed') }; }
    reviews.mine.set(String(submissionId), r.data.review);
    const dlg = D.getElementById('review-dialog'); if(dlg) dlg.close();
    toast('Review requested', 'Your result shows "Under review" until a judge decides.');
    const root = historyRoot || D.getElementById('profile-media');
    if(root){ root.querySelectorAll('[data-review-request]').forEach(b => { if(b.dataset.reviewRequest === String(submissionId)) b.remove(); }); decorateHistory(root); }
    return { ok:true, review:r.data.review };
  }
  // Operator queue, inside Judging Operations.
  function queueHost(){
    const ops = D.getElementById('operations');
    if(!ops) return null;
    let host = D.getElementById('ops-review-queue');
    if(!host){ host = D.createElement('section'); host.id = 'ops-review-queue'; host.className = 'panel ops-review-queue'; ops.appendChild(host); }
    return host;
  }
  async function loadReviewQueue(){
    reviews.queueStatus = 'loading'; renderReviewQueue();
    const r = await api('/api/operations/resultReviews?status=pending');
    if(r.error){ reviews.queueStatus = 'error'; reviews.queueError = setupNote(r, 'The review queue'); renderReviewQueue(); return reviews; }
    reviews.queue = r.data.reviews || []; reviews.reasons = r.data.reasons || reviews.reasons;
    reviews.queueStatus = 'ready'; reviews.queueError = '';
    renderReviewQueue();
    return reviews;
  }
  function renderReviewQueue(){
    const host = queueHost();
    if(!host) return;
    const rows = reviews.queue;
    host.innerHTML = `<div class="section-head"><div><span class="eyebrow accent">RESULT REVIEWS</span><h3>Review requests <span class="dm-unread" ${rows.length ? '' : 'hidden'}>${rows.length}</span></h3><p>DJs who think a judged score is wrong. Confirm the score, or rescore it (0–100). The DJ gets a notification either way.</p></div><button class="ghost" type="button" id="ops-review-refresh">Refresh</button></div>
      <div class="social-note">${reviews.queueStatus === 'loading' ? 'Loading…' : reviews.queueError || ''}</div>
      ${reviews.queueStatus === 'ready' && !rows.length ? '<p class="dm-empty">No open review requests.</p>' : ''}
      <ul class="review-queue">${rows.map(rv => `<li class="review-item" data-review-id="${esc(rv.id)}">
        <div><strong>${esc(rv.battleTitle)}</strong> <span class="review-badge pending">Score ${esc(rv.originalScore == null ? '—' : rv.originalScore)}/100</span>
        <div class="challenge-meta">${esc(rv.reasonLabel)} · ${esc(new Date(rv.createdAt).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }))}</div>
        ${rv.note ? `<blockquote>${esc(rv.note)}</blockquote>` : ''}</div>
        <div class="review-decide"><input type="text" maxlength="600" placeholder="Note to the DJ (optional)" data-review-note aria-label="Note to the DJ">
        <button class="ghost small" type="button" data-review-confirm>Confirm score</button>
        <label class="review-rescore">New score <input type="number" min="0" max="100" step="1" data-review-score aria-label="New score"></label><button class="primary small" type="button" data-review-rescore>Rescore</button></div>
      </li>`).join('')}</ul>`;
    host.querySelector('#ops-review-refresh').onclick = () => loadReviewQueue();
    host.querySelectorAll('[data-review-id]').forEach(li => {
      const id = li.dataset.reviewId;
      const note = () => li.querySelector('[data-review-note]').value;
      li.querySelector('[data-review-confirm]').onclick = () => decideReview(id, 'confirm', null, note());
      li.querySelector('[data-review-rescore]').onclick = () => decideReview(id, 'rescore', li.querySelector('[data-review-score]').value, note());
    });
  }
  async function decideReview(id, decision, newScore, note){
    if(decision === 'rescore' && (newScore === '' || newScore == null)){ toast('Enter a new score', 'Type a score from 0 to 100 first.'); return { error:'score' }; }
    const r = await api(`/api/operations/resultReviews/${encodeURIComponent(id)}/decision`, { method:'POST', body:{ decision, newScore:newScore == null ? undefined : Number(newScore), note } });
    if(r.error){ toast('Review not saved', errText(r, 'Try again.')); return { error:errText(r, 'failed') }; }
    reviews.queue = reviews.queue.filter(x => x.id !== id);
    renderReviewQueue();
    toast('Review decided', decision === 'rescore' ? `Rescored to ${Number(newScore)}/100.` : 'Score confirmed.');
    return { ok:true, review:r.data.review };
  }

  /* ============================== 5. My data & account deletion ============================== */
  const account = { deletion:null, phrase:'DELETE MY ACCOUNT', graceDays:7, status:'idle', error:'' };
  async function loadDeletion(){
    if(!signedIn()){ account.deletion = null; renderAccountPanel(); renderDeletionBanner(); return account; }
    const r = await api('/api/account/deletion');
    if(!r.error && r.data){ account.deletion = r.data.deletion; account.phrase = r.data.confirmPhrase || account.phrase; account.graceDays = r.data.graceDays || 7; account.error = ''; }
    else account.error = schemaMissing(r) ? setupNote(r, 'Account deletion') : '';
    renderAccountPanel(); renderDeletionBanner();
    return account;
  }
  async function downloadMyData(){
    const status = D.getElementById('account-status');
    if(!signedIn()){ if(status) status.textContent = 'Sign in to download your data.'; return { error:'signed-out' }; }
    if(status) status.textContent = 'Gathering everything…';
    const r = await api('/api/account/export');
    if(r.error || !r.data){ if(status) status.innerHTML = setupNote(r, 'Download my data'); return { error:errText(r, 'failed') }; }
    // Things only kept on this device (settings, local practice notes) go in too.
    const local = {};
    try{ for(let i = 0; i < localStorage.length; i += 1){ const k = localStorage.key(i); if(k && k.indexOf('djBattle') === 0 && !/token|auth|session/i.test(k)) local[k] = localStorage.getItem(k); } }catch(e){}
    const file = { ...r.data, thisDevice:local };
    const name = `djb-my-data-${new Date().toISOString().slice(0, 10)}.json`;
    downloadText(name, JSON.stringify(file, null, 2), 'application/json');
    if(status) status.textContent = `Downloaded ${name}.`;
    return { ok:true, file, name };
  }
  function openDeleteDialog(){
    let dlg = D.getElementById('delete-account-dialog');
    if(dlg) dlg.remove();
    dlg = D.createElement('dialog'); dlg.id = 'delete-account-dialog'; dlg.className = 'social-dialog danger-dialog';
    dlg.innerHTML = `<form method="dialog"><h3>Delete my account</h3>
      <p>This removes your profile, mixes, library, messages, practice log and everything else tied to your account. Sales records stay where the law requires it, without your profile.</p>
      <p><strong>You have ${esc(account.graceDays)} days to change your mind.</strong> Until then you can sign in and cancel. After that it's permanent.</p>
      <p>Tip: use <em>Download my data</em> first if you want a copy.</p>
      <label>Type <code>${esc(account.phrase)}</code> to confirm<input id="delete-confirm-input" autocomplete="off" spellcheck="false"></label>
      <div class="social-note" id="delete-status" aria-live="polite"></div>
      <div class="modal-actions"><button class="ghost" type="button" data-delete-cancel>Keep my account</button><button class="danger" type="button" data-delete-go disabled>Delete in ${esc(account.graceDays)} days</button></div></form>`;
    D.body.appendChild(dlg);
    const input = dlg.querySelector('#delete-confirm-input');
    const go = dlg.querySelector('[data-delete-go]');
    input.oninput = () => { go.disabled = input.value.trim().toUpperCase() !== account.phrase; };
    dlg.querySelector('[data-delete-cancel]').onclick = () => dlg.close();
    go.onclick = () => requestDeletion(input.value);
    if(typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    return dlg;
  }
  async function requestDeletion(typed){
    const status = D.getElementById('delete-status');
    const r = await api('/api/account/deletion', { method:'POST', body:{ confirm:typed } });
    if(r.error){ if(status) status.innerHTML = setupNote(r, 'Account deletion'); return { error:errText(r, 'failed') }; }
    account.deletion = r.data.deletion;
    const dlg = D.getElementById('delete-account-dialog'); if(dlg) dlg.close();
    renderAccountPanel(); renderDeletionBanner();
    return { ok:true, deletion:account.deletion };
  }
  async function cancelDeletion(){
    const r = await api('/api/account/deletion', { method:'DELETE' });
    if(r.error){ toast('Could not cancel', errText(r, 'Try again.')); return { error:errText(r, 'failed') }; }
    account.deletion = null;
    renderAccountPanel(); renderDeletionBanner();
    toast('Deletion cancelled', 'Your account is staying.');
    return { ok:true };
  }
  const longDate = iso => new Date(iso).toLocaleString([], { weekday:'long', month:'long', day:'numeric', hour:'numeric', minute:'2-digit' });
  function renderAccountPanel(){
    const panel = settingsPanel('settings-account-panel');
    if(!panel) return;
    const del = account.deletion;
    panel.innerHTML = `<span class="eyebrow">YOUR DATA</span><h3>My data &amp; account</h3>
      <p>Download one file with everything DJ Battle stores for your account, or delete your account.</p>
      <div class="account-actions"><button class="ghost" type="button" id="account-download">⬇ Download my data</button>
      ${del ? `<button class="primary" type="button" id="account-cancel-delete">Cancel deletion</button>` : '<button class="danger ghost" type="button" id="account-delete">Delete my account…</button>'}</div>
      ${del ? `<p class="delete-scheduled">Your account will be deleted on <strong>${esc(longDate(del.scheduledFor))}</strong>.</p>` : ''}
      <div class="social-note" id="account-status" aria-live="polite">${account.error || ''}</div>`;
    panel.querySelector('#account-download').onclick = () => downloadMyData();
    const d = panel.querySelector('#account-delete'); if(d) d.onclick = () => (signedIn() ? openDeleteDialog() : (panel.querySelector('#account-status').textContent = 'Sign in to manage your account.'));
    const c = panel.querySelector('#account-cancel-delete'); if(c) c.onclick = () => cancelDeletion();
  }
  function renderDeletionBanner(){
    let bar = D.getElementById('deletion-banner');
    if(!account.deletion){ if(bar) bar.remove(); return; }
    const main = D.querySelector('.main');
    if(!main) return;
    if(!bar){ bar = D.createElement('div'); bar.id = 'deletion-banner'; bar.className = 'deletion-banner'; bar.setAttribute('role', 'status'); main.insertBefore(bar, main.firstChild); }
    bar.innerHTML = `<span>Your account is set to be deleted on <strong>${esc(longDate(account.deletion.scheduledFor))}</strong>.</span> <button class="primary small" type="button">Keep my account</button>`;
    bar.querySelector('button').onclick = () => cancelDeletion();
  }

  /* ============================== wiring ============================== */
  function onView(view){
    if(view === 'settings'){ loadPush(); loadDeletion(); }
    if(view === 'operations' && isOperator()) loadReviewQueue();
    if(view === 'profile') loadMyReviews().then(() => decorateHistory()).catch(() => {});
  }
  // Show the "deletion scheduled" banner on sign-in, wherever the DJ lands.
  let lastSignedIn = null;
  setInterval(() => { const now = signedIn(); if(now !== lastSignedIn){ lastSignedIn = now; if(now) loadDeletion().catch(() => {}); else { account.deletion = null; renderDeletionBanner(); } } }, 3000).unref?.();

  W.calendarButtonHtml = W.calendarButtonHtml || (() => '');
  W.DJBOct20 = {
    onView,
    push:{ state:() => push, load:loadPush, enable:enablePush, disable:disablePush, setType:setPushType, render:renderPushPanel, urlB64ToUint8Array, isIos },
    calendar:{ buildIcs, googleUrl, outlookUrl, openMenu:openCalendarMenu, close:closeCalendarMenu, icsFileName },
    reviews:{ state:() => reviews, loadMine:loadMyReviews, decorateHistory, openDialog:openReviewDialog, send:sendReviewRequest, loadQueue:loadReviewQueue, renderQueue:renderReviewQueue, decide:decideReview, badge:reviewBadgeHtml },
    account:{ state:() => account, load:loadDeletion, download:downloadMyData, openDelete:openDeleteDialog, request:requestDeletion, cancel:cancelDeletion, render:renderAccountPanel },
    decorateHistory
  };
  const active = D.querySelector('.view.active');
  if(active && active.id === 'settings') onView('settings');
})();

// Remix contests. A host (Dan or any producer) posts a track as parts (stems) or a full track,
// confirms they have the rights to share it (same rights rules as the Beat Store), and sets a
// submission deadline and a voting deadline. DJs and producers download the parts and send one
// remix each (they can replace it until submissions close). After submissions close the crowd
// votes (one vote per account, never for your own remix). When voting closes the top remix wins:
// the winner gets the "Remix Champion" badge and an Activity-bell alert, and the host can offer to
// list the winning remix in the Beat Store, which only happens if the winner says yes.
//
// Private account ids never leave the server: people are shown by DJ name and public profile id,
// and audio is only reachable through short-lived signed links.
const crypto = require('crypto');
const { cleanText, cleanId, newId, isMissingTable, profilesFor, rateLimited } = require('./social_helpers');
const { notifyQuietly } = require('./social_notifications');
const { validateAudioMetadata } = require('./ingestion_safety');
const Market = require('./marketplace_foundation');

const SCHEMA = '049_create_remix_contests';
const CONTESTS = 'remix_contests';
const ENTRIES = 'remix_contest_entries';
const VOTES = 'remix_contest_votes';
const BUCKET = 'battle-mixes';
const PATH_PREFIX = 'private/battle-entries/remix-contests/';
const MAX_PARTS = 12;
const HOUR = 60 * 60 * 1000;
const MIN_SUBMISSION_HOURS = 24;
const MIN_VOTING_HOURS = 24;
const MAX_DAYS = 90;
const DEFAULT_SUBMISSION_DAYS = 7;
const DEFAULT_VOTING_DAYS = 3;
// Same list the Beat Store uses for tracks that may be sold or streamed.
const RIGHTS_ALLOWED = Object.freeze([...Market.RIGHTS_CLASSIFICATIONS_ALLOWED_FOR_MARKETPLACE]);
const RIGHTS_LABELS = Object.freeze({ original:'I made it (original)', licensed:'I licensed it and may share the parts', royalty_free:'Royalty-free', platform_cleared:'Cleared by DJ Battle' });
const BADGE = Object.freeze({ key:'remix_champion', emoji:'🎛️', label:'Remix Champion' });

const missing = () => ({ schemaMissing:true, schema:SCHEMA });
const fail = r => (isMissingTable(r.error) ? missing() : { error:r.error });
const iso = d => new Date(d).toISOString();
const ext = name => { const m = /\.([a-z0-9]{1,5})$/i.exec(String(name || '')); return m ? m[1].toLowerCase() : 'audio'; };
const randomTag = () => crypto.randomBytes(6).toString('hex');

/* ----------------------------- phases ----------------------------- */
// draft (parts still uploading) → open (taking remixes) → voting → completed. cancelled any time before entries.
function phaseOf(row, now = new Date()){
  if(!row) return 'missing';
  if(row.status === 'cancelled' || row.status === 'draft' || row.status === 'completed') return row.status;
  const t = now.getTime();
  if(t < new Date(row.submission_deadline).getTime()) return 'open';
  if(t < new Date(row.voting_deadline).getTime()) return 'voting';
  return 'ended'; // waiting for finalize (done lazily on the next read)
}
function countdown(target, now = new Date()){
  const ms = new Date(target).getTime() - now.getTime();
  if(!Number.isFinite(ms) || ms <= 0) return { endsAt:iso(target), msLeft:0, label:'closed' };
  const d = Math.floor(ms / (24 * HOUR)), h = Math.floor(ms % (24 * HOUR) / HOUR), m = Math.floor(ms % HOUR / 60000);
  return { endsAt:iso(target), msLeft:ms, label:d ? `${d}d ${h}h left` : h ? `${h}h ${m}m left` : `${Math.max(1, m)}m left` };
}

/* ----------------------------- input ----------------------------- */
function parseDeadlines(input, now, existing){
  const sub = input.submissionDeadline != null ? new Date(input.submissionDeadline) : existing ? new Date(existing.submission_deadline) : new Date(now.getTime() + DEFAULT_SUBMISSION_DAYS * 24 * HOUR);
  const vote = input.votingDeadline != null ? new Date(input.votingDeadline) : existing && input.submissionDeadline == null ? new Date(existing.voting_deadline) : new Date(sub.getTime() + DEFAULT_VOTING_DAYS * 24 * HOUR);
  if(Number.isNaN(sub.getTime()) || Number.isNaN(vote.getTime())) return { validationError:'Pick valid dates for the deadlines' };
  if(sub.getTime() < now.getTime() + MIN_SUBMISSION_HOURS * HOUR) return { validationError:'Give remixers at least 24 hours before submissions close' };
  if(sub.getTime() > now.getTime() + MAX_DAYS * 24 * HOUR) return { validationError:'Submissions must close within 90 days' };
  if(vote.getTime() < sub.getTime() + MIN_VOTING_HOURS * HOUR) return { validationError:'Voting needs at least 24 hours after submissions close' };
  if(vote.getTime() > sub.getTime() + 30 * 24 * HOUR) return { validationError:'Voting can last at most 30 days' };
  return { submission:sub, voting:vote };
}
function parseParts(list, contestId){
  const arr = Array.isArray(list) ? list.slice(0, MAX_PARTS + 1) : [];
  if(!arr.length) return { validationError:'Add the full track or at least one part (stem)' };
  if(arr.length > MAX_PARTS) return { validationError:`At most ${MAX_PARTS} parts` };
  const out = [];
  for(const p of arr){
    const v = validateAudioMetadata({ filename:p && p.filename, mimeType:p && p.mimeType, size:p && p.size });
    if(v.error) return { validationError:`${cleanText(p && p.filename, 80) || 'A file'}: ${v.error}` };
    const id = `part_${randomTag()}`;
    out.push({ id, label:cleanText(p.label, 40) || (arr.length === 1 ? 'Full track' : `Part ${out.length + 1}`), filename:cleanText(p.filename, 160), mime_type:v.mimeType, size:v.size,
      path:`${PATH_PREFIX}${contestId}/parts/${id}.${v.extension}`, uploaded:false });
  }
  return { parts:out };
}
function parseRights(input){
  const rc = String(input.rightsClassification || '').trim();
  if(!RIGHTS_ALLOWED.includes(rc)) return { validationError:'Choose how you have the rights to this track (same rules as the Beat Store)' };
  if(input.rightsConfirmed !== true) return { validationError:'Confirm you have the rights to share these parts for remixing' };
  return { rights:rc };
}

/* ----------------------------- loading ----------------------------- */
async function loadContest(db, id){
  const cid = cleanId(id);
  if(!cid) return { notFound:true };
  const r = await db.from(CONTESTS).select('*').eq('id', cid).limit(1);
  if(r.error) return fail(r);
  const row = (r.data || [])[0];
  return row ? { row } : { notFound:true };
}
async function entriesFor(db, contestId){
  const r = await db.from(ENTRIES).select('*').eq('contest_id', contestId).limit(1000);
  if(r.error) return fail(r);
  return { rows:(r.data || []).filter(e => e.status === 'submitted' || e.status === 'hidden') };
}
async function votesFor(db, contestId){
  const r = await db.from(VOTES).select('*').eq('contest_id', contestId).limit(100000);
  if(r.error) return fail(r);
  return { rows:r.data || [] };
}
const tally = (entries, votes) => { const c = new Map(entries.map(e => [String(e.id), 0])); votes.forEach(v => { const k = String(v.entry_id); if(c.has(k)) c.set(k, c.get(k) + 1); }); return c; };
// Most votes wins; a tie goes to whoever sent their final remix first.
function pickWinner(entries, votes){
  const live = entries.filter(e => e.status === 'submitted');
  if(!live.length) return null;
  const counts = tally(live, votes);
  return live.slice().sort((a, b) => (counts.get(String(b.id)) - counts.get(String(a.id))) || (new Date(a.submitted_at) - new Date(b.submitted_at)))[0];
}

// Close out a contest whose voting deadline passed. Safe to call repeatedly.
async function finalizeIfDue(db, row, now = new Date()){
  if(phaseOf(row, now) !== 'ended') return row;
  const ents = await entriesFor(db, row.id); if(ents.error || ents.schemaMissing) return row;
  const vts = await votesFor(db, row.id); if(vts.error || vts.schemaMissing) return row;
  const winner = pickWinner(ents.rows, vts.rows);
  const patch = { status:'completed', completed_at:now.toISOString(), updated_at:now.toISOString(), winner_entry_id:winner ? winner.id : null, winner_user_id:winner ? winner.user_id : null };
  const up = await db.from(CONTESTS).update(patch).eq('id', row.id).eq('status', 'open');
  if(up.error) return row;
  const done = { ...row, ...patch };
  if(winner){
    await notifyQuietly(db, { recipientUserId:winner.user_id, actorUserId:row.host_user_id, type:'remix_contest_won', subjectId:row.id, eventKey:`remix-won:${row.id}`,
      destination:{ type:'remix_contest', contestId:row.id }, summary:`Your remix won "${cleanText(row.title, 80)}"! You earned the 🎛️ Remix Champion badge.`, now });
  }
  return done;
}
async function sweepDueContests(db, now = new Date()){
  const r = await db.from(CONTESTS).select('*').eq('status', 'open').limit(500);
  if(r.error) return fail(r);
  let finalized = 0;
  for(const row of r.data || []){ if(phaseOf(row, now) === 'ended'){ await finalizeIfDue(db, row, now); finalized++; } }
  return { finalized };
}

/* ----------------------------- shaping (no private ids) ----------------------------- */
function shapeContest(row, profiles, viewerId, now, extra = {}){
  const phase = phaseOf(row, now);
  const p = id => { const x = profiles.get(String(id)) || {}; return { displayName:x.displayName || 'DJ', publicProfileId:x.publicProfileId || null }; };
  const isHost = Boolean(viewerId && String(viewerId) === String(row.host_user_id));
  return {
    id:row.id, title:row.title, description:row.description || '', phase,
    host:p(row.host_user_id), isHost,
    rights:{ classification:row.rights_classification, label:RIGHTS_LABELS[row.rights_classification] || row.rights_classification },
    submissionDeadline:row.submission_deadline, votingDeadline:row.voting_deadline,
    countdown:phase === 'open' ? { ...countdown(row.submission_deadline, now), what:'Submissions close' } : phase === 'voting' ? { ...countdown(row.voting_deadline, now), what:'Voting closes' } : null,
    parts:(row.parts || []).filter(x => x.uploaded || isHost).map(x => ({ id:x.id, label:x.label, filename:x.filename, size:x.size, uploaded:Boolean(x.uploaded) })),
    entryCount:extra.entryCount != null ? extra.entryCount : undefined,
    winner:row.winner_user_id ? { ...p(row.winner_user_id), entryId:row.winner_entry_id } : null,
    store:{ status:row.store_offer_status || 'none', listingId:row.store_listing_id || null },
    canEdit:isHost && (phase === 'draft' || phase === 'open') && !extra.entryCount,
    createdAt:row.created_at
  };
}

/* ----------------------------- public reads ----------------------------- */
async function listContests(db, viewerId = null, now = new Date()){
  const r = await db.from(CONTESTS).select('*').limit(300);
  if(r.error) return fail(r);
  const rows = [];
  for(const row of r.data || []){
    if(row.status === 'draft' && String(row.host_user_id) !== String(viewerId || '')) continue;
    if(row.status === 'cancelled' && String(row.host_user_id) !== String(viewerId || '')) continue;
    rows.push(await finalizeIfDue(db, row, now));
  }
  const counts = new Map();
  const e = await db.from(ENTRIES).select('*').eq('status', 'submitted').limit(10000);
  if(!e.error) (e.data || []).forEach(x => counts.set(String(x.contest_id), (counts.get(String(x.contest_id)) || 0) + 1));
  const profiles = await profilesFor(db, rows.flatMap(x => [x.host_user_id, x.winner_user_id]));
  const order = { open:0, voting:1, draft:2, completed:3, cancelled:4 };
  const list = rows.map(x => shapeContest(x, profiles, viewerId, now, { entryCount:counts.get(String(x.id)) || 0 }))
    .sort((a, b) => (order[a.phase] - order[b.phase]) || (new Date(a.phase === 'completed' ? b.votingDeadline : a.submissionDeadline) - new Date(a.phase === 'completed' ? a.votingDeadline : b.submissionDeadline)));
  return { contests:list };
}

async function getContest(db, id, viewerId = null, now = new Date()){
  const l = await loadContest(db, id);
  if(l.error || l.schemaMissing || l.notFound) return l;
  const isHost = viewerId && String(viewerId) === String(l.row.host_user_id);
  if((l.row.status === 'draft' || l.row.status === 'cancelled') && !isHost) return { notFound:true };
  const row = await finalizeIfDue(db, l.row, now);
  const ents = await entriesFor(db, row.id); if(ents.error || ents.schemaMissing) return ents;
  const vts = await votesFor(db, row.id); if(vts.error || vts.schemaMissing) return vts;
  const phase = phaseOf(row, now);
  const showVotes = phase === 'completed';
  const counts = tally(ents.rows, vts.rows);
  const visible = ents.rows.filter(e => e.status === 'submitted' || (viewerId && String(e.user_id) === String(viewerId)));
  const profiles = await profilesFor(db, [row.host_user_id, row.winner_user_id, ...visible.map(e => e.user_id)]);
  const myVote = viewerId ? vts.rows.find(v => String(v.voter_user_id) === String(viewerId)) : null;
  const entries = visible.map(e => { const pr = profiles.get(String(e.user_id)) || {}; return {
    id:e.id, title:e.title, notes:e.notes || '', submittedAt:e.submitted_at, hidden:e.status === 'hidden',
    dj:{ displayName:pr.displayName || 'DJ', publicProfileId:pr.publicProfileId || null },
    isMine:Boolean(viewerId && String(e.user_id) === String(viewerId)),
    isWinner:String(row.winner_entry_id || '') === String(e.id),
    votes:showVotes ? counts.get(String(e.id)) || 0 : null
  }; }).sort((a, b) => showVotes ? (b.votes - a.votes) || (new Date(a.submittedAt) - new Date(b.submittedAt)) : new Date(a.submittedAt) - new Date(b.submittedAt));
  const mine = viewerId ? ents.rows.find(e => String(e.user_id) === String(viewerId)) : null;
  const pending = viewerId ? await db.from(ENTRIES).select('*').eq('contest_id', row.id).eq('user_id', String(viewerId)).limit(1) : null;
  const contest = shapeContest(row, profiles, viewerId, now, { entryCount:ents.rows.filter(e => e.status === 'submitted').length });
  return { contest:{ ...contest, entries,
    totalVotes:showVotes ? vts.rows.length : null,
    viewer:{ signedIn:Boolean(viewerId), hasEntry:Boolean(mine), entryId:mine ? mine.id : null,
      hasPendingUpload:Boolean(pending && !pending.error && (pending.data || [])[0] && pending.data[0].pending_path),
      votedEntryId:myVote ? myVote.entry_id : null,
      canSubmit:Boolean(viewerId) && phase === 'open' && String(viewerId) !== String(row.host_user_id),
      canVote:Boolean(viewerId) && phase === 'voting' && !myVote && entries.some(e => !e.isMine && !e.hidden),
      isWinner:Boolean(viewerId && String(row.winner_user_id || '') === String(viewerId)) } } };
}

/* ----------------------------- host actions ----------------------------- */
async function createContest(db, storage, userId, input = {}, now = new Date()){
  if(!userId) return { forbidden:true };
  const title = cleanText(input.title, 100);
  if(title.length < 3) return { validationError:'Give the contest a title (at least 3 characters)' };
  const description = cleanText(input.description, 1500);
  const rights = parseRights(input); if(rights.validationError) return rights;
  const dl = parseDeadlines(input, now); if(dl.validationError) return dl;
  const id = newId('rmx');
  const parts = parseParts(input.parts, id); if(parts.validationError) return parts;
  if(rateLimited(`remix-create:${userId}`, now.getTime(), 5, HOUR)) return { rateLimited:true };
  const row = { id, host_user_id:String(userId), title, description, status:'draft', rights_classification:rights.rights, rights_confirmed_at:now.toISOString(),
    submission_deadline:dl.submission.toISOString(), voting_deadline:dl.voting.toISOString(), parts:parts.parts,
    winner_entry_id:null, winner_user_id:null, store_offer_status:'none', store_listing_id:null, created_at:now.toISOString(), updated_at:now.toISOString() };
  const ins = await db.from(CONTESTS).insert([row]);
  if(ins.error) return fail(ins);
  const uploads = [];
  for(const p of parts.parts){
    const s = await storage.createSignedUploadUrl(p.path, { upsert:true });
    if(s.error) return { error:s.error };
    uploads.push({ partId:p.id, label:p.label, bucket:BUCKET, uploadPath:s.data.path, uploadToken:s.data.token });
  }
  const profiles = await profilesFor(db, [userId]);
  return { created:true, contest:shapeContest(row, profiles, userId, now, { entryCount:0 }), uploads };
}

async function verifyObject(storage, path, size){
  const slash = path.lastIndexOf('/');
  const listed = await storage.list(path.slice(0, slash), { search:path.slice(slash + 1) });
  if(listed.error) return { error:listed.error };
  const obj = (listed.data || []).find(o => o.name === path.slice(slash + 1));
  if(!obj) return { missing:true };
  const got = obj.metadata && Number(obj.metadata.size);
  if(size && got && got !== Number(size)) return { missing:true };
  return { ok:true };
}

// After the browser uploads the parts: check every file arrived, then open the contest.
async function publishContest(db, storage, userId, id, now = new Date()){
  const l = await loadContest(db, id); if(l.error || l.schemaMissing || l.notFound) return l;
  const row = l.row;
  if(String(row.host_user_id) !== String(userId)) return { forbidden:true };
  if(row.status !== 'draft') return { validationError:'This contest is already published' };
  if(new Date(row.submission_deadline).getTime() <= now.getTime()) return { validationError:'The submission deadline already passed. Edit the dates first.' };
  const parts = [];
  for(const p of row.parts || []){
    const v = await verifyObject(storage, p.path, p.size);
    if(v.error) return { error:v.error };
    if(v.missing) return { validationError:`"${p.label}" hasn\u2019t finished uploading yet` };
    parts.push({ ...p, uploaded:true });
  }
  const patch = { status:'open', parts, updated_at:now.toISOString(), published_at:now.toISOString() };
  const up = await db.from(CONTESTS).update(patch).eq('id', row.id);
  if(up.error) return fail(up);
  const profiles = await profilesFor(db, [userId]);
  return { published:true, contest:shapeContest({ ...row, ...patch }, profiles, userId, now, { entryCount:0 }) };
}

async function submittedCount(db, contestId){
  const r = await db.from(ENTRIES).select('*').eq('contest_id', contestId).limit(1000);
  if(r.error) return fail(r);
  return { count:(r.data || []).filter(e => e.status === 'submitted' || e.status === 'hidden').length };
}

// Host can change the title, description or dates only until the first remix arrives.
async function editContest(db, userId, id, input = {}, now = new Date()){
  const l = await loadContest(db, id); if(l.error || l.schemaMissing || l.notFound) return l;
  const row = l.row;
  if(String(row.host_user_id) !== String(userId)) return { forbidden:true };
  const phase = phaseOf(row, now);
  if(phase !== 'draft' && phase !== 'open') return { validationError:'This contest can\u2019t be edited any more' };
  const c = await submittedCount(db, row.id); if(c.error || c.schemaMissing) return c;
  if(c.count) return { validationError:'Remixes have already come in, so the contest can\u2019t be edited' };
  const patch = { updated_at:now.toISOString() };
  if(input.title != null){ const t = cleanText(input.title, 100); if(t.length < 3) return { validationError:'Give the contest a title (at least 3 characters)' }; patch.title = t; }
  if(input.description != null) patch.description = cleanText(input.description, 1500);
  if(input.submissionDeadline != null || input.votingDeadline != null){
    const dl = parseDeadlines(input, now, row); if(dl.validationError) return dl;
    patch.submission_deadline = dl.submission.toISOString(); patch.voting_deadline = dl.voting.toISOString();
  }
  const up = await db.from(CONTESTS).update(patch).eq('id', row.id);
  if(up.error) return fail(up);
  const profiles = await profilesFor(db, [userId]);
  return { updated:true, contest:shapeContest({ ...row, ...patch }, profiles, userId, now, { entryCount:0 }) };
}

async function cancelContest(db, userId, id, now = new Date()){
  const l = await loadContest(db, id); if(l.error || l.schemaMissing || l.notFound) return l;
  const row = l.row;
  if(String(row.host_user_id) !== String(userId)) return { forbidden:true };
  const phase = phaseOf(row, now);
  if(phase !== 'draft' && phase !== 'open') return { validationError:'This contest can\u2019t be cancelled any more' };
  const c = await submittedCount(db, row.id); if(c.error || c.schemaMissing) return c;
  if(c.count) return { validationError:'Remixes have already come in, so the contest can\u2019t be cancelled' };
  const up = await db.from(CONTESTS).update({ status:'cancelled', cancelled_at:now.toISOString(), updated_at:now.toISOString() }).eq('id', row.id);
  if(up.error) return fail(up);
  return { cancelled:true };
}

/* ----------------------------- remixer actions ----------------------------- */
async function partDownload(db, storage, userId, id, partId, now = new Date()){
  if(!userId) return { forbidden:true };
  const l = await loadContest(db, id); if(l.error || l.schemaMissing || l.notFound) return l;
  const phase = phaseOf(l.row, now);
  const isHost = String(l.row.host_user_id) === String(userId);
  if(phase === 'cancelled' || (phase === 'draft' && !isHost)) return { notFound:true };
  const part = (l.row.parts || []).find(p => p.id === String(partId || '') && (p.uploaded || isHost));
  if(!part) return { notFound:true };
  const s = await storage.createSignedUrl(part.path, 10 * 60, { download:part.filename || true });
  if(s.error) return { error:s.error };
  return { url:s.data.signedUrl, filename:part.filename, expiresInSeconds:600 };
}

// Start (or replace) your remix: returns a one-time upload link. The remix only counts after completeEntry.
async function startEntry(db, storage, userId, id, input = {}, now = new Date()){
  if(!userId) return { forbidden:true };
  if(rateLimited(`remix-entry:${userId}`, now.getTime(), 10, HOUR)) return { rateLimited:true };
  const l = await loadContest(db, id); if(l.error || l.schemaMissing || l.notFound) return l;
  const row = l.row;
  if(phaseOf(row, now) !== 'open') return { validationError:'Submissions are closed for this contest' };
  if(String(row.host_user_id) === String(userId)) return { validationError:'Hosts can\u2019t enter their own contest' };
  const v = validateAudioMetadata({ filename:input.filename, mimeType:input.mimeType, size:input.size });
  if(v.error) return { validationError:v.error };
  const title = cleanText(input.title, 100) || `${cleanText(row.title, 60)} (remix)`;
  const notes = cleanText(input.notes, 600);
  const pendingPath = `${PATH_PREFIX}${row.id}/entries/${String(userId)}/${randomTag()}.${v.extension}`;
  const existing = await db.from(ENTRIES).select('*').eq('contest_id', row.id).eq('user_id', String(userId)).limit(1);
  if(existing.error) return fail(existing);
  const pend = { pending_path:pendingPath, pending_filename:cleanText(input.filename, 160), pending_mime_type:v.mimeType, pending_size:v.size, pending_title:title, pending_notes:notes, updated_at:now.toISOString() };
  let entryId;
  if((existing.data || [])[0]){
    const e = existing.data[0];
    if(e.status === 'hidden') return { validationError:'Your remix was hidden by a moderator, so it can\u2019t be replaced' };
    entryId = e.id;
    const up = await db.from(ENTRIES).update(pend).eq('id', e.id);
    if(up.error) return fail(up);
  }else{
    entryId = newId('rmxe');
    const ins = await db.from(ENTRIES).insert([{ id:entryId, contest_id:row.id, user_id:String(userId), status:'pending_upload', title, notes, storage_path:null, filename:null, mime_type:null, size:null, submitted_at:null, created_at:now.toISOString(), ...pend }]);
    if(ins.error){ if(/duplicate|unique|23505/i.test(String(ins.error.message || ins.error.code || ''))) return { validationError:'Try again' }; return fail(ins); }
  }
  const s = await storage.createSignedUploadUrl(pendingPath, { upsert:false });
  if(s.error) return { error:s.error };
  return { entryId, upload:{ bucket:BUCKET, uploadPath:s.data.path, uploadToken:s.data.token } };
}

async function completeEntry(db, storage, userId, id, now = new Date()){
  if(!userId) return { forbidden:true };
  const l = await loadContest(db, id); if(l.error || l.schemaMissing || l.notFound) return l;
  const row = l.row;
  if(phaseOf(row, now) !== 'open') return { validationError:'Submissions are closed for this contest' };
  const r = await db.from(ENTRIES).select('*').eq('contest_id', row.id).eq('user_id', String(userId)).limit(1);
  if(r.error) return fail(r);
  const e = (r.data || [])[0];
  if(!e || !e.pending_path) return { validationError:'Upload your remix first' };
  const v = await verifyObject(storage, e.pending_path, e.pending_size);
  if(v.error) return { error:v.error };
  if(v.missing) return { validationError:'Your remix hasn\u2019t finished uploading yet' };
  const replaced = e.status === 'submitted';
  const oldPath = e.storage_path;
  const patch = { status:'submitted', storage_path:e.pending_path, filename:e.pending_filename, mime_type:e.pending_mime_type, size:e.pending_size, title:e.pending_title || e.title, notes:e.pending_notes != null ? e.pending_notes : e.notes,
    pending_path:null, pending_filename:null, pending_mime_type:null, pending_size:null, pending_title:null, pending_notes:null, submitted_at:now.toISOString(), updated_at:now.toISOString() };
  const up = await db.from(ENTRIES).update(patch).eq('id', e.id);
  if(up.error) return fail(up);
  if(oldPath && oldPath !== patch.storage_path && typeof storage.remove === 'function'){ try{ await storage.remove([oldPath]); }catch(err){ /* old file cleanup is best-effort */ } }
  return { submitted:true, replaced, entry:{ id:e.id, title:patch.title, notes:patch.notes, submittedAt:patch.submitted_at } };
}

async function withdrawEntry(db, storage, userId, id, now = new Date()){
  const l = await loadContest(db, id); if(l.error || l.schemaMissing || l.notFound) return l;
  if(phaseOf(l.row, now) !== 'open') return { validationError:'Submissions are closed, so your remix stays in' };
  const r = await db.from(ENTRIES).select('*').eq('contest_id', l.row.id).eq('user_id', String(userId)).limit(1);
  if(r.error) return fail(r);
  const e = (r.data || [])[0];
  if(!e) return { notFound:true };
  const del = await db.from(ENTRIES).delete().eq('id', e.id);
  if(del.error) return fail(del);
  if(typeof storage.remove === 'function'){ try{ await storage.remove([e.storage_path, e.pending_path].filter(Boolean)); }catch(err){ /* best-effort */ } }
  return { withdrawn:true };
}

// Short-lived link to play one remix on the public contest page.
async function entryPlayback(db, storage, id, entryId, viewerId = null, now = new Date()){
  const l = await loadContest(db, id); if(l.error || l.schemaMissing || l.notFound) return l;
  if(['draft', 'cancelled'].includes(l.row.status)) return { notFound:true };
  const r = await db.from(ENTRIES).select('*').eq('id', cleanId(entryId)).eq('contest_id', l.row.id).limit(1);
  if(r.error) return fail(r);
  const e = (r.data || [])[0];
  const mine = e && viewerId && String(e.user_id) === String(viewerId);
  if(!e || !e.storage_path || (e.status !== 'submitted' && !mine)) return { notFound:true };
  const s = await storage.createSignedUrl(e.storage_path, 15 * 60);
  if(s.error) return { error:s.error };
  return { url:s.data.signedUrl, expiresInSeconds:900 };
}

/* ----------------------------- crowd voting ----------------------------- */
async function castVote(db, userId, id, input = {}, now = new Date()){
  if(!userId) return { forbidden:true };
  if(rateLimited(`remix-vote:${userId}`, now.getTime(), 20, 60 * 1000)) return { rateLimited:true };
  const l = await loadContest(db, id); if(l.error || l.schemaMissing || l.notFound) return l;
  const row = l.row;
  const phase = phaseOf(row, now);
  if(phase === 'open') return { validationError:'Voting opens when submissions close' };
  if(phase !== 'voting') return { validationError:'Voting is closed for this contest' };
  const entryId = cleanId(input.entryId);
  const r = await db.from(ENTRIES).select('*').eq('id', entryId).eq('contest_id', row.id).limit(1);
  if(r.error) return fail(r);
  const e = (r.data || [])[0];
  if(!e || e.status !== 'submitted') return { validationError:'Pick one of the remixes' };
  if(String(e.user_id) === String(userId)) return { validationError:'You can\u2019t vote for your own remix' };
  const prior = await db.from(VOTES).select('*').eq('contest_id', row.id).eq('voter_user_id', String(userId)).limit(1);
  if(prior.error) return fail(prior);
  if((prior.data || [])[0]) return { duplicate:true, entryId:prior.data[0].entry_id };
  const ins = await db.from(VOTES).insert([{ contest_id:row.id, voter_user_id:String(userId), entry_id:e.id, created_at:now.toISOString() }]);
  if(ins.error){ if(/duplicate|unique|23505/i.test(String(ins.error.message || ins.error.code || ''))) return { duplicate:true }; return fail(ins); }
  return { voted:true, entryId:e.id };
}

/* ----------------------------- badge ----------------------------- */
// Public list of Remix Champions (by public profile id) for profile badges and Rankings.
async function listChampions(db){
  const r = await db.from(CONTESTS).select('*').eq('status', 'completed').limit(5000);
  if(r.error) return fail(r);
  const wins = new Map();
  (r.data || []).forEach(c => { if(c.winner_user_id) wins.set(String(c.winner_user_id), (wins.get(String(c.winner_user_id)) || 0) + 1); });
  const profiles = await profilesFor(db, [...wins.keys()]);
  return { badge:BADGE, champions:[...wins.entries()].map(([uid, n]) => { const p = profiles.get(uid) || {}; return { publicProfileId:p.publicProfileId, displayName:p.displayName || 'DJ', wins:n }; }) };
}
async function myRemixSummary(db, userId){
  const r = await db.from(CONTESTS).select('*').eq('winner_user_id', String(userId)).limit(500);
  if(r.error) return fail(r);
  const won = (r.data || []).filter(c => c.status === 'completed');
  return { wins:won.length, badge:won.length ? BADGE : null, contests:won.map(c => ({ id:c.id, title:c.title, completedAt:c.completed_at })) };
}

/* ----------------------------- Beat Store (winner consent) ----------------------------- */
// Host asks; winner answers; only then can the host publish. Seller is the winner, so any sale
// money goes to the winner's Stripe account (the same Beat Store payouts as any other beat).
async function offerStoreListing(db, userId, id, input = {}, now = new Date()){
  const l = await loadContest(db, id); if(l.error || l.schemaMissing || l.notFound) return l;
  const row = l.row;
  if(String(row.host_user_id) !== String(userId)) return { forbidden:true };
  if(row.status !== 'completed' || !row.winner_entry_id) return { validationError:'There\u2019s no winning remix yet' };
  if(['offered', 'accepted', 'listed'].includes(row.store_offer_status)) return { validationError:'You already asked the winner' };
  const price = Math.round(Number(input.priceCents));
  if(!Number.isFinite(price) || price < 100 || price > 50000) return { validationError:'Pick a price between $1 and $500' };
  const up = await db.from(CONTESTS).update({ store_offer_status:'offered', store_price_cents:price, updated_at:now.toISOString() }).eq('id', row.id);
  if(up.error) return fail(up);
  await notifyQuietly(db, { recipientUserId:row.winner_user_id, actorUserId:row.host_user_id, type:'remix_store_offer', subjectId:row.id, eventKey:`remix-store-offer:${row.id}`,
    destination:{ type:'remix_contest', contestId:row.id }, summary:`The host of "${cleanText(row.title, 80)}" wants to sell your winning remix in the Beat Store. Say yes or no.`, now });
  return { offered:true, status:'offered' };
}
async function answerStoreOffer(db, userId, id, input = {}, now = new Date()){
  const l = await loadContest(db, id); if(l.error || l.schemaMissing || l.notFound) return l;
  const row = l.row;
  if(String(row.winner_user_id || '') !== String(userId)) return { forbidden:true };
  if(row.store_offer_status !== 'offered') return { validationError:'There\u2019s no Beat Store request waiting' };
  const status = input.accept === true ? 'accepted' : 'declined';
  const up = await db.from(CONTESTS).update({ store_offer_status:status, store_consent_at:now.toISOString(), updated_at:now.toISOString() }).eq('id', row.id);
  if(up.error) return fail(up);
  return { answered:true, status };
}
async function listWinnerInStore(db, userId, id, now = new Date()){
  const l = await loadContest(db, id); if(l.error || l.schemaMissing || l.notFound) return l;
  const row = l.row;
  if(String(row.host_user_id) !== String(userId)) return { forbidden:true };
  if(row.store_offer_status === 'listed') return { validationError:'It\u2019s already in the Beat Store' };
  if(row.store_offer_status !== 'accepted') return { validationError:'The winner hasn\u2019t agreed to this yet' };
  if(!RIGHTS_ALLOWED.includes(row.rights_classification)) return { validationError:'This track\u2019s rights don\u2019t allow selling it' };
  const r = await db.from(ENTRIES).select('*').eq('id', row.winner_entry_id).limit(1);
  if(r.error) return fail(r);
  const e = (r.data || [])[0];
  if(!e || e.status !== 'submitted' || !e.storage_path) return { validationError:'The winning remix isn\u2019t available' };
  const ts = now.toISOString();
  const seller = String(row.winner_user_id);
  const pseudoTrack = { id:null, source_type:'track', audio_storage_bucket:BUCKET, audio_storage_object_path:e.storage_path, title:e.title, genre:'Remix', tags:['remix', 'remix-contest'], rights_classification:'licensed' };
  const product = Market.marketplaceProductPayloadFromTrack(seller, pseudoTrack, { productId:`mp_prod_rmx_${e.id}`, description:`Winning remix of "${row.title}" (DJ Battle remix contest).` }, ts);
  product.library_track_id = null;
  const rights = Market.marketplaceRightsPayload(product, { licenseType:'creator_license', terms:{ source:'remix_contest', contestId:row.id } }, ts);
  const listing = Market.marketplaceListingPayload(seller, product, { publish:true, displayPriceCents:row.store_price_cents || 500, metadata:{ source:'remix_contest', contestId:row.id } }, ts);
  for(const [table, value] of [[Market.MARKETPLACE_PRODUCT_TABLE, product], [Market.MARKETPLACE_RIGHTS_TABLE, rights], [Market.MARKETPLACE_LISTING_TABLE, listing]]){
    const ins = await db.from(table).insert([value]);
    if(ins.error) return fail(ins);
  }
  const up = await db.from(CONTESTS).update({ store_offer_status:'listed', store_listing_id:listing.id, updated_at:ts }).eq('id', row.id);
  if(up.error) return fail(up);
  return { listed:true, listingId:listing.id };
}

/* ----------------------------- reports & moderation ----------------------------- */
// Plugged into the shared community report queue (community.js EXTRA_REPORT_TARGETS).
async function contestReportTarget(db, userId, id){
  const l = await loadContest(db, id); if(l.error || l.schemaMissing) return l.schemaMissing ? { notFound:true } : l;
  if(l.notFound || l.row.status === 'draft') return { notFound:true };
  if(String(l.row.host_user_id) === String(userId)) return { forbidden:true };
  return { target:{ id:l.row.id } };
}
async function entryReportTarget(db, userId, id){
  const r = await db.from(ENTRIES).select('*').eq('id', cleanId(id)).limit(1);
  if(r.error) return isMissingTable(r.error) ? { notFound:true } : { error:r.error };
  const e = (r.data || [])[0];
  if(!e || e.status !== 'submitted') return { notFound:true };
  if(String(e.user_id) === String(userId)) return { forbidden:true };
  return { target:{ id:e.id } };
}
// Moderator: hide or restore a remix (hidden remixes can't win or get votes).
async function moderateEntry(db, entryId, input = {}, now = new Date()){
  const r = await db.from(ENTRIES).select('*').eq('id', cleanId(entryId)).limit(1);
  if(r.error) return fail(r);
  const e = (r.data || [])[0];
  if(!e || !['submitted', 'hidden'].includes(e.status)) return { notFound:true };
  const status = input.action === 'restore' ? 'submitted' : 'hidden';
  const up = await db.from(ENTRIES).update({ status, moderated_at:now.toISOString(), updated_at:now.toISOString() }).eq('id', e.id);
  if(up.error) return fail(up);
  return { moderated:true, status };
}

module.exports = { SCHEMA, BADGE, RIGHTS_ALLOWED, PATH_PREFIX, phaseOf, countdown, parseDeadlines, pickWinner, finalizeIfDue, sweepDueContests,
  listContests, getContest, createContest, publishContest, editContest, cancelContest, partDownload, startEntry, completeEntry, withdrawEntry, entryPlayback,
  castVote, listChampions, myRemixSummary, offerStoreListing, answerStoreOffer, listWinnerInStore, contestReportTarget, entryReportTarget, moderateEntry };

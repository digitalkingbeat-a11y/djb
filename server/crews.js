// Oct 20b: Crews (up to 4 DJs, name + logo, crew page, crew rankings) and 2-vs-2 crew battles.
// Each side puts up two members; each member submits one of their own judged mixes and the
// crew's battle score is the two judged scores added together.
const crypto = require('crypto');
const { cleanText, cleanId, newId, isMissingTable, profilesFor, blockedUserIdsFor, rateLimited, stablePublicProfileId } = require('./social_helpers');

const SCHEMA = '043_create_crews';
const MAX_MEMBERS = 4;
const LOGO_COLORS = ['#ff4d6d', '#ffb703', '#2ec4b6', '#4361ee', '#9b5de5', '#f15bb5', '#00bbf9', '#80ed99'];
const WIN_POINTS = 3;
const DRAW_POINTS = 1;
const missing = () => ({ schemaMissing:true, schema:SCHEMA });
const fail = r => (isMissingTable(r.error) ? missing() : { error:r.error });

function validLogo(body = {}){
  const emoji = cleanText(body.logoEmoji, 8) || '🎧';
  const color = LOGO_COLORS.includes(body.logoColor) ? body.logoColor : LOGO_COLORS[0];
  let url = cleanText(body.logoUrl, 400);
  if(url && !/^https:\/\/[^\s"'<>]+$/i.test(url)) return { validationError:'The logo link must start with https://' };
  return { emoji, color, url:url || null };
}
const inviteCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();

function publicCrew(row, members = [], profiles = new Map(), { viewerId = null } = {}){
  const isMember = Boolean(viewerId && members.some(m => String(m.user_id) === String(viewerId)));
  const isOwner = Boolean(viewerId && String(row.owner_user_id) === String(viewerId));
  const out = {
    id:row.id, name:row.name, logo:{ emoji:row.logo_emoji || '🎧', color:row.logo_color || LOGO_COLORS[0], url:row.logo_url || null },
    wins:Number(row.wins || 0), losses:Number(row.losses || 0), draws:Number(row.draws || 0), points:Number(row.points || 0),
    memberCount:members.length, maxMembers:MAX_MEMBERS, createdAt:row.created_at,
    members:members.map(m => { const p = profiles.get(String(m.user_id)) || { publicProfileId:stablePublicProfileId(m.user_id), displayName:'DJ' }; return { publicProfileId:p.publicProfileId, displayName:p.displayName, belt:p.belt || null, role:m.role, isMe:Boolean(viewerId && String(m.user_id) === String(viewerId)) }; }),
    isMember, isOwner
  };
  if(isOwner) out.inviteCode = row.invite_code; // only the owner sees the join code
  return out;
}

async function membersOf(db, crewIds){
  if(!crewIds.length) return { rows:[] };
  const r = await db.from('crew_members').select('*').in('crew_id', crewIds);
  if(r.error) return fail(r);
  return { rows:r.data || [] };
}
async function myMembership(db, userId){
  const r = await db.from('crew_members').select('*').eq('user_id', String(userId)).limit(1);
  if(r.error) return fail(r);
  return { row:(r.data || [])[0] || null };
}
async function loadCrew(db, crewId, viewerId){
  const id = cleanId(crewId);
  if(!id) return { notFound:true };
  const r = await db.from('crews').select('*').eq('id', id).limit(1);
  if(r.error) return fail(r);
  const row = (r.data || [])[0];
  if(!row) return { notFound:true };
  const m = await membersOf(db, [id]);
  if(m.schemaMissing || m.error) return m;
  const profiles = await profilesFor(db, m.rows.map(x => x.user_id));
  return { row, members:m.rows, crew:publicCrew(row, m.rows, profiles, { viewerId }) };
}

async function createCrew(db, userId, body = {}, now = new Date()){
  const name = cleanText(body.name, 40);
  if(name.length < 2) return { validationError:'Give your crew a name (2 to 40 characters)' };
  const logo = validLogo(body);
  if(logo.validationError) return logo;
  if(rateLimited(`crew-create:${userId}`, now.getTime(), 3, 60000)) return { validationError:'Slow down a little and try again in a minute' };
  const mine = await myMembership(db, userId);
  if(mine.schemaMissing || mine.error) return mine;
  if(mine.row) return { validationError:'You are already in a crew. Leave it first to start a new one' };
  const all = await db.from('crews').select('*').limit(2000);
  if(all.error) return fail(all);
  if((all.data || []).some(c => String(c.name).toLowerCase() === name.toLowerCase())) return { validationError:'That crew name is taken' };
  const ts = now.toISOString();
  const row = { id:newId('crew'), name, logo_emoji:logo.emoji, logo_color:logo.color, logo_url:logo.url, owner_user_id:String(userId), invite_code:inviteCode(), wins:0, losses:0, draws:0, points:0, created_at:ts, updated_at:ts };
  const ins = await db.from('crews').insert([row]);
  if(ins.error) return fail(ins);
  const mem = await db.from('crew_members').insert([{ crew_id:row.id, user_id:String(userId), role:'owner', joined_at:ts }]);
  if(mem.error) return fail(mem);
  return loadCrew(db, row.id, userId);
}

async function updateCrew(db, userId, crewId, body = {}, now = new Date()){
  const loaded = await loadCrew(db, crewId, userId);
  if(!loaded.crew) return loaded;
  if(!loaded.crew.isOwner) return { forbidden:true };
  const patch = { updated_at:now.toISOString() };
  if(body.name != null){ const name = cleanText(body.name, 40); if(name.length < 2) return { validationError:'Give your crew a name (2 to 40 characters)' }; patch.name = name; }
  if(body.logoEmoji != null || body.logoColor != null || body.logoUrl != null){ const logo = validLogo({ logoEmoji:body.logoEmoji ?? loaded.row.logo_emoji, logoColor:body.logoColor ?? loaded.row.logo_color, logoUrl:body.logoUrl ?? loaded.row.logo_url }); if(logo.validationError) return logo; Object.assign(patch, { logo_emoji:logo.emoji, logo_color:logo.color, logo_url:logo.url }); }
  if(body.newInviteCode) patch.invite_code = inviteCode();
  const r = await db.from('crews').update(patch).eq('id', loaded.row.id);
  if(r.error) return fail(r);
  return loadCrew(db, loaded.row.id, userId);
}

async function joinCrew(db, userId, body = {}, now = new Date()){
  const code = cleanText(body.inviteCode, 16).toUpperCase();
  if(!/^[A-F0-9]{8}$/.test(code)) return { validationError:'Enter the 8-character join code from the crew owner' };
  if(rateLimited(`crew-join:${userId}`, now.getTime(), 6, 60000)) return { validationError:'Too many tries. Wait a minute and try again' };
  const mine = await myMembership(db, userId);
  if(mine.schemaMissing || mine.error) return mine;
  if(mine.row) return { validationError:'You are already in a crew' };
  const r = await db.from('crews').select('*').eq('invite_code', code).limit(1);
  if(r.error) return fail(r);
  const row = (r.data || [])[0];
  if(!row) return { validationError:'That join code did not match a crew' };
  const blocked = await blockedUserIdsFor(db, userId);
  if(blocked.has(String(row.owner_user_id))) return { validationError:'That join code did not match a crew' };
  const m = await membersOf(db, [row.id]);
  if(m.error || m.schemaMissing) return m;
  if(m.rows.length >= MAX_MEMBERS) return { validationError:`That crew is full (${MAX_MEMBERS} DJs max)` };
  const ins = await db.from('crew_members').insert([{ crew_id:row.id, user_id:String(userId), role:'member', joined_at:now.toISOString() }]);
  if(ins.error) return fail(ins);
  return loadCrew(db, row.id, userId);
}

async function leaveCrew(db, userId, crewId){
  const loaded = await loadCrew(db, crewId, userId);
  if(!loaded.crew) return loaded;
  if(!loaded.crew.isMember) return { forbidden:true };
  const del = await db.from('crew_members').delete().eq('crew_id', loaded.row.id).eq('user_id', String(userId));
  if(del.error) return fail(del);
  const rest = loaded.members.filter(m => String(m.user_id) !== String(userId)).sort((a, b) => String(a.joined_at).localeCompare(String(b.joined_at)));
  if(!rest.length){
    const d = await db.from('crews').delete().eq('id', loaded.row.id);
    if(d.error) return fail(d);
    return { left:true, disbanded:true };
  }
  if(loaded.crew.isOwner){ // hand the crew to the longest-standing member
    await db.from('crews').update({ owner_user_id:String(rest[0].user_id) }).eq('id', loaded.row.id);
    await db.from('crew_members').update({ role:'owner' }).eq('crew_id', loaded.row.id).eq('user_id', String(rest[0].user_id));
  }
  return { left:true, disbanded:false };
}

async function removeMember(db, userId, crewId, publicProfileId){
  const loaded = await loadCrew(db, crewId, userId);
  if(!loaded.crew) return loaded;
  if(!loaded.crew.isOwner) return { forbidden:true };
  const target = loaded.members.find(m => stablePublicProfileId(m.user_id) === publicProfileId);
  if(!target) return { notFound:true };
  if(String(target.user_id) === String(userId)) return { validationError:'Use Leave crew to remove yourself' };
  const del = await db.from('crew_members').delete().eq('crew_id', loaded.row.id).eq('user_id', String(target.user_id));
  if(del.error) return fail(del);
  return loadCrew(db, loaded.row.id, userId);
}

function rankCrews(rows){
  return rows.slice().sort((a, b) => (Number(b.points || 0) - Number(a.points || 0)) || (Number(b.wins || 0) - Number(a.wins || 0)) || (Number(a.losses || 0) - Number(b.losses || 0)) || String(a.name).localeCompare(String(b.name)));
}
async function crewRankings(db, viewerId = null, limit = 50){
  const r = await db.from('crews').select('*').limit(2000);
  if(r.error) return fail(r);
  const ranked = rankCrews(r.data || []).slice(0, Math.min(100, Math.max(1, limit)));
  const m = await membersOf(db, ranked.map(c => c.id));
  if(m.error || m.schemaMissing) return m;
  const profiles = await profilesFor(db, m.rows.map(x => x.user_id));
  return { crews:ranked.map((row, i) => ({ rank:i + 1, ...publicCrew(row, m.rows.filter(x => x.crew_id === row.id), profiles, { viewerId }) })) };
}
async function getMyCrew(db, userId){
  const mine = await myMembership(db, userId);
  if(mine.schemaMissing || mine.error) return mine;
  if(!mine.row) return { crew:null };
  const loaded = await loadCrew(db, mine.row.crew_id, userId);
  if(loaded.error || loaded.schemaMissing) return loaded;
  const battles = await listCrewBattles(db, mine.row.crew_id, userId);
  return { crew:loaded.crew || null, battles:battles.battles || [] };
}

/* ---------------- 2-vs-2 crew battles ---------------- */
function publicBattle(row, crews, profiles, viewerId){
  const side = (crewId, lineup, scores) => {
    const c = crews.get(String(crewId));
    return { crewId, name:c ? c.name : 'Crew', logo:c ? { emoji:c.logo_emoji || '🎧', color:c.logo_color || LOGO_COLORS[0], url:c.logo_url || null } : null,
      lineup:(lineup || []).map(uid => { const p = profiles.get(String(uid)) || { publicProfileId:stablePublicProfileId(uid), displayName:'DJ' }; const s = (scores || {})[uid]; return { publicProfileId:p.publicProfileId, displayName:p.displayName, submitted:s != null, score:s == null ? null : Number(s), isMe:String(uid) === String(viewerId) }; }) };
  };
  const scores = row.scores || {};
  return { id:row.id, title:row.title, status:row.status, createdAt:row.created_at, completedAt:row.completed_at || null,
    challenger:{ ...side(row.challenger_crew_id, row.challenger_lineup, scores), total:row.challenger_total == null ? null : Number(row.challenger_total) },
    opponent:{ ...side(row.opponent_crew_id, row.opponent_lineup, scores), total:row.opponent_total == null ? null : Number(row.opponent_total) },
    winnerCrewId:row.winner_crew_id || null };
}
async function battleContext(db, rows, viewerId){
  const crewIds = [...new Set(rows.flatMap(r => [r.challenger_crew_id, r.opponent_crew_id]).map(String))];
  const crews = new Map();
  if(crewIds.length){ const c = await db.from('crews').select('*').in('id', crewIds); (c.data || []).forEach(x => crews.set(String(x.id), x)); }
  const uids = rows.flatMap(r => [...(r.challenger_lineup || []), ...(r.opponent_lineup || [])]);
  const profiles = await profilesFor(db, uids);
  return rows.map(r => publicBattle(r, crews, profiles, viewerId));
}
async function listCrewBattles(db, crewId, viewerId){
  const a = await db.from('crew_battles').select('*').eq('challenger_crew_id', String(crewId)).limit(200);
  if(a.error) return fail(a);
  const b = await db.from('crew_battles').select('*').eq('opponent_crew_id', String(crewId)).limit(200);
  if(b.error) return fail(b);
  const rows = [...(a.data || []), ...(b.data || [])].sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
  return { battles:await battleContext(db, rows, viewerId) };
}
function lineupFrom(members, publicIds){
  const ids = Array.isArray(publicIds) ? [...new Set(publicIds.map(String))] : [];
  if(ids.length !== 2) return { validationError:'Pick exactly two DJs from the crew for a 2-vs-2' };
  const out = ids.map(pid => members.find(m => stablePublicProfileId(m.user_id) === pid));
  if(out.some(x => !x)) return { validationError:'Both DJs must be in the crew' };
  return { lineup:out.map(m => String(m.user_id)) };
}

async function challengeCrew(db, userId, body = {}, now = new Date()){
  const mine = await myMembership(db, userId);
  if(mine.schemaMissing || mine.error) return mine;
  if(!mine.row) return { validationError:'Join or start a crew first' };
  const own = await loadCrew(db, mine.row.crew_id, userId);
  if(!own.crew) return own;
  const opp = await loadCrew(db, body.opponentCrewId, userId);
  if(!opp.crew) return opp.notFound ? { validationError:'Pick a crew to challenge' } : opp;
  if(opp.row.id === own.row.id) return { validationError:'A crew cannot battle itself' };
  if(opp.members.length < 2) return { validationError:'That crew needs at least 2 DJs for a 2-vs-2' };
  const lineup = lineupFrom(own.members, body.lineup);
  if(lineup.validationError) return lineup;
  const blocked = await blockedUserIdsFor(db, userId);
  if(opp.members.some(m => blocked.has(String(m.user_id)))) return { validationError:'You can\u2019t challenge a crew with a DJ you blocked (or who blocked you)' };
  if(rateLimited(`crew-battle:${userId}`, now.getTime(), 5, 60000)) return { validationError:'Slow down a little and try again in a minute' };
  const ts = now.toISOString();
  const row = { id:newId('cbat'), title:cleanText(body.title, 80) || `${own.row.name} vs ${opp.row.name}`, status:'pending', challenger_crew_id:own.row.id, opponent_crew_id:opp.row.id, challenger_lineup:lineup.lineup, opponent_lineup:[], scores:{}, submissions:{}, challenger_total:null, opponent_total:null, winner_crew_id:null, created_by:String(userId), created_at:ts, updated_at:ts };
  const ins = await db.from('crew_battles').insert([row]);
  if(ins.error) return fail(ins);
  return { battle:(await battleContext(db, [row], userId))[0] };
}

async function loadBattle(db, battleId){
  const id = cleanId(battleId);
  if(!id) return { notFound:true };
  const r = await db.from('crew_battles').select('*').eq('id', id).limit(1);
  if(r.error) return fail(r);
  const row = (r.data || [])[0];
  return row ? { row } : { notFound:true };
}

async function respondToCrewBattle(db, userId, battleId, body = {}, now = new Date()){
  const b = await loadBattle(db, battleId);
  if(!b.row) return b;
  if(b.row.status !== 'pending') return { validationError:'This crew battle was already answered' };
  const opp = await loadCrew(db, b.row.opponent_crew_id, userId);
  if(!opp.crew) return opp;
  if(!opp.crew.isMember) return { forbidden:true };
  const ts = now.toISOString();
  if(body.accept === false){
    const r = await db.from('crew_battles').update({ status:'declined', updated_at:ts }).eq('id', b.row.id);
    if(r.error) return fail(r);
    return { battle:(await battleContext(db, [{ ...b.row, status:'declined' }], userId))[0] };
  }
  const lineup = lineupFrom(opp.members, body.lineup);
  if(lineup.validationError) return lineup;
  const patch = { status:'live', opponent_lineup:lineup.lineup, updated_at:ts };
  const r = await db.from('crew_battles').update(patch).eq('id', b.row.id);
  if(r.error) return fail(r);
  return { battle:(await battleContext(db, [{ ...b.row, ...patch }], userId))[0] };
}

function judgedScore(sub){
  const j = sub && sub.judge_result;
  const s = j && (j.overallScore ?? j.overall_score ?? j.score);
  return Number.isFinite(Number(s)) ? Math.round(Number(s) * 10) / 10 : null;
}
// Combined score: the two lineup scores added up. Higher total wins; equal totals are a draw.
function combineScores(row, scores){
  const sum = lineup => lineup.reduce((t, uid) => t + Number(scores[uid] || 0), 0);
  const all = [...(row.challenger_lineup || []), ...(row.opponent_lineup || [])];
  const done = all.length === 4 && all.every(uid => scores[uid] != null);
  const challengerTotal = Math.round(sum(row.challenger_lineup || []) * 10) / 10;
  const opponentTotal = Math.round(sum(row.opponent_lineup || []) * 10) / 10;
  const winner = !done ? null : challengerTotal > opponentTotal ? row.challenger_crew_id : opponentTotal > challengerTotal ? row.opponent_crew_id : 'draw';
  return { done, challengerTotal, opponentTotal, winner };
}

async function submitCrewBattleMix(db, userId, battleId, body = {}, now = new Date()){
  const b = await loadBattle(db, battleId);
  if(!b.row) return b;
  if(b.row.status !== 'live') return { validationError:b.row.status === 'complete' ? 'This crew battle is already finished' : 'This crew battle hasn\u2019t started yet' };
  const uid = String(userId);
  if(![...(b.row.challenger_lineup || []), ...(b.row.opponent_lineup || [])].includes(uid)) return { forbidden:true };
  if((b.row.scores || {})[uid] != null) return { validationError:'You already sent your mix for this battle' };
  const subId = cleanId(body.submissionId);
  if(!subId) return { validationError:'Pick one of your judged mixes' };
  const s = await db.from('mix_submissions').select('*').eq('id', subId).limit(1);
  if(s.error) return { error:s.error };
  const sub = (s.data || [])[0];
  if(!sub || String(sub.user_id) !== uid) return { forbidden:true };
  const score = judgedScore(sub);
  if(sub.status !== 'completed' || score == null) return { validationError:'That mix hasn\u2019t been judged yet' };
  const scores = { ...(b.row.scores || {}), [uid]:score };
  const submissions = { ...(b.row.submissions || {}), [uid]:subId };
  const c = combineScores(b.row, scores);
  const ts = now.toISOString();
  const patch = { scores, submissions, challenger_total:c.challengerTotal, opponent_total:c.opponentTotal, updated_at:ts };
  if(c.done){ Object.assign(patch, { status:'complete', completed_at:ts, winner_crew_id:c.winner }); }
  const u = await db.from('crew_battles').update(patch).eq('id', b.row.id);
  if(u.error) return fail(u);
  if(c.done) await applyStandings(db, b.row, c.winner);
  return { battle:(await battleContext(db, [{ ...b.row, ...patch }], userId))[0] };
}
async function applyStandings(db, row, winner){
  for(const crewId of [row.challenger_crew_id, row.opponent_crew_id]){
    const r = await db.from('crews').select('*').eq('id', crewId).limit(1);
    const c = (r.data || [])[0];
    if(!c) continue;
    const patch = winner === 'draw' ? { draws:Number(c.draws || 0) + 1, points:Number(c.points || 0) + DRAW_POINTS }
      : winner === crewId ? { wins:Number(c.wins || 0) + 1, points:Number(c.points || 0) + WIN_POINTS } : { losses:Number(c.losses || 0) + 1 };
    await db.from('crews').update(patch).eq('id', crewId);
  }
}

module.exports = { SCHEMA, MAX_MEMBERS, LOGO_COLORS, WIN_POINTS, DRAW_POINTS, createCrew, updateCrew, joinCrew, leaveCrew, removeMember, loadCrew, crewRankings, rankCrews, getMyCrew, listCrewBattles, challengeCrew, respondToCrewBattle, submitCrewBattleMix, combineScores, judgedScore };

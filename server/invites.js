// Oct 20c: personal invite-a-friend links. Every DJ gets one short invite code (made the first
// time they open their invite card). A brand-new account that arrives through the link is
// credited to the inviter once, the inviter gets an Activity-bell alert, and their invite card
// shows how many friends joined plus a badge. No emails, account ids or contact details are ever
// sent to the browser: friends are shown by DJ name and public profile id only.
const crypto = require('crypto');
const { isMissingTable, profilesFor, rateLimited } = require('./social_helpers');
const { notifyQuietly } = require('./social_notifications');

const SCHEMA = '048_create_dj_invites';
const CODES = 'dj_invite_codes';
const JOINS = 'dj_invite_joins';
const NEW_ACCOUNT_DAYS = 14; // only accounts made in the last 2 weeks count as "joined from an invite"
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, so codes are easy to read out
const BADGES = Object.freeze([
  { min:1, key:'connector', emoji:'🤝', label:'Connector' },
  { min:3, key:'recruiter', emoji:'📣', label:'Crew Recruiter' },
  { min:10, key:'scene_builder', emoji:'🌟', label:'Scene Builder' },
  { min:25, key:'ambassador', emoji:'👑', label:'DJ Battle Ambassador' }
]);
const missing = () => ({ schemaMissing:true, schema:SCHEMA });
const fail = r => (isMissingTable(r.error) ? missing() : { error:r.error });
const normCode = v => String(v == null ? '' : v).trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
const validCode = c => /^[A-Z0-9]{6,12}$/.test(c);

function makeCode(rand = crypto.randomBytes){
  const bytes = rand(8);
  let out = '';
  for(let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
// Current badge plus the next one to aim for.
function badgeFor(joinCount){
  const n = Math.max(0, Number(joinCount) || 0);
  let badge = null, next = null;
  for(const b of BADGES){ if(n >= b.min) badge = b; else if(!next) next = b; }
  return { badge:badge ? { key:badge.key, emoji:badge.emoji, label:badge.label } : null, next:next ? { label:next.label, emoji:next.emoji, needed:next.min - n } : null };
}

async function codeRowFor(db, userId){
  const r = await db.from(CODES).select('*').eq('user_id', String(userId)).limit(1);
  if(r.error) return fail(r);
  return { row:(r.data || [])[0] || null };
}
async function ensureCode(db, userId, now = new Date(), rand){
  const found = await codeRowFor(db, userId);
  if(found.error || found.schemaMissing || found.row) return found;
  for(let i = 0; i < 5; i++){
    const code = makeCode(rand);
    const taken = await db.from(CODES).select('user_id').eq('code', code).limit(1);
    if(taken.error) return fail(taken);
    if((taken.data || []).length) continue;
    const ins = await db.from(CODES).insert([{ user_id:String(userId), code, created_at:now.toISOString() }]);
    if(ins.error){
      // Two tabs racing: the other one won, so just read its code.
      const again = await codeRowFor(db, userId);
      if(again.row) return again;
      if(isMissingTable(ins.error)) return missing();
      continue;
    }
    return { row:{ user_id:String(userId), code, created_at:now.toISOString() } };
  }
  return { error:new Error('Could not make an invite code') };
}

// The signed-in DJ's own invite card: code, join count, badge and the friends who joined.
async function getMyInvite(db, userId, now = new Date(), rand){
  const c = await ensureCode(db, userId, now, rand);
  if(c.error || c.schemaMissing) return c;
  const j = await db.from(JOINS).select('*').eq('inviter_user_id', String(userId)).limit(1000);
  if(j.error) return fail(j);
  const joins = (j.data || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const profiles = await profilesFor(db, joins.slice(0, 20).map(r => r.invitee_user_id));
  const friends = joins.slice(0, 20).map(r => { const p = profiles.get(String(r.invitee_user_id)) || {}; return { displayName:p.displayName || 'DJ', publicProfileId:p.publicProfileId || null, joinedAt:r.created_at }; });
  return { invite:{ code:c.row.code, joinCount:joins.length, ...badgeFor(joins.length), friends } };
}

// Public: who sent this link (for the "DJ X invited you" banner). Never reveals account ids.
async function lookupInvite(db, code){
  const c = normCode(code);
  if(!validCode(c)) return { notFound:true };
  const r = await db.from(CODES).select('*').eq('code', c).limit(1);
  if(r.error) return fail(r);
  const row = (r.data || [])[0];
  if(!row) return { notFound:true };
  const p = (await profilesFor(db, [row.user_id])).get(String(row.user_id)) || {};
  return { invite:{ code:c, inviter:{ displayName:p.displayName || 'A DJ', publicProfileId:p.publicProfileId || null } } };
}

// Called by the browser right after sign-in when it remembers an invite code from the link.
// Only a brand-new account counts, only once, and never your own code.
async function claimInvite(db, user, input = {}, now = new Date()){
  const userId = String(user && user.id || '');
  if(!userId) return { validationError:'Sign in first' };
  if(rateLimited(`invite-claim:${userId}`, now.getTime(), 5, 60 * 1000)) return { rateLimited:true };
  const c = normCode(input.code);
  if(!validCode(c)) return { validationError:'That invite link isn\u2019t valid' };
  const r = await db.from(CODES).select('*').eq('code', c).limit(1);
  if(r.error) return fail(r);
  const codeRow = (r.data || [])[0];
  if(!codeRow) return { validationError:'That invite link isn\u2019t valid' };
  if(String(codeRow.user_id) === userId) return { validationError:'That\u2019s your own invite link', ownCode:true };
  const already = await db.from(JOINS).select('*').eq('invitee_user_id', userId).limit(1);
  if(already.error) return fail(already);
  if((already.data || [])[0]) return { alreadyCounted:true, sameInviter:String(already.data[0].inviter_user_id) === String(codeRow.user_id) };
  const created = user.created_at ? new Date(user.created_at) : null;
  if(!created || Number.isNaN(created.getTime()) || now.getTime() - created.getTime() > NEW_ACCOUNT_DAYS * 24 * 60 * 60 * 1000){
    return { notNewAccount:true };
  }
  const ins = await db.from(JOINS).insert([{ invitee_user_id:userId, inviter_user_id:String(codeRow.user_id), code:c, created_at:now.toISOString() }]);
  if(ins.error){
    if(isMissingTable(ins.error)) return missing();
    if(/duplicate|unique|23505/i.test(String(ins.error.message || ins.error.code || ''))) return { alreadyCounted:true };
    return { error:ins.error };
  }
  const profiles = await profilesFor(db, [userId, codeRow.user_id]);
  const me = profiles.get(userId) || {}, inviter = profiles.get(String(codeRow.user_id)) || {};
  await notifyQuietly(db, { recipientUserId:codeRow.user_id, actorUserId:userId, type:'invite_joined', subjectId:userId, eventKey:`invite-joined:${userId}`,
    destination:{ type:'invites', view:'profile' }, summary:`${me.displayName && me.displayName !== 'DJ' ? me.displayName : 'A friend'} joined DJ Battle from your invite link`, now });
  return { claimed:true, inviter:{ displayName:inviter.displayName || 'A DJ', publicProfileId:inviter.publicProfileId || null } };
}

module.exports = { SCHEMA, BADGES, NEW_ACCOUNT_DAYS, makeCode, badgeFor, normCode, ensureCode, getMyInvite, lookupInvite, claimInvite };

// Oct 20: "Download my data" (one JSON file) and "Delete my account" (typed confirmation,
// 7-day grace period, cancellable). The actual deletion runs on the server with the existing
// Supabase service key, never from the browser.
const { isMissingTable } = require('./social_helpers');

const DELETION_TABLE = 'account_deletion_requests';
const SCHEMA = '042_create_account_deletion_requests';
const GRACE_DAYS = 7;
const CONFIRM_PHRASE = 'DELETE MY ACCOUNT';
const MIX_BUCKET = 'battle-mixes';

// [table, column] pairs holding a DJ's own data. Exported, and deleted on account deletion.
const OWN_TABLES = [
  ['dj_progression_profiles', 'user_id'], ['mix_submissions', 'user_id'], ['battle_entries', 'user_id'],
  ['music_library_tracks', 'user_id'], ['music_library_crates', 'user_id'], ['music_library_crate_memberships', 'user_id'],
  ['practice_sessions', 'user_id'], ['practice_goals', 'user_id'], ['shared_crate_tracklists', 'user_id'],
  ['battle_prep_entry_snapshots', 'user_id'], ['battle_chat_messages', 'user_id'], ['result_timed_comments', 'user_id'],
  ['community_posts', 'user_id'], ['community_comments', 'user_id'], ['community_reactions', 'user_id'],
  ['dj_follows', 'follower_user_id'], ['dj_follows', 'followed_user_id'], ['dj_blocks', 'blocker_user_id'],
  ['dj_notification_mutes', 'user_id'], ['dj_notifications', 'user_id'], ['dj_challenge_preferences', 'user_id'],
  ['direct_messages', 'sender_user_id'], ['direct_messages', 'recipient_user_id'],
  ['dj_challenges', 'challenger_user_id'], ['dj_challenges', 'recipient_user_id'], ['dj_tournament_seats', 'user_id'],
  ['battle_crowd_votes', 'voter_user_id'], ['battle_community_votes', 'voter_user_id'],
  ['mix_rights_certifications', 'user_id'], ['marketplace_entitlements', 'user_id'], ['marketplace_listings', 'seller_user_id'],
  ['marketplace_free_email_leads', 'user_id'], ['user_belts', 'user_id'], ['belt_attempts', 'user_id'], ['belt_tests', 'user_id'],
  ['ai_scores', 'user_id'], ['judge_breakdowns', 'user_id'], ['timing_analysis', 'user_id'],
  ['push_subscriptions', 'user_id'], ['result_review_requests', 'user_id']
];
// Kept after deletion (with the account gone they show as a removed DJ): sales records the law
// requires sellers/buyers to keep, and moderation history. Exported, not deleted.
const RETAINED_TABLES = [['marketplace_orders', 'buyer_user_id'], ['marketplace_orders', 'seller_user_id']];
// Never put these in an export: secrets and other people's private data.
const SECRET_FIELDS = /^(p256dh|auth|endpoint|password|token|secret|.*_secret|.*_token|stripe_.*_id|access_key|signed_url|upload_url)$/i;

function scrub(value, depth = 0){
  if(depth > 8) return null;
  if(Array.isArray(value)) return value.map(v => scrub(v, depth + 1));
  if(value && typeof value === 'object'){
    const out = {};
    Object.entries(value).forEach(([k, v]) => { if(!SECRET_FIELDS.test(k)) out[k] = scrub(v, depth + 1); });
    return out;
  }
  return value;
}

async function exportAccountData(dataClient, user, now = new Date()){
  const userId = String(user && user.id || '');
  const tables = {};
  for(const [table, column] of [...OWN_TABLES, ...RETAINED_TABLES]){
    const r = await dataClient.from(table).select('*').eq(column, userId).limit(5000);
    if(r.error){ if(isMissingTable(r.error)) continue; return { error:r.error }; }
    const rows = (r.data || []).map(row => scrub(row));
    if(!rows.length) continue;
    // Other DJs' private account ids (messages, orders, follows...) become placeholders.
    const safe = rows.map(row => {
      const out = { ...row };
      Object.keys(out).forEach(k => { if(/(^|_)user_id$/.test(k) && out[k] != null) out[k] = String(out[k]) === userId ? 'me' : 'other-dj'; });
      return out;
    });
    tables[table] = (tables[table] || []).concat(safe);
  }
  return {
    file:{
      format:'djb-account-export', version:1, exportedAt:now.toISOString(),
      account:{ id:userId, email:user.email || null, createdAt:user.created_at || null },
      note:'Everything DJ Battle stores for your account. Audio files are not inside this file; download them from your library or results.',
      tables
    }
  };
}

const publicDeletion = row => row ? ({ status:row.status, requestedAt:row.requested_at, scheduledFor:row.scheduled_for, cancelledAt:row.cancelled_at || null, completedAt:row.completed_at || null, graceDays:GRACE_DAYS }) : null;

async function getDeletion(dataClient, userId){
  const r = await dataClient.from(DELETION_TABLE).select('*').eq('user_id', String(userId)).limit(1);
  if(r.error) return isMissingTable(r.error) ? { schemaMissing:true, schema:SCHEMA } : { error:r.error };
  const row = (r.data || [])[0];
  return { row, deletion:row && row.status === 'scheduled' ? publicDeletion(row) : null };
}

async function requestDeletion(dataClient, userId, body = {}, now = new Date()){
  if(String(body.confirm || '').trim().toUpperCase() !== CONFIRM_PHRASE) return { validationError:`Type ${CONFIRM_PHRASE} to confirm` };
  const current = await getDeletion(dataClient, userId);
  if(current.error || current.schemaMissing) return current;
  if(current.deletion) return { duplicate:true, deletion:current.deletion };
  const at = now.toISOString();
  const values = { user_id:String(userId), status:'scheduled', requested_at:at, scheduled_for:new Date(now.getTime() + GRACE_DAYS * 86400000).toISOString(), cancelled_at:null, completed_at:null, updated_at:at };
  const write = current.row ? await dataClient.from(DELETION_TABLE).update(values).eq('user_id', String(userId)) : await dataClient.from(DELETION_TABLE).insert([values]);
  if(write && write.error) return { error:write.error };
  return { created:true, deletion:publicDeletion(values) };
}

async function cancelDeletion(dataClient, userId, now = new Date()){
  const current = await getDeletion(dataClient, userId);
  if(current.error || current.schemaMissing) return current;
  if(!current.deletion) return { notFound:true };
  const at = now.toISOString();
  const up = await dataClient.from(DELETION_TABLE).update({ status:'cancelled', cancelled_at:at, updated_at:at }).eq('user_id', String(userId)).eq('status', 'scheduled');
  if(up && up.error) return { error:up.error };
  return { cancelled:true };
}

async function deleteAccountNow(dataClient, authAdmin, storage, userId){
  const id = String(userId);
  // Private mix audio first, while we still know the file paths.
  const subs = await dataClient.from('mix_submissions').select('*').eq('user_id', id).limit(5000);
  const paths = (subs && !subs.error ? subs.data || [] : []).map(s => s.storage_object_path).filter(Boolean);
  if(paths.length && storage && typeof storage.from === 'function'){
    try{ await storage.from(MIX_BUCKET).remove(paths); }catch(e){ console.warn('mix audio delete failed', e && e.message); }
  }
  const failed = [];
  for(const [table, column] of OWN_TABLES){
    const del = await dataClient.from(table).delete().eq(column, id);
    if(del && del.error && !isMissingTable(del.error)) failed.push(table);
  }
  if(authAdmin && typeof authAdmin.deleteUser === 'function'){
    const r = await authAdmin.deleteUser(id);
    if(r && r.error) failed.push('auth.users');
  }
  return { deleted:failed.length === 0, failed };
}

// Runs on a timer in index.js: deletes every account whose 7 days are up.
async function runDueDeletions(dataClient, authAdmin, storage, now = new Date()){
  const r = await dataClient.from(DELETION_TABLE).select('*').eq('status', 'scheduled').limit(200);
  if(r.error) return isMissingTable(r.error) ? { skipped:true } : { error:r.error };
  const due = (r.data || []).filter(row => new Date(row.scheduled_for).getTime() <= now.getTime());
  let completed = 0;
  for(const row of due){
    const out = await deleteAccountNow(dataClient, authAdmin, storage, row.user_id);
    if(out.deleted){
      completed += 1;
      await dataClient.from(DELETION_TABLE).update({ status:'completed', completed_at:now.toISOString(), updated_at:now.toISOString() }).eq('user_id', row.user_id);
    }else console.warn('account deletion incomplete', row.user_id, out.failed);
  }
  return { due:due.length, completed };
}

module.exports = { DELETION_TABLE, SCHEMA, GRACE_DAYS, CONFIRM_PHRASE, OWN_TABLES, RETAINED_TABLES, scrub, exportAccountData, getDeletion, requestDeletion, cancelDeletion, deleteAccountNow, runDueDeletions };

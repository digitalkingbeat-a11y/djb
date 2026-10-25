// Oct 19b: Activity-bell notifications for tournaments, battle chat and timed comments.
// Reuses the existing dj_notifications table (category 'battle') and the dj_notification_mutes
// table: turning a type off in Settings is just a mute row for that notification type.
const crypto = require('crypto');
const { cleanText, profilesFor, isMissingTable } = require('./social_helpers');
const { firePush } = require('./push_hook');

const NOTIFICATIONS_TABLE = 'dj_notifications';
const MUTES_TABLE = 'dj_notification_mutes';
const SOCIAL_NOTIFICATION_TYPES = Object.freeze(['tournament_match_ready', 'battle_chat_message', 'timed_comment_received', 'direct_message', 'result_review_decided', 'invite_joined', 'remix_contest_won', 'remix_store_offer']);
const SOCIAL_NOTIFICATION_LABELS = Object.freeze({
  tournament_match_ready:'Tournament match is ready',
  battle_chat_message:'New battle chat message',
  timed_comment_received:'Someone commented on your mix',
  direct_message:'New direct message',
  result_review_decided:'A judge finished reviewing your result',
  invite_joined:'A friend joined from your invite',
  remix_contest_won:'Your remix won a contest',
  remix_store_offer:'A host wants to sell your winning remix'
});

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const muteIdFor = (userId, type) => `mute-social-${hash({ userId:String(userId), type }).slice(0, 24)}`;

async function activeMutes(dataClient, userId){
  const result = await dataClient.from(MUTES_TABLE).select('*').eq('user_id', String(userId)).limit(500);
  if(result.error) return isMissingTable(result.error) ? [] : { error:result.error };
  return (result.data || []).filter(row => row.active !== false && row.muted !== false);
}

function typeMuted(mutes, type, actorUserId){
  return mutes.some(row => {
    const category = row.category || 'challenge';
    if(category !== 'all' && category !== 'battle') return false;
    if(row.notification_type && row.notification_type !== type) return false;
    if(row.muted_user_id && String(row.muted_user_id) !== String(actorUserId || '')) return false;
    return true;
  });
}

// input: { recipientUserId, actorUserId, type, subjectId, eventKey, destination, summary, now }
async function emitSocialNotification(dataClient, input = {}){
  try{
    const recipient = String(input.recipientUserId || '');
    const actor = input.actorUserId ? String(input.actorUserId) : null;
    const type = input.type;
    if(!recipient || !SOCIAL_NOTIFICATION_TYPES.includes(type)) return { skipped:true };
    if(actor && actor === recipient) return { skipped:true };
    const mutes = await activeMutes(dataClient, recipient);
    if(mutes.error) return mutes;
    if(typeMuted(mutes, type, actor)) return { skipped:true, muted:true };
    const eventKey = hash({ recipient, type, key:input.eventKey || input.subjectId });
    const existing = await dataClient.from(NOTIFICATIONS_TABLE).select('*').eq('user_id', recipient).eq('event_key', eventKey).limit(1);
    if(existing.error) return isMissingTable(existing.error) ? { skipped:true } : { error:existing.error };
    if(existing.data && existing.data[0]) return { duplicate:true };
    const profiles = actor ? await profilesFor(dataClient, [actor]) : new Map();
    const actorProfile = actor ? profiles.get(actor) || { displayName:'DJ' } : {};
    const at = (input.now || new Date()).toISOString();
    const row = {
      id:`notification-${eventKey.slice(0, 24)}`,
      user_id:recipient,
      type,
      category:'battle',
      subject_type:type.split('_')[0],
      subject_id:String(input.subjectId || eventKey.slice(0, 24)),
      event_key:eventKey,
      event_version:1,
      actor_user_id:actor,
      actor_public_profile_id:actorProfile.publicProfileId || null,
      actor_profile:actor ? { displayName:actorProfile.displayName, publicProfileId:actorProfile.publicProfileId } : {},
      challenge_snapshot:{},
      destination:input.destination || {},
      summary:cleanText(input.summary, 180) || SOCIAL_NOTIFICATION_LABELS[type],
      status:'delivered', read_at:null, archived_at:null, created_at:at, updated_at:at
    };
    const inserted = await dataClient.from(NOTIFICATIONS_TABLE).insert([row]);
    if(inserted && inserted.error) return isMissingTable(inserted.error) ? { skipped:true } : { error:inserted.error };
    await firePush(dataClient, row);
    return { created:true, notification:row };
  }catch(error){
    return { error };
  }
}

// Notifications are a side effect: never let a notification failure break the main action.
async function notifyQuietly(dataClient, input){
  const out = await emitSocialNotification(dataClient, input);
  if(out && out.error) console.warn('social notification skipped', out.error && out.error.message || out.error);
  return out;
}

async function getSocialNotificationPrefs(dataClient, userId){
  const mutes = await activeMutes(dataClient, userId);
  if(mutes.error) return mutes;
  const prefs = {};
  SOCIAL_NOTIFICATION_TYPES.forEach(type => {
    prefs[type] = !mutes.some(row => !row.muted_user_id && !row.muted_public_profile_id && (row.category === 'battle' || row.category === 'all') && (!row.notification_type || row.notification_type === type));
  });
  return { prefs, labels:SOCIAL_NOTIFICATION_LABELS };
}

async function setSocialNotificationPref(dataClient, userId, type, enabled, now = new Date()){
  if(!SOCIAL_NOTIFICATION_TYPES.includes(type)) return { validationError:'Pick a notification type' };
  const id = muteIdFor(userId, type);
  const found = await dataClient.from(MUTES_TABLE).select('*').eq('id', id).limit(1);
  if(found.error) return isMissingTable(found.error) ? { schemaMissing:true, schema:'018_create_challenge_notifications_blocks_mutes' } : { error:found.error };
  const at = now.toISOString();
  if(enabled){
    // Also switch off any other plain (not per-DJ) mute of this type the DJ made earlier.
    const all = await activeMutes(dataClient, userId);
    if(all.error) return all;
    for(const row of all.filter(r => !r.muted_user_id && !r.muted_public_profile_id && r.category === 'battle' && r.notification_type === type)){
      const up = await dataClient.from(MUTES_TABLE).update({ active:false, muted:false, updated_at:at }).eq('id', row.id).eq('user_id', String(userId));
      if(up.error) return { error:up.error };
    }
  }else if((found.data || [])[0]){
    const up = await dataClient.from(MUTES_TABLE).update({ active:true, muted:true, updated_at:at }).eq('id', id).eq('user_id', String(userId));
    if(up.error) return { error:up.error };
  }else{
    const ins = await dataClient.from(MUTES_TABLE).insert([{ id, user_id:String(userId), muted_user_id:null, muted_public_profile_id:null, category:'battle', notification_type:type, muted:true, active:true, created_at:at, updated_at:at }]);
    if(ins && ins.error) return { error:ins.error };
  }
  return getSocialNotificationPrefs(dataClient, userId);
}

module.exports = { SOCIAL_NOTIFICATION_TYPES, SOCIAL_NOTIFICATION_LABELS, emitSocialNotification, notifyQuietly, getSocialNotificationPrefs, setSocialNotificationPref };

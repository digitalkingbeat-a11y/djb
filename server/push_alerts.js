// Oct 20: phone lock-screen alerts (Web Push). A DJ turns alerts on in Settings; the browser
// gives us a push "subscription" (an address on Apple/Google/Mozilla's push service plus two
// public encryption keys). We store it per device with the alert types that device wants.
// Sending needs VAPID keys, which Dan sets as server env vars (never committed):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com)
const crypto = require('crypto');
const { cleanText, isMissingTable } = require('./social_helpers');

const TABLE = 'push_subscriptions';
const SCHEMA = '040_create_push_subscriptions';
// Reuses the Oct 19b Activity-bell types, plus incoming/accepted challenges.
const PUSH_TYPES = Object.freeze(['tournament_match_ready', 'battle_chat_message', 'timed_comment_received', 'direct_message', 'challenge_received', 'wishlist_alert']);
const PUSH_LABELS = Object.freeze({
  tournament_match_ready:'Tournament match is ready',
  battle_chat_message:'New battle chat message',
  timed_comment_received:'Someone commented on your mix',
  direct_message:'New direct message',
  challenge_received:'New challenge (or your challenge was accepted)',
  wishlist_alert:'Price drops and codes on beats you saved'
});
const MAX_DEVICES = 10;

function pushTypeFor(notificationType){
  if(notificationType === 'challenge_received' || notificationType === 'challenge_accepted') return 'challenge_received';
  return PUSH_TYPES.includes(notificationType) ? notificationType : null;
}

function vapidConfig(env = process.env){
  const publicKey = String(env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(env.VAPID_PRIVATE_KEY || '').trim();
  const subject = String(env.VAPID_SUBJECT || '').trim() || (env.EMAIL_FROM ? `mailto:${String(env.EMAIL_FROM).replace(/^.*<|>.*$/g, '')}` : '');
  const ok = /^[A-Za-z0-9_-]{80,100}$/.test(publicKey) && /^[A-Za-z0-9_-]{40,50}$/.test(privateKey) && /^(mailto:|https:\/\/)/.test(subject);
  return { configured:ok, publicKey:ok ? publicKey : null, privateKey:ok ? privateKey : null, subject:ok ? subject : null };
}
// What the browser is allowed to know: only the PUBLIC key.
function publicStatus(env = process.env){
  const c = vapidConfig(env);
  return { configured:c.configured, publicKey:c.publicKey, types:PUSH_TYPES, labels:PUSH_LABELS };
}

function cleanSubscription(input){
  const sub = input && typeof input === 'object' ? input : {};
  const endpoint = String(sub.endpoint || '').trim();
  const keys = sub.keys && typeof sub.keys === 'object' ? sub.keys : {};
  const p256dh = String(keys.p256dh || '').trim();
  const auth = String(keys.auth || '').trim();
  if(!/^https:\/\/[^\s]{10,1000}$/.test(endpoint) || endpoint.length > 1000) return null;
  if(!/^[A-Za-z0-9_=-]{40,200}$/.test(p256dh) || !/^[A-Za-z0-9_=-]{10,60}$/.test(auth)) return null;
  return { endpoint, p256dh, auth };
}
function cleanTypes(types){
  if(!Array.isArray(types)) return PUSH_TYPES.slice();
  return PUSH_TYPES.filter(t => types.includes(t));
}
const idFor = endpoint => `push_${crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 32)}`;
const publicRow = row => ({ id:row.id, types:cleanTypes(row.types), deviceLabel:row.device_label || 'This device', createdAt:row.created_at, lastSentAt:row.last_sent_at || null });

async function saveSubscription(dataClient, userId, body = {}, now = new Date()){
  const sub = cleanSubscription(body.subscription);
  if(!sub) return { validationError:'That browser did not give a valid push subscription' };
  const id = idFor(sub.endpoint);
  const at = now.toISOString();
  const existing = await dataClient.from(TABLE).select('*').eq('id', id).limit(1);
  if(existing.error) return isMissingTable(existing.error) ? { schemaMissing:true, schema:SCHEMA } : { error:existing.error };
  const row = existing.data && existing.data[0];
  const values = { user_id:String(userId), endpoint:sub.endpoint, p256dh:sub.p256dh, auth:sub.auth, types:cleanTypes(body.types), device_label:cleanText(body.deviceLabel, 60) || 'This device', active:true, updated_at:at };
  if(row){
    const up = await dataClient.from(TABLE).update(values).eq('id', id);
    if(up.error) return { error:up.error };
    return { subscription:publicRow({ ...row, ...values }) };
  }
  const mine = await dataClient.from(TABLE).select('*').eq('user_id', String(userId)).limit(100);
  if(mine.error) return { error:mine.error };
  if((mine.data || []).filter(r => r.active !== false).length >= MAX_DEVICES) return { validationError:`Alerts are already on for ${MAX_DEVICES} devices. Turn one off first.` };
  const ins = await dataClient.from(TABLE).insert([{ id, ...values, created_at:at, last_sent_at:null }]);
  if(ins && ins.error) return { error:ins.error };
  return { created:true, subscription:publicRow({ id, ...values, created_at:at }) };
}

async function removeSubscription(dataClient, userId, endpoint){
  const id = idFor(String(endpoint || ''));
  const del = await dataClient.from(TABLE).delete().eq('id', id).eq('user_id', String(userId));
  if(del && del.error) return isMissingTable(del.error) ? { schemaMissing:true, schema:SCHEMA } : { error:del.error };
  return { removed:true };
}

async function listSubscriptions(dataClient, userId){
  const r = await dataClient.from(TABLE).select('*').eq('user_id', String(userId)).limit(100);
  if(r.error) return isMissingTable(r.error) ? { schemaMissing:true, schema:SCHEMA } : { error:r.error };
  return { subscriptions:(r.data || []).filter(x => x.active !== false).map(publicRow) };
}

// Short, private-by-default lock-screen text: no message bodies on the lock screen.
function payloadFor(row){
  const type = pushTypeFor(row.type);
  const actor = row.actor_profile && row.actor_profile.displayName ? cleanText(row.actor_profile.displayName, 40) : '';
  const titles = {
    tournament_match_ready:'Your tournament match is ready',
    battle_chat_message:actor ? `${actor} sent a battle chat message` : 'New battle chat message',
    timed_comment_received:actor ? `${actor} commented on your mix` : 'New comment on your mix',
    direct_message:actor ? `New message from ${actor}` : 'New direct message',
    challenge_received:row.type === 'challenge_accepted' ? 'Your challenge was accepted' : actor ? `${actor} challenged you` : 'You have a new challenge',
    wishlist_alert:'A beat you saved just got cheaper'
  };
  const dest = row.destination || {};
  const view = dest.type === 'messages' ? 'messages' : dest.type === 'tournament' ? 'tournaments' : dest.type === 'store' ? 'store' : type === 'challenge_received' ? 'notifications' : 'activity';
  return { title:titles[type] || 'DJ Battle', body:type === 'wishlist_alert' && row.summary ? cleanText(row.summary, 140) : 'Tap to open DJ Battle', tag:`djb-${type}`, url:`./#${view}`, type };
}

// sender(subscription, payloadString) → Promise; defaults to the web-push library.
function createPushSender(env = process.env, webpush = null){
  const cfg = vapidConfig(env);
  if(!cfg.configured) return null;
  const lib = webpush || require('web-push');
  lib.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  return (sub, payload) => lib.sendNotification({ endpoint:sub.endpoint, keys:{ p256dh:sub.p256dh, auth:sub.auth } }, payload, { TTL:3600 });
}

async function deliverPush(dataClient, notificationRow, sender, now = new Date()){
  const type = pushTypeFor(notificationRow && notificationRow.type);
  if(!sender || !type || !notificationRow.user_id) return { skipped:true };
  const r = await dataClient.from(TABLE).select('*').eq('user_id', String(notificationRow.user_id)).limit(100);
  if(r.error) return isMissingTable(r.error) ? { skipped:true } : { error:r.error };
  const targets = (r.data || []).filter(s => s.active !== false && cleanTypes(s.types).includes(type));
  const payload = JSON.stringify(payloadFor(notificationRow));
  let sent = 0;
  for(const sub of targets){
    try{
      await sender(sub, payload);
      sent += 1;
      await dataClient.from(TABLE).update({ last_sent_at:now.toISOString() }).eq('id', sub.id);
    }catch(error){
      // 404/410 means the DJ uninstalled the app or revoked permission: forget that device.
      if(error && (error.statusCode === 404 || error.statusCode === 410)) await dataClient.from(TABLE).delete().eq('id', sub.id);
    }
  }
  return { sent, devices:targets.length };
}

module.exports = { TABLE, SCHEMA, PUSH_TYPES, PUSH_LABELS, pushTypeFor, vapidConfig, publicStatus, cleanSubscription, saveSubscription, removeSubscription, listSubscriptions, payloadFor, createPushSender, deliverPush };

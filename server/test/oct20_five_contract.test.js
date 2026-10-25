const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const Push = require('../push_alerts');
const { setPushHook } = require('../push_hook');
const Social = require('../social_notifications');
const Reviews = require('../result_reviews');
const Account = require('../account_data');
const { resetRateLimits } = require('../social_helpers');

const root = path.join(__dirname, '..');
const sql = name => fs.readFileSync(path.join(root, 'sql', name), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
function dataClient(initial = {}){
  const db = Object.fromEntries(Object.entries(initial).map(([t, rows]) => [t, rows.map(r => ({ ...r }))]));
  return { db, from(table){ if(!db[table]) db[table] = []; return new Query(db, table); } };
}
class Query{
  constructor(db, table){ Object.assign(this, { db, table, filters:[], inFilters:[], limitValue:null, insertRows:null, updateValues:null, orderBy:null, del:false }); }
  select(){ return this; }
  eq(f, v){ this.filters.push([f, v]); return this; }
  in(f, vs){ this.inFilters.push([f, vs.map(String)]); return this; }
  order(f, o){ this.orderBy = [f, o && o.ascending]; return this; }
  limit(v){ this.limitValue = v; return this; }
  insert(rows){ this.insertRows = rows.map(r => ({ ...r })); return this; }
  update(v){ this.updateValues = { ...v }; return this; }
  delete(){ this.del = true; return this; }
  then(res, rej){ return this.exec().then(res, rej); }
  async single(){ const r = await this.exec(); return r.error ? r : { data:(r.data || [])[0] || null, error:null }; }
  async exec(){
    const t = this.db[this.table];
    if(this.insertRows){ t.push(...this.insertRows); return { data:this.insertRows, error:null }; }
    let rows = t.filter(r => this.filters.every(([f, v]) => String(r[f]) === String(v))).filter(r => this.inFilters.every(([f, vs]) => vs.includes(String(r[f]))));
    if(this.del){ this.db[this.table] = t.filter(r => !rows.includes(r)); return { data:rows, error:null }; }
    if(this.updateValues){ rows.forEach(r => Object.assign(r, this.updateValues)); return { data:rows, error:null }; }
    if(this.orderBy){ const [f, asc] = this.orderBy; rows = rows.slice().sort((a, b) => (new Date(a[f]) - new Date(b[f])) * (asc ? 1 : -1)); }
    if(this.limitValue != null) rows = rows.slice(0, this.limitValue);
    return { data:rows, error:null };
  }
}
const VAPID = { VAPID_PUBLIC_KEY:'B'.repeat(87), VAPID_PRIVATE_KEY:'p'.repeat(43), VAPID_SUBJECT:'mailto:dan@example.com' };
const sub = (n = 1) => ({ endpoint:`https://fcm.googleapis.com/fcm/send/device-${n}-abcdef`, keys:{ p256dh:'K'.repeat(87), auth:'a'.repeat(22) } });
const judge = score => ({ overallScore:score, components:{ timing:score }, breakdown:{ timing:{ available:true, score } }, timing:[], rawMeasurements:[], measurableAnalysis:{ bpm:124 }, confidence:{ measurableComponentRatio:0.8, trainedModelJudging:{ used:false } }, recommendations:[] });
const submission = (id, user, score) => ({ id, user_id:user, battle_entry_id:`e-${id}`, status:'completed', judge_result:judge(score), processing_info:{}, storage_object_path:`private/battle-entries/e-${id}/submissions/${id}`, created_at:'2026-10-18T10:00:00Z' });

describe('Oct 20: lock-screen alerts (web push)', () => {
  afterEach(() => setPushHook(null));
  it('only reports configured with well-formed VAPID keys, and never exposes the private key', () => {
    expect(Push.vapidConfig({}).configured).to.equal(false);
    expect(Push.publicStatus({}).publicKey).to.equal(null);
    const s = Push.publicStatus(VAPID);
    expect(s.configured).to.equal(true);
    expect(s.publicKey).to.equal(VAPID.VAPID_PUBLIC_KEY);
    expect(JSON.stringify(s)).to.not.include(VAPID.VAPID_PRIVATE_KEY);
    expect(s.types).to.include.members(['tournament_match_ready', 'battle_chat_message', 'timed_comment_received', 'direct_message', 'challenge_received']);
  });
  it('saves a device with chosen types, rejects junk, and updates instead of duplicating', async () => {
    const db = dataClient({ push_subscriptions:[] });
    expect((await Push.saveSubscription(db, 'u1', { subscription:{ endpoint:'http://evil' } })).validationError).to.match(/valid/);
    const first = await Push.saveSubscription(db, 'u1', { subscription:sub(), types:['direct_message', 'nope'] });
    expect(first.created).to.equal(true);
    expect(first.subscription.types).to.deep.equal(['direct_message']);
    expect(JSON.stringify(first.subscription)).to.not.match(/p256dh|endpoint/);
    await Push.saveSubscription(db, 'u1', { subscription:sub(), types:['tournament_match_ready'] });
    expect(db.db.push_subscriptions).to.have.length(1);
    expect(db.db.push_subscriptions[0].types).to.deep.equal(['tournament_match_ready']);
    expect((await Push.listSubscriptions(db, 'u1')).subscriptions).to.have.length(1);
    await Push.removeSubscription(db, 'u1', sub().endpoint);
    expect(db.db.push_subscriptions).to.have.length(0);
  });
  it('a new Activity-bell notification buzzes only devices that chose that type, and forgets dead devices', async () => {
    const db = dataClient({ push_subscriptions:[], dj_notifications:[], dj_notification_mutes:[], dj_progression_profiles:[{ user_id:'a', public_profile_id:'dj_a', display_name:'Ace' }] });
    await Push.saveSubscription(db, 'b', { subscription:sub(1), types:['direct_message'] });
    await Push.saveSubscription(db, 'b', { subscription:sub(2), types:['tournament_match_ready'] });
    await Push.saveSubscription(db, 'b', { subscription:sub(3), types:['direct_message'] });
    const sent = [];
    const sender = async (s, payload) => { if(s.endpoint.includes('device-3')){ const e = new Error('gone'); e.statusCode = 410; throw e; } sent.push([s.endpoint, JSON.parse(payload)]); };
    setPushHook((client, row) => Push.deliverPush(client, row, sender));
    await Social.emitSocialNotification(db, { recipientUserId:'b', actorUserId:'a', type:'direct_message', subjectId:'m1', destination:{ type:'messages', publicProfileId:'dj_a' }, summary:'secret text here' });
    expect(sent).to.have.length(1);
    expect(sent[0][0]).to.include('device-1');
    expect(sent[0][1]).to.include({ title:'New message from Ace', url:'./#messages' });
    expect(JSON.stringify(sent[0][1])).to.not.include('secret text');
    expect(db.db.push_subscriptions.map(r => r.endpoint).some(e => e.includes('device-3'))).to.equal(false);
  });
  it('a muted notification type sends no push either', async () => {
    const db = dataClient({ push_subscriptions:[], dj_notifications:[], dj_notification_mutes:[], dj_progression_profiles:[] });
    await Push.saveSubscription(db, 'b', { subscription:sub(), types:Push.PUSH_TYPES });
    await Social.setSocialNotificationPref(db, 'b', 'battle_chat_message', false);
    let calls = 0;
    setPushHook((client, row) => Push.deliverPush(client, row, async () => { calls += 1; }));
    await Social.emitSocialNotification(db, { recipientUserId:'b', actorUserId:'a', type:'battle_chat_message', subjectId:'c1' });
    expect(calls).to.equal(0);
  });
  it('challenge notifications map to the challenge alert', () => {
    expect(Push.pushTypeFor('challenge_accepted')).to.equal('challenge_received');
    expect(Push.pushTypeFor('follow_started')).to.equal(null);
    expect(Push.payloadFor({ type:'challenge_received', actor_profile:{ displayName:'Bee' } }).title).to.equal('Bee challenged you');
  });
  it('SQL 040, routes and docs exist, and no VAPID key is committed', () => {
    expect(sql('040_create_push_subscriptions.sql')).to.match(/CREATE TABLE IF NOT EXISTS public\.push_subscriptions/);
    expect(serverSource).to.include("app.get('/api/push/config'");
    expect(serverSource).to.include("app.post('/api/push/subscriptions', requireAuth");
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    expect(readme).to.match(/Oct 20/);
    expect(readme).to.include('npx web-push generate-vapid-keys');
    const all = ['index.js', 'push_alerts.js', 'README.md'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
    expect(all).to.not.match(/VAPID_PRIVATE_KEY\s*=\s*[A-Za-z0-9_-]{40}/);
  });
});

describe('Oct 20: request a review of a judged result', () => {
  beforeEach(() => resetRateLimits());
  const base = () => dataClient({ mix_submissions:[submission('s1', 'a', 64), submission('s2', 'b', 80)], result_review_requests:[], dj_notifications:[], dj_notification_mutes:[], dj_progression_profiles:[] });
  it('a DJ can request one open review of their own result, with a reason', async () => {
    const db = base();
    expect((await Reviews.requestReview(db, 'a', 's1', { reason:'bogus' })).validationError).to.match(/reason/);
    expect((await Reviews.requestReview(db, 'a', 's1', { reason:'other', note:'bad' })).validationError).to.match(/10 characters/);
    expect((await Reviews.requestReview(db, 'a', 's2', { reason:'timing_misread' })).forbidden).to.equal(true);
    const r = await Reviews.requestReview(db, 'a', 's1', { reason:'timing_misread', note:'Transition at 1:42 is on beat' });
    expect(r.created).to.equal(true);
    expect(r.review).to.include({ status:'pending', originalScore:64, reason:'timing_misread' });
    expect(JSON.stringify(r.review)).to.not.match(/"a"|user_id/);
    expect((await Reviews.requestReview(db, 'a', 's1', { reason:'audio_problem' })).duplicate).to.equal(true);
  });
  it('operators see the queue and can confirm or rescore; the DJ is notified and the result records it', async () => {
    const db = base();
    const { review } = await Reviews.requestReview(db, 'a', 's1', { reason:'scoring_rule' });
    const q = await Reviews.listReviewQueue(db);
    expect(q.reviews).to.have.length(1);
    expect((await Reviews.decideReview(db, 'op', review.id, { decision:'rescore', newScore:140 })).validationError).to.match(/0 and 100/);
    const d = await Reviews.decideReview(db, 'op', review.id, { decision:'rescore', newScore:71, note:'Analyzer missed a transition' });
    expect(d.review).to.include({ status:'decided', newScore:71, originalScore:64 });
    expect((await Reviews.decideReview(db, 'op', review.id, { decision:'confirm' })).validationError).to.match(/already/);
    expect((await Reviews.listReviewQueue(db)).reviews).to.have.length(0);
    expect(db.db.mix_submissions[0].processing_info.resultReview).to.include({ outcome:'rescored', newScore:71 });
    const n = db.db.dj_notifications.find(x => x.user_id === 'a');
    expect(n.type).to.equal('result_review_decided');
    expect(n.summary).to.include('71/100');
    const mine = await Reviews.listMyReviews(db, 'a');
    expect(mine.reviews[0].status).to.equal('decided');
  });
  it('a result can be reviewed at most twice', async () => {
    const db = base();
    for(let i = 0; i < 2; i += 1){
      const { review } = await Reviews.requestReview(db, 'a', 's1', { reason:'timing_misread' });
      await Reviews.decideReview(db, 'op', review.id, { decision:'confirm' });
    }
    expect((await Reviews.requestReview(db, 'a', 's1', { reason:'timing_misread' })).validationError).to.match(/twice/);
  });
  it('SQL 041 and operator-only routes exist', () => {
    const s = sql('041_create_result_review_requests.sql');
    expect(s).to.match(/result_review_requests/);
    expect(s).to.include("'result_review_decided'");
    expect(serverSource).to.include("app.get('/api/operations/resultReviews', requireAuth, requireOperatorUser");
    expect(serverSource).to.include("app.post('/api/operations/resultReviews/:reviewId/decision', requireAuth, requireOperatorUser");
  });
});

describe('Oct 20: download my data and delete my account', () => {
  const base = () => dataClient({
    dj_progression_profiles:[{ user_id:'a', display_name:'Ace' }, { user_id:'b', display_name:'Bee' }],
    mix_submissions:[submission('s1', 'a', 64), submission('s2', 'b', 80)],
    direct_messages:[{ id:'m1', sender_user_id:'a', recipient_user_id:'b', body:'yo' }],
    push_subscriptions:[{ id:'p1', user_id:'a', endpoint:'https://x', p256dh:'k', auth:'s' }],
    marketplace_orders:[{ id:'o1', buyer_user_id:'a', seller_user_id:'b', stripe_payment_intent_id:'pi_123' }],
    account_deletion_requests:[]
  });
  it('exports one file with my data, no secrets and no other DJ ids', async () => {
    const db = base();
    const { file } = await Account.exportAccountData(db, { id:'a', email:'a@example.com' }, new Date('2026-10-20T12:00:00Z'));
    expect(file.format).to.equal('djb-account-export');
    expect(file.tables.mix_submissions).to.have.length(1);
    expect(file.tables.direct_messages[0]).to.include({ sender_user_id:'me', recipient_user_id:'other-dj' });
    const text = JSON.stringify(file);
    expect(text).to.not.match(/"b"|p256dh|pi_123|"endpoint"/);
    expect(file.tables.marketplace_orders).to.have.length(1);
  });
  it('needs the typed phrase, schedules 7 days out, and can be cancelled', async () => {
    const db = base();
    const now = new Date('2026-10-20T12:00:00Z');
    expect((await Account.requestDeletion(db, 'a', { confirm:'delete' }, now)).validationError).to.include('DELETE MY ACCOUNT');
    const r = await Account.requestDeletion(db, 'a', { confirm:'delete my account' }, now);
    expect(r.deletion.scheduledFor).to.equal('2026-10-27T12:00:00.000Z');
    expect((await Account.requestDeletion(db, 'a', { confirm:'DELETE MY ACCOUNT' }, now)).duplicate).to.equal(true);
    expect((await Account.cancelDeletion(db, 'a', now)).cancelled).to.equal(true);
    expect((await Account.getDeletion(db, 'a')).deletion).to.equal(null);
    const due = await Account.runDueDeletions(db, null, null, new Date('2026-11-01T00:00:00Z'));
    expect(due.due).to.equal(0);
    expect(db.db.mix_submissions).to.have.length(2);
  });
  it('after the grace period the server deletes the account, its files and its rows, keeping sales records', async () => {
    const db = base();
    await Account.requestDeletion(db, 'a', { confirm:'DELETE MY ACCOUNT' }, new Date('2026-10-20T12:00:00Z'));
    expect((await Account.runDueDeletions(db, null, null, new Date('2026-10-26T12:00:00Z'))).due).to.equal(0);
    const removedFiles = []; const deletedUsers = [];
    const storage = { from:bucket => ({ remove:async paths => { removedFiles.push(bucket, ...paths); return {}; } }) };
    const authAdmin = { deleteUser:async id => { deletedUsers.push(id); return {}; } };
    const out = await Account.runDueDeletions(db, authAdmin, storage, new Date('2026-10-27T12:00:01Z'));
    expect(out.completed).to.equal(1);
    expect(deletedUsers).to.deep.equal(['a']);
    expect(removedFiles).to.include('battle-mixes');
    expect(db.db.mix_submissions.map(r => r.user_id)).to.deep.equal(['b']);
    expect(db.db.dj_progression_profiles.map(r => r.user_id)).to.deep.equal(['b']);
    expect(db.db.direct_messages).to.have.length(0);
    expect(db.db.push_subscriptions).to.have.length(0);
    expect(db.db.marketplace_orders).to.have.length(1);
    expect(db.db.account_deletion_requests[0].status).to.equal('completed');
  });
  it('SQL 042 and routes exist; deletion runs server-side with the service client', () => {
    expect(sql('042_create_account_deletion_requests.sql')).to.match(/account_deletion_requests/);
    expect(serverSource).to.include("app.get('/api/account/export', requireAuth");
    expect(serverSource).to.include("app.post('/api/account/deletion', requireAuth");
    expect(serverSource).to.include("app.delete('/api/account/deletion', requireAuth");
    expect(serverSource).to.match(/runDueDeletions\(supabaseService, supabaseService\.auth/);
  });
});

const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  acceptDjChallenge,
  cancelDjChallenge,
  countOwnedNotifications,
  createDjBlock,
  createNotificationMute,
  countOwnedDjChallenges,
  declineDjChallenge,
  getChallengeInteractionEligibility,
  listOwnedDjChallenges,
  listOwnedNotifications,
  markOwnedNotificationRead,
  sendDjChallenge
} = require('../dj_challenges');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'sql', '017_create_dj_challenges.sql'), 'utf8');
const notificationSql = fs.readFileSync(path.join(root, 'sql', '018_create_challenge_notifications_blocks_mutes.sql'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

describe('server-backed DJ challenges', () => {
  it('creates a public-profile challenge idempotently and blocks duplicate active challenges', async () => {
    const client = dataClient(seedData());
    const body = challengeBody();

    const first = await sendDjChallenge(client, 'dj-1', body, new Date('2026-08-27T12:00:00.000Z'));
    const retry = await sendDjChallenge(client, 'dj-1', body, new Date('2026-08-27T12:00:01.000Z'));
    const duplicateRules = await sendDjChallenge(client, 'dj-1', { ...body, idempotencyKey:'different-key' }, new Date('2026-08-27T12:00:02.000Z'));

    expect(first.created).to.equal(true);
    expect(retry.duplicate).to.equal(true);
    expect(duplicateRules.conflict).to.equal(true);
    expect(client.db.dj_challenges).to.have.length(1);
    expect(first.challenge.recipient.displayName).to.equal('Recipient DJ');
    expect(first.challenge.rules.reward.type).to.equal('xp');
    expect(JSON.stringify(first.challenge)).to.not.match(/dj-2|crate-b|track-3|private\/|storage_object_path|secret/i);
  });

  it('denies self, private recipient and blocked challenges before storing a row', async () => {
    const client = dataClient(seedData());
    const self = await sendDjChallenge(client, 'dj-1', { ...challengeBody(), recipientPublicProfileId:'dj_challenger' });
    const privateRecipient = await sendDjChallenge(client, 'dj-1', { ...challengeBody(), recipientPublicProfileId:'dj_private' });
    const blocked = await sendDjChallenge(client, 'dj-1', challengeBody(), new Date('2026-08-27T12:00:00.000Z'), {
      blockedPairs:[{ from:'dj-2', to:'dj-1' }]
    });

    expect(self.conflict).to.equal(true);
    expect(privateRecipient.private).to.equal(true);
    expect(blocked.forbidden).to.equal(true);
    expect(client.db.dj_challenges).to.have.length(0);
  });

  it('lists and counts a private inbox with pagination, filters and expiration recovery', async () => {
    const client = dataClient(seedData());
    await sendDjChallenge(client, 'dj-1', challengeBody({ idempotencyKey:'fresh', challengeId:'challenge-fresh' }), new Date('2026-08-27T12:00:00.000Z'));
    await sendDjChallenge(client, 'dj-3', challengeBody({ challengerCrateId:'crate-c', idempotencyKey:'old', challengeId:'challenge-old' }), new Date('2026-08-20T12:00:00.000Z'));

    const listed = await listOwnedDjChallenges(client, 'dj-2', { direction:'received', status:'all', limit:1 }, new Date('2026-08-27T13:00:00.000Z'));
    const counts = await countOwnedDjChallenges(client, 'dj-2', new Date('2026-08-27T13:00:00.000Z'));

    expect(listed.challenges).to.have.length(1);
    expect(listed.pagination.total).to.equal(2);
    expect(listed.pagination.hasMore).to.equal(true);
    expect(counts.pendingReceived).to.equal(1);
    expect(client.db.dj_challenges.find(row => row.id === 'challenge-old').status).to.equal('expired');
    expect(JSON.stringify(listed.challenges)).to.not.match(/crate-|track-|private\/|user_id/i);
  });

  it('accepts a challenge into one battle with two immutable private snapshots and returns a room', async () => {
    const client = dataClient(seedData());
    const created = await sendDjChallenge(client, 'dj-1', challengeBody({ challengeId:'challenge-accept' }), new Date('2026-08-27T12:00:00.000Z'));
    const accepted = await acceptDjChallenge(client, 'dj-2', created.challenge.id, { recipientCrateId:'crate-b' }, new Date('2026-08-27T12:05:00.000Z'));
    const retry = await acceptDjChallenge(client, 'dj-2', created.challenge.id, { recipientCrateId:'crate-b' }, new Date('2026-08-27T12:06:00.000Z'));

    expect(accepted.accepted).to.equal(true);
    expect(retry.duplicate).to.equal(true);
    expect(client.db.battle_records).to.have.length(1);
    expect(client.db.battle_entries).to.have.length(2);
    expect(client.db.battle_prep_entry_snapshots).to.have.length(2);
    expect(client.db.dj_challenges[0].status).to.equal('converted-to-battle');
    expect(accepted.room.battle.id).to.equal(accepted.battle.id);
    expect(accepted.room.snapshot.userId).to.equal('dj-2');
    expect(accepted.room.participants).to.have.length(2);
    expect(JSON.stringify(accepted.room.participants)).to.not.match(/crate-a|crate-b|track-1|track-3|private\/|dj-1|dj-2/i);
  });

  it('requires the recipient own crate during acceptance and keeps challenger prep private', async () => {
    const client = dataClient(seedData());
    const created = await sendDjChallenge(client, 'dj-1', challengeBody({ challengeId:'challenge-deny' }), new Date('2026-08-27T12:00:00.000Z'));
    const denied = await acceptDjChallenge(client, 'dj-2', created.challenge.id, { recipientCrateId:'crate-c' }, new Date('2026-08-27T12:05:00.000Z'));

    expect(denied.forbidden).to.equal(true);
    expect(client.db.dj_challenges[0].status).to.equal('pending');
    expect(client.db.battle_entries.filter(row => row.user_id === 'dj-2')).to.have.length(0);
  });

  it('enforces terminal decline/cancel/accept races with one winning status', async () => {
    const declineClient = dataClient(seedData());
    const created = await sendDjChallenge(declineClient, 'dj-1', challengeBody({ challengeId:'challenge-decline' }), new Date('2026-08-27T12:00:00.000Z'));
    const declined = await declineDjChallenge(declineClient, 'dj-2', created.challenge.id, new Date('2026-08-27T12:02:00.000Z'));
    const acceptedAfterDecline = await acceptDjChallenge(declineClient, 'dj-2', created.challenge.id, { recipientCrateId:'crate-b' });
    expect(declined.declined).to.equal(true);
    expect(acceptedAfterDecline.conflict).to.equal(true);
    expect(declineClient.db.battle_records).to.have.length(0);

    const cancelClient = dataClient(seedData());
    const sent = await sendDjChallenge(cancelClient, 'dj-1', challengeBody({ challengeId:'challenge-cancel' }), new Date('2026-08-27T12:00:00.000Z'));
    const cancelled = await cancelDjChallenge(cancelClient, 'dj-1', sent.challenge.id, new Date('2026-08-27T12:02:00.000Z'));
    const declineAfterCancel = await declineDjChallenge(cancelClient, 'dj-2', sent.challenge.id, new Date('2026-08-27T12:03:00.000Z'));
    expect(cancelled.cancelled).to.equal(true);
    expect(declineAfterCancel.conflict).to.equal(true);
  });

  it('defines protected challenge routes and RLS-ready local migration without wallet custody', () => {
    expect(serverSource).to.include("app.post('/api/challenges', requireAuth");
    expect(serverSource).to.include("app.get('/api/challenges', requireAuth");
    expect(serverSource).to.include("app.get('/api/challenges/count', requireAuth");
    expect(serverSource).to.include("app.post('/api/challenges/:challengeId/accept', requireAuth");
    expect(serverSource).to.include("app.post('/api/challenges/:challengeId/decline', requireAuth");
    expect(serverSource).to.include("app.post('/api/challenges/:challengeId/cancel', requireAuth");
    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.dj_challenges');
    expect(sql).to.include("status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired', 'converted-to-battle')");
    expect(sql).to.include('dj_challenges_active_rules_idx');
    expect(sql).to.include('FOR UPDATE');
    expect(sql).to.include('allow_select_own_dj_challenges');
    expect(sql).to.not.match(/wallet_balances|deposit_address|payout_status|claimable_amount|custody_private_key/i);
    expect(notificationSql).to.include('CREATE TABLE IF NOT EXISTS public.dj_notifications');
    expect(notificationSql).to.include('dj_notifications_owner_event_idx');
    expect(notificationSql).to.include('CREATE TABLE IF NOT EXISTS public.dj_blocks');
    expect(notificationSql).to.include('CREATE TABLE IF NOT EXISTS public.dj_notification_mutes');
    expect(notificationSql).to.include('allow_select_own_dj_notifications');
    expect(notificationSql).to.not.match(/wallet_balances|deposit_address|payout_status|claimable_amount|custody_private_key/i);
  });

  it('creates idempotent private notifications from authoritative challenge events and read state', async () => {
    const client = dataClient(seedData());
    await sendDjChallenge(client, 'dj-1', challengeBody({ challengeId:'challenge-notify' }), new Date('2026-08-27T12:00:00.000Z'));

    const first = await listOwnedNotifications(client, 'dj-2', { filter:'unread' }, new Date('2026-08-27T12:01:00.000Z'));
    const second = await listOwnedNotifications(client, 'dj-2', { filter:'unread' }, new Date('2026-08-27T12:02:00.000Z'));
    const marked = await markOwnedNotificationRead(client, 'dj-2', first.notifications[0].id, true, new Date('2026-08-27T12:03:00.000Z'));
    const counts = await countOwnedNotifications(client, 'dj-2', new Date('2026-08-27T12:04:00.000Z'));

    expect(first.notifications).to.have.length(1);
    expect(second.notifications).to.have.length(1);
    expect(client.db.dj_notifications).to.have.length(1);
    expect(first.notifications[0].type).to.equal('challenge_received');
    expect(first.notifications[0].unread).to.equal(true);
    expect(marked.notification.unread).to.equal(false);
    expect(counts.unreadTotal).to.equal(0);
    expect(JSON.stringify(first.notifications[0])).to.not.match(/dj-1|dj-2|crate-|track-|snapshot|private\/|storage|email/i);
  });

  it('emits one expiration event and disables stale challenge controls after server reconciliation', async () => {
    const client = dataClient(seedData());
    await sendDjChallenge(client, 'dj-1', challengeBody({ challengeId:'challenge-expire', expirationHours:1 }), new Date('2026-08-27T12:00:00.000Z'));

    const inbox = await listOwnedDjChallenges(client, 'dj-2', { direction:'received', status:'all' }, new Date('2026-08-27T14:00:00.000Z'));
    const notifications = await listOwnedNotifications(client, 'dj-2', { filter:'challenges' }, new Date('2026-08-27T14:01:00.000Z'));
    const retryNotifications = await listOwnedNotifications(client, 'dj-2', { filter:'challenges' }, new Date('2026-08-27T14:02:00.000Z'));

    expect(inbox.challenges[0].status).to.equal('expired');
    expect(inbox.challenges[0].eligibility.canAccept).to.equal(false);
    expect(client.db.dj_challenges[0].expires_at).to.equal('2026-08-27T13:00:00.000Z');
    expect(notifications.notifications.filter(row => row.type === 'challenge_expired')).to.have.length(1);
    expect(retryNotifications.notifications.filter(row => row.type === 'challenge_expired')).to.have.length(1);
  });

  it('accepted challenge notifications deep-link to the existing battle room without recreating entries', async () => {
    const client = dataClient(seedData());
    const created = await sendDjChallenge(client, 'dj-1', challengeBody({ challengeId:'challenge-room' }), new Date('2026-08-27T12:00:00.000Z'));
    await acceptDjChallenge(client, 'dj-2', created.challenge.id, { recipientCrateId:'crate-b' }, new Date('2026-08-27T12:05:00.000Z'));

    const challengerNotifications = await listOwnedNotifications(client, 'dj-1', { filter:'battles' }, new Date('2026-08-27T12:06:00.000Z'));
    const retry = await acceptDjChallenge(client, 'dj-2', created.challenge.id, { recipientCrateId:'crate-b' }, new Date('2026-08-27T12:07:00.000Z'));

    expect(challengerNotifications.notifications).to.have.length(1);
    expect(challengerNotifications.notifications[0].destination.type).to.equal('battle_room');
    expect(challengerNotifications.notifications[0].destination.battleId).to.equal(client.db.dj_challenges[0].battle_id);
    expect(retry.duplicate).to.equal(true);
    expect(client.db.battle_records).to.have.length(1);
    expect(client.db.battle_entries).to.have.length(2);
    expect(client.db.dj_notifications.filter(row => row.type === 'challenge_converted_to_battle' && row.user_id === 'dj-1')).to.have.length(1);
  });

  it('blocks profile interactions privately and cancels pending challenges without exposing block state', async () => {
    const client = dataClient(seedData());
    await sendDjChallenge(client, 'dj-1', challengeBody({ challengeId:'challenge-block' }), new Date('2026-08-27T12:00:00.000Z'));
    const blocked = await createDjBlock(client, 'dj-2', { blockedPublicProfileId:'dj_challenger', idempotencyKey:'block-1' }, new Date('2026-08-27T12:02:00.000Z'));
    const eligibility = await getChallengeInteractionEligibility(client, 'dj-1', 'dj_recipient');
    const newChallenge = await sendDjChallenge(client, 'dj-1', { ...challengeBody(), challengeId:'challenge-after-block', idempotencyKey:'after-block' }, new Date('2026-08-27T12:03:00.000Z'));

    expect(blocked.created).to.equal(true);
    expect(blocked.cancelledChallengeCount).to.equal(1);
    expect(client.db.dj_challenges[0].status).to.equal('cancelled');
    expect(eligibility.available).to.equal(false);
    expect(eligibility.reason).to.equal('Challenge unavailable');
    expect(newChallenge.forbidden).to.equal(true);
    expect(JSON.stringify(blocked.block)).to.not.match(/dj-1|dj-2|email|private\/|storage|blocker_user_id/i);
  });

  it('mutes challenge notifications without blocking battle eligibility or deleting history', async () => {
    const client = dataClient(seedData());
    const mute = await createNotificationMute(client, 'dj-2', { mutedPublicProfileId:'dj_challenger', category:'challenge' }, new Date('2026-08-27T11:59:00.000Z'));
    const created = await sendDjChallenge(client, 'dj-1', challengeBody({ challengeId:'challenge-muted' }), new Date('2026-08-27T12:00:00.000Z'));
    const unread = await listOwnedNotifications(client, 'dj-2', { filter:'unread' }, new Date('2026-08-27T12:01:00.000Z'));
    const all = await listOwnedNotifications(client, 'dj-2', { filter:'all' }, new Date('2026-08-27T12:01:00.000Z'));
    const eligibility = await getChallengeInteractionEligibility(client, 'dj-1', 'dj_recipient');

    expect(mute.created).to.equal(true);
    expect(created.created).to.equal(true);
    expect(unread.notifications).to.have.length(0);
    expect(all.notifications).to.have.length(1);
    expect(all.notifications[0].muted).to.equal(true);
    expect(eligibility.available).to.equal(true);
  });
});

function challengeBody(overrides = {}){
  return {
    challengeId:'challenge-1',
    recipientPublicProfileId:'dj_recipient',
    challengerCrateId:'crate-a',
    idempotencyKey:'challenge-key-1',
    origin:{ publicProfileId:'dj_recipient', rankingCategory:'competitive_battles', source:'public_profile' },
    rules:{
      modeId:'own_selection_battle',
      title:'Profile Challenge',
      genre:'Open Format',
      durationMinutes:20,
      scoringType:'hybrid',
      ownSelection:true,
      reward:{ type:'xp', metadata:{} },
      isPremium:true
    },
    ...overrides
  };
}

function profile(overrides = {}){
  const userId = overrides.user_id || 'dj-1';
  const displayName = userId === 'dj-2' ? 'Recipient DJ' : userId === 'dj-3' ? 'Third DJ' : 'Challenger DJ';
  return {
    user_id:userId,
    display_name:displayName,
    country:userId === 'dj-2' ? 'GB' : 'US',
    belt:userId === 'dj-2' ? 'Green' : 'Blue',
    rating:userId === 'dj-2' ? 1740 : 1810,
    wins:4,
    losses:1,
    ties:0,
    completed_battles:5,
    public_profile_id:userId === 'dj-1' ? 'dj_challenger' : userId === 'dj-2' ? 'dj_recipient' : 'dj_third',
    visibility:'public',
    public_profile:{ publicProfileId:userId === 'dj-1' ? 'dj_challenger' : userId === 'dj-2' ? 'dj_recipient' : 'dj_third', displayName, country:userId === 'dj-2' ? 'GB' : 'US', belt:userId === 'dj-2' ? 'Green' : 'Blue', visibility:'public' },
    ...overrides
  };
}

function track(overrides = {}){
  return {
    id:'track-1',
    user_id:'dj-1',
    title:'Prep Track',
    artist:'DJ',
    bpm:124,
    key:'A minor',
    camelot_key:'8A',
    genre:'Open Format',
    duration:180,
    rights_classification:'original',
    source_type:'track',
    analysis_confidence:0.91,
    audio_storage_object_path:'private/library-audio/dj-1/track.wav',
    archived_at:null,
    ...overrides
  };
}

function seedData(overrides = {}){
  return {
    dj_challenges:[],
    dj_notifications:[],
    dj_blocks:[],
    dj_notification_mutes:[],
    battle_records:[],
    battle_entries:[],
    battle_prep_entry_snapshots:[],
    battle_prep_snapshot_replacements:[],
    mix_submissions:[],
    dj_progression_profiles:[
      profile({ user_id:'dj-1' }),
      profile({ user_id:'dj-2' }),
      profile({ user_id:'dj-3' }),
      profile({ user_id:'dj-private', public_profile_id:'dj_private', visibility:'private', public_profile:{ publicProfileId:'dj_private', displayName:'Hidden', visibility:'private', country:'US', email:'hidden@example.com' } })
    ],
    music_library_crates:[
      { id:'crate-a', user_id:'dj-1', name:'Challenger Prep', type:'battle_prep', updated_at:'crate-a-v1', archived_at:null },
      { id:'crate-b', user_id:'dj-2', name:'Recipient Prep', type:'battle_prep', updated_at:'crate-b-v1', archived_at:null },
      { id:'crate-c', user_id:'dj-3', name:'Third Prep', type:'battle_prep', updated_at:'crate-c-v1', archived_at:null }
    ],
    music_library_crate_memberships:[
      { id:'m1', user_id:'dj-1', crate_id:'crate-a', track_id:'track-1', position:0, archived_at:null },
      { id:'m2', user_id:'dj-1', crate_id:'crate-a', track_id:'track-2', position:1, archived_at:null },
      { id:'m3', user_id:'dj-2', crate_id:'crate-b', track_id:'track-3', position:0, archived_at:null },
      { id:'m4', user_id:'dj-2', crate_id:'crate-b', track_id:'track-4', position:1, archived_at:null },
      { id:'m5', user_id:'dj-3', crate_id:'crate-c', track_id:'track-5', position:0, archived_at:null },
      { id:'m6', user_id:'dj-3', crate_id:'crate-c', track_id:'track-6', position:1, archived_at:null }
    ],
    music_library_tracks:[
      track({ id:'track-1', user_id:'dj-1' }),
      track({ id:'track-2', user_id:'dj-1', bpm:128, key:'C minor', camelot_key:'5A' }),
      track({ id:'track-3', user_id:'dj-2' }),
      track({ id:'track-4', user_id:'dj-2', bpm:128, key:'C minor', camelot_key:'5A' }),
      track({ id:'track-5', user_id:'dj-3' }),
      track({ id:'track-6', user_id:'dj-3', bpm:128 })
    ],
    ...overrides
  };
}

function dataClient(initial){
  const db = Object.fromEntries(Object.entries(initial).map(([table, rows]) => [table, rows.map(row => ({ ...row }))]));
  return {
    db,
    from(table){
      if(!db[table]) db[table] = [];
      return new Query(db, table);
    }
  };
}

class Query{
  constructor(db, table){
    this.db = db;
    this.table = table;
    this.filters = [];
    this.inFilters = [];
    this.limitValue = null;
    this.insertRows = null;
    this.updateValues = null;
  }
  select(){ return this; }
  eq(field, value){ this.filters.push([field, value]); return this; }
  in(field, values){ this.inFilters.push([field, values.map(value => String(value))]); return this; }
  limit(value){ this.limitValue = Number(value); return this; }
  insert(rows){ this.insertRows = rows.map(row => ({ ...row })); return this; }
  update(values){ this.updateValues = { ...values }; return this; }
  then(resolve, reject){ return this.exec().then(resolve, reject); }
  async single(){
    const result = await this.exec();
    return result.error ? result : { data:(result.data && result.data[0]) || null, error:null };
  }
  async exec(){
    if(this.insertRows){
      const rows = this.insertRows.map(row => ({ id:row.id || `${this.table}-${this.db[this.table].length + 1}`, ...row }));
      this.db[this.table].push(...rows);
      return { data:rows, error:null };
    }
    let rows = this.db[this.table].filter(row => this.filters.every(([field, value]) => String(row[field]) === String(value)));
    rows = rows.filter(row => this.inFilters.every(([field, values]) => values.includes(String(row[field]))));
    if(this.updateValues){
      rows.forEach(row => Object.assign(row, this.updateValues));
      return { data:rows.slice(0, this.limitValue || rows.length), error:null };
    }
    if(this.limitValue != null) rows = rows.slice(0, this.limitValue);
    return { data:rows, error:null };
  }
}

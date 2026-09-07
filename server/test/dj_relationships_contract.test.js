const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  followPublicDj,
  getOwnedChallengePreferences,
  getOwnedRelationshipSyncState,
  getRelationshipSummary,
  listOwnedActivityFeed,
  listOwnedOpponentHistory,
  listOwnedRelationships,
  requestRematch,
  updateOwnedChallengePreferences,
  unfollowPublicDj
} = require('../dj_relationships');
const {
  createDjBlock,
  listOwnedNotifications,
  sendDjChallenge
} = require('../dj_challenges');
const {
  stableVerifiedResultId
} = require('../battle_result_history');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'sql', '019_create_dj_relationships_preferences.sql'), 'utf8');
const notificationSql = fs.readFileSync(path.join(root, 'sql', '018_create_challenge_notifications_blocks_mutes.sql'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

describe('server-backed DJ relationships and rematches', () => {
  it('follows public DJs idempotently and emits private relationship notifications', async () => {
    const client = dataClient(seedData());
    const first = await followPublicDj(client, 'dj-1', { publicProfileId:'dj_recipient', idempotencyKey:'follow-1' }, new Date('2026-08-28T10:00:00.000Z'));
    const retry = await followPublicDj(client, 'dj-1', { publicProfileId:'dj_recipient', idempotencyKey:'follow-1' }, new Date('2026-08-28T10:00:01.000Z'));
    const listed = await listOwnedRelationships(client, 'dj-1', { direction:'following' });
    const summary = await getRelationshipSummary(client, 'dj-1', 'dj_recipient');
    const notifications = await listOwnedNotifications(client, 'dj-2', { filter:'relationships' }, new Date('2026-08-28T10:01:00.000Z'));

    expect(first.created).to.equal(true);
    expect(retry.duplicate).to.equal(true);
    expect(listed.relationships).to.have.length(1);
    expect(listed.counts.following).to.equal(1);
    expect(summary.summary.following).to.equal(true);
    expect(notifications.notifications).to.have.length(1);
    expect(notifications.notifications[0].type).to.equal('follow_started');
    expect(JSON.stringify({ first, listed, summary, notifications })).to.not.match(/dj-1|dj-2|email|private\/|storage|service_key|track-/i);
  });

  it('unfollows without deleting history and blocks disable existing follow edges', async () => {
    const client = dataClient(seedData());
    await followPublicDj(client, 'dj-1', { publicProfileId:'dj_recipient' }, new Date('2026-08-28T10:00:00.000Z'));
    const removed = await unfollowPublicDj(client, 'dj-1', 'dj_recipient', new Date('2026-08-28T10:01:00.000Z'));
    await followPublicDj(client, 'dj-1', { publicProfileId:'dj_recipient', idempotencyKey:'follow-2' }, new Date('2026-08-28T10:02:00.000Z'));
    const blocked = await createDjBlock(client, 'dj-2', { blockedPublicProfileId:'dj_challenger', idempotencyKey:'block-follow' }, new Date('2026-08-28T10:03:00.000Z'));
    const listed = await listOwnedRelationships(client, 'dj-1', { direction:'following' });
    const challenge = await sendDjChallenge(client, 'dj-1', challengeBody({ challengeId:'after-block', idempotencyKey:'after-block' }), new Date('2026-08-28T10:04:00.000Z'));

    expect(removed.removed).to.equal(true);
    expect(blocked.disabledFollowCount).to.equal(1);
    expect(listed.relationships).to.have.length(0);
    expect(challenge.forbidden).to.equal(true);
    expect(client.db.dj_follows).to.have.length(1);
    expect(client.db.dj_follows[0].active).to.equal(false);
  });

  it('returns versioned relationship sync and respects muted follow notifications', async () => {
    const client = dataClient(seedData({
      dj_notification_mutes:[
        {
          id:'mute-follow',
          user_id:'dj-2',
          muted_user_id:'dj-1',
          muted_public_profile_id:'dj_challenger',
          category:'relationship',
          notification_type:'follow_started',
          muted:true,
          active:true
        }
      ],
      mix_submissions:[
        completedSubmission('dj-2', { id:'sub-public-sync', visibility:'public', score:94, completedAt:'2026-08-28T10:02:00.000Z' }),
        completedSubmission('dj-1', {
          id:'sub-opponent-sync',
          visibility:'private',
          opponent:{ status:'opponent', name:'Recipient DJ', country:'GB', publicProfileId:'dj_recipient', userId:'dj-2', belt:'Green' },
          completedAt:'2026-08-28T10:03:00.000Z'
        })
      ]
    }));
    await followPublicDj(client, 'dj-1', { publicProfileId:'dj_recipient' }, new Date('2026-08-28T10:00:00.000Z'));
    const sync = await getOwnedRelationshipSyncState(client, 'dj-1', { sinceVersion:0, relationshipLimit:5, feedLimit:5 }, new Date('2026-08-28T10:04:00.000Z'));
    const notifications = await listOwnedNotifications(client, 'dj-2', { filter:'relationships' }, new Date('2026-08-28T10:05:00.000Z'));

    expect(sync.sync.syncVersion).to.be.greaterThan(0);
    expect(sync.sync.counts.following).to.equal(1);
    expect(sync.sync.relationships).to.have.length(1);
    expect(sync.sync.events[0].result.rankingCategory).to.equal('competitive_battles');
    expect(sync.sync.opponents[0].opponent.publicProfileId).to.equal('dj_recipient');
    expect(sync.sync.polling.realtime).to.equal('optional_authenticated_scope');
    expect(notifications.notifications).to.have.length(0);
    expect(JSON.stringify(sync)).to.not.match(/private\/|storage_object|service_key|email/i);
  });

  it('stores challenge preferences and enforces audience mode genre rating belt and Bitcoin rules', async () => {
    const client = dataClient(seedData());
    const saved = await updateOwnedChallengePreferences(client, 'dj-2', {
      whoMayChallenge:'followed',
      allowedModes:['own_selection_battle'],
      allowedGenres:['Open Format'],
      ratingRange:{ min:1800, max:1900 },
      allowedBelts:['Blue'],
      bitcoinBattles:'deny',
      autoDeclineOutsideRules:true
    }, new Date('2026-08-28T10:00:00.000Z'));
    const read = await getOwnedChallengePreferences(client, 'dj-2');
    const deniedAudience = await sendDjChallenge(client, 'dj-1', challengeBody({ challengeId:'pref-denied', idempotencyKey:'pref-denied' }), new Date('2026-08-28T10:01:00.000Z'));
    await followPublicDj(client, 'dj-2', { publicProfileId:'dj_challenger' }, new Date('2026-08-28T10:02:00.000Z'));
    const allowed = await sendDjChallenge(client, 'dj-1', challengeBody({ challengeId:'pref-allowed', idempotencyKey:'pref-allowed' }), new Date('2026-08-28T10:03:00.000Z'));
    const bitcoinDenied = await sendDjChallenge(client, 'dj-1', challengeBody({
      challengeId:'pref-bitcoin',
      idempotencyKey:'pref-bitcoin',
      rules:{ ...challengeBody().rules, reward:{ type:'bitcoin', metadata:{ amountSats:5000, custody:'external_pending' } } }
    }), new Date('2026-08-28T10:04:00.000Z'));

    expect(saved.preferences.whoMayChallenge).to.equal('followed');
    expect(saved.preferences.autoDeclineOutsideRules).to.equal(true);
    expect(read.preferences.allowedModes).to.deep.equal(['own_selection_battle']);
    expect(deniedAudience.forbidden).to.equal(true);
    expect(allowed.created).to.equal(true);
    expect(bitcoinDenied.forbidden).to.equal(true);
    expect(JSON.stringify(saved.preferences)).to.not.match(/dj-2|email|storage|secret|private_key/i);
  });

  it('builds a privacy-safe followed activity feed from public verified source events', async () => {
    const client = dataClient(seedData({
      mix_submissions:[
        completedSubmission('dj-2', { id:'sub-public', visibility:'public', score:94 }),
        completedSubmission('dj-2', { id:'sub-private', visibility:'private', score:99 }),
        completedSubmission('dj-3', { id:'sub-other', visibility:'public', score:88 })
      ]
    }));
    await followPublicDj(client, 'dj-1', { publicProfileId:'dj_recipient' }, new Date('2026-08-28T10:00:00.000Z'));
    const feed = await listOwnedActivityFeed(client, 'dj-1', { limit:1, page:1 });

    expect(feed.events).to.have.length(1);
    expect(feed.pagination.total).to.equal(1);
    expect(feed.events[0].sourceType).to.equal('verified_result');
    expect(feed.events[0].summary).to.include('94/100');
    expect(JSON.stringify(feed.events)).to.not.match(/sub-private|dj-2|private\/|storage|email|audio_storage|track-/i);
  });

  it('lists private opponent history and creates rematch challenges with fresh crate requirements', async () => {
    const client = dataClient(seedData({
      mix_submissions:[
        completedSubmission('dj-1', {
          id:'sub-rematch',
          visibility:'private',
          opponent:{ status:'opponent', name:'Recipient DJ', country:'GB', publicProfileId:'dj_recipient', userId:'dj-2', belt:'Green' }
        })
      ]
    }));
    const history = await listOwnedOpponentHistory(client, 'dj-1');
    const rematch = await requestRematch(client, 'dj-1', {
      previousResultId:'sub-rematch',
      challengerCrateId:'crate-a',
      idempotencyKey:'rematch-1'
    }, new Date('2026-08-28T11:00:00.000Z'));
    const recipientNotifications = await listOwnedNotifications(client, 'dj-2', { filter:'challenges' }, new Date('2026-08-28T11:01:00.000Z'));

    expect(history.opponents).to.have.length(1);
    expect(history.opponents[0].rematchEligible).to.equal(true);
    expect(rematch.created).to.equal(true);
    expect(rematch.rematch.requiresFreshCrate).to.equal(true);
    expect(client.db.dj_challenges[0].origin_context.source).to.equal('rematch');
    expect(recipientNotifications.notifications[0].type).to.equal('rematch_requested');
    expect(JSON.stringify({ history, rematch })).to.not.match(/crate-b|track-3|snapshot_id|battle_prep_entry_snapshots|private\/|storage_object_path|service_key/i);
  });

  it('defines protected relationship routes and review-only RLS-ready schema without wallet actions', () => {
    expect(serverSource).to.include("app.get('/api/relationships/sync', requireAuth");
    expect(serverSource).to.include("app.get('/api/relationships/:publicProfileId', requireAuth");
    expect(serverSource).to.include("app.post('/api/relationships/:publicProfileId/follow', requireAuth");
    expect(serverSource).to.include("app.delete('/api/relationships/:publicProfileId/follow', requireAuth");
    expect(serverSource).to.include("app.get('/api/activityFeed', requireAuth");
    expect(serverSource).to.include("app.get('/api/opponentHistory', requireAuth");
    expect(serverSource).to.include("app.post('/api/rematches', requireAuth");
    expect(serverSource).to.include("app.patch('/api/challengePreferences', requireAuth");
    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.dj_follows');
    expect(sql).to.include('dj_follows_active_pair_idx');
    expect(sql).to.include('dj_follows_follower_public_profile_idx');
    expect(sql).to.include('dj_follows_event_version_idx');
    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.dj_challenge_preferences');
    expect(sql).to.include('allow_select_own_dj_follows');
    expect(sql).to.include('allow_upsert_own_challenge_preferences');
    expect(notificationSql).to.include("'follow_started'");
    expect(notificationSql).to.include("'rematch_requested'");
    expect(`${sql}\n${notificationSql}`).to.not.match(/wallet_balances|deposit_address|payout_status|claimable_amount|custody_private_key/i);
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

function completedSubmission(userId, overrides = {}){
  const id = overrides.id || `sub-${userId}`;
  const visibility = overrides.visibility || 'public';
  const opponent = overrides.opponent || { status:'opponent', name:'Challenger DJ', country:'US', publicProfileId:'dj_challenger', userId:'dj-1', belt:'Blue' };
  return {
    id,
    user_id:userId,
    status:'completed',
    judge_result:{
      score:overrides.score || 91,
      opponentScore:84,
      evidenceType:'measurable rule-based analysis',
      breakdown:{ timing:92, phrasing:88, key:90 },
      measurableAnalysis:{ bpm:128, durationSec:180, transitionCount:3 },
      confidence:{ overall:0.86 },
      recommendations:['Keep transitions phrase-aligned.'],
      reward:overrides.reward || { type:'xp', metadata:{} }
    },
    processing_info:{
      result_visibility:visibility,
      verified_result_id:stableVerifiedResultId(id),
      battleResultSummary:{
        visibility,
        verifiedResultId:stableVerifiedResultId(id),
        title:'Completed Battle',
        modeId:'own_selection_battle',
        type:'Own Selection Battle',
        genre:'Open Format',
        durationMinutes:20,
        scoringType:'hybrid',
        outcome:overrides.outcome || 'win',
        opponent,
        profile:{ displayName:userId === 'dj-2' ? 'Recipient DJ' : 'Challenger DJ', country:userId === 'dj-2' ? 'GB' : 'US' },
        progression:{ xp:120, ratingDelta:14 },
        progressBefore:{ belt:'Blue' },
        progressAfter:{ belt:'Green' },
        completedAt:overrides.completedAt || '2026-08-28T09:00:00.000Z',
        reward:overrides.reward || { type:'xp', metadata:{} }
      }
    },
    created_at:'2026-08-28T09:00:00.000Z',
    updated_at:'2026-08-28T09:05:00.000Z'
  };
}

function seedData(overrides = {}){
  return {
    dj_follows:[],
    dj_challenge_preferences:[],
    dj_activity_feed_events:[],
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
      { id:'crate-b', user_id:'dj-2', name:'Recipient Prep', type:'battle_prep', updated_at:'crate-b-v1', archived_at:null }
    ],
    music_library_crate_memberships:[
      { id:'m1', user_id:'dj-1', crate_id:'crate-a', track_id:'track-1', position:0, archived_at:null },
      { id:'m2', user_id:'dj-1', crate_id:'crate-a', track_id:'track-2', position:1, archived_at:null },
      { id:'m3', user_id:'dj-2', crate_id:'crate-b', track_id:'track-3', position:0, archived_at:null },
      { id:'m4', user_id:'dj-2', crate_id:'crate-b', track_id:'track-4', position:1, archived_at:null }
    ],
    music_library_tracks:[
      track({ id:'track-1', user_id:'dj-1' }),
      track({ id:'track-2', user_id:'dj-1', bpm:128, key:'C minor', camelot_key:'5A' }),
      track({ id:'track-3', user_id:'dj-2' }),
      track({ id:'track-4', user_id:'dj-2', bpm:128, key:'C minor', camelot_key:'5A' })
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

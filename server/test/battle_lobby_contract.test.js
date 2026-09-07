const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  cancelOwnedBattle,
  findCompatibleLobbyBattle,
  joinBattleWithPrepSnapshot,
  listPublicBattleLobby,
  recoverOwnedActiveBattles,
  withdrawOwnedBattleEntry
} = require('../battle_prep_snapshots');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'sql', '014_create_battle_prep_entry_snapshots.sql'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

describe('server-backed Battle Lobby and recovery contract', () => {
  it('lists only sanitized public lobby battles with filters and bounded pagination', async () => {
    const client = dataClient(seedData({
      battle_records:[
        battleRecord({
          id:'battle-open',
          public_creator_profile:{ name:'DJ One', country:'US', belt:'Blue', rating:1820, email:'hidden@example.com' },
          created_at:'2026-08-26T10:00:00.000Z'
        }),
        battleRecord({
          id:'battle-bitcoin',
          mode_id:'bitcoin_battle',
          reward_type:'bitcoin',
          reward:{ type:'bitcoin', metadata:{ amountSats:2500, custody:'external_pending' } },
          bitcoin_reward_metadata:{ amountSats:2500, custody:'external_pending', walletConnected:false },
          public_creator_profile:{ name:'DJ Two', country:'US', belt:'Green' },
          created_at:'2026-08-26T11:00:00.000Z'
        }),
        battleRecord({ id:'battle-private', visibility:'private', public_creator_profile:{ name:'Private DJ', country:'US' } }),
        battleRecord({ id:'battle-ca', public_creator_profile:{ name:'DJ Three', country:'CA' } })
      ],
      battle_entries:[{ id:'entry-creator', battle_id:'battle-open', user_id:'dj-1', status:'active' }]
    }));

    const listed = await listPublicBattleLobby(client, { country:'US', limit:1 }, new Date('2026-08-26T12:00:00.000Z'));
    expect(listed.items).to.have.length(1);
    expect(listed.pagination.hasMore).to.equal(true);
    expect(listed.items[0].creator.country).to.equal('US');
    expect(listed.items[0]).to.not.have.property('createdBy');
    expect(JSON.stringify(listed.items)).to.not.include('hidden@example.com');
    expect(JSON.stringify(listed.items)).to.not.include('private/');

    const bitcoin = await listPublicBattleLobby(client, { bitcoin:'true', limit:5 }, new Date('2026-08-26T12:00:00.000Z'));
    expect(bitcoin.items).to.have.length(1);
    expect(bitcoin.items[0].bitcoinRewardMetadata.status).to.equal('metadata_untransferred');
  });

  it('uses real open battles for matchmaking and excludes the requesting creator', async () => {
    const client = dataClient(seedData({
      battle_records:[
        battleRecord({ id:'battle-own', created_by:'dj-1', genre:'Open Format', public_creator_profile:{ name:'You', country:'US' } }),
        battleRecord({ id:'battle-match', created_by:'dj-2', genre:'Open Format', public_creator_profile:{ name:'Rival', country:'US', belt:'Blue' } }),
        battleRecord({ id:'battle-full', created_by:'dj-3', genre:'Open Format', capacity:1, public_creator_profile:{ name:'Full', country:'US' } })
      ],
      battle_entries:[{ id:'entry-full', battle_id:'battle-full', user_id:'dj-3', status:'active' }]
    }));

    const match = await findCompatibleLobbyBattle(client, 'dj-1', { genre:'Open Format', country:'US' }, new Date('2026-08-26T12:00:00.000Z'));
    expect(match.battle.id).to.equal('battle-match');
    expect(match.battle.creator.name).to.equal('Rival');
    expect(match.candidates.map(row => row.id)).to.not.include('battle-own');
    expect(match.candidates.map(row => row.id)).to.not.include('battle-full');
  });

  it('filters lobby discovery by followed creators server-side without exposing private prep data', async () => {
    const client = dataClient(seedData({
      battle_records:[
        battleRecord({ id:'battle-followed', created_by:'dj-2', public_creator_profile:{ publicProfileId:'dj_rival', name:'Rival', country:'US', belt:'Blue', rating:1810 } }),
        battleRecord({ id:'battle-blocked', created_by:'dj-3', public_creator_profile:{ publicProfileId:'dj_blocked', name:'Blocked', country:'US', belt:'Black', rating:1990 } }),
        battleRecord({ id:'battle-other', created_by:'dj-4', public_creator_profile:{ publicProfileId:'dj_other', name:'Other', country:'GB', belt:'Green', rating:1700 } })
      ],
      dj_follows:[
        { id:'follow-rival', follower_user_id:'dj-1', followed_user_id:'dj-2', follower_public_profile_id:'dj_creator', followed_public_profile_id:'dj_rival', active:true, status:'active' },
        { id:'follow-blocked', follower_user_id:'dj-1', followed_user_id:'dj-3', follower_public_profile_id:'dj_creator', followed_public_profile_id:'dj_blocked', active:true, status:'active' },
        { id:'follower-rival', follower_user_id:'dj-4', followed_user_id:'dj-2', follower_public_profile_id:'dj_other', followed_public_profile_id:'dj_rival', active:true, status:'active' }
      ],
      dj_blocks:[
        { id:'block-row', blocker_user_id:'dj-3', blocked_user_id:'dj-1', active:true, status:'active' }
      ]
    }));

    const result = await listPublicBattleLobby(client, { relationship:'following', viewerUserId:'dj-1', limit:10 }, new Date('2026-08-26T12:00:00.000Z'));

    expect(result.filters.relationship).to.equal('following');
    expect(result.items.map(row => row.id)).to.deep.equal(['battle-followed']);
    expect(result.items[0].creator.followerCount).to.equal(2);
    expect(result.items[0].creator.relationshipCounts.source).to.equal('server');
    expect(JSON.stringify(result.items[0])).to.not.match(/crate|track-|storage|dj-2|dj-1|private/i);
  });

  it('rejects self-joining, expired battles and unavailable final slots server-side', async () => {
    const selfClient = dataClient(seedData({ battle_records:[battleRecord()] }));
    const self = await joinBattleWithPrepSnapshot(selfClient, 'dj-1', 'battle-open', { crateId:'crate-a' });
    expect(self.conflict).to.equal(true);

    const expiredClient = dataClient(seedData({
      battle_records:[battleRecord({ expires_at:'2026-08-26T09:00:00.000Z' })]
    }));
    const expired = await joinBattleWithPrepSnapshot(expiredClient, 'dj-2', 'battle-open', { crateId:'crate-b' }, new Date('2026-08-26T12:00:00.000Z'));
    expect(expired.conflict).to.equal(true);
    expect(expired.reason).to.include('expired');

    const startedClient = dataClient(seedData({
      battle_records:[battleRecord({ status:'active' })]
    }));
    const started = await joinBattleWithPrepSnapshot(startedClient, 'dj-2', 'battle-open', { crateId:'crate-b' });
    expect(started.conflict).to.equal(true);
    expect(started.reason).to.include('not joinable');
  });

  it('recovers only the authenticated DJ snapshot and sanitized opponent state', async () => {
    const client = dataClient(seedData({
      battle_records:[battleRecord({ status:'matched', public_creator_profile:{ name:'DJ One', country:'US' } })],
      battle_entries:[
        { id:'entry-own', battle_id:'battle-open', user_id:'dj-1', status:'active', battle_prep_snapshot_id:'snap-own' },
        { id:'entry-opponent', battle_id:'battle-open', user_id:'dj-2', status:'active', battle_prep_snapshot_id:'snap-opponent', public_profile:{ name:'Rival', country:'GB', belt:'Green', email:'private@example.com' } }
      ],
      battle_prep_entry_snapshots:[
        snapshotRow({ id:'snap-own', battle_entry_id:'entry-own', user_id:'dj-1' }),
        snapshotRow({ id:'snap-opponent', battle_entry_id:'entry-opponent', user_id:'dj-2', crate_id:'secret-crate', tracks:[{ libraryTrackId:'secret-track', storage:'private/opponent.wav' }] })
      ],
      mix_submissions:[{ id:'sub-own', battle_entry_id:'entry-own', user_id:'dj-1', status:'uploaded', created_at:'2026-08-26T12:01:00.000Z' }]
    }));

    const recovered = await recoverOwnedActiveBattles(client, 'dj-1', {}, new Date('2026-08-26T12:05:00.000Z'));
    expect(recovered.items).to.have.length(1);
    expect(recovered.items[0].snapshot.snapshotId).to.equal('snap-own');
    expect(recovered.items[0].submission.status).to.equal('uploaded');
    expect(recovered.items[0].participants.opponents[0].profile.name).to.equal('Rival');
    expect(JSON.stringify(recovered.items[0].participants.opponents)).to.not.include('dj-2');
    expect(JSON.stringify(recovered.items[0])).to.not.include('secret-track');
    expect(JSON.stringify(recovered.items[0])).to.not.include('private@example.com');
  });

  it('allows safe cancellation and withdrawal without rewriting snapshot evidence', async () => {
    const cancelClient = dataClient(seedData({
      battle_records:[battleRecord()],
      battle_entries:[{ id:'entry-creator', battle_id:'battle-open', user_id:'dj-1', status:'active', battle_prep_snapshot_id:'snap-1' }],
      battle_prep_entry_snapshots:[snapshotRow({ id:'snap-1', battle_entry_id:'entry-creator', user_id:'dj-1' })]
    }));
    const cancelled = await cancelOwnedBattle(cancelClient, 'dj-1', 'battle-open', new Date('2026-08-26T12:00:00.000Z'));
    expect(cancelled.cancelled).to.equal(true);
    expect(cancelClient.db.battle_prep_entry_snapshots[0].id).to.equal('snap-1');

    const withdrawClient = dataClient(seedData({
      battle_records:[battleRecord()],
      battle_entries:[
        { id:'entry-creator', battle_id:'battle-open', user_id:'dj-1', status:'active' },
        { id:'entry-joiner', battle_id:'battle-open', user_id:'dj-2', status:'active', battle_prep_snapshot_id:'snap-joiner' }
      ],
      battle_prep_entry_snapshots:[snapshotRow({ id:'snap-joiner', battle_entry_id:'entry-joiner', user_id:'dj-2' })]
    }));
    const withdrawn = await withdrawOwnedBattleEntry(withdrawClient, 'dj-2', 'entry-joiner', new Date('2026-08-26T12:00:00.000Z'));
    expect(withdrawn.withdrawn).to.equal(true);
    expect(withdrawClient.db.battle_entries.find(row => row.id === 'entry-joiner').status).to.equal('withdrawn');
    expect(withdrawClient.db.battle_prep_entry_snapshots[0].snapshot_version).to.equal('snap-v1');

    const creatorWithdraw = await withdrawOwnedBattleEntry(withdrawClient, 'dj-1', 'entry-creator');
    expect(creatorWithdraw.conflict).to.equal(true);
  });

  it('defines lobby/recovery routes and migration readiness fields', () => {
    expect(serverSource).to.include("app.get('/api/battles/lobby'");
    expect(serverSource).to.include("app.get('/api/battles/relationshipLobby', requireAuth");
    expect(serverSource).to.include("app.get('/api/battles/matchmaking', requireAuth");
    expect(serverSource).to.include("app.get('/api/battles/recovery', requireAuth");
    expect(serverSource).to.include("app.post('/api/battles/:battleId/cancel', requireAuth");
    expect(serverSource).to.include("app.post('/api/battleEntries/:entryId/withdraw', requireAuth");
    expect(sql).to.include('public_creator_profile');
    expect(sql).to.include('expires_at');
    expect(sql).to.include('battle_records_public_lobby_idx');
    expect(sql).to.include('withdrawn_at');
    expect(sql).to.include('FOR UPDATE');
    expect(sql).to.not.include('CREATE EXTENSION');
  });
});

function battleRecord(overrides = {}){
  return {
    id:'battle-open',
    created_by:'dj-1',
    mode_id:'own_selection_battle',
    title:'Own Selection Battle',
    genre:'Open Format',
    duration_minutes:20,
    track_selection_method:'own_selection',
    track_count:null,
    minimum_track_count:1,
    opponent_requirement:'required',
    capacity:2,
    visibility:'public',
    status:'open',
    scoring_type:'hybrid',
    start_conditions:{ startsWhenFull:true },
    public_creator_profile:{ name:'DJ One', country:'US', belt:'Blue' },
    reward_type:'xp',
    reward:{ type:'xp', metadata:{} },
    bitcoin_reward_metadata:null,
    created_at:'2026-08-26T10:00:00.000Z',
    updated_at:'2026-08-26T10:00:00.000Z',
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

function snapshotRow(overrides = {}){
  return {
    id:'snap-1',
    battle_id:'battle-open',
    battle_entry_id:'entry-1',
    user_id:'dj-1',
    crate_id:'crate-a',
    crate_version:'v1',
    snapshot_version:'snap-v1',
    purpose:'own_selection',
    track_selection_method:'own_selection',
    replacement_allowed:true,
    tracks:[{ libraryTrackId:'track-1', order:0, bpm:124, key:'A minor', camelotKey:'8A', genre:'Open Format', duration:180, status:'ready', availability:'available', reasons:[] }],
    rule_decisions:{ ready:true, blockers:[], warnings:[], method:'own_selection', purpose:'own_selection' },
    availability:{ status:'available', unavailableTrackCount:0 },
    replacements:[],
    created_at:'2026-08-26T10:00:00.000Z',
    updated_at:'2026-08-26T10:00:00.000Z',
    ...overrides
  };
}

function seedData(overrides = {}){
  return {
    battle_records: [],
    battle_entries: [],
    battle_prep_entry_snapshots: [],
    battle_prep_snapshot_replacements: [],
    mix_submissions: [],
    music_library_crates: [
      { id:'crate-a', user_id:'dj-1', name:'Private Prep', type:'battle_prep', updated_at:'v1', archived_at:null },
      { id:'crate-b', user_id:'dj-2', name:'Rival Prep', type:'battle_prep', updated_at:'v1', archived_at:null }
    ],
    music_library_crate_memberships: [
      { id:'member-1', user_id:'dj-1', crate_id:'crate-a', track_id:'track-1', position:0, created_at:'2026-08-26T09:00:00.000Z', archived_at:null },
      { id:'member-2', user_id:'dj-2', crate_id:'crate-b', track_id:'track-2', position:0, created_at:'2026-08-26T09:01:00.000Z', archived_at:null }
    ],
    music_library_tracks: [
      track({ id:'track-1', user_id:'dj-1' }),
      track({ id:'track-2', user_id:'dj-2' })
    ],
    dj_follows: [],
    dj_blocks: [],
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
    this.limitValue = null;
    this.insertRows = null;
    this.updateValues = null;
    this.inFilters = [];
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
      const rows = this.insertRows.map(row => ({ id: row.id || `${this.table}-${this.db[this.table].length + 1}`, ...row }));
      this.db[this.table].push(...rows);
      return { data: rows, error:null };
    }
    let rows = this.db[this.table].filter(row => this.filters.every(([field, value]) => String(row[field]) === String(value)));
    rows = rows.filter(row => this.inFilters.every(([field, values]) => values.includes(String(row[field]))));
    if(this.updateValues){
      rows.forEach(row => Object.assign(row, this.updateValues));
      return { data: rows.slice(0, this.limitValue || rows.length), error:null };
    }
    if(this.limitValue != null) rows = rows.slice(0, this.limitValue);
    return { data: rows, error:null };
  }
}

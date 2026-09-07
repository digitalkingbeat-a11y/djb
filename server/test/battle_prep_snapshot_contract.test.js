const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  createBattleWithPrepSnapshot,
  hydrateOwnedBattlePrepSnapshot,
  joinBattleWithPrepSnapshot,
  replaceBattlePrepSnapshotTrack,
  sanitizeBattlePrepSnapshotForPublic,
  validateOwnedBattlePrepCrate
} = require('../battle_prep_snapshots');
const { createDraftSubmission, verifyBattlePrepSnapshotContext } = require('../battle_submission');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'sql', '014_create_battle_prep_entry_snapshots.sql'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

describe('server-backed Battle Prep snapshots', () => {
  it('creates an owned battle, entry and immutable safe prep snapshot idempotently', async () => {
    const client = dataClient(seedData());
    const now = new Date('2026-08-26T10:00:00.000Z');
    const body = ownSelectionBody();

    const first = await createBattleWithPrepSnapshot(client, 'dj-1', body, now);
    const second = await createBattleWithPrepSnapshot(client, 'dj-1', body, now);

    expect(first.created).to.equal(true);
    expect(second.duplicate).to.equal(true);
    expect(client.db.battle_records).to.have.length(1);
    expect(client.db.battle_entries).to.have.length(1);
    expect(client.db.battle_prep_entry_snapshots).to.have.length(1);
    expect(first.snapshot.tracks.map(track => track.libraryTrackId)).to.deep.equal(['track-1', 'track-2']);
    expect(JSON.stringify(first.snapshot)).to.not.include('private/library-audio');
    expect(first.snapshot.snapshotVersion).to.equal(second.snapshot.snapshotVersion);
  });

  it('denies foreign crates and tracks during server-side validation', async () => {
    const client = dataClient(seedData({
      music_library_crates: [{ id:'crate-foreign', user_id:'dj-2', type:'battle_prep', updated_at:'v1' }]
    }));
    const deniedCrate = await validateOwnedBattlePrepCrate(client, 'dj-1', 'crate-foreign', ownSelectionBattle());
    expect(deniedCrate.forbidden).to.equal(true);

    const foreignTrackClient = dataClient(seedData({
      music_library_crate_memberships: [
        { id:'member-foreign', user_id:'dj-1', crate_id:'crate-a', track_id:'track-foreign', position:0 }
      ],
      music_library_tracks: [
        { id:'track-foreign', user_id:'dj-2', title:'Hidden', bpm:120, key:'C minor', camelot_key:'5A', genre:'Open Format', duration:120, rights_classification:'original', audio_storage_object_path:'private/library-audio/dj-2/hidden.wav' }
      ]
    }));
    const deniedTrack = await validateOwnedBattlePrepCrate(foreignTrackClient, 'dj-1', 'crate-a', ownSelectionBattle());
    expect(deniedTrack.ready).to.equal(false);
    expect(deniedTrack.ruleDecisions.blockers.join(' ')).to.include('another DJ');
  });

  it('returns duplicate joins cleanly and protects the final battle slot', async () => {
    const duplicateClient = dataClient(seedData({
      battle_records: [battleRecord()],
      battle_entries: [{ id:'entry-existing', battle_id:'battle-open', user_id:'dj-2', status:'active' }],
      battle_prep_entry_snapshots: [snapshotRow({ id:'snap-existing', battle_entry_id:'entry-existing', user_id:'dj-2' })]
    }));
    const duplicate = await joinBattleWithPrepSnapshot(duplicateClient, 'dj-2', 'battle-open', { crateId:'crate-b' });
    expect(duplicate.duplicate).to.equal(true);
    expect(duplicate.snapshot.snapshotId).to.equal('snap-existing');

    const fullClient = dataClient(seedData({
      battle_records: [battleRecord({ capacity:2 })],
      battle_entries: [
        { id:'entry-creator', battle_id:'battle-open', user_id:'dj-1', status:'active' },
        { id:'entry-rival', battle_id:'battle-open', user_id:'dj-2', status:'active' }
      ]
    }));
    const full = await joinBattleWithPrepSnapshot(fullClient, 'dj-3', 'battle-open', { crateId:'crate-c' });
    expect(full.conflict).to.equal(true);
    expect(full.reason).to.include('full');
  });

  it('locks the persisted roster and starts a final successful full table', async () => {
    const client = dataClient(seedData({
      battle_records:[battleRecord({ capacity:2 })],
      battle_entries:[{ id:'entry-creator', battle_id:'battle-open', user_id:'dj-1', status:'active' }]
    }));
    const joined = await joinBattleWithPrepSnapshot(client, 'dj-3', 'battle-open', { crateId:'crate-c' });
    expect(joined.created).to.equal(true);
    expect(joined.battle.status).to.equal('started');
    expect(client.db.battle_entries).to.have.length(2);
    expect(client.db.battle_records[0].status).to.equal('started');
    expect(client.db.battle_records[0].started_at).to.be.a('string');
    expect(client.db.battle_records[0].deadline_at).to.be.a('string');
  });

  it('hydrates an owned snapshot across devices and marks later unavailable tracks without rewriting history', async () => {
    const client = dataClient(seedData({
      battle_entries: [{ id:'entry-1', battle_id:'battle-open', user_id:'dj-1', status:'active' }],
      battle_prep_entry_snapshots: [snapshotRow({ id:'snap-1', battle_entry_id:'entry-1', user_id:'dj-1' })],
      music_library_tracks: [
        track({ id:'track-1', audio_storage_object_path:null }),
        track({ id:'track-2' })
      ]
    }));
    const hydrated = await hydrateOwnedBattlePrepSnapshot(client, 'dj-1', 'entry-1');
    expect(hydrated.snapshot.availability.status).to.equal('unavailable');
    expect(hydrated.snapshot.availability.unavailableTrackIds).to.deep.equal(['track-1']);
    expect(client.db.battle_prep_entry_snapshots[0].tracks[0].availability).to.equal('available');
  });

  it('allows replacement only when the battle mode permits it', async () => {
    const client = dataClient(seedData({
      battle_records: [battleRecord()],
      battle_prep_entry_snapshots: [snapshotRow({ id:'snap-own', replacement_allowed:true })],
      music_library_tracks: [track({ id:'track-1' }), track({ id:'track-2' }), track({ id:'track-3', bpm:126 })]
    }));
    const replaced = await replaceBattlePrepSnapshotTrack(client, 'dj-1', 'snap-own', { fromTrackId:'track-1', toTrackId:'track-3' }, new Date('2026-08-26T10:05:00.000Z'));
    expect(replaced.snapshot.replacements).to.have.length(1);
    expect(replaced.snapshot.tracks[0].libraryTrackId).to.equal('track-1');

    const assignedClient = dataClient(seedData({
      battle_records: [battleRecord({ id:'battle-assigned', mode_id:'transition_battle', track_selection_method:'assigned', minimum_track_count:null, track_count:2 })],
      battle_prep_entry_snapshots: [snapshotRow({ id:'snap-assigned', battle_id:'battle-assigned', replacement_allowed:false })]
    }));
    const denied = await replaceBattlePrepSnapshotTrack(assignedClient, 'dj-1', 'snap-assigned', { fromTrackId:'track-1', toTrackId:'track-3' });
    expect(denied.forbiddenReplacement).to.equal(true);
  });

  it('verifies submission snapshot ownership and version before creating a draft', async () => {
    const client = dataClient(seedData({
      battle_entries: [{ id:'entry-1', battle_id:'battle-open', user_id:'dj-1', status:'active' }],
      battle_prep_entry_snapshots: [snapshotRow({ id:'snap-1', battle_entry_id:'entry-1', user_id:'dj-1', snapshot_version:'snap-v1' })]
    }));
    const verified = await verifyBattlePrepSnapshotContext(client, 'dj-1', 'entry-1', { battlePrepSnapshotId:'snap-1', battlePrepSnapshotVersion:'snap-v1' });
    expect(verified.ok).to.equal(true);

    const draft = await createDraftSubmission(client, 'dj-1', 'entry-1', {
      originalFilename:'mix.webm',
      declaredMimeType:'audio/webm',
      fileSize:64,
      submissionSource:'uploaded_mix',
      battleContext:{ battlePrepSnapshotId:'snap-1', battlePrepSnapshotVersion:'snap-v1' }
    });
    expect(draft.created).to.equal(true);

    const bad = await createDraftSubmission(client, 'dj-1', 'entry-1', {
      originalFilename:'mix.webm',
      declaredMimeType:'audio/webm',
      fileSize:64,
      battleContext:{ battlePrepSnapshotId:'snap-1', battlePrepSnapshotVersion:'wrong-version' }
    });
    expect(bad.validationError).to.include('version');
  });

  it('redacts private prep data from public history and keeps Bitcoin metadata separate', async () => {
    const client = dataClient(seedData());
    const result = await createBattleWithPrepSnapshot(client, 'dj-1', {
      ...ownSelectionBody(),
      battleId:'battle-bitcoin',
      modeId:'bitcoin_battle',
      trackSelectionMethod:'assigned',
      trackCount:2,
      minimumTrackCount:null,
      reward:{ type:'bitcoin', metadata:{ amountSats:2500, custody:'external_pending', walletConnected:false } },
      crateId:'crate-a',
      purpose:'reference'
    }, new Date('2026-08-26T11:00:00.000Z'));
    const publicSummary = sanitizeBattlePrepSnapshotForPublic(client.db.battle_prep_entry_snapshots[0]);
    expect(publicSummary.trackCount).to.equal(2);
    expect(publicSummary).to.not.have.property('crateId');
    expect(publicSummary).to.not.have.property('tracks');
    expect(JSON.stringify(publicSummary)).to.not.include('track-1');
    expect(result.battle.bitcoinRewardMetadata.amountSats).to.equal(2500);
    expect(result.snapshot).to.not.have.property('bitcoinRewardMetadata');
  });

  it('defines protected routes, local migration constraints and concurrency guard', () => {
    expect(serverSource).to.include("app.post('/api/battles/withPrepSnapshot', requireAuth");
    expect(serverSource).to.include("app.post('/api/battles/:battleId/join', requireAuth");
    expect(serverSource).to.include("app.get('/api/battleEntries/:entryId/prepSnapshot', requireAuth");
    expect(serverSource).to.include("app.post('/api/battlePrepSnapshots/:snapshotId/replacements', requireAuth");
    expect(sql).to.include('battle_prep_entry_snapshots');
    expect(sql).to.include('UNIQUE (battle_entry_id, user_id)');
    expect(sql).to.include('FOREIGN KEY (battle_entry_id, user_id)');
    expect(sql).to.include('enforce_battle_record_entry_capacity');
    expect(sql).to.include('FOR UPDATE');
    expect(sql).to.include('allow_select_own_battle_prep_snapshots');
    expect(sql).to.include('bitcoin_reward_metadata');
    expect(sql).to.not.include('CREATE EXTENSION');
  });
});

function ownSelectionBody(){
  return {
    battleId:'battle-open',
    modeId:'own_selection_battle',
    genre:'Open Format',
    durationMinutes:20,
    trackSelectionMethod:'own_selection',
    minimumTrackCount:2,
    opponentRequirement:'required',
    visibility:'public',
    reward:{ type:'xp', metadata:{} },
    crateId:'crate-a',
    idempotencyKey:'idem-create-1',
    isPremium:true
  };
}

function ownSelectionBattle(){
  return {
    id:'battle-open',
    modeId:'own_selection_battle',
    genre:'Open Format',
    durationMinutes:20,
    trackSelectionMethod:'own_selection',
    minimumTrackCount:2,
    opponentRequirement:'required',
    reward:{ type:'xp', metadata:{} },
    createdBy:'dj-1'
  };
}

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
    minimum_track_count:2,
    opponent_requirement:'required',
    capacity:2,
    visibility:'public',
    status:'open',
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
    tracks:[
      { libraryTrackId:'track-1', order:0, bpm:124, key:'A minor', camelotKey:'8A', genre:'Open Format', duration:180, status:'ready', availability:'available', reasons:[] },
      { libraryTrackId:'track-2', order:1, bpm:128, key:'C minor', camelotKey:'5A', genre:'Open Format', duration:180, status:'ready', availability:'available', reasons:[] }
    ],
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
      { id:'crate-b', user_id:'dj-2', name:'Rival Prep', type:'battle_prep', updated_at:'v1', archived_at:null },
      { id:'crate-c', user_id:'dj-3', name:'Third Prep', type:'battle_prep', updated_at:'v1', archived_at:null }
    ],
    music_library_crate_memberships: [
      { id:'member-1', user_id:'dj-1', crate_id:'crate-a', track_id:'track-1', position:0, created_at:'2026-08-26T09:00:00.000Z', archived_at:null },
      { id:'member-2', user_id:'dj-1', crate_id:'crate-a', track_id:'track-2', position:1, created_at:'2026-08-26T09:01:00.000Z', archived_at:null },
      { id:'member-3', user_id:'dj-2', crate_id:'crate-b', track_id:'track-4', position:0, created_at:'2026-08-26T09:02:00.000Z', archived_at:null },
      { id:'member-4', user_id:'dj-3', crate_id:'crate-c', track_id:'track-5', position:0, created_at:'2026-08-26T09:03:00.000Z', archived_at:null },
      { id:'member-5', user_id:'dj-3', crate_id:'crate-c', track_id:'track-6', position:1, created_at:'2026-08-26T09:04:00.000Z', archived_at:null }
    ],
    music_library_tracks: [
      track({ id:'track-1' }),
      track({ id:'track-2', bpm:128, key:'C minor', camelot_key:'5A' }),
      track({ id:'track-4', user_id:'dj-2' }),
      track({ id:'track-5', user_id:'dj-3' }),
      track({ id:'track-6', user_id:'dj-3', bpm:127 })
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

const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  buildBattleRoomState,
  setBattleEntryReady,
  startBattleIfReady,
  touchBattleRoomPresence
} = require('../battle_prep_snapshots');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'sql', '014_create_battle_prep_entry_snapshots.sql'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

describe('server-backed live Battle Room synchronization', () => {
  it('allows only the entry owner to ready up after immutable snapshot validation and auto-starts when all required DJs are ready', async () => {
    const client = dataClient(seedData({
      battle_records:[battleRecord({ status:'matched', start_conditions:{ startsWhenFull:true } })],
      battle_entries:[
        entry({ id:'entry-creator', user_id:'dj-1', status:'ready', ready_at:'2026-08-26T12:00:00.000Z', battle_prep_snapshot_id:'snap-creator' }),
        entry({ id:'entry-joiner', user_id:'dj-2', status:'preparing', battle_prep_snapshot_id:'snap-joiner' })
      ],
      battle_prep_entry_snapshots:[
        snapshotRow({ id:'snap-creator', battle_entry_id:'entry-creator', user_id:'dj-1', crate_id:'crate-a' }),
        snapshotRow({ id:'snap-joiner', battle_entry_id:'entry-joiner', user_id:'dj-2', crate_id:'crate-b', tracks:[snapshotTrack({ libraryTrackId:'track-2' })] })
      ]
    }));

    const foreign = await setBattleEntryReady(client, 'dj-1', 'entry-joiner', true);
    expect(foreign.forbidden).to.equal(true);

    const ready = await setBattleEntryReady(client, 'dj-2', 'entry-joiner', true, new Date('2026-08-26T12:05:00.000Z'));
    expect(ready.autoStarted).to.equal(true);
    expect(client.db.battle_records[0].status).to.equal('started');
    expect(client.db.battle_records[0].battle_version).to.equal(1);
    expect(client.db.battle_records[0].deadline_at).to.equal('2026-08-26T12:25:00.000Z');
    expect(ready.state.timing.remainingSeconds).to.equal(1200);
    expect(ready.state.participants.every(row => row.status === 'started')).to.equal(true);
  });

  it('rejects premature, duplicate and unauthorized start attempts while preserving authoritative timer state', async () => {
    const prematureClient = dataClient(seedData({
      battle_records:[battleRecord({ status:'matched', start_conditions:{ manualStart:true } })],
      battle_entries:[
        entry({ id:'entry-creator', user_id:'dj-1', status:'ready', battle_prep_snapshot_id:'snap-creator' }),
        entry({ id:'entry-joiner', user_id:'dj-2', status:'preparing', battle_prep_snapshot_id:'snap-joiner' })
      ]
    }));
    const premature = await startBattleIfReady(prematureClient, 'battle-live', { userId:'dj-1' }, new Date('2026-08-26T12:00:00.000Z'));
    expect(premature.conflict).to.equal(true);

    const unauthorizedClient = dataClient(seedData({
      battle_records:[battleRecord({ status:'matched', start_conditions:{ manualStart:true } })],
      battle_entries:[
        entry({ id:'entry-creator', user_id:'dj-1', status:'ready', battle_prep_snapshot_id:'snap-creator' }),
        entry({ id:'entry-joiner', user_id:'dj-2', status:'ready', battle_prep_snapshot_id:'snap-joiner' })
      ]
    }));
    const unauthorized = await startBattleIfReady(unauthorizedClient, 'battle-live', { userId:'dj-2' }, new Date('2026-08-26T12:00:00.000Z'));
    expect(unauthorized.forbidden).to.equal(true);

    const started = await startBattleIfReady(unauthorizedClient, 'battle-live', { userId:'dj-1' }, new Date('2026-08-26T12:00:00.000Z'));
    expect(started.started).to.equal(true);
    const duplicate = await startBattleIfReady(unauthorizedClient, 'battle-live', { userId:'dj-1' }, new Date('2026-08-26T12:01:00.000Z'));
    expect(duplicate.duplicate).to.equal(true);
    expect(duplicate.state.timing.deadlineAt).to.equal('2026-08-26T12:20:00.000Z');
  });

  it('returns versioned sanitized room state and marks stale client versions without exposing opponent prep', async () => {
    const client = dataClient(seedData({
      battle_records:[battleRecord({ status:'started', started_at:'2026-08-26T12:00:00.000Z', deadline_at:'2026-08-26T12:20:00.000Z', battle_version:2 })],
      battle_entries:[
        entry({ id:'entry-creator', user_id:'dj-1', status:'started', battle_prep_snapshot_id:'snap-creator', public_profile:{ name:'Creator', country:'US', email:'hidden@example.com' } }),
        entry({ id:'entry-joiner', user_id:'dj-2', status:'submitted', battle_prep_snapshot_id:'snap-secret', public_profile:{ name:'Rival', country:'GB', belt:'Green', storage:'private/opponent' } })
      ],
      battle_prep_entry_snapshots:[
        snapshotRow({ id:'snap-creator', battle_entry_id:'entry-creator', user_id:'dj-1' }),
        snapshotRow({ id:'snap-secret', battle_entry_id:'entry-joiner', user_id:'dj-2', tracks:[snapshotTrack({ libraryTrackId:'secret-track' })] })
      ],
      mix_submissions:[{ id:'sub-rival', battle_entry_id:'entry-joiner', user_id:'dj-2', status:'uploaded', uploaded_at:'2026-08-26T12:08:00.000Z', created_at:'2026-08-26T12:08:00.000Z' }]
    }));

    const state = await buildBattleRoomState(client, 'dj-1', 'battle-live', { ifVersion:5 }, new Date('2026-08-26T12:10:00.000Z'));
    expect(state.stale).to.equal(true);
    expect(state.state.version).to.equal(2);
    expect(state.state.timing.remainingSeconds).to.equal(600);
    const opponent = state.state.participants.find(row => !row.entryId);
    expect(opponent.submission.submitted).to.equal(true);
    expect(JSON.stringify(state.state)).to.not.include('secret-track');
    expect(JSON.stringify(state.state)).to.not.include('hidden@example.com');
    expect(JSON.stringify(state.state)).to.not.include('private/opponent');
    expect(JSON.stringify(state.state)).to.not.include('dj-2');
  });

  it('tracks privacy-safe presence without erasing entries, snapshots or submissions', async () => {
    const client = dataClient(seedData({
      battle_records:[battleRecord({ status:'matched' })],
      battle_entries:[entry({ id:'entry-joiner', user_id:'dj-2', status:'preparing', battle_prep_snapshot_id:'snap-joiner' })],
      battle_prep_entry_snapshots:[snapshotRow({ id:'snap-joiner', battle_entry_id:'entry-joiner', user_id:'dj-2', crate_id:'crate-b', tracks:[snapshotTrack({ libraryTrackId:'track-2' })] })]
    }));
    const touched = await touchBattleRoomPresence(client, 'dj-2', 'entry-joiner', { presence:'offline' }, new Date('2026-08-26T12:00:00.000Z'));
    expect(touched.entry.status).to.equal('disconnected');
    expect(client.db.battle_prep_entry_snapshots).to.have.length(1);
    expect(touched.state.participants[0].presence.status).to.equal('offline');
    expect(JSON.stringify(touched.state)).to.not.include('127.0.0.1');
  });

  it('defines protected room routes and additive live-room migration fields', () => {
    expect(serverSource).to.include("app.get('/api/battles/:battleId/room', requireAuth");
    expect(serverSource).to.include("app.post('/api/battleEntries/:entryId/ready', requireAuth");
    expect(serverSource).to.include("app.post('/api/battles/:battleId/start', requireAuth");
    expect(serverSource).to.include("app.post('/api/battleEntries/:entryId/presence', requireAuth");
    expect(sql).to.include('battle_version');
    expect(sql).to.include('deadline_at');
    expect(sql).to.include('presence_last_seen_at');
    expect(sql).to.include('battle_entries_room_state_idx');
    expect(sql).to.include('battle_entries_public_profile_redaction_check');
    expect(sql).to.not.include('CREATE EXTENSION');
  });
});

function battleRecord(overrides = {}){
  return {
    id:'battle-live',
    created_by:'dj-1',
    mode_id:'own_selection_battle',
    title:'Live Battle',
    genre:'Open Format',
    duration_minutes:20,
    track_selection_method:'own_selection',
    track_count:null,
    minimum_track_count:1,
    opponent_requirement:'required',
    capacity:2,
    visibility:'public',
    status:'matched',
    scoring_type:'hybrid',
    start_conditions:{ startsWhenFull:true },
    public_creator_profile:{ name:'Creator', country:'US', belt:'Blue' },
    reward_type:'xp',
    reward:{ type:'xp', metadata:{} },
    bitcoin_reward_metadata:null,
    battle_version:0,
    created_at:'2026-08-26T11:00:00.000Z',
    updated_at:'2026-08-26T11:00:00.000Z',
    ...overrides
  };
}

function entry(overrides = {}){
  return {
    id:'entry-creator',
    battle_id:'battle-live',
    user_id:'dj-1',
    status:'preparing',
    public_profile:{ name:'Creator', country:'US', belt:'Blue' },
    presence_status:'online',
    presence_last_seen_at:'2026-08-26T12:00:00.000Z',
    created_at:'2026-08-26T11:01:00.000Z',
    updated_at:'2026-08-26T11:01:00.000Z',
    ...overrides
  };
}

function snapshotTrack(overrides = {}){
  return {
    libraryTrackId:'track-1',
    order:0,
    bpm:124,
    key:'A minor',
    camelotKey:'8A',
    genre:'Open Format',
    duration:180,
    status:'ready',
    availability:'available',
    reasons:[],
    ...overrides
  };
}

function snapshotRow(overrides = {}){
  return {
    id:'snap-creator',
    battle_id:'battle-live',
    battle_entry_id:'entry-creator',
    user_id:'dj-1',
    crate_id:'crate-a',
    crate_version:'v1',
    snapshot_version:'snap-v1',
    purpose:'own_selection',
    track_selection_method:'own_selection',
    replacement_allowed:true,
    tracks:[snapshotTrack()],
    rule_decisions:{ ready:true, blockers:[], warnings:[], method:'own_selection', purpose:'own_selection' },
    availability:{ status:'available', unavailableTrackCount:0 },
    replacements:[],
    created_at:'2026-08-26T11:02:00.000Z',
    updated_at:'2026-08-26T11:02:00.000Z',
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
    battle_records: [],
    battle_entries: [],
    battle_prep_entry_snapshots: [],
    battle_prep_snapshot_replacements: [],
    mix_submissions: [],
    music_library_tracks: [
      track({ id:'track-1', user_id:'dj-1' }),
      track({ id:'track-2', user_id:'dj-2' })
    ],
    music_library_crates: [],
    music_library_crate_memberships: [],
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

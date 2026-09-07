const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  LIBRARY_ARTWORK_BUCKET,
  LIBRARY_TRACK_TABLE,
  LIBRARY_CRATE_TABLE,
  LIBRARY_CRATE_MEMBERSHIP_TABLE,
  buildLibraryTrackPayload,
  camelotKeyFor,
  checkMusicLibrarySchemaReadiness,
  checkMusicLibraryOrganizationSchemaReadiness,
  validateArtworkMetadata,
  sanitizeLibraryTrack,
  sanitizeLibraryCrate,
  createLibraryTrack,
  createLibraryCrate,
  duplicateLibraryCrate,
  listOwnedLibraryCrates,
  listOwnedLibraryTracks,
  updateLibraryTrack,
  archiveLibraryTrack,
  issueLibraryAudioUploadAuthorization,
  completeLibraryAudioUpload,
  issueLibraryArtworkUploadAuthorization,
  completeLibraryArtworkUpload,
  removeLibraryArtwork,
  issueLibraryPlaybackAccess,
  recordLibraryTrackUsage,
  setLibraryCrateMemberships,
  trackMatchesSmartRules,
  createPracticeRecordingFromSubmission
} = require('../music_library');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'sql', '012_create_music_library_tracks.sql'), 'utf8');
const sql13 = fs.readFileSync(path.join(root, 'sql', '013_create_music_library_crates.sql'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

function uploadedSubmission(overrides = {}){
  return {
    id:'sub-1',
    user_id:'user-1',
    status:'uploaded',
    storage_object_path:'private/battle-entries/entry-1/submissions/sub-1/mix.webm',
    original_filename:'round-one.webm',
    declared_mime_type:'audio/webm',
    verified_mime_type:'audio/webm',
    file_size:1024,
    verified_object_size:1024,
    duration:92,
    ...overrides
  };
}

function libraryTrack(overrides = {}){
  return {
    id:'track-1',
    user_id:'user-1',
    source_type:'track',
    linked_submission_id:null,
    title:'Deck Tool',
    artist:'Digital King',
    bpm:128,
    key:'A minor',
    camelot_key:'8A',
    genre:'Bass House',
    duration:180,
    tags:['battle'],
    rights_classification:'original',
    visibility:'private',
    analysis_confidence:0.82,
    original_filename:'deck-tool.webm',
    declared_mime_type:'audio/webm',
    file_size:2048,
    file_hash:'a'.repeat(64),
    audio_storage_bucket:'battle-mixes',
    audio_storage_object_path:'private/library-audio/user-1/tracks/track-1/audio.webm',
    artwork_storage_bucket:null,
    artwork_storage_object_path:null,
    artwork_metadata:null,
    pending_artwork_metadata:null,
    usage_relationships:{ playlists:['warmups'], battles:[], posts:[], practiceHistory:[], submissions:[] },
    created_at:'2026-08-25T12:00:00.000Z',
    updated_at:'2026-08-25T12:00:00.000Z',
    archived_at:null,
    ...overrides
  };
}

describe('server-backed music library contract', () => {
  it('builds owned metadata with Camelot keys and sanitized public output', () => {
    const payload = buildLibraryTrackPayload('user-1', {
      id:'track-1',
      title:'Harmonic Opener',
      artist:'Digital King',
      bpm:128,
      key:'A minor',
      genre:'Bass House',
      duration:180,
      tags:['battle', 'warmup'],
      rightsClassification:'original',
      visibility:'profile',
      analysisConfidence:0.88,
      originalFilename:'opener.webm',
      declaredMimeType:'audio/webm',
      fileSize:4096
    }, new Date('2026-08-25T12:00:00Z'));

    expect(payload.user_id).to.equal('user-1');
    expect(payload.camelot_key).to.equal('8A');
    expect(payload.audio_storage_object_path).to.equal('private/library-audio/user-1/tracks/track-1/audio.webm');
    expect(payload.audio_storage_object_path).to.not.match(/^https?:/);

    const sanitized = sanitizeLibraryTrack({ ...payload, artwork_storage_object_path:'private/library-artwork/user-1/tracks/track-1/artwork.png', artwork_metadata:{ mimeType:'image/png', size:512 } });
    expect(sanitized.camelotKey).to.equal('8A');
    expect(sanitized.hasAudio).to.equal(true);
    expect(sanitized.hasArtwork).to.equal(true);
    const serialized = JSON.stringify(sanitized);
    expect(serialized).to.not.include('private/library-audio');
    expect(serialized).to.not.include('private/library-artwork');
  });

  it('reuses owned uploaded submissions and prevents duplicate library records', async () => {
    const db = dataClient({
      mix_submissions:[uploadedSubmission()],
      music_library_tracks:[]
    });

    const created = await createLibraryTrack(db, 'user-1', {
      id:'track-sub-1',
      sourceType:'submission',
      sourceSubmissionId:'sub-1',
      title:'Battle Entry Keeper',
      artist:'Digital King',
      key:'C major',
      genre:'House',
      rightsClassification:'original'
    });
    expect(created.created).to.equal(true);
    expect(created.rawTrack.audio_storage_object_path).to.equal('private/battle-entries/entry-1/submissions/sub-1/mix.webm');
    expect(created.track.linkedSubmissionId).to.equal('sub-1');

    const duplicate = await createLibraryTrack(db, 'user-1', {
      id:'track-sub-2',
      sourceType:'submission',
      sourceSubmissionId:'sub-1',
      title:'Duplicate'
    });
    expect(duplicate.duplicate).to.equal(true);

    const foreign = await createLibraryTrack(dataClient({ mix_submissions:[uploadedSubmission({ user_id:'user-2' })], music_library_tracks:[] }), 'user-1', {
      sourceType:'submission',
      sourceSubmissionId:'sub-1',
      title:'Foreign'
    });
    expect(foreign.forbidden).to.equal(true);
  });

  it('checks schema readiness and paginates owned hydration without applying migrations', async () => {
    const ready = await checkMusicLibrarySchemaReadiness(dataClient({ music_library_tracks:[libraryTrack()], mix_submissions:[] }));
    expect(ready.ready).to.equal(true);
    expect(ready.schema).to.equal('012_create_music_library_tracks');

    const missing = await checkMusicLibrarySchemaReadiness({
      from(){ return { select(){ return this; }, limit(){ return Promise.resolve({ data:null, error:new Error('relation "music_library_tracks" does not exist') }); } }; }
    });
    expect(missing.ready).to.equal(false);
    expect(missing.status).to.equal('migration_required');

    const db = dataClient({
      music_library_tracks:[
        libraryTrack({ id:'track-1' }),
        libraryTrack({ id:'track-2' }),
        libraryTrack({ id:'track-3' })
      ]
    });
    const page = await listOwnedLibraryTracks(db, 'user-1', { page:1, limit:2 });
    expect(page.tracks.map(track => track.id)).to.deep.equal(['track-1', 'track-2']);
    expect(page.pagination.hasMore).to.equal(true);
    expect(page.pagination.nextPage).to.equal(2);
  });


  it('authorizes, verifies, replaces and removes artwork without disconnecting audio', async () => {
    const db = dataClient({ music_library_tracks:[libraryTrack()] });
    const storage = storageClient({ 'private/library-artwork/user-1/tracks/track-1/artwork.png': { size:900, mimetype:'image/png' } });

    const rejected = await issueLibraryArtworkUploadAuthorization(db, storage, 'user-1', 'track-1', { filename:'bad.svg', mimeType:'image/svg+xml', size:100 });
    expect(rejected.validationError).to.equal('Artwork MIME type is not allowed');

    const auth = await issueLibraryArtworkUploadAuthorization(db, storage, 'user-1', 'track-1', { filename:'cover.png', mimeType:'image/png', size:900 }, new Date('2026-08-25T12:00:00Z'));
    expect(auth.bucket).to.equal(LIBRARY_ARTWORK_BUCKET);
    expect(auth.uploadPath).to.equal('private/library-artwork/user-1/tracks/track-1/artwork.png');

    const completed = await completeLibraryArtworkUpload(db, storage, 'user-1', 'track-1', new Date('2026-08-25T12:01:00Z'));
    expect(completed.track.hasArtwork).to.equal(true);
    expect(db.tables.music_library_tracks[0].audio_storage_object_path).to.equal('private/library-audio/user-1/tracks/track-1/audio.webm');

    const removed = await removeLibraryArtwork(db, storage, 'user-1', 'track-1');
    expect(removed.track.hasArtwork).to.equal(false);
    expect(db.tables.music_library_tracks[0].audio_storage_object_path).to.equal('private/library-audio/user-1/tracks/track-1/audio.webm');
    expect(storage.removed).to.deep.equal(['private/library-artwork/user-1/tracks/track-1/artwork.png']);
  });

  it('authorizes and verifies private library audio without exposing permanent URLs', async () => {
    const db = dataClient({ music_library_tracks:[libraryTrack()] });
    const storage = storageClient({ 'private/library-audio/user-1/tracks/track-1/audio.webm': { size:2048, mimetype:'audio/webm' } });

    const auth = await issueLibraryAudioUploadAuthorization(db, storage, 'user-1', 'track-1', new Date('2026-08-25T12:00:00Z'));
    expect(auth.bucket).to.equal('battle-mixes');
    expect(auth.uploadPath).to.equal('private/library-audio/user-1/tracks/track-1/audio.webm');
    expect(auth.uploadPath).to.not.match(/^https?:/);

    const completed = await completeLibraryAudioUpload(db, storage, 'user-1', 'track-1', new Date('2026-08-25T12:01:00Z'));
    expect(completed.track.hasAudio).to.equal(true);
    expect(completed.rawTrack.verified_mime_type).to.equal('audio/webm');
    expect(JSON.stringify(completed.track)).to.not.include('private/library-audio');
  });

  it('issues time-limited playback access only for owned private audio', async () => {
    const db = dataClient({ music_library_tracks:[libraryTrack()] });
    const playback = await issueLibraryPlaybackAccess(db, storageClient({}), 'user-1', 'track-1', new Date('2026-08-25T12:00:00Z'));

    expect(playback.track.playbackAccess.url).to.equal('https://signed.local/private%2Flibrary-audio%2Fuser-1%2Ftracks%2Ftrack-1%2Faudio.webm');
    expect(playback.track.playbackAccess.expiresAt).to.equal('2026-08-25T12:05:00.000Z');
    expect(JSON.stringify(playback.track)).to.not.include('audio_storage_object_path');

    const foreign = await issueLibraryPlaybackAccess(dataClient({ music_library_tracks:[libraryTrack({ user_id:'user-2' })] }), storageClient({}), 'user-1', 'track-1');
    expect(foreign.forbidden).to.equal(true);
  });

  it('preserves usage relationships through metadata updates and archives instead of deleting files', async () => {
    const db = dataClient({ music_library_tracks:[libraryTrack()] });
    const used = await recordLibraryTrackUsage(db, 'user-1', 'track-1', { type:'battle', id:'battle-7' });
    expect(used.track.usageRelationships.battles).to.deep.equal(['battle-7']);

    const updated = await updateLibraryTrack(db, 'user-1', 'track-1', { title:'Renamed Tool', key:'C major' });
    expect(updated.track.title).to.equal('Renamed Tool');
    expect(updated.track.camelotKey).to.equal('8B');
    expect(updated.track.usageRelationships.battles).to.deep.equal(['battle-7']);
    expect(db.tables.music_library_tracks[0].audio_storage_object_path).to.equal('private/library-audio/user-1/tracks/track-1/audio.webm');

    const archived = await archiveLibraryTrack(db, 'user-1', 'track-1', new Date('2026-08-25T13:00:00Z'));
    expect(archived.track.archived).to.equal(true);
    expect(db.tables.music_library_tracks[0].audio_storage_object_path).to.equal('private/library-audio/user-1/tracks/track-1/audio.webm');
  });

  it('syncs owned crates with ordered memberships, duplicate prevention and smart rules', async () => {
    const db = dataClient({
      music_library_tracks:[
        libraryTrack({ id:'track-1', bpm:128, key:'A minor', camelot_key:'8A', rights_classification:'original', analysis_confidence:0.9 }),
        libraryTrack({ id:'track-2', bpm:130, key:'E minor', camelot_key:'9A', rights_classification:'licensed', analysis_confidence:null }),
        libraryTrack({ id:'track-3', user_id:'user-2', bpm:128, key:'A minor', camelot_key:'8A' })
      ],
      music_library_crates:[],
      music_library_crate_memberships:[]
    });

    const ready = await checkMusicLibraryOrganizationSchemaReadiness(db);
    expect(ready.ready).to.equal(true);
    expect(ready.schema).to.equal('013_create_music_library_crates');

    const crate = await createLibraryCrate(db, 'user-1', { id:'crate-1', name:'Battle Prep House', type:'battle_prep', trackIds:['track-2','track-1'] }, new Date('2026-08-25T13:00:00Z'));
    expect(crate.crate.trackIds).to.deep.equal(['track-2', 'track-1']);
    expect(crate.crate.type).to.equal('battle_prep');

    const duplicate = await setLibraryCrateMemberships(db, 'user-1', 'crate-1', ['track-1', 'track-1']);
    expect(duplicate.validationError).to.equal('Duplicate crate memberships are not allowed');

    const foreign = await setLibraryCrateMemberships(db, 'user-1', 'crate-1', ['track-3']);
    expect(foreign.forbidden).to.equal(true);

    const reordered = await setLibraryCrateMemberships(db, 'user-1', 'crate-1', ['track-1', 'track-2'], {}, new Date('2026-08-25T13:05:00Z'));
    expect(reordered.crate.trackIds).to.deep.equal(['track-1', 'track-2']);

    const copy = await duplicateLibraryCrate(db, 'user-1', 'crate-1', { name:'Battle Prep Copy' });
    expect(copy.crate.trackIds).to.deep.equal(['track-1', 'track-2']);

    await createLibraryCrate(db, 'user-1', { id:'smart-1', name:'Missing Analysis', type:'smart_crate', smartRules:{ analysisStatus:'missing' } });
    const listed = await listOwnedLibraryCrates(db, 'user-1');
    const smart = listed.crates.find(row => row.id === 'smart-1');
    expect(smart.trackIds).to.deep.equal(['track-2']);
    expect(trackMatchesSmartRules(db.tables.music_library_tracks[1], { analysisStatus:'missing' })).to.equal(true);
    expect(JSON.stringify(sanitizeLibraryCrate(db.tables.music_library_crates[0], db.tables.music_library_crate_memberships, db.tables.music_library_tracks))).to.not.include('private/library-audio');
  });

  it('saves practice recordings as reusable owned library tracks without duplicating audio', async () => {
    const db = dataClient({
      mix_submissions:[uploadedSubmission({ id:'practice-sub-1', status:'completed', storage_object_path:'private/battle-entries/entry-9/submissions/practice-sub-1/mix.webm' })],
      music_library_tracks:[],
      music_library_crates:[],
      music_library_crate_memberships:[]
    });

    const recording = await createPracticeRecordingFromSubmission(db, 'user-1', {
      id:'practice-track-1',
      sourceSubmissionId:'practice-sub-1',
      practiceHistoryId:'practice-history-1',
      title:'Practice Keeper',
      artist:'Digital King',
      bpm:126,
      key:'D minor',
      genre:'House',
      score:91,
      recommendations:['Tighten the second blend'],
      analysisSummary:{ timingAccuracy:93, transitionQuality:88, keyConfidence:0.8 }
    });

    expect(recording.created).to.equal(true);
    expect(recording.track.sourceType).to.equal('practice_recording');
    expect(recording.track.linkedSubmissionId).to.equal('practice-sub-1');
    expect(recording.track.practiceMetadata.score).to.equal(91);
    expect(recording.rawTrack.audio_storage_object_path).to.equal('private/battle-entries/entry-9/submissions/practice-sub-1/mix.webm');
    expect(db.tables.music_library_tracks).to.have.length(1);

    const duplicate = await createPracticeRecordingFromSubmission(db, 'user-1', { sourceSubmissionId:'practice-sub-1', title:'Again' });
    expect(duplicate.duplicate).to.equal(true);

    const foreign = await createPracticeRecordingFromSubmission(dataClient({
      mix_submissions:[uploadedSubmission({ id:'practice-sub-1', user_id:'user-2' })],
      music_library_tracks:[],
      music_library_crates:[],
      music_library_crate_memberships:[]
    }), 'user-1', { sourceSubmissionId:'practice-sub-1', title:'Foreign' });
    expect(foreign.forbidden).to.equal(true);
  });

  it('defines protected routes, ownership SQL and safe storage constraints', () => {
    expect(validateArtworkMetadata({ filename:'cover.webp', mimeType:'image/webp', size:1024 }).extension).to.equal('webp');
    expect(camelotKeyFor('D min')).to.equal('7A');
    expect(sql).to.include('CREATE TABLE IF NOT EXISTS music_library_tracks');
    expect(sql13).to.include('CREATE TABLE IF NOT EXISTS music_library_crates');
    expect(sql13).to.include('music_library_crate_memberships');
    expect(sql13).to.include('ADD COLUMN IF NOT EXISTS practice_metadata');
    expect(sql).to.include('FOREIGN KEY (linked_submission_id, user_id)');
    expect(sql).to.include("audio_storage_object_path !~* '^(https?|data|file):'");
    expect(sql).to.include('allow_select_own_music_library_tracks');
    expect(serverSource).to.include("app.get('/api/musicLibrary/tracks', requireAuth");
    expect(serverSource).to.include("app.get('/api/musicLibrary/crates', requireAuth");
    expect(serverSource).to.include("app.post('/api/musicLibrary/practiceRecordings', requireAuth");
    expect(serverSource).to.include("app.get('/api/musicLibrary/schemaStatus', requireAuth");
    expect(serverSource).to.include("app.get('/api/musicLibrary/organizationStatus', requireAuth");
    expect(serverSource).to.include("app.post('/api/musicLibrary/tracks/:trackId/artworkUploadAuthorization', requireAuth");
    expect(serverSource).to.include("app.post('/api/musicLibrary/tracks/:trackId/completeAudioUpload', requireAuth");
    expect(serverSource).to.include("app.post('/api/musicLibrary/tracks/:trackId/playbackAccess', requireAuth");
    expect(serverSource).to.include('issueLibraryPlaybackAccess(supabaseService');
    expect(LIBRARY_TRACK_TABLE).to.equal('music_library_tracks');
    expect(LIBRARY_CRATE_TABLE).to.equal('music_library_crates');
    expect(LIBRARY_CRATE_MEMBERSHIP_TABLE).to.equal('music_library_crate_memberships');
  });
});

function dataClient(initial){
  const tables = {
    music_library_tracks:(initial.music_library_tracks || []).map(row => ({ ...row })),
    music_library_crates:(initial.music_library_crates || []).map(row => ({ ...row })),
    music_library_crate_memberships:(initial.music_library_crate_memberships || []).map(row => ({ ...row })),
    mix_submissions:(initial.mix_submissions || []).map(row => ({ ...row }))
  };
  return {
    tables,
    from(table){ return new Query(tables, table); }
  };
}

class Query{
  constructor(tables, table){
    this.tables = tables;
    this.table = table;
    this.filters = [];
    this.limitValue = null;
    this.rangeValue = null;
    this.insertRows = null;
    this.updateValues = null;
  }
  select(){ return this; }
  eq(field, value){ this.filters.push([field, value]); return this; }
  limit(value){ this.limitValue = Number(value); return this; }
  range(from, to){ this.rangeValue = [Number(from), Number(to)]; return this; }
  insert(rows){ this.insertRows = rows; return this; }
  update(values){ this.updateValues = values; return this; }
  then(resolve, reject){ return this.execute().then(resolve, reject); }
  async single(){
    const result = await this.execute();
    if(result.error) return result;
    return { data:Array.isArray(result.data) ? result.data[0] : result.data, error:null };
  }
  async execute(){
    const rows = this.tables[this.table];
    if(!rows) return { data:null, error:new Error(`Unknown table ${this.table}`) };
    if(this.insertRows){
      this.insertRows.forEach(row => rows.push({ ...row }));
      return { data:this.insertRows.map(row => ({ ...row })), error:null };
    }
    const matched = rows.filter(row => this.filters.every(([field, value]) => String(row[field]) === String(value)));
    if(this.updateValues){
      matched.forEach(row => Object.assign(row, this.updateValues));
      return { data:matched.map(row => ({ ...row })), error:null };
    }
    const ranged = this.rangeValue ? matched.slice(this.rangeValue[0], this.rangeValue[1] + 1) : matched;
    const limited = this.limitValue ? ranged.slice(0, this.limitValue) : ranged;
    return { data:limited.map(row => ({ ...row })), error:null };
  }
}

function storageClient(objects){
  return {
    removed:[],
    async createSignedUploadUrl(objectPath){
      return { data:{ path:objectPath, token:`token:${objectPath}` }, error:null };
    },
    async createSignedUrl(objectPath){
      return { data:{ signedUrl:`https://signed.local/${encodeURIComponent(objectPath)}` }, error:null };
    },
    async list(prefix, options){
      const search = options && options.search;
      const rows = Object.entries(objects)
        .filter(([objectPath]) => objectPath.startsWith(prefix + '/') && (!search || objectPath.endsWith('/' + search)))
        .map(([objectPath, metadata]) => ({ name:objectPath.slice(prefix.length + 1), metadata }));
      return { data:rows, error:null };
    },
    async remove(paths){
      this.removed.push(...paths);
      return { data:paths, error:null };
    }
  };
}

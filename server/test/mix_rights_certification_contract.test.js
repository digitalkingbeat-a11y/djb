const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  MIX_RIGHTS_CERTIFICATION_SCHEMA,
  MIX_RIGHTS_CERTIFICATION_TABLE,
  CERTIFICATION_STATUSES,
  certifyMixRights,
  checkMixRightsCertificationSchemaReadiness,
  getMixRightsPublicationGate,
  getOwnedMixRightsCertification,
  listOwnedMixRightsCertifications,
  requiresDjMixRightsCertification,
  revokeMixRightsCertification
} = require('../mix_rights_certification');
const {
  getPublicBattleResult,
  listPublicBattleResults,
  saveOwnedBattleResultSummary,
  stableVerifiedResultId
} = require('../battle_result_history');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'sql', '025_create_mix_rights_certifications.sql'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const now = new Date('2026-09-05T15:00:00Z');

function submission(overrides = {}){
  return {
    id:'sub-1',
    battle_entry_id:'entry-1',
    user_id:'dj-1',
    status:'completed',
    storage_object_path:'private/battle-entries/entry-1/submissions/sub-1/mix.webm',
    original_filename:'battle-mix.webm',
    declared_mime_type:'audio/webm',
    file_size:123456,
    duration:120,
    processing_info:{
      battleContext:{
        battleId:'battle-1',
        battleEntryId:'entry-1',
        battlePrepSnapshotId:'snap-1',
        battlePrepSnapshotVersion:'snap-v1',
        modeId:'transition_battle',
        type:'Transition Battle',
        genre:'Bass House',
        discipline:'dj'
      }
    },
    judge_result:{
      score:91,
      overallScore:91,
      won:true,
      opponentScore:84,
      evidenceType:'MEASURABLE_AUDIO_RULE_BASED',
      battleDiscipline:'dj',
      battleMode:'transition_battle',
      breakdown:{ timing:{ score:93 } },
      timing:[{ label:'Transition 1', timeMs:20000 }]
    },
    created_at:'2026-09-05T14:50:00.000Z',
    updated_at:'2026-09-05T14:59:00.000Z',
    ...overrides
  };
}

function snapshot(overrides = {}){
  return {
    id:'snap-1',
    battle_id:'battle-1',
    battle_entry_id:'entry-1',
    user_id:'dj-1',
    crate_id:'crate-1',
    snapshot_version:'snap-v1',
    purpose:'own_selection',
    track_selection_method:'own_selection',
    tracks:[
      { libraryTrackId:'track-1', order:0, rightsClassification:'original', sourceType:'track', status:'ready', availability:'available', reasons:[] },
      { libraryTrackId:'track-2', order:1, rightsClassification:'licensed', sourceType:'track', status:'warning', availability:'available', reasons:['Track analysis is missing.'] },
      { libraryTrackId:'track-3', order:2, rightsClassification:'royalty_free', sourceType:'track', status:'ready', availability:'available', reasons:[], storageObjectPath:'private/library-audio/secret.wav' }
    ],
    rule_decisions:{ ready:true },
    availability:{ status:'available' },
    created_at:'2026-09-05T14:45:00.000Z',
    updated_at:'2026-09-05T14:45:00.000Z',
    ...overrides
  };
}

function certification(overrides = {}){
  return {
    id:'cert-1',
    submission_id:'sub-1',
    battle_entry_id:'entry-1',
    user_id:'dj-1',
    certification_status:'certified',
    certification_source:'battle_prep_snapshot',
    battle_prep_snapshot_id:'snap-1',
    battle_prep_snapshot_version:'snap-v1',
    public_result_allowed:true,
    replay_allowed:false,
    rights_attested:true,
    public_result_consent:true,
    replay_consent:false,
    attestation_text:'I certify rights.',
    attestation_version:'mix-rights-v1',
    track_evidence:[
      { libraryTrackId:'track-1', order:0, rightsClassification:'original', sourceType:'track', status:'ready', availability:'available', reasons:[] }
    ],
    blocked_reasons:[],
    warnings:[],
    operator_review_status:'not_requested',
    review_notes:null,
    certified_at:'2026-09-05T15:00:00.000Z',
    revoked_at:null,
    expires_at:null,
    created_at:'2026-09-05T15:00:00.000Z',
    updated_at:'2026-09-05T15:00:00.000Z',
    ...overrides
  };
}

function baseDb(overrides = {}){
  return dataClient({
    mix_submissions:[submission()],
    battle_prep_entry_snapshots:[snapshot()],
    mix_rights_certifications:[],
    marketplace_orders:[],
    marketplace_order_items:[],
    marketplace_payment_events:[],
    marketplace_entitlements:[],
    ...overrides
  });
}

describe('DJ mix rights certification contract', () => {
  it('certifies completed DJ mixes from immutable Battle Prep rights evidence', async () => {
    const db = baseDb();
    const result = await certifyMixRights(db, 'dj-1', 'sub-1', {
      rightsAttested:true,
      publicResultConsent:true,
      replayConsent:true,
      attestationText:'I own or have permission for every track in this DJ mix.',
      attestationVersion:'mix-rights-v2'
    }, now);

    expect(result.created).to.equal(true);
    expect(result.certification.status).to.equal('certified');
    expect(result.certification.publicResultAllowed).to.equal(true);
    expect(result.certification.replayAllowed).to.equal(true);
    expect(result.certification.certificationSource).to.equal('battle_prep_snapshot');
    expect(result.certification.battlePrepSnapshotVersion).to.equal('snap-v1');
    expect(result.certification.trackEvidence.map(track => track.rightsClassification)).to.deep.equal(['original', 'licensed', 'royalty_free']);
    expect(JSON.stringify(result.certification)).to.not.include('private/library-audio');

    const gate = await getMixRightsPublicationGate(db, db.tables.mix_submissions[0], now);
    expect(gate.allowed).to.equal(true);
    expect(db.tables.marketplace_orders).to.have.length(0);
    expect(db.tables.marketplace_order_items).to.have.length(0);
    expect(db.tables.marketplace_payment_events).to.have.length(0);
    expect(db.tables.marketplace_entitlements).to.have.length(0);
  });

  it('requires attestation and keeps incomplete, foreign and producer submissions outside certification', async () => {
    const missingAttestation = await certifyMixRights(baseDb(), 'dj-1', 'sub-1', { publicResultConsent:true }, now);
    expect(missingAttestation.validationError).to.match(/Rights attestation/);

    const incomplete = await certifyMixRights(baseDb({ mix_submissions:[submission({ status:'uploaded' })] }), 'dj-1', 'sub-1', {
      rightsAttested:true,
      publicResultConsent:true
    }, now);
    expect(incomplete.unavailable).to.equal(true);

    const foreign = await certifyMixRights(baseDb({ mix_submissions:[submission({ user_id:'dj-2' })] }), 'dj-1', 'sub-1', {
      rightsAttested:true,
      publicResultConsent:true
    }, now);
    expect(foreign.forbidden).to.equal(true);

    const producer = submission({
      processing_info:{ battleContext:{ modeId:'original_beat_battle', type:'Original Beat Battle', discipline:'producer' } },
      judge_result:{ ...submission().judge_result, battleDiscipline:'producer', battleMode:'original_beat_battle' }
    });
    expect(requiresDjMixRightsCertification(producer)).to.equal(false);
    const producerGate = await getMixRightsPublicationGate(baseDb({ mix_submissions:[producer] }), producer, now);
    expect(producerGate).to.deep.include({ allowed:true, notRequired:true });
  });

  it('blocks commercial/copyright evidence and routes unknown evidence to review without granting public use', async () => {
    const blockedDb = baseDb({
      battle_prep_entry_snapshots:[snapshot({
        tracks:[{ libraryTrackId:'track-commercial', rightsClassification:'commercial_copyrighted', sourceType:'track', status:'ready', availability:'available', reasons:[] }]
      })]
    });
    const blocked = await certifyMixRights(blockedDb, 'dj-1', 'sub-1', {
      rightsAttested:true,
      publicResultConsent:true
    }, now);
    expect(blocked.certification.status).to.equal('blocked');
    expect(blocked.certification.publicResultAllowed).to.equal(false);
    expect(blocked.certification.blockedReasons[0]).to.match(/does not permit/);
    const blockedSave = await saveOwnedBattleResultSummary(blockedDb, 'dj-1', 'sub-1', { visibility:'public' }, now);
    expect(blockedSave.rightsCertificationBlocked).to.equal(true);

    const reviewDb = baseDb({
      battle_prep_entry_snapshots:[snapshot({
        tracks:[{ libraryTrackId:'track-unknown', rightsClassification:'unknown', sourceType:'track', status:'ready', availability:'available', reasons:[] }]
      })]
    });
    const review = await certifyMixRights(reviewDb, 'dj-1', 'sub-1', {
      rightsAttested:true,
      publicResultConsent:true
    }, now);
    expect(review.certification.status).to.equal('review_required');
    expect(review.certification.publicResultAllowed).to.equal(false);
    const reviewGate = await getMixRightsPublicationGate(reviewDb, reviewDb.tables.mix_submissions[0], now);
    expect(reviewGate).to.deep.include({ allowed:false, certificationRequired:true, reviewRequired:true });
  });

  it('requires a certified public gate before public result writes, reads and discovery', async () => {
    const publicRow = submission({
      processing_info:{
        ...submission().processing_info,
        result_visibility:'public',
        verified_result_id:stableVerifiedResultId('sub-1'),
        battleResultSummary:{
          visibility:'public',
          verifiedResultId:stableVerifiedResultId('sub-1'),
          title:'Certified Battle',
          genre:'Bass House',
          profile:{ displayName:'Digital King', country:'US' }
        }
      }
    });
    const uncertifiedDb = baseDb({ mix_submissions:[publicRow], mix_rights_certifications:[] });
    const publicRead = await getPublicBattleResult(uncertifiedDb, stableVerifiedResultId('sub-1'));
    const publicList = await listPublicBattleResults(uncertifiedDb, { limit:10 });
    const publicSave = await saveOwnedBattleResultSummary(uncertifiedDb, 'dj-1', 'sub-1', { visibility:'public' }, now);

    expect(publicRead.private).to.equal(true);
    expect(publicList.results).to.deep.equal([]);
    expect(publicSave.rightsCertificationRequired).to.equal(true);

    await certifyMixRights(uncertifiedDb, 'dj-1', 'sub-1', {
      rightsAttested:true,
      publicResultConsent:true
    }, now);
    const saved = await saveOwnedBattleResultSummary(uncertifiedDb, 'dj-1', 'sub-1', {
      visibility:'public',
      title:'Certified Battle',
      profile:{ displayName:'Digital King', country:'US' }
    }, now);
    const certifiedRead = await getPublicBattleResult(uncertifiedDb, stableVerifiedResultId('sub-1'));
    const certifiedList = await listPublicBattleResults(uncertifiedDb, { limit:10 });

    expect(saved.result.visibility).to.equal('public');
    expect(saved.result.verifiedResultId).to.equal(stableVerifiedResultId('sub-1'));
    expect(certifiedRead.result.id).to.equal(stableVerifiedResultId('sub-1'));
    expect(certifiedList.results).to.have.length(1);
  });

  it('lets owners read their certifications and lets operators revoke the public gate', async () => {
    const db = baseDb();
    await certifyMixRights(db, 'dj-1', 'sub-1', {
      rightsAttested:true,
      publicResultConsent:true
    }, now);
    const owned = await getOwnedMixRightsCertification(db, 'dj-1', 'sub-1');
    const listed = await listOwnedMixRightsCertifications(db, 'dj-1');

    expect(owned.certification.status).to.equal('certified');
    expect(listed.certifications.map(row => row.submissionId)).to.deep.equal(['sub-1']);
    const foreign = await getOwnedMixRightsCertification(baseDb({ mix_submissions:[submission({ user_id:'dj-2' })] }), 'dj-1', 'sub-1');
    expect(foreign.forbidden).to.equal(true);

    const revoked = await revokeMixRightsCertification(db, 'operator-1', 'sub-1', { reason:'Rights dispute opened.' }, new Date('2026-09-05T15:10:00Z'));
    expect(revoked.certification.status).to.equal('revoked');
    expect(revoked.certification.publicResultAllowed).to.equal(false);
    const gate = await getMixRightsPublicationGate(db, db.tables.mix_submissions[0], now);
    expect(gate.certificationBlocked).to.equal(true);
  });

  it('reports schema readiness and wires certification routes without commerce or entitlement tables', async () => {
    const ready = await checkMixRightsCertificationSchemaReadiness(baseDb());
    expect(ready.ready).to.equal(true);
    expect(ready.schema).to.equal(MIX_RIGHTS_CERTIFICATION_SCHEMA);
    expect(MIX_RIGHTS_CERTIFICATION_TABLE).to.equal('mix_rights_certifications');
    expect(CERTIFICATION_STATUSES).to.deep.equal(['certified', 'review_required', 'blocked', 'revoked', 'expired']);

    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.mix_rights_certifications');
    expect(sql).to.include("certification_status IN ('certified', 'review_required', 'blocked', 'revoked', 'expired')");
    expect(sql).to.include('public_result_allowed');
    expect(sql).to.include('replay_allowed');
    expect(sql).to.include('track_evidence');
    expect(sql).to.include('allow_select_own_mix_rights_certifications');
    expect(sql).to.not.include('CREATE TABLE IF NOT EXISTS public.marketplace_orders');
    expect(sql).to.not.include('CREATE TABLE IF NOT EXISTS public.marketplace_payment_events');
    expect(sql).to.not.include('marketplace_entitlements');

    expect(serverSource).to.include("app.get('/api/mixRights/schemaStatus', requireAuth");
    expect(serverSource).to.include("app.get('/api/mixRights/certifications', requireAuth");
    expect(serverSource).to.include("app.post('/api/mixRights/certifications/:submissionId', requireAuth");
    expect(serverSource).to.include("app.post('/api/mixRights/certifications/:submissionId/revoke', requireAuth, requireOperatorUser");
    expect(serverSource).to.include('saveOwnedBattleResultSummary(supabaseService, req.authUser.id');
    expect(serverSource).to.include('rightsCertificationRequired');
  });
});

function dataClient(initial = {}){
  const tables = {
    mix_submissions:(initial.mix_submissions || []).map(clone),
    battle_prep_entry_snapshots:(initial.battle_prep_entry_snapshots || []).map(clone),
    mix_rights_certifications:(initial.mix_rights_certifications || []).map(clone),
    marketplace_orders:(initial.marketplace_orders || []).map(clone),
    marketplace_order_items:(initial.marketplace_order_items || []).map(clone),
    marketplace_payment_events:(initial.marketplace_payment_events || []).map(clone),
    marketplace_entitlements:(initial.marketplace_entitlements || []).map(clone),
    dj_follows:(initial.dj_follows || []).map(clone)
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
    this.insertRows = null;
    this.updateValues = null;
  }
  select(){ return this; }
  eq(field, value){ this.filters.push([field, value]); return this; }
  limit(value){ this.limitValue = Number(value); return this; }
  insert(rows){ this.insertRows = rows.map(clone); return this; }
  update(values){ this.updateValues = clone(values); return this; }
  then(resolve, reject){ return this.execute().then(resolve, reject); }
  async single(){
    const result = await this.execute();
    if(result.error) return result;
    return { data:Array.isArray(result.data) ? result.data[0] || null : result.data, error:null };
  }
  async execute(){
    const rows = this.tables[this.table];
    if(!rows) return { data:null, error:new Error(`Unknown table ${this.table}`) };
    if(this.insertRows){
      this.insertRows.forEach(row => rows.push(clone(row)));
      return { data:this.insertRows.map(clone), error:null };
    }
    const matched = rows.filter(row => this.filters.every(([field, value]) => String(row[field]) === String(value)));
    if(this.updateValues){
      matched.forEach(row => Object.assign(row, clone(this.updateValues)));
      return { data:matched.map(clone), error:null };
    }
    const limited = this.limitValue ? matched.slice(0, this.limitValue) : matched;
    return { data:limited.map(clone), error:null };
  }
}

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  buildPublicRankings,
  getPublicProfile,
  getOwnedBattleResult,
  getPublicBattleResult,
  listPublicBattleResults,
  listOwnedBattleResults,
  recordPublicProfileView,
  recordVerifiedResultView,
  sanitizeBattleResult,
  saveOwnedBattleResultSummary,
  setOwnedBattleResultVisibility,
  stablePublicProfileId,
  stableVerifiedResultId
} = require('../battle_result_history');

const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

function submission(overrides = {}){
  return {
    id:'sub-history',
    battle_entry_id:'entry-history',
    user_id:'user-1',
    status:'completed',
    storage_object_path:'private/battle-entries/entry-history/submissions/sub-history/mix.webm',
    processing_info:{
      service_key:'never-public',
      battleContext:{
        battleId:'entry-history',
        modeId:'bitcoin_battle',
        type:'Bitcoin Battle',
        genre:'Bass House',
        title:'Bitcoin Throwdown'
      },
      battleResultSummary:{
        visibility:'private',
        title:'Bitcoin Throwdown',
        modeId:'bitcoin_battle',
        type:'Bitcoin Battle',
        genre:'Bass House',
        outcome:'win',
        opponent:{ status:'opponent', name:'Rival DJ', country:'CA' },
        profile:{ displayName:'Digital King', country:'US' },
        progression:{ xp:80, ratingDelta:12 },
        progressBefore:{ xp:120, rankingRating:1700, belt:'White' },
        progressAfter:{ xp:200, rankingRating:1712, belt:'Yellow' },
        rankBefore:8,
        rankAfter:6,
        completedAt:'2026-08-25T12:00:00.000Z'
      }
    },
    judge_result:{
      overallScore:93,
      won:true,
      opponentScore:86,
      breakdown:{ timing:{ score:94 }, transition_quality:{ score:91 } },
      timing:[{ label:'Measured Transition 1', timeMs:18000 }],
      recommendations:['Tighten the second transition.'],
      confidence:{ measurableComponentRatio:0.8, trainedModelJudging:{ used:false } },
      evidenceType:'MEASURABLE_AUDIO_RULE_BASED',
      measurableAnalysis:{ durationSec:90, bpm:128, key:{ name:'A minor' }, transitionCount:3 },
      scoringModel:{ measurableAnalysis:'ffmpeg_audio_analyzer', ruleBasedScoring:'judge_engine' },
      reward:{ type:'bitcoin', metadata:{ network:'bitcoin', amountSats:2500, custody:'external_pending', walletConnected:false } }
    },
    updated_at:'2026-08-25T12:00:00.000Z',
    created_at:'2026-08-25T11:55:00.000Z',
    ...overrides
  };
}

function rightsCertificationForSubmission(row, overrides = {}){
  return {
    id:`cert-${row.id}`,
    submission_id:row.id,
    battle_entry_id:row.battle_entry_id,
    user_id:row.user_id,
    certification_status:'certified',
    certification_source:'battle_prep_snapshot',
    battle_prep_snapshot_id:null,
    battle_prep_snapshot_version:null,
    public_result_allowed:true,
    replay_allowed:false,
    rights_attested:true,
    public_result_consent:true,
    replay_consent:false,
    attestation_text:'I certify that this DJ mix is cleared for public result visibility.',
    attestation_version:'mix-rights-v1',
    track_evidence:[{ libraryTrackId:'track-1', rightsClassification:'original', sourceType:'track', status:'ready', availability:'available', reasons:[] }],
    blocked_reasons:[],
    warnings:[],
    operator_review_status:'not_requested',
    certified_at:'2026-08-25T12:00:00.000Z',
    revoked_at:null,
    expires_at:null,
    created_at:'2026-08-25T12:00:00.000Z',
    updated_at:'2026-08-25T12:00:00.000Z',
    ...overrides
  };
}

function dataClient(rows, initial = {}){
  const mixRows = rows.map(clone);
  const tables = {
    mix_submissions:mixRows,
    mix_rights_certifications:initial.mix_rights_certifications
      ? initial.mix_rights_certifications.map(clone)
      : mixRows.filter(row => row.status === 'completed').map(row => rightsCertificationForSubmission(row)),
    dj_follows:initial.dj_follows ? initial.dj_follows.map(clone) : []
  };
  const state = { rows:tables.mix_submissions, tables, updates: [] };
  class Query {
    constructor(table){
      this.table = table;
      this.filters = [];
      this.updateValues = null;
      this.limitCount = null;
    }
    select(){ return this; }
    eq(key, value){ this.filters.push({ key, value }); return this; }
    limit(value){ this.limitCount = Number(value); return this; }
    update(values){ this.updateValues = clone(values); return this; }
    matchingRows(){
      let rows = state.tables[this.table] || [];
      rows = rows.filter(row => this.filters.every(filter => String(row[filter.key]) === String(filter.value)));
      if(Number.isFinite(this.limitCount)) rows = rows.slice(0, this.limitCount);
      return rows;
    }
    async single(){
      const row = this.matchingRows()[0];
      if(!row) return { data:null, error:new Error('not found') };
      if(this.updateValues){
        Object.assign(row, clone(this.updateValues));
        state.updates.push({ filters:clone(this.filters), values:clone(this.updateValues) });
      }
      return { data:clone(row), error:null };
    }
    async execute(){
      return { data:this.matchingRows().map(clone), error:null };
    }
    then(resolve, reject){
      return this.execute().then(resolve, reject);
    }
  }
  return {
    state,
    from(table){
      if(!state.tables[table]) throw new Error(`Unknown table ${table}`);
      return new Query(table);
    }
  };
}

describe('battle result history and sharing contract', () => {
  it('sanitizes completed result history without exposing private storage or service internals', () => {
    const result = sanitizeBattleResult(submission());
    const serialized = JSON.stringify(result);

    expect(result.submissionId).to.equal('sub-history');
    expect(result.battle).to.deep.include({ modeId:'bitcoin_battle', type:'Bitcoin Battle', genre:'Bass House' });
    expect(result.profile).to.deep.include({ displayName:'Digital King', country:'US' });
    expect(result.opponent).to.deep.include({ name:'Rival DJ', country:'CA' });
    expect(result.score).to.equal(93);
    expect(result.reward).to.deep.include({ type:'bitcoin', transferStatus:'untransferred' });
    expect(result.scoringSource).to.include.members(['measured', 'rule-based', 'hybrid']);
    expect(serialized).to.not.include('private/battle-entries');
    expect(serialized).to.not.include('service_key');
    expect(serialized).to.not.include('never-public');
  });

  it('saves an owned summary on the completed submission record and blocks foreign users', async () => {
    const db = dataClient([submission()]);
    const saved = await saveOwnedBattleResultSummary(db, 'user-1', 'sub-history', {
      visibility:'public',
      title:'Verified Throwdown',
      genre:'Bass House',
      opponent:{ status:'opponent', name:'Rival DJ', country:'CA' },
      profile:{ displayName:'Digital King', country:'US' },
      progression:{ xp:80, ratingDelta:12 },
      progressBefore:{ xp:120, rankingRating:1700, belt:'White' },
      progressAfter:{ xp:200, rankingRating:1712, belt:'Yellow' },
      rankBefore:8,
      rankAfter:6,
      completedAt:'2026-08-25T12:00:00.000Z'
    }, new Date('2026-08-25T12:01:00.000Z'));

    expect(saved.result.visibility).to.equal('public');
    expect(saved.result.verifiedResultId).to.equal(stableVerifiedResultId('sub-history'));
    expect(saved.result.verifiedResultUrl).to.equal(`/results/${stableVerifiedResultId('sub-history')}`);
    expect(db.state.updates).to.have.length(1);
    expect(db.state.rows[0].processing_info.result_visibility).to.equal('public');
    expect(db.state.rows[0].processing_info.battleResultSummary.title).to.equal('Verified Throwdown');
    expect(JSON.stringify(db.state.rows[0].processing_info.battleResultSummary)).to.not.include('private/battle-entries');

    const foreign = await saveOwnedBattleResultSummary(dataClient([submission({ user_id:'user-2' })]), 'user-1', 'sub-history', { visibility:'public' });
    expect(foreign.forbidden).to.equal(true);
  });

  it('lists and reads only owned completed battle results', async () => {
    const db = dataClient([
      submission({ id:'sub-1', user_id:'user-1', updated_at:'2026-08-25T12:00:00.000Z' }),
      submission({ id:'sub-2', user_id:'user-1', updated_at:'2026-08-25T12:05:00.000Z', processing_info:{ battleResultSummary:{ completedAt:'2026-08-25T12:05:00.000Z' } } }),
      submission({ id:'sub-other', user_id:'user-2' }),
      submission({ id:'sub-uploaded', status:'uploaded' })
    ]);

    const listed = await listOwnedBattleResults(db, 'user-1');
    expect(listed.results.map(result => result.submissionId)).to.deep.equal(['sub-2', 'sub-1']);

    const owned = await getOwnedBattleResult(db, 'user-1', 'sub-1');
    expect(owned.result.submissionId).to.equal('sub-1');
    const foreign = await getOwnedBattleResult(db, 'user-1', 'sub-other');
    expect(foreign.forbidden).to.equal(true);
  });

  it('serves public verified results only after owner visibility is public', async () => {
    const publicRow = submission({
      processing_info:{
        ...submission().processing_info,
        result_visibility:'public',
        verified_result_id:stableVerifiedResultId('sub-history')
      }
    });
    const publicResult = await getPublicBattleResult(dataClient([publicRow]), stableVerifiedResultId('sub-history'));
    expect(publicResult.result.id).to.equal(stableVerifiedResultId('sub-history'));
    expect(publicResult.result.submissionId).to.equal(undefined);
    expect(publicResult.result.securePlaybackPermitted).to.equal(false);
    expect(JSON.stringify(publicResult.result)).to.not.include('private/battle-entries');

    const privateResult = await getPublicBattleResult(dataClient([submission()]), stableVerifiedResultId('sub-history'));
    expect(privateResult.private).to.equal(true);
    const missing = await getPublicBattleResult(dataClient([]), stableVerifiedResultId('missing'));
    expect(missing.notFound).to.equal(true);
  });

  it('toggles visibility through the owned result contract', async () => {
    const db = dataClient([submission()]);
    const publicResult = await setOwnedBattleResultVisibility(db, 'user-1', 'sub-history', 'public');
    expect(publicResult.result.visibility).to.equal('public');
    const privateResult = await setOwnedBattleResultVisibility(db, 'user-1', 'sub-history', 'private');
    expect(privateResult.result.visibility).to.equal('private');
    expect(db.state.updates).to.have.length(2);
  });

  it('lists only public verified results with filters, pagination, sorting and redaction', async () => {
    const publicUs = submission({
      id:'sub-public-us',
      processing_info:{
        ...submission().processing_info,
        result_visibility:'public',
        verified_result_id:stableVerifiedResultId('sub-public-us'),
        battleResultSummary:{
          ...submission().processing_info.battleResultSummary,
          visibility:'public',
          verifiedResultId:stableVerifiedResultId('sub-public-us'),
          profile:{ displayName:'Digital King', country:'US' },
          progressAfter:{ xp:200, rankingRating:1712, belt:'Yellow' },
          rankBefore:8,
          rankAfter:6,
          viewCount:12
        }
      }
    });
    const publicCa = submission({
      id:'sub-public-ca',
      user_id:'user-2',
      processing_info:{
        ...submission().processing_info,
        result_visibility:'public',
        verified_result_id:stableVerifiedResultId('sub-public-ca'),
        battleResultSummary:{
          ...submission().processing_info.battleResultSummary,
          visibility:'public',
          verifiedResultId:stableVerifiedResultId('sub-public-ca'),
          genre:'Open Format',
          modeId:'ai_only_practice',
          type:'AI Practice',
          outcome:'practice',
          opponent:{ status:'ai_only', name:'AI-only practice' },
          profile:{ displayName:'Practice DJ', country:'CA' },
          progressAfter:{ xp:180, rankingRating:1600, belt:'White' },
          rankBefore:11,
          rankAfter:10,
          viewCount:4
        }
      },
      judge_result:{ ...submission().judge_result, overallScore:97, won:null, opponentScore:null, reward:{ type:'high_score', metadata:{} } }
    });
    const duplicateUs = submission({
      id:'sub-duplicate-us',
      processing_info:{
        ...publicUs.processing_info,
        verified_result_id:stableVerifiedResultId('sub-public-us')
      }
    });
    const db = dataClient([publicUs, publicCa, duplicateUs, submission(), submission({ id:'sub-uploaded', status:'uploaded', processing_info:{ result_visibility:'public' } })]);

    const listed = await listPublicBattleResults(db, { country:'US', genre:'Bass House', source:'hybrid', belt:'Yellow', opponent:'opponent', sort:'most_viewed', limit:1, page:1 });
    const serialized = JSON.stringify(listed);

    expect(listed.results).to.have.length(1);
    expect(listed.results[0].verifiedResultId).to.equal(stableVerifiedResultId('sub-public-us'));
    expect(listed.results[0].profile.publicProfileId).to.equal(stablePublicProfileId('user-1'));
    expect(listed.results[0].profile.userId).to.equal(undefined);
    expect(listed.pagination.total).to.equal(1);
    expect(listed.sortUnsupported).to.equal(false);
    expect(serialized).to.not.include('private/battle-entries');
    expect(serialized).to.not.include('service_key');

    const secondPage = await listPublicBattleResults(db, { sort:'highest_score', limit:1, page:2 });
    expect(secondPage.pagination.total).to.equal(2);
    expect(secondPage.results[0].verifiedResultId).to.equal(stableVerifiedResultId('sub-public-us'));
  });

  it('builds country-aware public rankings by category without duplicate or private results', () => {
    const publicUs = sanitizeBattleResult(submission({
      id:'sub-rank-us',
      processing_info:{
        ...submission().processing_info,
        result_visibility:'public',
        verified_result_id:stableVerifiedResultId('sub-rank-us'),
        battleResultSummary:{
          ...submission().processing_info.battleResultSummary,
          visibility:'public',
          verifiedResultId:stableVerifiedResultId('sub-rank-us'),
          profile:{ displayName:'Digital King', country:'US' },
          progressAfter:{ belt:'Yellow' }
        }
      }
    }), { publicView:true });
    const publicAi = sanitizeBattleResult(submission({
      id:'sub-rank-ai',
      user_id:'user-2',
      processing_info:{
        ...submission().processing_info,
        result_visibility:'public',
        verified_result_id:stableVerifiedResultId('sub-rank-ai'),
        battleResultSummary:{
          ...submission().processing_info.battleResultSummary,
          visibility:'public',
          verifiedResultId:stableVerifiedResultId('sub-rank-ai'),
          modeId:'ai_only_practice',
          type:'AI Practice',
          outcome:'practice',
          opponent:{ status:'ai_only', name:'AI-only practice' },
          profile:{ displayName:'Practice DJ', country:'CA' },
          progressAfter:{ belt:'White' }
        }
      },
      judge_result:{ ...submission().judge_result, overallScore:97, won:null, opponentScore:null, reward:{ type:'high_score', metadata:{} } }
    }), { publicView:true });
    const privateResult = sanitizeBattleResult(submission(), { publicView:true });
    const rankings = buildPublicRankings([publicUs, publicUs, publicAi, privateResult]);

    expect(rankings.categories.competitive_battles.rows).to.have.length(1);
    expect(rankings.categories.competitive_battles.rows[0]).to.deep.include({ djName:'Digital King', country:'US', resultCount:1 });
    expect(rankings.categories.bitcoin_battles.rows[0].djName).to.equal('Digital King');
    expect(rankings.categories.ai_only_high_scores.rows[0]).to.deep.include({ djName:'Practice DJ', country:'CA', resultCount:1 });
    expect(rankings.categories.competitive_battles.countries.US).to.have.length(1);
  });

  it('builds a public DJ profile from approved public result fields only', async () => {
    const profileId = stablePublicProfileId('user-1');
    const publicRow = submission({
      processing_info:{
        ...submission().processing_info,
        result_visibility:'public',
        verified_result_id:stableVerifiedResultId('sub-history'),
        battleResultSummary:{
          ...submission().processing_info.battleResultSummary,
          visibility:'public',
          verifiedResultId:stableVerifiedResultId('sub-history'),
          profile:{
            displayName:'Digital King',
            country:'US',
            publicBio:'Bass house selector.',
            email:'private@example.com',
            authUserId:'auth-secret',
            specialties:['bitcoin_battle','transition_battle'],
            media:[
              { title:'Public set', visibility:'public', publicUrl:'https://example.test/listen', securePlaybackPermitted:true },
              { title:'Private set', visibility:'private', publicUrl:'private/battle-entries/secret.webm' }
            ]
          },
          progressAfter:{ xp:200, rankingRating:1712, belt:'Yellow' }
        }
      }
    });
    const privateRow = submission({ id:'sub-private', processing_info:{ ...submission().processing_info, result_visibility:'private' } });
    const result = await getPublicProfile(dataClient([publicRow, privateRow]), profileId);
    const serialized = JSON.stringify(result);

    expect(result.profile.id).to.equal(profileId);
    expect(result.profile.displayName).to.equal('Digital King');
    expect(result.profile.country).to.equal('US');
    expect(result.profile.bio).to.equal('Bass house selector.');
    expect(result.profile.media).to.have.length(1);
    expect(result.profile.competitiveHistory).to.have.length(1);
    expect(result.profile.aiOnlyHighScores).to.have.length(0);
    expect(result.profile.stats.totalResults).to.equal(1);
    expect(serialized).to.not.include('private@example.com');
    expect(serialized).to.not.include('auth-secret');
    expect(serialized).to.not.include('private/battle-entries');

    const privateOnly = await getPublicProfile(dataClient([privateRow]), stablePublicProfileId('user-1'));
    expect(privateOnly.private).to.equal(true);
    const missing = await getPublicProfile(dataClient([]), profileId);
    expect(missing.notFound).to.equal(true);
  });

  it('tracks verified result views with duplicate-window and rate-limit protection without raw visitor storage', async () => {
    const publicRow = submission({
      processing_info:{
        ...submission().processing_info,
        result_visibility:'public',
        verified_result_id:stableVerifiedResultId('sub-history'),
        battleResultSummary:{ ...submission().processing_info.battleResultSummary, visibility:'public', verifiedResultId:stableVerifiedResultId('sub-history') }
      }
    });
    const db = dataClient([publicRow]);
    const rateState = new Map();
    const limits = { duplicateWindowMs:15 * 60 * 1000, rateWindowMs:60 * 1000, rateMax:2, fingerprintRetentionMs:30 * 24 * 60 * 60 * 1000, maxFingerprints:20 };

    const first = await recordVerifiedResultView(db, stableVerifiedResultId('sub-history'), { visitorId:'viewer-1', ip:'203.0.113.9', userAgent:'test-agent' }, new Date('2026-08-25T12:00:00Z'), { limits, rateState });
    const duplicate = await recordVerifiedResultView(db, stableVerifiedResultId('sub-history'), { visitorId:'viewer-1', ip:'203.0.113.9', userAgent:'test-agent' }, new Date('2026-08-25T12:00:10Z'), { limits, rateState });
    const limited = await recordVerifiedResultView(db, stableVerifiedResultId('sub-history'), { visitorId:'viewer-1', ip:'203.0.113.9', userAgent:'test-agent' }, new Date('2026-08-25T12:00:20Z'), { limits, rateState });
    const later = await recordVerifiedResultView(db, stableVerifiedResultId('sub-history'), { visitorId:'viewer-1', ip:'203.0.113.9', userAgent:'test-agent' }, new Date('2026-08-25T12:20:00Z'), { limits, rateState });
    const serialized = JSON.stringify(db.state.rows[0].processing_info);

    expect(first.views).to.deep.include({ total:1, uniqueEstimate:1 });
    expect(duplicate.duplicate).to.equal(true);
    expect(duplicate.views.total).to.equal(1);
    expect(limited.rateLimited).to.equal(true);
    expect(later.views.total).to.equal(2);
    expect(serialized).to.not.include('203.0.113.9');
    expect(serialized).to.not.include('viewer-1');
    expect(serialized).to.not.include('test-agent');

    const privateView = await recordVerifiedResultView(dataClient([submission()]), stableVerifiedResultId('sub-history'), { visitorId:'viewer-2' }, new Date('2026-08-25T12:00:00Z'), { limits, rateState:new Map() });
    expect(privateView.private).to.equal(true);
  });

  it('tracks public profile views and lets most-viewed sorting use real server counts', async () => {
    const firstRow = submission({
      id:'sub-view-1',
      processing_info:{
        ...submission().processing_info,
        result_visibility:'public',
        verified_result_id:stableVerifiedResultId('sub-view-1'),
        battleResultSummary:{ ...submission().processing_info.battleResultSummary, visibility:'public', verifiedResultId:stableVerifiedResultId('sub-view-1'), viewCount:1, profile:{ displayName:'Digital King', country:'US' } }
      }
    });
    const secondRow = submission({
      id:'sub-view-2',
      user_id:'user-2',
      processing_info:{
        ...submission().processing_info,
        result_visibility:'public',
        verified_result_id:stableVerifiedResultId('sub-view-2'),
        battleResultSummary:{ ...submission().processing_info.battleResultSummary, visibility:'public', verifiedResultId:stableVerifiedResultId('sub-view-2'), viewCount:7, profile:{ displayName:'View Leader', country:'CA' } }
      }
    });
    const db = dataClient([firstRow, secondRow]);
    const profileView = await recordPublicProfileView(db, stablePublicProfileId('user-1'), { visitorId:'profile-viewer' }, new Date('2026-08-25T12:00:00Z'), { rateState:new Map() });
    const listed = await listPublicBattleResults(db, { sort:'most_viewed', limit:2 });

    expect(profileView.views.total).to.equal(1);
    expect(listed.sortUnsupported).to.equal(false);
    expect(listed.results.map(row => row.verifiedResultId)).to.deep.equal([stableVerifiedResultId('sub-view-2'), stableVerifiedResultId('sub-view-1')]);

    const privateProfileView = await recordPublicProfileView(dataClient([submission()]), stablePublicProfileId('user-1'), { visitorId:'profile-viewer' }, new Date('2026-08-25T12:00:00Z'), { rateState:new Map() });
    expect(privateProfileView.private).to.equal(true);
  });

  it('wires owned and public battle-result routes with authentication and service guards', () => {
    expect(serverSource).to.include("app.get('/api/battleResults', requireAuth");
    expect(serverSource).to.include("app.get('/api/battleResults/:submissionId', requireAuth");
    expect(serverSource).to.include("app.post('/api/battleResults/:submissionId', requireAuth");
    expect(serverSource).to.include("app.patch('/api/battleResults/:submissionId/visibility', requireAuth");
    expect(serverSource).to.include("app.get('/api/publicBattleResults', async");
    expect(serverSource).to.include("app.get('/api/publicRankings', async");
    expect(serverSource).to.include("app.get('/api/publicProfiles/:publicProfileId', async");
    expect(serverSource).to.include("app.post('/api/publicProfiles/:publicProfileId/views', async");
    expect(serverSource).to.include("app.get('/api/publicBattleResults/:verifiedResultId', async");
    expect(serverSource).to.include("app.post('/api/publicBattleResults/:verifiedResultId/views', async");
    expect(serverSource).to.include('listPublicBattleResults(supabaseService, req.query || {})');
    expect(serverSource).to.include('getPublicProfile(supabaseService, validation.value.publicProfileId)');
    expect(serverSource).to.include('recordVerifiedResultView(supabaseService, validation.value.verifiedResultId, publicViewVisitor(req))');
    expect(serverSource).to.include('recordPublicProfileView(supabaseService, validation.value.publicProfileId, publicViewVisitor(req))');
    expect(serverSource).to.include('getOwnedBattleResult(supabaseService, req.authUser.id');
    expect(serverSource).to.include('saveOwnedBattleResultSummary(supabaseService, req.authUser.id');
    expect(serverSource).to.include('setOwnedBattleResultVisibility(supabaseService, req.authUser.id');
    expect(serverSource).to.include('getPublicBattleResult(supabaseService, validation.value.verifiedResultId)');
    expect(serverSource).to.include("requireConfiguredDataClient(supabaseService, res, 'Supabase service role client')");
  });
});

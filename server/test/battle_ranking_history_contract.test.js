const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  checkRankingDetailRateLimit,
  getOwnedRankingDetail,
  getPublicRankingDetail
} = require('../battle_leaderboards');

const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

describe('ranking history detail contract', () => {
  it('builds public movement history from applied awards and published snapshots', async () => {
    const client = dataClient(seedData({
      battle_progression_awards:[
        award({ id:'award-1', resolution_id:'res-1', global_rank_before:null, global_rank_after:8, rating_after:1760, applied_at:'2026-08-24T12:00:00.000Z' }),
        award({ id:'award-2', resolution_id:'res-2', global_rank_before:8, global_rank_after:5, rating_before:1760, rating_after:1810, applied_at:'2026-08-26T12:00:00.000Z' }),
        award({ id:'award-duplicate', resolution_id:'res-2', global_rank_before:5, global_rank_after:1, rating_after:9999, applied_at:'2026-08-26T13:00:00.000Z' })
      ],
      public_leaderboard_snapshots:[
        snapshot({ public_profile_id:'dj_dj1', rank:5, previous_rank:8, movement:3, published_at:'2026-08-27T12:00:00.000Z' })
      ]
    }));

    const result = await getPublicRankingDetail(client, 'dj_dj1', { category:'competitive_battles', limit:10 });

    expect(result.detail.source).to.equal('award_ledger');
    expect(result.detail.current.rank).to.equal(5);
    expect(result.detail.current.publishedSnapshot.rank).to.equal(5);
    expect(result.detail.current.publishedSnapshot.snapshotId).to.equal(undefined);
    expect(result.detail.publishedSnapshots).to.have.length(1);
    expect(result.detail.movementHistory).to.have.length(2);
    expect(result.detail.movementHistory[0].movementStatus).to.equal('up');
    expect(result.detail.eligibility.qualifyingBattleCount).to.equal(2);
    expect(JSON.stringify(result.detail)).to.not.match(/service_role|storage_object_path|signedurl|private\/|dj-1/);
  });

  it('redacts private qualifying results on public detail while exposing public verified links', async () => {
    const client = dataClient(seedData({
      battle_progression_awards:[
        award({ id:'award-public', resolution_id:'res-public', submission_id:'sub-public', score:96 }),
        award({ id:'award-private', resolution_id:'res-private', submission_id:'sub-private', score:88, applied_at:'2026-08-26T12:00:00.000Z' })
      ],
      mix_submissions:[
        submission({ id:'sub-public', visibility:'public', title:'Public Finals', verifiedResultId:'vr_11111111111111111111' }),
        submission({ id:'sub-private', visibility:'private', title:'Private Finals', verifiedResultId:'vr_22222222222222222222' })
      ]
    }));

    const result = await getPublicRankingDetail(client, 'dj_dj1', { category:'competitive_battles', limit:10 });
    const publicBattle = result.detail.qualifyingBattles.find(row => row.result);
    const privateBattle = result.detail.qualifyingBattles.find(row => row.private);

    expect(publicBattle.result.verifiedResultUrl).to.equal('/results/vr_11111111111111111111');
    expect(privateBattle.title).to.equal('Private qualifying battle');
    expect(JSON.stringify(privateBattle)).to.not.include('Private Finals');
    expect(JSON.stringify(result.detail)).to.not.match(/evidence|timing|storage|audio_path|download/i);
  });

  it('returns owned detail with eligibility and belt progression without browser calculations', async () => {
    const client = dataClient(seedData({
      battle_progression_awards:[
        award({ id:'award-1', resolution_id:'res-1', xp_before:820, xp_after:900, belt_before:'Green', belt_after:'Blue', rating_after:1810 }),
        award({ id:'award-2', resolution_id:'res-2', xp_before:900, xp_after:1320, belt_before:'Blue', belt_after:'Purple', rating_before:1810, rating_after:1844, applied_at:'2026-08-27T12:00:00.000Z' })
      ]
    }));

    const result = await getOwnedRankingDetail(client, 'dj-1', { category:'competitive_battles', limit:1 });

    expect(result.detail.scope).to.equal('owned');
    expect(result.detail.beltProgression.currentBelt).to.equal('Purple');
    expect(result.detail.beltProgression.promotions.map(row => row.to)).to.deep.equal(['Blue', 'Purple']);
    expect(result.detail.pagination.hasMore).to.equal(true);
    expect(result.detail.pagination.nextCursor).to.equal('cursor_1');
  });

  it('denies private public profiles and rejects invalid categories cleanly', async () => {
    const client = dataClient(seedData({
      dj_progression_profiles:[
        profile({ user_id:'dj-private', public_profile_id:'dj_private', display_name:'Hidden DJ', visibility:'private', public_profile:{ publicProfileId:'dj_private', displayName:'Hidden DJ', visibility:'private' } })
      ],
      battle_progression_awards:[
        award({ id:'award-private', resolution_id:'res-private', user_id:'dj-private' })
      ]
    }));

    const privateResult = await getPublicRankingDetail(client, 'dj_private', { category:'competitive_battles' });
    const invalidCategory = await getOwnedRankingDetail(client, 'dj-1', { category:'not_real' });

    expect(privateResult.private).to.equal(true);
    expect(invalidCategory.invalidCategory).to.equal(true);
  });

  it('keeps AI-only detail separate from competitive award ranking', async () => {
    const client = dataClient(seedData());
    const result = await getOwnedRankingDetail(client, 'dj-1', { category:'ai_only_high_scores' });

    expect(result.detail.eligibility.status).to.equal('separate_arcade_board');
    expect(result.detail.movementHistory).to.deep.equal([]);
    expect(result.detail.eligibility.blockers).to.include('ai_only_high_scores_are_separate_from_competitive_awards');
  });

  it('defines protected ranking history routes and bounded rate limiting', () => {
    const state = new Map();
    const first = checkRankingDetailRateLimit('public', 'dj_dj1', 'visitor-a', new Date('2026-08-27T12:00:00.000Z'), { windowMs:60000, max:1 }, state);
    const second = checkRankingDetailRateLimit('public', 'dj_dj1', 'visitor-a', new Date('2026-08-27T12:00:01.000Z'), { windowMs:60000, max:1 }, state);

    expect(first.rateLimited).to.equal(false);
    expect(second.rateLimited).to.equal(true);
    expect(serverSource).to.include("app.get('/api/publicRankings/:publicProfileId/history'");
    expect(serverSource).to.include("app.get('/api/myRankings/history', requireAuth");
  });
});

function award(overrides = {}){
  return {
    id:'award-1',
    battle_id:'battle-1',
    resolution_id:'res-1',
    resolution_version:1,
    battle_entry_id:'entry-1',
    user_id:'dj-1',
    submission_id:'sub-1',
    outcome:'winner',
    score:92,
    xp_delta:100,
    xp_before:800,
    xp_after:900,
    rating_before:1780,
    rating_delta:18,
    rating_after:1798,
    belt_before:'Green',
    belt_after:'Blue',
    global_rank_before:3,
    global_rank_after:2,
    country_rank_before:2,
    country_rank_after:1,
    country:'US',
    categories:['competitive_battles'],
    rule_version:'ranking-history-test',
    rating_rule_version:'rating-test',
    belt_rule_version:'belt-test',
    status:'applied',
    applied_at:'2026-08-25T12:00:00.000Z',
    updated_at:'2026-08-25T12:00:00.000Z',
    created_at:'2026-08-25T12:00:00.000Z',
    ...overrides
  };
}

function profile(overrides = {}){
  const userId = overrides.user_id || 'dj-1';
  const displayName = userId === 'dj-2' ? 'Rival DJ' : 'Creator DJ';
  return {
    user_id:userId,
    xp:1200,
    rating:1810,
    ranking_rating:1810,
    belt:'Blue',
    wins:3,
    losses:1,
    ties:0,
    completed_battles:4,
    country:'US',
    visibility:'public',
    public_profile_id:`dj_${userId.replace(/[^a-z0-9]/gi, '')}`,
    public_profile:{ publicProfileId:`dj_${userId.replace(/[^a-z0-9]/gi, '')}`, displayName, country:'US', belt:'Blue', visibility:'public' },
    updated_at:'2026-08-27T11:00:00.000Z',
    ...overrides
  };
}

function snapshot(overrides = {}){
  return {
    id:'lb-1',
    category:'competitive_battles',
    public_profile_id:'dj_dj1',
    display_name:'Creator DJ',
    country:'US',
    belt:'Blue',
    rank:2,
    previous_rank:3,
    movement:1,
    rating:1810,
    qualifying_battles:2,
    average_score:91,
    best_score:96,
    status:'published',
    calculation_version:'public-ledger-leaderboards-v1',
    published_at:'2026-08-27T12:00:00.000Z',
    ...overrides
  };
}

function submission(overrides = {}){
  const visibility = overrides.visibility || 'public';
  const verifiedResultId = overrides.verifiedResultId || 'vr_11111111111111111111';
  const title = overrides.title || 'Public Finals';
  return {
    id:overrides.id || 'sub-1',
    user_id:overrides.user_id || 'dj-1',
    status:'completed',
    processing_info:{
      result_visibility:visibility,
      verified_result_id:verifiedResultId,
      battleResultSummary:{
        visibility,
        verifiedResultId,
        title,
        modeId:'transition_battle',
        type:'Transition Battle',
        genre:'House',
        outcome:'win',
        profile:{ displayName:'Creator DJ', country:'US' },
        opponent:{ status:'human', name:'Opponent DJ', country:'GB' },
        progression:{ xp:100, ratingDelta:18 },
        progressBefore:{ belt:'Green' },
        progressAfter:{ belt:'Blue' },
        completedAt:'2026-08-27T12:00:00.000Z'
      },
      judgeResult:{
        score:96,
        evidenceType:'measurable_audio_rule_based',
        measurableAnalysis:{ duration:180 },
        breakdown:{ timing:94 },
        recommendations:['Tighten the outro'],
        confidence:{ measurable:0.8 },
        completedAt:'2026-08-27T12:00:00.000Z',
        reward:{ type:'standard', metadata:{} }
      }
    },
    updated_at:'2026-08-27T12:00:00.000Z',
    created_at:'2026-08-27T11:50:00.000Z',
    ...overrides
  };
}

function seedData(overrides = {}){
  return {
    battle_progression_awards:[],
    dj_progression_profiles:[
      profile({ user_id:'dj-1' }),
      profile({ user_id:'dj-2', country:'GB' })
    ],
    public_leaderboard_snapshots:[],
    mix_submissions:[],
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
  }
  select(){ return this; }
  eq(field, value){ this.filters.push([field, value]); return this; }
  limit(value){ this.limitValue = Number(value); return this; }
  then(resolve, reject){ return this.exec().then(resolve, reject); }
  async exec(){
    let rows = this.db[this.table].filter(row => this.filters.every(([field, value]) => String(row[field]) === String(value)));
    if(this.limitValue != null) rows = rows.slice(0, this.limitValue);
    return { data:rows, error:null };
  }
}

const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  LEADERBOARD_CALCULATION_VERSION,
  PUBLIC_LEADERBOARD_TABLE,
  buildLeaderboards,
  getOwnedRankingSummary,
  listPublicLeaderboards,
  rebuildPublicLeaderboards
} = require('../battle_leaderboards');

const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'sql', '016_create_public_leaderboard_snapshots.sql'), 'utf8');

describe('public leaderboards from progression award ledger', () => {
  it('builds public rankings only from applied awards and dedupes repeated resolution entries', async () => {
    const client = dataClient(seedData({
      battle_progression_awards:[
        award({ id:'award-1', resolution_id:'res-1', user_id:'dj-1', outcome:'winner', score:96, rating_after:1818, categories:['competitive_battles','bitcoin_battles'] }),
        award({ id:'award-duplicate', resolution_id:'res-1', user_id:'dj-1', outcome:'winner', score:60, rating_after:9999, categories:['competitive_battles','bitcoin_battles'] }),
        award({ id:'award-2', resolution_id:'res-2', user_id:'dj-2', outcome:'loser', score:82, rating_after:1705, categories:['competitive_battles'] }),
        award({ id:'award-retry', resolution_id:'res-3', user_id:'dj-3', status:'retryable', outcome:'winner', score:99, rating_after:1900, categories:['competitive_battles'] })
      ]
    }));

    const result = await listPublicLeaderboards(client, { category:'competitive_battles', limit:10 });

    expect(result.source).to.equal('award_ledger');
    expect(result.calculationVersion).to.equal(LEADERBOARD_CALCULATION_VERSION);
    expect(result.rows).to.have.length(2);
    expect(result.rows[0].djName).to.equal('Creator DJ');
    expect(result.rows[0].qualifyingBattles).to.equal(1);
    expect(result.rows[0].averageScore).to.equal(96);
    expect(JSON.stringify(result)).to.not.match(/dj-1|service_role|private\/|storage_object_path|signedurl/i);
  });

  it('uses deterministic rank tie breakers after rating', async () => {
    const client = dataClient(seedData({
      battle_progression_awards:[
        award({ id:'award-win', resolution_id:'res-win', user_id:'dj-2', outcome:'winner', score:88, rating_after:1800 }),
        award({ id:'award-loss', resolution_id:'res-loss', user_id:'dj-1', outcome:'loser', score:91, rating_after:1800 })
      ]
    }));

    const result = await listPublicLeaderboards(client, { category:'competitive_battles' });

    expect(result.rows.map(row => row.djName)).to.deep.equal(['Rival DJ', 'Creator DJ']);
    expect(result.rows.map(row => row.rank)).to.deep.equal([1, 2]);
  });

  it('supports country, belt, Bitcoin category and pagination filters without loading unlimited history', async () => {
    const client = dataClient(seedData({
      battle_progression_awards:[
        award({ id:'award-us-blue', resolution_id:'res-us-blue', user_id:'dj-1', country:'US', belt_after:'Blue', categories:['competitive_battles','bitcoin_battles'] }),
        award({ id:'award-gb-orange', resolution_id:'res-gb-orange', user_id:'dj-2', country:'GB', belt_after:'Orange', rating_after:1770, categories:['competitive_battles','bitcoin_battles'] }),
        award({ id:'award-us-purple', resolution_id:'res-us-purple', user_id:'dj-4', country:'US', belt_after:'Purple', rating_after:1850, categories:['competitive_battles','bitcoin_battles'] })
      ]
    }));

    const page = await listPublicLeaderboards(client, { category:'bitcoin_battles', country:'US', limit:1 });
    const belt = await listPublicLeaderboards(client, { category:'belt_rankings', belt:'Blue', limit:10 });

    expect(page.rows).to.have.length(1);
    expect(page.pagination.total).to.equal(2);
    expect(page.pagination.hasMore).to.equal(true);
    expect(page.rows[0].countryCode).to.equal('US');
    expect(belt.rows.map(row => row.belt)).to.deep.equal(['Blue']);
  });

  it('filters authoritative rankings by followed DJs server-side with follower counts and block exclusion', async () => {
    const client = dataClient(seedData({
      dj_follows:[
        { id:'follow-rival', follower_user_id:'dj-1', followed_user_id:'dj-2', follower_public_profile_id:'dj_dj1', followed_public_profile_id:'dj_dj2', active:true, status:'active', created_at:'2026-08-27T10:00:00.000Z', updated_at:'2026-08-27T10:00:00.000Z' },
        { id:'follow-purple', follower_user_id:'dj-1', followed_user_id:'dj-4', follower_public_profile_id:'dj_dj1', followed_public_profile_id:'dj_dj4', active:true, status:'active', created_at:'2026-08-27T10:01:00.000Z', updated_at:'2026-08-27T10:01:00.000Z' },
        { id:'other-follower', follower_user_id:'dj-3', followed_user_id:'dj-2', follower_public_profile_id:'dj_dj3', followed_public_profile_id:'dj_dj2', active:true, status:'active', created_at:'2026-08-27T10:02:00.000Z', updated_at:'2026-08-27T10:02:00.000Z' }
      ],
      dj_blocks:[
        { id:'block-purple', blocker_user_id:'dj-4', blocked_user_id:'dj-1', active:true, status:'active' }
      ],
      battle_progression_awards:[
        award({ id:'award-rival', resolution_id:'res-rival', user_id:'dj-2', outcome:'winner', score:91, rating_after:1810 }),
        award({ id:'award-purple', resolution_id:'res-purple', user_id:'dj-4', outcome:'winner', score:99, rating_after:1900 }),
        award({ id:'award-other', resolution_id:'res-other', user_id:'dj-3', outcome:'winner', score:88, rating_after:1750 })
      ]
    }));

    const result = await listPublicLeaderboards(client, { category:'competitive_battles', relationship:'following', viewerUserId:'dj-1', limit:10 });

    expect(result.filters.relationship).to.equal('following');
    expect(result.rows.map(row => row.publicProfileId)).to.deep.equal(['dj_dj2']);
    expect(result.rows[0].followerCount).to.equal(2);
    expect(result.rows[0].relationshipSource).to.equal('server');
    expect(JSON.stringify(result.rows[0])).to.not.match(/dj-2|dj-1|auth|private\/|service_key/i);
  });

  it('keeps private profile identity out of public rows', async () => {
    const client = dataClient(seedData({
      dj_progression_profiles:[
        profile({ user_id:'dj-private', display_name:'Hidden Name', visibility:'private', public_profile:{ displayName:'Secret Stage Name', visibility:'private', country:'US', belt:'Black' } })
      ],
      battle_progression_awards:[
        award({ id:'award-private', resolution_id:'res-private', user_id:'dj-private', country:'US', belt_after:'Black', rating_after:2000 })
      ]
    }));

    const result = await listPublicLeaderboards(client, { category:'competitive_battles' });

    expect(result.rows[0].djName).to.equal('Private DJ');
    expect(result.rows[0].publicProfileId).to.equal(null);
    expect(JSON.stringify(result.rows[0])).to.not.include('Secret Stage Name');
    expect(JSON.stringify(result.rows[0])).to.not.include('dj-private');
  });

  it('returns an authenticated DJ ranking summary without exposing opponent internals', async () => {
    const client = dataClient(seedData({
      battle_progression_awards:[
        award({ id:'award-owned', resolution_id:'res-owned', user_id:'dj-1', outcome:'winner', score:94, rating_after:1824 })
      ]
    }));

    const result = await getOwnedRankingSummary(client, 'dj-1');
    const missing = await getOwnedRankingSummary(client, 'dj-missing');

    expect(result.rankings.competitive_battles.rank).to.equal(1);
    expect(result.rankings.competitive_battles.djName).to.equal('Creator DJ');
    expect(missing.rankings.competitive_battles.status).to.equal('not_yet_ranked');
    expect(JSON.stringify(result)).to.not.include('dj-2');
  });

  it('rebuilds sanitized snapshot rows idempotently and defines protected API plus RLS-ready migration', async () => {
    const client = dataClient(seedData({
      battle_progression_awards:[
        award({ id:'award-rebuild', resolution_id:'res-rebuild', user_id:'dj-1', score:93, rating_after:1820, categories:['competitive_battles','transition_battles'] })
      ]
    }));

    const first = await rebuildPublicLeaderboards(client, {}, new Date('2026-08-27T12:00:00.000Z'));
    const second = await rebuildPublicLeaderboards(client, {}, new Date('2026-08-27T12:01:00.000Z'));

    expect(first.status).to.equal('published');
    expect(second.status).to.equal('published');
    expect(client.db[PUBLIC_LEADERBOARD_TABLE]).to.have.length(first.written);
    expect(client.db[PUBLIC_LEADERBOARD_TABLE][0].calculation_version).to.equal(LEADERBOARD_CALCULATION_VERSION);
    expect(serverSource).to.include("app.get('/api/publicLeaderboards'");
    expect(serverSource).to.include("app.get('/api/relationshipLeaderboards', requireAuth");
    expect(serverSource).to.include("app.get('/api/publicRankings'");
    expect(serverSource).to.include("app.get('/api/myRankings', requireAuth");
    expect(serverSource).to.include("app.post('/api/publicLeaderboards/rebuild', requireAuth, requireOperatorUser");
    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.public_leaderboard_snapshots');
    expect(sql).to.include('ENABLE ROW LEVEL SECURITY');
    expect(sql).to.include('allow_select_published_public_leaderboards');
    expect(sql).to.not.match(/CREATE TABLE .*wallet|wallet_balances|deposit_address|payout_status|claimable_amount/i);
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
    award_reason:'Resolved test battle',
    rule_version:'test',
    rating_rule_version:'test',
    belt_rule_version:'test',
    status:'applied',
    applied_at:'2026-08-27T12:00:00.000Z',
    updated_at:'2026-08-27T12:00:00.000Z',
    created_at:'2026-08-27T12:00:00.000Z',
    ...overrides
  };
}

function profile(overrides = {}){
  const userId = overrides.user_id || 'dj-1';
  const displayName = userId === 'dj-2' ? 'Rival DJ' : userId === 'dj-4' ? 'Purple DJ' : 'Creator DJ';
  const country = overrides.country || (userId === 'dj-2' ? 'GB' : 'US');
  const belt = overrides.belt || (userId === 'dj-2' ? 'Orange' : 'Blue');
  return {
    user_id:userId,
    xp:1000,
    rating:1800,
    ranking_rating:1800,
    belt,
    wins:3,
    losses:1,
    ties:0,
    completed_battles:4,
    country,
    visibility:'public',
    public_profile_id:`dj_${userId.replace(/[^a-z0-9]/gi, '')}`,
    public_profile:{ publicProfileId:`dj_${userId.replace(/[^a-z0-9]/gi, '')}`, displayName, country, belt, visibility:'public' },
    updated_at:'2026-08-27T11:00:00.000Z',
    ...overrides
  };
}

function seedData(overrides = {}){
  return {
    battle_progression_awards:[],
    dj_follows:[],
    dj_blocks:[],
    mix_submissions:[],
    dj_progression_profiles:[
      profile({ user_id:'dj-1', country:'US', belt:'Blue' }),
      profile({ user_id:'dj-2', country:'GB', belt:'Orange' }),
      profile({ user_id:'dj-3', country:'US', belt:'Green' }),
      profile({ user_id:'dj-4', country:'US', belt:'Purple' })
    ],
    public_leaderboard_snapshots:[],
    ...overrides
  };
}

function dataClient(initial, options = {}){
  const db = Object.fromEntries(Object.entries(initial).map(([table, rows]) => [table, rows.map(row => ({ ...row }))]));
  return {
    db,
    options,
    from(table){
      if(!db[table]) db[table] = [];
      return new Query(db, table, options);
    }
  };
}

class Query{
  constructor(db, table, options){
    this.db = db;
    this.table = table;
    this.options = options || {};
    this.filters = [];
    this.limitValue = null;
    this.insertRows = null;
    this.updateValues = null;
  }
  select(){ return this; }
  eq(field, value){ this.filters.push([field, value]); return this; }
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
      const rows = this.insertRows.map(row => ({ ...row }));
      this.db[this.table].push(...rows);
      return { data:rows, error:null };
    }
    let rows = this.db[this.table].filter(row => this.filters.every(([field, value]) => String(row[field]) === String(value)));
    if(this.updateValues){
      rows.forEach(row => Object.assign(row, this.updateValues));
      return { data:rows.slice(0, this.limitValue || rows.length), error:null };
    }
    if(this.limitValue != null) rows = rows.slice(0, this.limitValue);
    return { data:rows, error:null };
  }
}

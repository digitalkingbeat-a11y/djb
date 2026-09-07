const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  applyResolvedBattleAwards,
  reconcileBattleAwards,
  sanitizeAwardForOwner
} = require('../battle_award_ledger');

const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'sql', '015_create_progression_award_ledger.sql'), 'utf8');

describe('durable progression award ledger', () => {
  it('applies one immutable award per resolved participant and dedupes retries', async () => {
    const client = dataClient(seedData());
    const applied = await applyResolvedBattleAwards(client, battleRow(), resolution(), new Date('2026-08-27T12:00:00.000Z'));
    expect(applied.resolution.awardState.status).to.equal('applied');
    expect(client.db.battle_progression_awards).to.have.length(2);
    expect(client.db.battle_progression_awards.every(row => row.status === 'applied')).to.equal(true);
    expect(client.db.battle_progression_awards[0].resolution_id).to.equal('res-1');
    expect(client.db.battle_progression_awards[0].rating_before).to.equal(1800);
    expect(client.db.battle_progression_awards[0].rating_after).to.be.above(1800);
    expect(client.db.dj_progression_profiles.find(row => row.user_id === 'dj-1').belt).to.equal('Blue');
    expect(client.db.battle_ranking_snapshots.map(row => row.category)).to.include('bitcoin_battles');

    const duplicate = await applyResolvedBattleAwards(client, battleRow(), applied.resolution, new Date('2026-08-27T12:01:00.000Z'));
    expect(duplicate.resolution.awardState.status).to.equal('applied');
    expect(client.db.battle_progression_awards).to.have.length(2);
    expect(client.db.battle_ranking_snapshots.map(row => row.award_id)).to.have.length(4);
  });

  it('handles wins, losses, ties and multiple completed battles for one DJ without demoting belts', async () => {
    const client = dataClient(seedData({
      dj_progression_profiles:[
        profile({ user_id:'dj-1', xp:1230, rating:1800, ranking_rating:1800, belt:'Blue', wins:1, country:'US' }),
        profile({ user_id:'dj-2', xp:400, rating:1700, ranking_rating:1700, belt:'Orange', losses:1, country:'GB' })
      ]
    }));
    await applyResolvedBattleAwards(client, battleRow({ id:'battle-a' }), resolution({ id:'res-a', battleId:'battle-a', participants:[participant({ entryId:'entry-a1', submissionId:'sub-a1', outcome:'tie', won:null, score:90 }), participant({ entryId:'entry-a2', userId:'dj-2', submissionId:'sub-a2', outcome:'tie', won:null, score:90 })] }), new Date('2026-08-27T12:00:00.000Z'));
    await applyResolvedBattleAwards(client, battleRow({ id:'battle-b', mode_id:'transition_battle', reward_type:'xp', reward:{ type:'xp', metadata:{} } }), resolution({ id:'res-b', battleId:'battle-b', participants:[participant({ entryId:'entry-b1', submissionId:'sub-b1', outcome:'winner', won:true, score:88 }), participant({ entryId:'entry-b2', userId:'dj-2', submissionId:'sub-b2', outcome:'loser', won:false, score:82 })] }), new Date('2026-08-27T12:05:00.000Z'));

    const dj1 = client.db.dj_progression_profiles.find(row => row.user_id === 'dj-1');
    expect(dj1.ties).to.equal(1);
    expect(dj1.wins).to.equal(2);
    expect(dj1.belt).to.equal('Purple');
    expect(client.db.battle_progression_awards.filter(row => row.user_id === 'dj-1')).to.have.length(2);
    expect(client.db.battle_ranking_snapshots.map(row => row.category)).to.include('transition_battles');
  });

  it('keeps AI-only practice progression separate from competitive awards', async () => {
    const client = dataClient(seedData());
    const practice = await applyResolvedBattleAwards(client, battleRow({ mode_id:'ai_only_practice', opponent_requirement:'none', reward_type:'high_score', reward:{ type:'high_score', metadata:{} } }), resolution({ status:'resolved', participants:[participant({ outcome:'recorded', won:null, score:99 })] }), new Date('2026-08-27T12:00:00.000Z'));
    expect(practice.resolution.awardState.status).to.equal('practice_separate');
    expect(client.db.battle_progression_awards).to.have.length(0);
    expect(client.db.dj_progression_profiles.find(row => row.user_id === 'dj-1').wins).to.equal(3);
  });

  it('records retryable sanitized failures without deleting the award ledger entry', async () => {
    const client = dataClient(seedData(), { failProfileWrite:true });
    const result = await applyResolvedBattleAwards(client, battleRow(), resolution(), new Date('2026-08-27T12:00:00.000Z'));
    expect(result.resolution.awardState.status).to.match(/retryable/);
    expect(client.db.battle_progression_awards[0].status).to.equal('retryable');
    expect(client.db.battle_progression_awards[0].sanitized_error).to.include('[path]');
    expect(client.db.battle_progression_awards[0].sanitized_error).to.not.include('service-role-secret');
  });

  it('reconciles bounded resolved battles idempotently and exposes only owner-safe award fields', async () => {
    const client = dataClient(seedData({ battle_records:[{ ...battleRow(), resolution:resolution(), resolution_status:'resolved' }] }));
    const reconciled = await reconcileBattleAwards(client, { limit:5 }, new Date('2026-08-27T12:00:00.000Z'));
    expect(reconciled.processed).to.equal(1);
    expect(reconciled.results[0].status).to.equal('applied');
    const safe = sanitizeAwardForOwner(client.db.battle_progression_awards[0]);
    expect(safe.progression.status).to.equal('applied');
    expect(JSON.stringify(safe)).to.not.include('dj-2');
  });

  it('defines operator reconciliation route, uniqueness constraints, ranking indexes and no monetary custody tables', () => {
    expect(serverSource).to.include("app.post('/api/battleAwards/reconcile', requireAuth, requireOperatorUser");
    expect(serverSource).to.include('reconcileBattleAwards(supabaseService');
    expect(sql).to.include('CREATE TABLE IF NOT EXISTS public.battle_progression_awards');
    expect(sql).to.include('UNIQUE (resolution_id, user_id)');
    expect(sql).to.include('battle_ranking_snapshots');
    expect(sql).to.include('dj_progression_profiles_country_ranking_idx');
    expect(sql).to.not.match(/CREATE TABLE .*wallet|wallet_balances|deposit_address|payout_status|claimable_amount/i);
  });
});

function battleRow(overrides = {}){
  return {
    id:'battle-ledger',
    mode_id:'bitcoin_battle',
    title:'Ledger Battle',
    genre:'Open Format',
    duration_minutes:20,
    opponent_requirement:'required',
    reward_type:'bitcoin',
    reward:{ type:'bitcoin', metadata:{ amountSats:2500, custody:'external_pending' } },
    ...overrides
  };
}

function participant(overrides = {}){
  return {
    entryId:'entry-1',
    userId:'dj-1',
    submissionId:'sub-1',
    profile:{ name:'Creator', country:'US', belt:'Green' },
    outcome:'winner',
    won:true,
    score:96,
    result:{ progression:{ awardId:'award-seed' } },
    award:{ id:overrides.awardId || `award-${overrides.entryId || 'entry-1'}` },
    ...overrides
  };
}

function resolution(overrides = {}){
  return {
    id:'res-1',
    battleId:'battle-ledger',
    status:'resolved',
    outcome:'winner',
    version:4,
    resolvedAt:'2026-08-27T12:00:00.000Z',
    participants:[
      participant(),
      participant({ entryId:'entry-2', userId:'dj-2', submissionId:'sub-2', profile:{ name:'Rival', country:'GB', belt:'Orange' }, outcome:'loser', won:false, score:70, awardId:'award-entry-2' })
    ],
    ...overrides
  };
}

function profile(overrides = {}){
  return {
    user_id:'dj-1',
    xp:830,
    rating:1800,
    ranking_rating:1800,
    belt:'Green',
    wins:3,
    losses:1,
    ties:0,
    voids:0,
    completed_battles:4,
    country:'US',
    updated_at:'2026-08-27T11:00:00.000Z',
    ...overrides
  };
}

function seedData(overrides = {}){
  return {
    battle_records:[],
    battle_progression_awards:[],
    dj_progression_profiles:[
      profile(),
      profile({ user_id:'dj-2', xp:400, rating:1700, ranking_rating:1700, belt:'Orange', wins:1, losses:3, country:'GB' }),
      profile({ user_id:'dj-3', xp:1200, rating:1750, ranking_rating:1750, belt:'Blue', wins:4, losses:2, country:'US' })
    ],
    battle_ranking_snapshots:[],
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
    if(this.options.failProfileWrite && this.table === 'dj_progression_profiles' && (this.insertRows || this.updateValues)){
      return { data:null, error:new Error('service-role-secret failed at F:\\private\\ledger\\profile.json') };
    }
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

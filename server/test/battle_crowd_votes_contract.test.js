const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const { recordCrowdVote, getCrowdVoteSummary, CROWD_VOTE_TABLE } = require('../battle_crowd_votes');

function fakeDb(tables){
  const db = JSON.parse(JSON.stringify(tables));
  return {
    db,
    from(table){
      if(!db[table]) db[table] = [];
      const filters = [];
      let lim = Infinity;
      const q = {
        select(){ return q; },
        eq(f, v){ filters.push([f, v]); return q; },
        limit(n){ lim = n; return q; },
        insert(rows){
          return Promise.resolve().then(() => {
            for(const r of rows){
              if(table === CROWD_VOTE_TABLE && db[table].some(x => x.battle_id === r.battle_id && x.voter_user_id === r.voter_user_id)) return { error:{ code:'23505' } };
              db[table].push(r);
            }
            return { data:rows, error:null };
          });
        },
        then(res, rej){ return Promise.resolve({ data:db[table].filter(r => filters.every(([f, v]) => String(r[f]) === String(v))).slice(0, lim), error:null }).then(res, rej); }
      };
      return q;
    }
  };
}

function base(status = 'completed'){
  return fakeDb({
    battle_records:[{ id:'b1', status, visibility:'public' }],
    battle_entries:[{ battle_id:'b1', user_id:'dj-a', status:'completed' }, { battle_id:'b1', user_id:'dj-b', status:'completed' }],
    battle_crowd_votes:[]
  });
}

describe('battle crowd votes contract', () => {
  it('lets a listener vote once and returns percentages', async () => {
    const db = base();
    const first = await recordCrowdVote(db, 'fan-1', 'b1', { pickedUserId:'dj-a' });
    expect(first.recorded).to.equal(true);
    await recordCrowdVote(db, 'fan-2', 'b1', { pickedUserId:'dj-b' });
    await recordCrowdVote(db, 'fan-3', 'b1', { pickedUserId:'dj-a' });
    const again = await recordCrowdVote(db, 'fan-1', 'b1', { pickedUserId:'dj-b' });
    expect(again.duplicate).to.equal(true);
    expect(db.db.battle_crowd_votes).to.have.length(3);
    const summary = await getCrowdVoteSummary(db, 'b1');
    expect(summary.summary.totalVotes).to.equal(3);
    expect(summary.summary.shares.map(s => s.percent)).to.deep.equal([67, 33]);
  });

  it('blocks participants, unfinished battles and non-participant picks', async () => {
    expect((await recordCrowdVote(base(), 'dj-a', 'b1', { pickedUserId:'dj-a' })).forbidden).to.equal(true);
    expect((await recordCrowdVote(base('judging'), 'fan-1', 'b1', { pickedUserId:'dj-a' })).votingClosed).to.equal(true);
    expect((await recordCrowdVote(base(), 'fan-1', 'b1', { pickedUserId:'someone' })).validationError).to.be.a('string');
    expect((await recordCrowdVote(base(), 'fan-1', 'missing', { pickedUserId:'dj-a' })).notFound).to.equal(true);
  });

  it('ships a migration with one vote per user and server routes', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '028_create_battle_crowd_votes.sql'), 'utf8');
    expect(sql).to.match(/UNIQUE \(battle_id, voter_user_id\)/);
    const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    expect(src).to.match(/app\.post\('\/api\/battles\/:battleId\/crowdVotes', requireAuth/);
    expect(src).to.match(/app\.get\('\/api\/battles\/:battleId\/crowdVotes'/);
  });
});

const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const BeltPromotion = require('../belt_promotion');

const defs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'belts', 'definitions.json'), 'utf8'));
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

function fakeClient(rows = {}){
  const writes = [];
  function builder(table){
    const state = { table, filters:[], op:'select', values:null };
    const api = {
      select(){ return api; },
      eq(field, value){ state.filters.push([field, value]); return api; },
      order(){ return api; },
      limit(){ return api; },
      insert(values){ state.op = 'insert'; state.values = values; writes.push({ table, op:'insert', values }); return api; },
      update(values){ state.op = 'update'; state.values = values; writes.push({ table, op:'update', values }); return api; },
      then(resolve){ const data = (rows[table] || []).filter(row => state.filters.every(([f, v]) => row[f] === v)); return resolve({ data, error:null }); }
    };
    return api;
  }
  return { from:builder, writes };
}

describe('belt promotion grading', () => {
  const test = { id:'t1', code:'yellow', passing_score:60, criteria:{ events:[{ id:'e1', targetWindowMs:100 }, { id:'e2', targetWindowMs:100 }] } };

  it('scores taps inside the window as 100 and missing taps as zero', () => {
    const perfect = BeltPromotion.scoreTapAttempt(test, { taps:[0, 10, -20, 99, 5, -5, 50, -100] }, defs);
    expect(perfect.score).to.equal(100);
    expect(perfect.expectedTaps).to.equal(8);
    expect(perfect.hits).to.equal(8);
    const empty = BeltPromotion.scoreTapAttempt(test, { taps:[] }, defs);
    expect(empty.score).to.equal(0);
    const half = BeltPromotion.scoreTapAttempt(test, { taps:[0, 0, 0, 0, null, null, null, null] }, defs);
    expect(half.score).to.equal(50);
  });

  it('falls off linearly outside the window and ignores extra or junk taps', () => {
    expect(BeltPromotion.tapScore(200, 100)).to.equal(50);
    expect(BeltPromotion.tapScore(-300, 100)).to.equal(0);
    expect(BeltPromotion.tapScore('nope', 100)).to.equal(0);
    expect(BeltPromotion.tapScore(null, 100)).to.equal(0);
    const extra = BeltPromotion.scoreTapAttempt(test, { taps:[0,0,0,0,0,0,0,0, 9999, 9999] }, defs);
    expect(extra.score).to.equal(100);
  });

  it('derives windows from the belt ladder when a test has no generated events', () => {
    const events = BeltPromotion.testEvents({ code:'black', criteria:{} }, defs);
    expect(events).to.have.length(4);
    expect(events[0].targetWindowMs).to.equal(60);
    expect(BeltPromotion.testEvents({ code:'yellow', criteria:{} }, defs)[0].targetWindowMs).to.equal(240);
  });

  it('finds the next belt in order and nothing after Black', () => {
    expect(BeltPromotion.nextBeltAfter(defs, 'white').code).to.equal('yellow');
    expect(BeltPromotion.nextBeltAfter(defs, 'brown').code).to.equal('black');
    expect(BeltPromotion.nextBeltAfter(defs, 'black')).to.equal(null);
  });

  it('reads the current belt from user_belts, defaulting to White', async () => {
    const none = await BeltPromotion.getUserBelt(fakeClient({ user_belts:[] }), 'u1', defs);
    expect(none.belt.code).to.equal('white');
    expect(none.belt.next.code).to.equal('yellow');
    expect(none.stored).to.equal(false);
    const held = await BeltPromotion.getUserBelt(fakeClient({ user_belts:[{ user_id:'u1', belt_code:'orange', awarded_at:'2026-10-01T00:00:00Z' }] }), 'u1', defs);
    expect(held.belt.name).to.equal('Orange');
    expect(held.belt.next).to.deep.equal({ code:'green', name:'Green', minScore:76 });
  });

  it('awards by inserting or updating user_belts', async () => {
    const fresh = fakeClient({ user_belts:[] });
    const out = await BeltPromotion.awardBelt(fresh, 'u1', 'yellow', { testId:'t1' }, new Date('2026-10-18T12:00:00Z'));
    expect(out.awarded.beltCode).to.equal('yellow');
    expect(fresh.writes[0]).to.include({ table:'user_belts', op:'insert' });
    const existing = fakeClient({ user_belts:[{ user_id:'u1', belt_code:'yellow' }] });
    await BeltPromotion.awardBelt(existing, 'u1', 'orange', {});
    expect(existing.writes[0]).to.include({ table:'user_belts', op:'update' });
    expect(existing.writes[0].values.belt_code).to.equal('orange');
  });

  it('submitBeltAttempt grades tap tests on the server, blocks resubmits and only awards the next belt', () => {
    expect(serverSource).to.match(/BeltPromotion\.scoreTapAttempt\(test, breakdown, defs\)/);
    expect(serverSource).to.match(/This belt test was already submitted/);
    expect(serverSource).to.match(/next && String\(next\.code\)\.toLowerCase\(\) === String\(test\.code\)\.toLowerCase\(\)/);
    expect(serverSource).to.match(/app\.get\('\/api\/myBelt', requireAuth/);
  });
});

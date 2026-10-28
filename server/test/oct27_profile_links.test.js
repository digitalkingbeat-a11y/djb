const { expect } = require('chai');
const PL = require('../profile_links');

function fakeDb(rows = [], opts = {}){
  const db = { rows, updates:[], inserts:[] };
  db.from = () => {
    let filter = null;
    const q = {
      select(){ return q; }, limit(){ return q; },
      eq(col, val){ filter = [col, val]; if(q._op === 'update'){ db.updates.push({ patch:q._patch, filter }); return Promise.resolve(opts.writeError ? { error:opts.writeError } : { data:null }); } return q; },
      update(patch){ q._op = 'update'; q._patch = patch; return q; },
      insert(list){ db.inserts.push(list); return Promise.resolve(opts.writeError ? { error:opts.writeError } : { data:list }); },
      then(res, rej){ const data = db.rows.filter(r => !filter || String(r[filter[0]]) === String(filter[1])); return Promise.resolve(opts.readError ? { error:opts.readError } : { data }).then(res, rej); }
    };
    return q;
  };
  return db;
}

describe('Oct 27 profile website + booking info', () => {
  it('cleans the website: http(s) only, bare domains get https://', () => {
    expect(PL.cleanWebsite('djdan.com').value).to.equal('https://djdan.com/');
    expect(PL.cleanWebsite('https://djdan.com/mixes').value).to.equal('https://djdan.com/mixes');
    expect(PL.cleanWebsite('').value).to.equal('');
    ['javascript:alert(1)', 'data:text/html,x', 'ftp://a.com', 'https://u:p@a.com', 'https://localhost', 'https://a.com/"><script>', 'x'.repeat(250) + '.com']
      .forEach(bad => expect(PL.cleanWebsite(bad).error, bad).to.be.a('string'));
  });
  it('cleans booking info to one short line', () => {
    expect(PL.cleanBookingInfo(' DM\n for  bookings ').value).to.equal('DM for bookings');
    expect(PL.cleanBookingInfo('x'.repeat(121)).error).to.match(/120/);
  });
  it('saves to dj_progression_profiles (update or insert) and rejects bad input', async () => {
    const db = fakeDb([{ user_id:'u1' }]);
    const out = await PL.updateProfileLinks(db, 'u1', { website:'djdan.com', bookingInfo:'bookings@djdan.com' }, new Date('2026-10-27T12:00:00Z'));
    expect(out.saved).to.equal(true);
    expect(db.updates[0].patch).to.include({ website_url:'https://djdan.com/', booking_info:'bookings@djdan.com' });
    const fresh = fakeDb([]);
    await PL.updateProfileLinks(fresh, 'u2', { website:'', bookingInfo:'' });
    expect(fresh.inserts[0][0]).to.include({ user_id:'u2', website_url:null, booking_info:null });
    const bad = await PL.updateProfileLinks(db, 'u1', { website:'javascript:alert(1)' });
    expect(bad.validationError).to.be.a('string');
    const missing = await PL.updateProfileLinks(fakeDb([{ user_id:'u1' }], { writeError:{ message:'column "website_url" does not exist' } }), 'u1', { website:'a.com' });
    expect(missing.schemaMissing).to.equal(true);
  });
  it('reads links back, re-cleaning anything stored', async () => {
    const out = await PL.getProfileLinks(fakeDb([{ user_id:'u1', website_url:'javascript:alert(1)', booking_info:'DM me' }]), 'u1');
    expect(out.links).to.deep.equal({ website:'', bookingInfo:'DM me' });
  });
  it('adds links to public profiles but never for private ones, and never breaks the profile', async () => {
    const pub = await PL.attachPublicProfileLinks(fakeDb([{ user_id:'u1', website_url:'https://djdan.com/', booking_info:'DM' }]), { displayName:'Dan' }, 'u1');
    expect(pub).to.include({ website:'https://djdan.com/', bookingInfo:'DM' });
    const priv = await PL.attachPublicProfileLinks(fakeDb([{ user_id:'u1', visibility:'private', website_url:'https://djdan.com/' }]), { displayName:'Dan' }, 'u1');
    expect(priv.website).to.equal(undefined);
    const broken = await PL.attachPublicProfileLinks(fakeDb([], { readError:{ message:'column missing' } }), { displayName:'Dan' }, 'u1');
    expect(broken).to.deep.equal({ displayName:'Dan' });
  });
  it('routes and SQL 055 are in place', () => {
    const fs = require('fs'); const path = require('path');
    const index = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    expect(index).to.include("app.put('/api/me/profileLinks', requireAuth");
    expect(index).to.include("app.get('/api/me/profileLinks', requireAuth");
    const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '055_add_profile_links.sql'), 'utf8');
    expect(sql).to.match(/ADD COLUMN IF NOT EXISTS website_url text/);
  });
});

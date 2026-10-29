const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const PL = require('../profile_links');
const SL = require('../social_links');
const ML = require('../music_library');

// Chainable fake for dj_progression_profiles: writes can fail when they touch given columns.
function profileDb(rows = [], opts = {}){
  const db = { rows, writes:[] };
  db.from = () => {
    let filter = null;
    const fail = values => (opts.failColumns || []).some(col => col in values) ? { error:{ message:`column "${opts.failColumns[0]}" does not exist` } } : { data:null };
    const q = {
      select(){ return q; }, limit(){ return q; },
      eq(col, val){ filter = [col, val]; if(q._op === 'update'){ db.writes.push({ op:'update', values:q._patch }); return Promise.resolve(fail(q._patch)); } return q; },
      update(patch){ q._op = 'update'; q._patch = patch; return q; },
      insert(list){ db.writes.push({ op:'insert', values:list[0] }); return Promise.resolve(fail(list[0])); },
      then(res, rej){ return Promise.resolve({ data:db.rows.filter(r => !filter || String(r[filter[0]]) === String(filter[1])) }).then(res, rej); }
    };
    return q;
  };
  return db;
}

// Chainable fake for music_library_tracks.
function trackDb(row, opts = {}){
  const db = { writes:[] };
  db.from = () => {
    const q = { _op:'select' };
    const result = () => {
      if(q._op === 'select') return q._single ? { data:row } : { data:[] };
      const values = q._op === 'insert' ? q._values[0] : q._values;
      db.writes.push({ op:q._op, values });
      if(opts.noRightsColumn && 'rights_confirmed' in values) return { error:{ message:'Could not find the \'rights_confirmed\' column of \'music_library_tracks\' in the schema cache' } };
      return { data:{ ...(row || {}), ...values } };
    };
    Object.assign(q, {
      select(){ return q; }, eq(){ return q; }, limit(){ return q; }, is(){ return q; }, order(){ return q; },
      single(){ q._single = true; return Promise.resolve(result()); },
      update(v){ q._op = 'update'; q._values = v; return q; },
      insert(v){ q._op = 'insert'; q._values = v; return q; },
      then(res, rej){ return Promise.resolve(result()).then(res, rej); }
    });
    return q;
  };
  return db;
}

describe('Oct 29 social links', () => {
  it('accepts https links on the right site or an @handle, refuses everything else', () => {
    expect(SL.cleanSocialLink('instagram', '@dj.dan').value).to.equal('https://instagram.com/dj.dan');
    expect(SL.cleanSocialLink('tiktok', 'djdan').value).to.equal('https://tiktok.com/@djdan');
    expect(SL.cleanSocialLink('soundcloud', 'https://soundcloud.com/djdan?utm=1').value).to.equal('https://soundcloud.com/djdan');
    expect(SL.cleanSocialLink('mixcloud', 'mixcloud.com/djdan/').value).to.equal('https://mixcloud.com/djdan');
    [['instagram', 'http://instagram.com/x'], ['instagram', 'javascript:alert(1)'], ['soundcloud', 'https://soundcloud.com.evil.com/x'], ['mixcloud', 'https://evil.com/mixcloud.com'],
     ['tiktok', '@x"><script>'], ['instagram', 'https://instagram.com/'], ['nope', '@x']]
      .forEach(([k, v]) => expect(SL.cleanSocialLink(k, v).error, `${k} ${v}`).to.be.a('string'));
    expect(SL.cleanSocialLinks({ instagram:'@a', tiktok:'https://bad.com/x' })).to.include({ field:'tiktok' });
  });
  it('saves the four columns with website/booking and rejects a bad one', async () => {
    const db = profileDb([{ user_id:'u1' }]);
    const out = await PL.updateProfileLinks(db, 'u1', { website:'djdan.com', instagram:'@djdan', soundcloud:'', mixcloud:'@djdan', tiktok:'@djdan' });
    expect(out.saved).to.equal(true);
    expect(db.writes[0].values).to.include({ website_url:'https://djdan.com/', instagram_url:'https://instagram.com/djdan', soundcloud_url:null, mixcloud_url:'https://mixcloud.com/djdan', tiktok_url:'https://tiktok.com/@djdan' });
    expect(out.links.tiktok).to.equal('https://tiktok.com/@djdan');
    const bad = await PL.updateProfileLinks(db, 'u1', { instagram:'https://evil.com/x' });
    expect(bad).to.include({ field:'instagram' });
    expect(bad.validationError).to.match(/Instagram/);
  });
  it('before SQL 056: website + booking still save, social links are reported as local only', async () => {
    const db = profileDb([{ user_id:'u1' }], { failColumns:['instagram_url'] });
    const out = await PL.updateProfileLinks(db, 'u1', { website:'djdan.com', bookingInfo:'DM', instagram:'@djdan' });
    expect(out).to.include({ saved:true, socialSchemaMissing:true, schema:'056_add_social_links_and_rights' });
    expect(db.writes).to.have.length(2);
    expect(db.writes[1].values).to.not.have.property('instagram_url');
    expect(db.writes[1].values).to.include({ website_url:'https://djdan.com/' });
  });
  it('reads them back re-cleaned, and adds them to public (not private) profiles', async () => {
    const row = { user_id:'u1', instagram_url:'https://instagram.com/djdan', tiktok_url:'javascript:alert(1)', soundcloud_url:'https://soundcloud.com/djdan' };
    const got = await PL.getProfileLinks(profileDb([row]), 'u1');
    expect(got.links).to.include({ instagram:'https://instagram.com/djdan', tiktok:'', soundcloud:'https://soundcloud.com/djdan', mixcloud:'' });
    const pub = await PL.attachPublicProfileLinks(profileDb([row]), { displayName:'Dan' }, 'u1');
    expect(pub).to.include({ instagram:'https://instagram.com/djdan', soundcloud:'https://soundcloud.com/djdan' });
    expect(pub).to.not.have.property('tiktok');
    const priv = await PL.attachPublicProfileLinks(profileDb([{ ...row, visibility:'private' }]), { displayName:'Dan' }, 'u1');
    expect(priv).to.not.have.property('instagram');
  });
  it('the PUT route reports the 056 step', () => {
    const index = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    expect(index).to.include('Social links need the 056 database update.');
    expect(index).to.include('socialSchemaMissing');
  });
});

describe('Oct 29 music rights confirmed', () => {
  it('only writes the rights columns when the client sends rightsConfirmed', () => {
    const now = new Date('2026-10-29T12:00:00Z');
    expect(ML.applyRightsConfirmation({}, {}, now)).to.deep.equal({});
    expect(ML.applyRightsConfirmation({}, { rightsConfirmed:true }, now)).to.deep.equal({ rights_confirmed:true, rights_confirmed_at:'2026-10-29T12:00:00.000Z' });
    expect(ML.applyRightsConfirmation({}, { rightsConfirmed:'yes' }, now)).to.deep.equal({ rights_confirmed:false, rights_confirmed_at:null });
  });
  it('update saves the tick and returns rightsConfirmed', async () => {
    const db = trackDb({ id:'t1', user_id:'u1', title:'Mine', rights_classification:'original' });
    const out = await ML.updateLibraryTrack(db, 'u1', 't1', { rightsConfirmed:true });
    expect(out.track.rightsConfirmed).to.equal(true);
    expect(db.writes[0].values.rights_confirmed).to.equal(true);
  });
  it('before SQL 056 the update still saves (without the tick) and says so', async () => {
    const db = trackDb({ id:'t1', user_id:'u1', title:'Mine' }, { noRightsColumn:true });
    const out = await ML.updateLibraryTrack(db, 'u1', 't1', { title:'New', rightsConfirmed:true });
    expect(out.rightsSchemaMissing).to.equal(true);
    expect(out.track.title).to.equal('New');
    expect(out.track.rightsConfirmed).to.equal(null, 'unknown, so the browser keeps its own copy');
    expect(db.writes[1].values).to.not.have.property('rights_confirmed');
  });
  it('create stores the tick from the upload form, and copes before 056', async () => {
    const db = trackDb(null);
    const out = await ML.createLibraryTrack(db, 'u1', { title:'Upload', rightsConfirmed:true });
    expect(out.created).to.equal(true);
    expect(out.track.rightsConfirmed).to.equal(true);
    const old = trackDb(null, { noRightsColumn:true });
    const again = await ML.createLibraryTrack(old, 'u1', { title:'Upload', rightsConfirmed:true });
    expect(again).to.include({ created:true, rightsSchemaMissing:true });
    const none = trackDb(null);
    await ML.createLibraryTrack(none, 'u1', { title:'No tick sent' });
    expect(none.writes[0].values).to.not.have.property('rights_confirmed');
  });
  it('SQL 056 is listed and adds every column', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '056_add_social_links_and_rights.sql'), 'utf8');
    ['instagram_url', 'soundcloud_url', 'mixcloud_url', 'tiktok_url', 'rights_confirmed boolean', 'rights_confirmed_at'].forEach(c => expect(sql).to.include(c));
    expect(fs.readFileSync(path.join(__dirname, '..', 'sql', 'README.md'), 'utf8')).to.include('056_add_social_links_and_rights.sql');
  });
});

const { expect } = require('chai');
const ml = require('../music_library');
describe('oct25 track prefs', () => {
  it('sanitizes prefs', () => {
    const p = ml.sanitizeTrackPrefs({ favourite: 'yes', note: 'x'.repeat(900), playCount: -3, evil: 1 });
    expect(p.favourite).to.equal(undefined);
    expect(p.note.length).to.be.at.most(500);
    expect(p).to.not.have.property('playCount');
    expect(p).to.not.have.property('evil');
  });
  it('merges newest edit and max plays', () => {
    const m = ml.mergeTrackPrefs(
      { favourite: true, note: 'old', playCount: 9, editedAt: '2026-10-01T00:00:00Z' },
      { note: 'new', playCount: 2, editedAt: '2026-10-20T00:00:00Z' });
    expect(m.favourite).to.equal(undefined);
    expect(m.note).to.equal('new');
    expect(m.playCount).to.equal(9);
  });
});

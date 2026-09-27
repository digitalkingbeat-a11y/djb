const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const { bracketFromSeats, advanceWinner } = require('../tournaments');
const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '028_create_tournaments.sql'), 'utf8');

describe('eight-seat tournament foundation', () => {
  const seats = Array.from({ length:8 }, (_, index) => `dj-${index + 1}`);

  it('seeds four quarterfinals, two semifinals and one final deterministically', () => {
    const matches = bracketFromSeats(seats);
    expect(matches.map(match => match.round)).to.deep.equal([1, 1, 1, 1, 2, 2, 3]);
    expect(matches[0]).to.include({ firstUserId:'dj-1', secondUserId:'dj-2' });
    expect(matches[6]).to.include({ firstUserId:null, secondUserId:null });
    expect(() => bracketFromSeats([...seats.slice(0, 7), 'dj-1'])).to.throw();
  });

  it('advances only a participant, preserves completed results, and produces a champion', () => {
    let matches = bracketFromSeats(seats);
    expect(() => advanceWinner(matches, 1, 1, 'outsider')).to.throw();
    for(let position = 1; position <= 4; position++) matches = advanceWinner(matches, 1, position, seats[(position - 1) * 2]);
    expect(matches.find(match => match.round === 2 && match.position === 1)).to.include({ firstUserId:'dj-1', secondUserId:'dj-3' });
    expect(advanceWinner(matches, 1, 1, 'dj-1')).to.equal(matches);
    expect(() => advanceWinner(matches, 1, 1, 'dj-2')).to.throw();
    matches = advanceWinner(matches, 2, 1, 'dj-1');
    matches = advanceWinner(matches, 2, 2, 'dj-5');
    matches = advanceWinner(matches, 3, 1, 'dj-5');
    expect(matches[6].winnerUserId).to.equal('dj-5');
  });

  it('requires database locks, distinct seats, unique positions and private ownership', () => {
    expect(sql).to.include('FOR UPDATE');
    expect(sql).to.include('UNIQUE (tournament_id, user_id)');
    expect(sql).to.include('UNIQUE (tournament_id, round_number, position)');
    expect(sql).to.include('ENABLE ROW LEVEL SECURITY');
    expect(sql).to.include('REVOKE ALL ON FUNCTION public.claim_tournament_seat');
    expect(sql).to.not.include('FOR SELECT USING (true)');
  });
});

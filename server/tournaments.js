const SEATS = 8;
const ROUNDS = Object.freeze([4, 2, 1]);

function bracketFromSeats(seats){
  if(!Array.isArray(seats) || seats.length !== SEATS || new Set(seats).size !== SEATS || seats.some(id => typeof id !== 'string' || !id.trim())){
    throw new Error('An eight-seat bracket requires eight distinct user IDs.');
  }
  const matches = [];
  for(let round = 1; round <= ROUNDS.length; round++){
    for(let position = 1; position <= ROUNDS[round - 1]; position++){
      const base = { round, position, winnerUserId:null };
      matches.push(round === 1
        ? { ...base, firstUserId:seats[(position - 1) * 2], secondUserId:seats[(position - 1) * 2 + 1] }
        : { ...base, firstUserId:null, secondUserId:null });
    }
  }
  return matches;
}

function advanceWinner(matches, round, position, winnerUserId){
  const source = matches.find(match => match.round === round && match.position === position);
  if(!source || !source.firstUserId || !source.secondUserId) throw new Error('Match is not ready.');
  if(winnerUserId !== source.firstUserId && winnerUserId !== source.secondUserId) throw new Error('Winner must be a participant.');
  if(source.winnerUserId && source.winnerUserId !== winnerUserId) throw new Error('Match result is final.');
  if(source.winnerUserId === winnerUserId) return matches;
  const updated = matches.map(match => ({ ...match }));
  updated.find(match => match.round === round && match.position === position).winnerUserId = winnerUserId;
  if(round < ROUNDS.length){
    const next = updated.find(match => match.round === round + 1 && match.position === Math.ceil(position / 2));
    const slot = position % 2 ? 'firstUserId' : 'secondUserId';
    if(next[slot] && next[slot] !== winnerUserId) throw new Error('Next match already has a different participant.');
    next[slot] = winnerUserId;
  }
  return updated;
}

module.exports = { SEATS, ROUNDS, bracketFromSeats, advanceWinner };

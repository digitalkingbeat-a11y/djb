// Single-elimination tournaments (8 or 16 DJs).
// Builds on the eight-seat foundation from the tranche11-tournament-foundation branch
// (bracketFromSeats / advanceWinner), generalised to 16 seats, byes and real battles.
// Every match is a normal battle: the two DJs enter it through the usual battle create/join
// code, and when that battle resolves the winner moves to the next round automatically.
const crypto = require('crypto');
const { cleanText, cleanId, newId, isMissingTable, profilesFor, rateLimited } = require('./social_helpers');

const TOURNAMENT_TABLE = 'dj_tournaments';
const SEAT_TABLE = 'dj_tournament_seats';
const MATCH_TABLE = 'dj_tournament_matches';
const TOURNAMENT_SCHEMA = '032_create_tournaments';
const CAPACITIES = Object.freeze([8, 16]);
const SEATS = 8; // kept for the foundation contract
const ROUNDS = Object.freeze([4, 2, 1]);

function roundsFor(capacity){ return Math.round(Math.log2(capacity)); }

// Standard bracket order: seed 1 meets the lowest seed, and seeds 1 and 2 can only meet in the final.
function seedOrder(size){
  let seeds = [1, 2];
  while(seeds.length < size){
    const n = seeds.length * 2;
    seeds = seeds.flatMap(s => [s, n + 1 - s]);
  }
  return seeds;
}

function emptyBracket(capacity){
  const rounds = roundsFor(capacity);
  const matches = [];
  for(let round = 1; round <= rounds; round++){
    const count = capacity / 2 ** round;
    for(let position = 1; position <= count; position++){
      matches.push({ round, position, firstUserId:null, secondUserId:null, winnerUserId:null, status:'pending', battleId:null });
    }
  }
  return matches;
}

// seeds: user ids in seed order (index 0 = seed 1). Fewer than capacity means byes for the top seeds.
function bracketFromSeeds(seeds, capacity){
  if(!CAPACITIES.includes(capacity)) throw new Error('Tournaments hold 8 or 16 DJs.');
  if(!Array.isArray(seeds) || seeds.length < 2 || seeds.length > capacity) throw new Error('A tournament needs at least two DJs.');
  if(new Set(seeds).size !== seeds.length || seeds.some(id => typeof id !== 'string' || !id.trim())) throw new Error('Each DJ can only take one seat.');
  const order = seedOrder(capacity);
  const matches = emptyBracket(capacity);
  matches.filter(m => m.round === 1).forEach(match => {
    match.firstUserId = seeds[order[(match.position - 1) * 2] - 1] || null;
    match.secondUserId = seeds[order[(match.position - 1) * 2 + 1] - 1] || null;
  });
  return settleByes(matches);
}

// Foundation API: eight distinct seats, paired 1v2, 3v4 ... in seat order.
function bracketFromSeats(seats){
  if(!Array.isArray(seats) || seats.length !== SEATS || new Set(seats).size !== SEATS || seats.some(id => typeof id !== 'string' || !id.trim())){
    throw new Error('An eight-seat bracket requires eight distinct user IDs.');
  }
  const matches = emptyBracket(8).map(m => ({ round:m.round, position:m.position, winnerUserId:null, firstUserId:null, secondUserId:null }));
  matches.filter(m => m.round === 1).forEach(m => { m.firstUserId = seats[(m.position - 1) * 2]; m.secondUserId = seats[(m.position - 1) * 2 + 1]; });
  return matches;
}

function find(matches, round, position){ return matches.find(m => m.round === round && m.position === position); }
function isDone(match){ return Boolean(match) && ['completed', 'bye', 'void'].includes(match.status); }

// Gives a free pass to a DJ with no opponent, voids empty matches, and marks playable matches ready.
function settleByes(input){
  const matches = input.map(m => ({ ...m }));
  const maxRound = Math.max(...matches.map(m => m.round));
  let changed = true;
  while(changed){
    changed = false;
    for(const match of matches){
      if(isDone(match) || match.status === 'active') continue;
      const feeders = match.round === 1 ? null : [find(matches, match.round - 1, match.position * 2 - 1), find(matches, match.round - 1, match.position * 2)];
      const feedersDone = !feeders || feeders.every(isDone);
      const players = [match.firstUserId, match.secondUserId].filter(Boolean);
      if(players.length === 2){
        if(match.status !== 'ready'){ match.status = 'ready'; changed = true; }
      }else if(feedersDone){
        if(players.length === 1){
          match.status = 'bye'; match.winnerUserId = players[0]; changed = true;
          if(match.round < maxRound) placeWinner(matches, match, players[0]);
        }else{ match.status = 'void'; changed = true; }
      }
    }
  }
  return matches;
}

function placeWinner(matches, source, winnerUserId){
  const next = find(matches, source.round + 1, Math.ceil(source.position / 2));
  if(!next) return;
  const slot = source.position % 2 ? 'firstUserId' : 'secondUserId';
  if(next[slot] && next[slot] !== winnerUserId) throw new Error('Next match already has a different participant.');
  next[slot] = winnerUserId;
}

function advanceWinner(matches, round, position, winnerUserId){
  const source = find(matches, round, position);
  if(!source || !source.firstUserId || !source.secondUserId) throw new Error('Match is not ready.');
  if(winnerUserId !== source.firstUserId && winnerUserId !== source.secondUserId) throw new Error('Winner must be a participant.');
  if(source.winnerUserId && source.winnerUserId !== winnerUserId) throw new Error('Match result is final.');
  if(source.winnerUserId === winnerUserId) return matches;
  const updated = matches.map(match => ({ ...match }));
  const target = find(updated, round, position);
  target.winnerUserId = winnerUserId;
  if('status' in target) target.status = 'completed';
  placeWinner(updated, target, winnerUserId);
  return 'status' in target ? settleByes(updated) : updated;
}

function championOf(matches){
  const maxRound = Math.max(...matches.map(m => m.round));
  const final = find(matches, maxRound, 1);
  return final && final.winnerUserId || null;
}

function shuffle(list, random = Math.random){
  const out = list.slice();
  for(let i = out.length - 1; i > 0; i--){ const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

// Winner of a resolved battle. On a tie the higher seed (top slot) goes through.
function battleWinner(battleRow, match){
  if(!battleRow) return null;
  const resolution = battleRow.resolution && typeof battleRow.resolution === 'object' ? battleRow.resolution : null;
  if(!resolution || resolution.status !== 'resolved') return null;
  const participants = Array.isArray(resolution.participants) ? resolution.participants : [];
  const won = participants.find(p => p && (p.outcome === 'winner' || p.won === true));
  const id = won && String(won.userId || won.user_id || won.winnerUserId || '');
  if(id && (id === match.firstUserId || id === match.secondUserId)) return id;
  if(resolution.outcome === 'tie') return match.firstUserId;
  return null;
}

/* ---------- persistence ---------- */
function rowToMatch(row){
  return { id:row.id, round:Number(row.round_number), position:Number(row.position), firstUserId:row.first_user_id || null, secondUserId:row.second_user_id || null, winnerUserId:row.winner_user_id || null, status:row.status || 'pending', battleId:row.battle_id || null };
}
function matchToRow(match, tournamentId){
  return { id:match.id, tournament_id:tournamentId, round_number:match.round, position:match.position, first_user_id:match.firstUserId, second_user_id:match.secondUserId, winner_user_id:match.winnerUserId, status:match.status, battle_id:match.battleId };
}

function sanitizeInput(input = {}){
  const title = cleanText(input.title, 120);
  if(!title) return { validationError:'Give the tournament a name' };
  const capacity = Number(input.capacity);
  if(!CAPACITIES.includes(capacity)) return { validationError:'Pick 8 or 16 DJs' };
  const seeding = input.seeding === 'signup' ? 'signup' : 'random';
  return { value:{ title, capacity, seeding, genre:cleanText(input.genre, 60) || 'Open Format', mode_id:cleanId(input.modeId) || 'transition_battle', description:cleanText(input.description, 400) } };
}

async function loadTournament(dataClient, tournamentId){
  const id = cleanId(tournamentId);
  if(!id) return { notFound:true };
  const t = await dataClient.from(TOURNAMENT_TABLE).select('*').eq('id', id).limit(1);
  if(t.error) return isMissingTable(t.error) ? { schemaMissing:true, schema:TOURNAMENT_SCHEMA } : { error:t.error };
  const row = (t.data || [])[0];
  if(!row) return { notFound:true };
  const seats = await dataClient.from(SEAT_TABLE).select('*').eq('tournament_id', id);
  if(seats.error) return { error:seats.error };
  const matches = await dataClient.from(MATCH_TABLE).select('*').eq('tournament_id', id);
  if(matches.error) return { error:matches.error };
  return {
    tournament:row,
    seats:(seats.data || []).slice().sort((a, b) => a.seat_number - b.seat_number),
    matches:(matches.data || []).map(rowToMatch).sort((a, b) => a.round - b.round || a.position - b.position)
  };
}

async function saveMatchChanges(dataClient, tournamentId, before, after){
  const key = m => `${m.round}:${m.position}`;
  const old = new Map(before.map(m => [key(m), m]));
  for(const match of after){
    const prev = old.get(key(match));
    if(prev && JSON.stringify(prev) === JSON.stringify(match)) continue;
    const row = matchToRow(match, tournamentId);
    const result = await dataClient.from(MATCH_TABLE).update(row).eq('id', match.id);
    if(result.error) return { error:result.error };
  }
  return { saved:true };
}

async function sanitizeTournament(dataClient, loaded, viewerId = null){
  const { tournament, seats, matches } = loaded;
  const userIds = [...seats.map(s => s.user_id), tournament.created_by, tournament.champion_user_id];
  const profiles = await profilesFor(dataClient, userIds);
  const pub = id => {
    if(!id) return null;
    const p = profiles.get(String(id)) || { displayName:'DJ' };
    const seat = seats.find(s => String(s.user_id) === String(id));
    return { displayName:p.displayName, publicProfileId:p.publicProfileId, seed:seat && seat.seed || null, you:viewerId != null && String(id) === String(viewerId) };
  };
  const viewerSeat = viewerId ? seats.find(s => String(s.user_id) === String(viewerId)) : null;
  const yourMatch = viewerId ? matches.find(m => ['ready', 'active'].includes(m.status) && [m.firstUserId, m.secondUserId].includes(String(viewerId))) : null;
  return {
    id:tournament.id,
    title:tournament.title,
    description:tournament.description || '',
    genre:tournament.genre,
    modeId:tournament.mode_id,
    capacity:Number(tournament.capacity),
    seeding:tournament.seeding || 'random',
    status:tournament.status,
    createdAt:tournament.created_at,
    startedAt:tournament.started_at || null,
    completedAt:tournament.completed_at || null,
    host:pub(tournament.created_by),
    entrantCount:seats.length,
    entrants:seats.map(s => pub(s.user_id)),
    champion:pub(tournament.champion_user_id),
    rounds:roundsFor(Number(tournament.capacity)),
    matches:matches.map(m => ({ id:m.id, round:m.round, position:m.position, status:m.status, first:pub(m.firstUserId), second:pub(m.secondUserId), winner:pub(m.winnerUserId), hasBattle:Boolean(m.battleId), battleId:viewerId && [m.firstUserId, m.secondUserId].includes(String(viewerId)) ? m.battleId : null })),
    you:viewerId ? { joined:Boolean(viewerSeat), host:String(tournament.created_by) === String(viewerId), matchId:yourMatch ? yourMatch.id : null } : null
  };
}

async function createTournament(dataClient, userId, input = {}, now = new Date()){
  const parsed = sanitizeInput(input);
  if(parsed.validationError) return parsed;
  if(rateLimited(`tournament-create:${userId}`, now.getTime(), 3, 60 * 60 * 1000)) return { rateLimited:true };
  const row = { id:newId('trn'), created_by:String(userId), ...parsed.value, status:'open', champion_user_id:null, created_at:now.toISOString(), started_at:null, completed_at:null };
  const inserted = await dataClient.from(TOURNAMENT_TABLE).insert([row]).select('*').single();
  if(inserted.error) return isMissingTable(inserted.error) ? { schemaMissing:true, schema:TOURNAMENT_SCHEMA } : { error:inserted.error };
  if(input.joinAsPlayer !== false){
    const joined = await joinTournament(dataClient, userId, row.id, now);
    if(joined.error) return joined;
  }
  return getTournament(dataClient, row.id, userId).then(r => ({ ...r, created:true }));
}

async function joinTournament(dataClient, userId, tournamentId, now = new Date(), options = {}){
  const loaded = await loadTournament(dataClient, tournamentId);
  if(loaded.error || loaded.notFound || loaded.schemaMissing) return loaded;
  const me = String(userId);
  if(loaded.seats.some(s => String(s.user_id) === me)) return { duplicate:true };
  if(loaded.tournament.status !== 'open') return { conflict:true, reason:'Sign-up is closed' };
  const capacity = Number(loaded.tournament.capacity);
  if(loaded.seats.length >= capacity) return { conflict:true, reason:'Tournament is full' };
  const taken = new Set(loaded.seats.map(s => Number(s.seat_number)));
  let seatNumber = 1;
  while(taken.has(seatNumber)) seatNumber++;
  // (tournament_id, seat_number) and (tournament_id, user_id) are unique in SQL, so a race fails cleanly.
  const inserted = await dataClient.from(SEAT_TABLE).insert([{ tournament_id:loaded.tournament.id, user_id:me, seat_number:seatNumber, seed:null, joined_at:now.toISOString() }]);
  if(inserted.error) return /duplicate|unique/i.test(String(inserted.error.message)) ? { conflict:true, reason:'That seat was just taken, try again' } : { error:inserted.error };
  if(loaded.seats.length + 1 >= capacity) return startTournament(dataClient, loaded.tournament.created_by, loaded.tournament.id, now, options);
  return { joined:true, seatNumber };
}

async function leaveTournament(dataClient, userId, tournamentId){
  const loaded = await loadTournament(dataClient, tournamentId);
  if(loaded.error || loaded.notFound || loaded.schemaMissing) return loaded;
  if(loaded.tournament.status !== 'open') return { conflict:true, reason:'The tournament has already started' };
  const seat = loaded.seats.find(s => String(s.user_id) === String(userId));
  if(!seat) return { notFound:true };
  const removed = await dataClient.from(SEAT_TABLE).delete().eq('tournament_id', loaded.tournament.id).eq('user_id', String(userId));
  if(removed && removed.error) return { error:removed.error };
  return { left:true };
}

async function startTournament(dataClient, userId, tournamentId, now = new Date(), options = {}){
  const loaded = await loadTournament(dataClient, tournamentId);
  if(loaded.error || loaded.notFound || loaded.schemaMissing) return loaded;
  const t = loaded.tournament;
  if(String(t.created_by) !== String(userId)) return { forbidden:true };
  if(t.status !== 'open') return { conflict:true, reason:'The tournament has already started' };
  if(loaded.seats.length < 2) return { validationError:'At least 2 DJs need to sign up first' };
  const signupOrder = loaded.seats.map(s => String(s.user_id));
  const seeds = t.seeding === 'signup' ? signupOrder : shuffle(signupOrder, options.random);
  for(let i = 0; i < seeds.length; i++){
    const r = await dataClient.from(SEAT_TABLE).update({ seed:i + 1 }).eq('tournament_id', t.id).eq('user_id', seeds[i]);
    if(r.error) return { error:r.error };
  }
  const matches = bracketFromSeeds(seeds, Number(t.capacity)).map(m => ({ ...m, id:newId('trm') }));
  const ins = await dataClient.from(MATCH_TABLE).insert(matches.map(m => matchToRow(m, t.id)));
  if(ins.error) return { error:ins.error };
  const champion = championOf(matches);
  const patch = { status:champion ? 'completed' : 'active', started_at:now.toISOString(), champion_user_id:champion, completed_at:champion ? now.toISOString() : null };
  const up = await dataClient.from(TOURNAMENT_TABLE).update(patch).eq('id', t.id).eq('status', 'open');
  if(up.error) return { error:up.error };
  return { started:true };
}

// Pulls finished battle results into the bracket. Safe to call on every read.
async function reconcileTournament(dataClient, loaded, now = new Date()){
  if(loaded.tournament.status !== 'active') return loaded;
  let matches = loaded.matches;
  const before = matches.map(m => ({ ...m }));
  for(const match of before){
    if(!match.battleId || !['ready', 'active'].includes(match.status)) continue;
    const b = await dataClient.from('battle_records').select('*').eq('id', match.battleId).limit(1);
    if(b.error) return { error:b.error };
    const battleRow = (b.data || [])[0];
    if(!battleRow || battleRow.status === 'cancelled'){
      matches = matches.map(m => m.id === match.id ? { ...m, battleId:null, status:'ready' } : m);
      continue;
    }
    const winner = battleWinner(battleRow, match);
    if(winner) matches = advanceWinner(matches.map(m => m.id === match.id ? { ...m, status:'ready' } : m), match.round, match.position, winner);
  }
  const saved = await saveMatchChanges(dataClient, loaded.tournament.id, before, matches);
  if(saved.error) return saved;
  const champion = championOf(matches);
  let tournament = loaded.tournament;
  if(champion){
    const patch = { status:'completed', champion_user_id:champion, completed_at:now.toISOString() };
    const up = await dataClient.from(TOURNAMENT_TABLE).update(patch).eq('id', tournament.id);
    if(up.error) return { error:up.error };
    tournament = { ...tournament, ...patch };
  }
  return { ...loaded, tournament, matches };
}

async function getTournament(dataClient, tournamentId, viewerId = null, now = new Date()){
  let loaded = await loadTournament(dataClient, tournamentId);
  if(loaded.error || loaded.notFound || loaded.schemaMissing) return loaded;
  loaded = await reconcileTournament(dataClient, loaded, now);
  if(loaded.error) return loaded;
  return { tournament:await sanitizeTournament(dataClient, loaded, viewerId) };
}

async function listTournaments(dataClient, viewerId = null){
  let query = dataClient.from(TOURNAMENT_TABLE).select('*');
  if(typeof query.order === 'function') query = query.order('created_at', { ascending:false });
  if(typeof query.limit === 'function') query = query.limit(30);
  const result = await query;
  if(result.error) return isMissingTable(result.error) ? { schemaMissing:true, schema:TOURNAMENT_SCHEMA } : { error:result.error };
  const out = [];
  for(const row of (result.data || []).filter(r => r.status !== 'cancelled')){
    const got = await getTournament(dataClient, row.id, viewerId);
    if(got.tournament) out.push(got.tournament);
  }
  return { tournaments:out };
}

// Starts (or joins) the real battle for a ready match. deps = { createBattle, joinBattle, roomState }.
async function playTournamentMatch(dataClient, userId, tournamentId, matchId, input = {}, deps = {}, now = new Date()){
  const loaded = await loadTournament(dataClient, tournamentId);
  if(loaded.error || loaded.notFound || loaded.schemaMissing) return loaded;
  const match = loaded.matches.find(m => m.id === cleanId(matchId));
  if(!match) return { notFound:true };
  const me = String(userId);
  if(![match.firstUserId, match.secondUserId].includes(me)) return { forbidden:true };
  if(!['ready', 'active'].includes(match.status)) return { conflict:true, reason:'This match is not ready to play' };
  const crateId = input.crateId || null;
  let outcome;
  if(!match.battleId){
    const t = loaded.tournament;
    const roundName = roundLabel(match.round, roundsFor(Number(t.capacity)));
    outcome = await deps.createBattle(dataClient, me, {
      battleId:`battle-${crypto.createHash('sha256').update(`tournament:${match.id}`).digest('hex').slice(0, 24)}`,
      title:`${t.title}: ${roundName}`.slice(0, 160), modeId:t.mode_id, genre:t.genre, visibility:'private', crateId,
      idempotencyKey:`tournament-match-${match.id}`
    }, now);
    if(outcome.error || outcome.validationError || outcome.forbidden || outcome.unavailable || outcome.conflict) return outcome;
    const battleId = outcome.battle && outcome.battle.id;
    const up = await dataClient.from(MATCH_TABLE).update({ battle_id:battleId, status:'active' }).eq('id', match.id);
    if(up.error) return { error:up.error };
    match.battleId = battleId;
  }else{
    outcome = await deps.joinBattle(dataClient, me, match.battleId, { crateId, idempotencyKey:`tournament-join-${match.id}-${me}` }, now);
    if(outcome.error || outcome.validationError || outcome.forbidden || outcome.unavailable) return outcome;
    if(outcome.conflict && !/creator already/i.test(outcome.reason || '')) return outcome;
  }
  const room = deps.roomState ? await deps.roomState(dataClient, me, match.battleId, { resolve:false }) : null;
  return { battleId:match.battleId, battle:outcome.battle || null, entry:outcome.entry || null, room:room && room.state || null };
}

// Only the two DJs of a tournament match may enter its battle.
async function tournamentBattleJoinAllowed(dataClient, battleId, userId){
  const result = await dataClient.from(MATCH_TABLE).select('*').eq('battle_id', String(battleId)).limit(1);
  if(result.error) return isMissingTable(result.error) ? { allowed:true } : { error:result.error };
  const row = (result.data || [])[0];
  if(!row) return { allowed:true };
  return { allowed:[row.first_user_id, row.second_user_id].map(String).includes(String(userId)), tournamentMatch:true };
}

function roundLabel(round, rounds){
  const left = rounds - round;
  if(left === 0) return 'Final';
  if(left === 1) return 'Semifinal';
  if(left === 2) return 'Quarterfinal';
  return `Round ${round}`;
}

module.exports = {
  SEATS, ROUNDS, CAPACITIES, TOURNAMENT_SCHEMA,
  bracketFromSeats, bracketFromSeeds, advanceWinner, settleByes, seedOrder, championOf, battleWinner, roundLabel,
  createTournament, joinTournament, leaveTournament, startTournament, getTournament, listTournaments, reconcileTournament,
  playTournamentMatch, tournamentBattleJoinAllowed
};

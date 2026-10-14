// Crowd voting: listeners (not participants) pick a winner of a finished battle, once per user.
const BATTLE_RECORD_TABLE = 'battle_records';
const BATTLE_ENTRY_TABLE = 'battle_entries';
const CROWD_VOTE_TABLE = 'battle_crowd_votes';
const FINISHED_STATUSES = new Set(['completed']);

function cleanId(value, max = 160){
  if(value == null) return '';
  return String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function tableMissing(error){
  const text = String(error && (error.code || '') + ' ' + (error.message || '')).toLowerCase();
  return text.includes('42p01') || text.includes('does not exist') || text.includes('schema cache');
}

function isFinishedBattle(row){
  if(!row) return false;
  return FINISHED_STATUSES.has(String(row.status || '').toLowerCase()) || String(row.resolution_status || '').toLowerCase() === 'resolved';
}

async function loadBattle(dataClient, battleId){
  const battle = await dataClient.from(BATTLE_RECORD_TABLE).select('*').eq('id', battleId).limit(1);
  if(battle.error) return { error:battle.error };
  const row = (battle.data || [])[0];
  if(!row) return { notFound:true };
  if(String(row.visibility || 'public') === 'private') return { notFound:true };
  const entries = await dataClient.from(BATTLE_ENTRY_TABLE).select('*').eq('battle_id', battleId).limit(32);
  if(entries.error) return { error:entries.error };
  const participants = (entries.data || []).filter(e => String(e.status || 'active') !== 'withdrawn').map(e => String(e.user_id));
  return { battle:row, participants };
}

function summarize(participants, votes, viewerUserId){
  const counts = Object.fromEntries(participants.map(id => [id, 0]));
  let total = 0;
  let viewerPick = null;
  (votes || []).forEach(vote => {
    const pick = String(vote.picked_user_id);
    if(!(pick in counts)) return;
    counts[pick] += 1;
    total += 1;
    if(viewerUserId && String(vote.voter_user_id) === String(viewerUserId)) viewerPick = pick;
  });
  const shares = participants.map(id => ({ userId:id, votes:counts[id], percent: total ? Math.round(counts[id] / total * 100) : 0 }));
  return { totalVotes:total, shares, viewerPick };
}

async function getCrowdVoteSummary(dataClient, battleIdInput, viewerUserId = null){
  const battleId = cleanId(battleIdInput);
  if(!battleId) return { validationError:'battleId is required' };
  const loaded = await loadBattle(dataClient, battleId);
  if(loaded.error || loaded.notFound) return loaded;
  const votes = await dataClient.from(CROWD_VOTE_TABLE).select('*').eq('battle_id', battleId).limit(10000);
  if(votes.error){
    if(tableMissing(votes.error)) return { schemaMissing:true, summary:summarize(loaded.participants, [], viewerUserId) };
    return { error:votes.error };
  }
  const isParticipant = Boolean(viewerUserId && loaded.participants.includes(String(viewerUserId)));
  return {
    battleId,
    finished:isFinishedBattle(loaded.battle),
    canVote:Boolean(viewerUserId) && !isParticipant && isFinishedBattle(loaded.battle),
    isParticipant,
    summary:summarize(loaded.participants, votes.data, viewerUserId)
  };
}

async function recordCrowdVote(dataClient, voterUserId, battleIdInput, input = {}, now = new Date()){
  const battleId = cleanId(battleIdInput);
  const voter = cleanId(voterUserId);
  const picked = cleanId(input.pickedUserId || input.picked_user_id);
  if(!voter) return { forbidden:true, reason:'Sign in to vote' };
  if(!battleId || !picked) return { validationError:'battleId and pickedUserId are required' };
  const loaded = await loadBattle(dataClient, battleId);
  if(loaded.error || loaded.notFound) return loaded;
  if(!isFinishedBattle(loaded.battle)) return { votingClosed:true, reason:'Crowd voting opens once the battle is finished' };
  if(loaded.participants.includes(voter)) return { forbidden:true, reason:'Battle participants cannot vote on their own battle' };
  if(!loaded.participants.includes(picked)) return { validationError:'Pick one of the battle participants' };
  const existing = await dataClient.from(CROWD_VOTE_TABLE).select('*').eq('battle_id', battleId).eq('voter_user_id', voter).limit(1);
  if(existing.error){
    if(tableMissing(existing.error)) return { schemaMissing:true };
    return { error:existing.error };
  }
  if((existing.data || []).length){
    const summary = await getCrowdVoteSummary(dataClient, battleId, voter);
    return { duplicate:true, vote:existing.data[0], summary:summary.summary };
  }
  const row = { battle_id:battleId, voter_user_id:voter, picked_user_id:picked, created_at:now.toISOString() };
  const inserted = await dataClient.from(CROWD_VOTE_TABLE).insert([row]);
  if(inserted.error){
    if(String(inserted.error.code) === '23505'){
      const summary = await getCrowdVoteSummary(dataClient, battleId, voter);
      return { duplicate:true, summary:summary.summary };
    }
    if(tableMissing(inserted.error)) return { schemaMissing:true };
    return { error:inserted.error };
  }
  const summary = await getCrowdVoteSummary(dataClient, battleId, voter);
  return { recorded:true, vote:row, summary:summary.summary };
}

module.exports = { CROWD_VOTE_TABLE, getCrowdVoteSummary, recordCrowdVote, isFinishedBattle, summarizeCrowdVotes:summarize };

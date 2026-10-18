// Belt promotion tests: server-side grading of the in-app "tap on the beat" test,
// the DJ's current belt, and awarding the next belt only after a server-graded pass.
const TAP_METHOD = 'tap_timing_v1';
const TAPS_PER_EVENT = 4;
const MAX_TAPS = 64;

function ladder(defs){
  return ((defs && defs.belts) || []).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

function findBelt(defs, code){
  const key = String(code || '').toLowerCase();
  return ladder(defs).find(belt => String(belt.code).toLowerCase() === key) || null;
}

function nextBeltAfter(defs, code){
  const belts = ladder(defs);
  const index = belts.findIndex(belt => String(belt.code).toLowerCase() === String(code || '').toLowerCase());
  if(index < 0) return belts[1] || null;
  return belts[index + 1] || null;
}

// Timing windows: from the generated test when present, otherwise derived from the belt's place on the ladder.
function testEvents(test, defs){
  const criteria = test && test.criteria || {};
  if(Array.isArray(criteria.events) && criteria.events.length){
    return criteria.events.slice(0, MAX_TAPS / TAPS_PER_EVENT).map((event, index) => ({
      id: String(event.id || `evt_${index + 1}`),
      label: String(event.label || `Transition ${index + 1}`),
      targetWindowMs: Math.max(30, Math.min(400, Number(event.targetWindowMs) || 150))
    }));
  }
  const belts = ladder(defs);
  const belt = findBelt(defs, test && (test.code || criteria.belt));
  const maxOrder = Math.max(1, ...belts.map(b => Number(b.order || 1)));
  const difficulty = (belt && Number(belt.order) || 1) / maxOrder;
  const windowMs = Math.max(40, Math.round(300 - difficulty * 240));
  return [1, 2, 3, 4].map(n => ({ id:`evt_${n}`, label:`Transition ${n}`, targetWindowMs:windowMs }));
}

function tapScore(offsetMs, windowMs){
  const off = Math.abs(Number(offsetMs));
  if(offsetMs === null || offsetMs === undefined || offsetMs === '' || !Number.isFinite(off)) return 0;
  if(off <= windowMs) return 100;
  return Math.max(0, Math.round(100 * (1 - (off - windowMs) / (2 * windowMs))));
}

// Grades the raw tap offsets (ms from the nearest beat). Missing taps count as zero; extra taps are ignored.
function scoreTapAttempt(test, breakdown, defs){
  const events = testEvents(test, defs);
  const taps = Array.isArray(breakdown && breakdown.taps) ? breakdown.taps.slice(0, MAX_TAPS) : [];
  const expectedTaps = events.length * TAPS_PER_EVENT;
  const perEvent = events.map((event, eventIndex) => {
    const slice = [];
    for(let i = 0; i < TAPS_PER_EVENT; i++) slice.push(taps[eventIndex * TAPS_PER_EVENT + i]);
    const scores = slice.map(offset => tapScore(offset, event.targetWindowMs));
    return {
      id: event.id,
      label: event.label,
      targetWindowMs: event.targetWindowMs,
      hits: scores.filter(score => score === 100).length,
      score: Math.round(scores.reduce((a, b) => a + b, 0) / TAPS_PER_EVENT)
    };
  });
  const score = perEvent.length ? Math.round(perEvent.reduce((sum, event) => sum + event.score, 0) / perEvent.length) : 0;
  const tapsReceived = taps.filter(offset => offset !== null && offset !== undefined && Number.isFinite(Number(offset))).length;
  return { score, expectedTaps, tapsReceived, hits: perEvent.reduce((sum, event) => sum + event.hits, 0), perEvent };
}

function sanitizeBelt(defs, code, awardedAt){
  const belt = findBelt(defs, code) || ladder(defs)[0] || { code:'white', name:'White', order:1, minScore:0 };
  const next = nextBeltAfter(defs, belt.code);
  return {
    code: belt.code,
    name: belt.name,
    order: belt.order,
    awardedAt: awardedAt || null,
    next: next ? { code: next.code, name: next.name, minScore: next.minScore } : null
  };
}

async function getUserBelt(dataClient, userId, defs){
  const result = await dataClient.from('user_belts').select('*').eq('user_id', userId).order('awarded_at', { ascending:false }).limit(1);
  if(result.error) return { error: result.error };
  const row = Array.isArray(result.data) ? result.data[0] : null;
  return { belt: sanitizeBelt(defs, row && row.belt_code || 'white', row && row.awarded_at), stored: Boolean(row) };
}

async function awardBelt(dataClient, userId, beltCode, evidence, now = new Date()){
  const awardedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const existing = await dataClient.from('user_belts').select('*').eq('user_id', userId).limit(1);
  if(existing.error) return { error: existing.error };
  const row = Array.isArray(existing.data) ? existing.data[0] : null;
  const write = row
    ? await dataClient.from('user_belts').update({ belt_code: beltCode, awarded_at: awardedAt, evidence: evidence || {} }).eq('user_id', userId)
    : await dataClient.from('user_belts').insert([{ user_id: userId, belt_code: beltCode, awarded_at: awardedAt, evidence: evidence || {} }]);
  if(write.error) return { error: write.error };
  return { awarded: { beltCode, awardedAt } };
}

module.exports = { TAP_METHOD, TAPS_PER_EVENT, ladder, findBelt, nextBeltAfter, testEvents, tapScore, scoreTapAttempt, sanitizeBelt, getUserBelt, awardBelt };

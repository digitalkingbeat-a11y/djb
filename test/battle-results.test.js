const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function loadAppDom(){
  const root = path.join(__dirname, '..');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(index, {
    url: 'http://127.0.0.1/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });

  const { window } = dom;
  window.alert = () => {};
  window.scrollTo = () => {};
  const errors = [];
  window.addEventListener('error', event => errors.push(event.error || event.message));
  window.HTMLDialogElement.prototype.showModal = function showModal(){ this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function close(){ this.removeAttribute('open'); };

  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });

  return { window, errors };
}

function judgeResult(overrides = {}){
  return {
    overallScore: 91,
    won: true,
    opponentScore: 84,
    components: { timing: 92, transition_quality: 89, harmonic_compatibility: 86 },
    breakdown: {
      timing: { available:true, score:92 },
      transition_quality: { available:true, score:89 },
      harmonic_compatibility: { available:true, score:86 }
    },
    timing: [{ label:'Measured Transition 1', timeMs:16000 }],
    rawMeasurements: [{ index:0, actualSec:16 }],
    measurableAnalysis: {
      durationSec: 64,
      bpm: 128,
      key: { name:'A minor' },
      transitionCount: 2,
      events: [{ label:'Measured Transition 1', actualSec:16 }]
    },
    confidence: {
      measurableComponentRatio: 0.75,
      trainedModelJudging: { used:false, status:'future_not_used' }
    },
    recommendations: ['Keep transitions controlled.'],
    scoringModel: {
      measurableAnalysis:'ffmpeg_audio_analyzer',
      ruleBasedScoring:'judge_engine',
      trainedModelJudging:'not_used'
    },
    evidenceType:'measurable_audio_rule_based',
    explanation:'Measured audio analysis scored by deterministic rules.',
    ...overrides
  };
}

function addBattle(window, input){
  const created = window.DJBattleModes.createBattleRecord({
    id:'battle-results-test',
    modeId:'transition_battle',
    genre:'Open Format',
    title:'Results Test',
    status:'submission_pending',
    assignedTracks:['Platform Beat 001','Platform Loop 02'],
    participants:[
      { userId:'local-profile-digital-king', name:'Digital King', status:'submitted', submissionId:'sub-results' },
      { userId:'opponent-1', name:'Rival DJ', status:'submitted' }
    ],
    ...input
  }, { requireAssignedTracks:false });
  assert.ifError(created.error);
  window.__DJBattleTestHooks.getBattles().unshift(created.battle);
  return created.battle;
}

test('Battle Results panel shows uploaded, judging and failed retryable progress states', () => {
  const { window, errors } = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  const session = { id:'progress-battle', submissionId:'sub-progress' };

  hooks.renderBattleResultProgress(session, 'uploaded', { submissionId:'sub-progress' });
  assert.match(window.document.getElementById('br-judge-placeholder').textContent, /Mix uploaded securely/);

  hooks.renderBattleResultProgress(session, 'judging', { submissionId:'sub-progress' });
  assert.match(window.document.getElementById('br-judge-placeholder').textContent, /measurable analysis is running/);

  hooks.renderBattleResultProgress(session, 'failed', { submissionId:'sub-progress' });
  assert.match(window.document.getElementById('br-judge-placeholder').textContent, /Retryable/);
  assert.match(window.document.getElementById('br-judge-placeholder').textContent, /Retry Upload/);
  assert.deepEqual(errors, []);
});

test('completed Battle Results show score, evidence, confidence, recommendations and scoring distinctions', () => {
  const { window, errors } = loadAppDom();
  const battle = addBattle(window);
  const completed = window.__DJBattleTestHooks.completeBattleWithJudgeResult(
    { id:battle.id, battleId:battle.id, participants:battle.participants, status:'submission_pending', submissionId:'sub-results' },
    judgeResult(),
    'sub-results'
  );

  const text = window.document.getElementById('br-judge-placeholder').textContent;
  assert.ifError(completed.error);
  assert.match(text, /Overall score/);
  assert.match(text, /91/);
  assert.match(text, /Timing accuracy/);
  assert.match(text, /Transition evidence/);
  assert.match(text, /A minor/);
  assert.match(text, /75% measurable/);
  assert.match(text, /Keep transitions controlled/);
  assert.match(text, /Rule-based scoring/);
  assert.match(text, /AI feedback/);
  assert.match(text, /Human voting/);
  assert.deepEqual(errors, []);
});

test('AI-only practice result saves high-score history without requiring an opponent', () => {
  const { window } = loadAppDom();
  const battle = addBattle(window, {
    id:'ai-only-results',
    modeId:'ai_only_practice',
    title:'AI Practice Result',
    trackSelectionMethod:'ai_practice',
    opponentRequirement:'none',
    reward:{ type:'high_score', metadata:{} },
    rewardType:'high_score',
    participants:[{ userId:'local-profile-digital-king', name:'Digital King', status:'submitted', submissionId:'sub-ai' }]
  });
  const completed = window.__DJBattleTestHooks.completeBattleWithJudgeResult(
    { id:battle.id, battleId:battle.id, participants:battle.participants, status:'submission_pending', submissionId:'sub-ai' },
    judgeResult({ won:null, opponentScore:null }),
    'sub-ai'
  );

  assert.ifError(completed.error);
  assert.equal(completed.result.progression.highScoreEligible, true);
  assert.match(window.document.getElementById('br-judge-placeholder').textContent, /Practice recorded/);
  assert.ok(window.__DJBattleTestHooks.getPracticeHistory().some(entry => entry.resultKey === 'ai-only-results:sub-ai'));
});

test('repeated completed polling does not duplicate XP, rating or belt awards', () => {
  const { window } = loadAppDom();
  const battle = addBattle(window, { id:'duplicate-results' });
  const session = { id:battle.id, battleId:battle.id, participants:battle.participants, status:'submission_pending', submissionId:'sub-dupe' };
  const first = window.__DJBattleTestHooks.completeBattleWithJudgeResult(session, judgeResult(), 'sub-dupe');
  const afterFirst = { ...window.__DJBattleTestHooks.getBattleProgress() };
  const second = window.__DJBattleTestHooks.completeBattleWithJudgeResult({ ...session, status:'completed' }, judgeResult({ overallScore:99 }), 'sub-dupe');
  const afterSecond = window.__DJBattleTestHooks.getBattleProgress();

  assert.ifError(first.error);
  assert.equal(second.duplicate, true);
  assert.equal(afterSecond.xp, afterFirst.xp);
  assert.equal(afterSecond.rankingRating, afterFirst.rankingRating);
  assert.match(window.document.getElementById('br-judge-placeholder').textContent, /No duplicate XP/);
});

test('Bitcoin Battle reward metadata is preserved without transfer or claim language', () => {
  const { window } = loadAppDom();
  const battle = addBattle(window, {
    id:'bitcoin-results',
    modeId:'bitcoin_battle',
    reward:{ type:'bitcoin', metadata:{ network:'bitcoin', custody:'external_pending', walletConnected:false, amountSats:2500 } },
    rewardType:'bitcoin'
  });
  window.__DJBattleTestHooks.completeBattleWithJudgeResult(
    { id:battle.id, battleId:battle.id, participants:battle.participants, status:'submission_pending', submissionId:'sub-btc-results' },
    judgeResult(),
    'sub-btc-results'
  );
  const text = window.document.getElementById('br-judge-placeholder').textContent;
  assert.match(text, /Bitcoin metadata preserved/);
  assert.match(text, /2500 sats/);
  assert.match(text, /not transferred, paid or claimable/);
});

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
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal(){ this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function close(){ this.removeAttribute('open'); };
  ['api_client.js', 'submission_upload.js', 'battle_modes.js', 'studio/studio_recording.js', 'studio/controller_mapping.js', 'studio/audio_setup.js', 'studio/streaming.js', 'studio/playlist_transfer.js', 'studio/studio_browser.js', 'studio/deck_runtime.js', 'app.js'].forEach(file => {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });
  return window;
}

function configureRoom(window){
  const hooks = window.__DJBattleTestHooks;
  hooks.getLibraryState().sync.accountId = 'local-profile-digital-king';
  hooks.getLibraryState().sync.status = 'synced';
  const session = {
    id:'battle-resolution',
    battleId:'battle-resolution',
    modeId:'own_selection_battle',
    title:'Resolution Battle',
    mode:'Own Selection Battle',
    genre:'Open Format',
    duration:20,
    status:'judging',
    battleEntryId:'entry-self',
    battlePrepSyncStatus:'server'
  };
  hooks.setActiveBattleSession(session);
  return { hooks, session };
}

function baseRoom(resolution){
  return {
    battle:{
      id:'battle-resolution',
      modeId:'own_selection_battle',
      title:'Resolution Battle',
      genre:'Open Format',
      durationMinutes:20,
      status:resolution && resolution.resolved ? 'completed' : 'judging',
      reward:{ type:'bitcoin', metadata:{ network:'bitcoin', amountSats:2500, custody:'external_pending' } },
      battleVersion:resolution && resolution.version || 4
    },
    entry:{ id:'entry-self', battleId:'battle-resolution', status:'submitted' },
    snapshot:null,
    participants:[
      { entryId:'entry-self', status:'submitted', submitted:true, profile:{ name:'Digital King', country:'US', belt:'White' }, submission:{ id:'sub-self', status:'completed' } },
      { status:'submitted', submitted:true, profile:{ name:'Rival Selector', country:'GB', belt:'Green' }, submission:{ submitted:true, status:'completed' } }
    ],
    timing:{ serverNow:'2026-08-26T13:00:00.000Z', durationMinutes:20, remainingSeconds:0 },
    version:resolution && resolution.version || 4,
    eventId:`battle-room:battle-resolution:${resolution && resolution.version || 4}`,
    resolution
  };
}

function resolvedResolution(overrides = {}){
  return {
    id:'res-server-1',
    battleId:'battle-resolution',
    status:'resolved',
    outcome:'winner',
    resolved:true,
    revealReady:true,
    version:7,
    resolvedAt:'2026-08-26T13:00:00.000Z',
    scoreDifference:7,
    scoringRule:{ type:'highest_normalized_score', modeId:'own_selection_battle' },
    bitcoinRewardMetadata:{ status:'metadata_untransferred', network:'bitcoin', amountSats:2500, custody:'external_pending', verifiedPayment:false },
    self:{
      self:true,
      entryId:'entry-self',
      submissionId:'sub-self',
      awardId:'award-self',
      profile:{ name:'Digital King', country:'US', belt:'White' },
      outcome:'winner',
      score:91,
      opponentScore:84,
      scoringSource:['measured', 'rule-based', 'hybrid'],
      evidenceType:'measurable_audio_rule_based',
      breakdown:{ timing:{ available:true, score:92 }, transition_quality:{ available:true, score:89 } },
      components:{ timing:{ available:true, score:92 } },
      confidence:{ measurableComponentRatio:0.8 },
      timingEvidenceCount:2,
      recommendations:['Keep phrasing tight.'],
      progression:{ xp:68, ratingDelta:16, awardId:'award-self', awardSource:'server_competitive_battle_resolution' }
    },
    participants:[
      {
        self:true,
        entryId:'entry-self',
        submissionId:'sub-self',
        awardId:'award-self',
        profile:{ name:'Digital King', country:'US', belt:'White' },
        outcome:'winner',
        score:91,
        opponentScore:84,
        scoringSource:['measured', 'rule-based', 'hybrid'],
        evidenceType:'measurable_audio_rule_based',
        breakdown:{ timing:{ available:true, score:92 }, transition_quality:{ available:true, score:89 } },
        components:{ timing:{ available:true, score:92 } },
        confidence:{ measurableComponentRatio:0.8 },
        timingEvidenceCount:2,
        recommendations:['Keep phrasing tight.'],
        progression:{ xp:68, ratingDelta:16, awardId:'award-self', awardSource:'server_competitive_battle_resolution' }
      },
      {
        self:false,
        profile:{ name:'Rival Selector', country:'GB', belt:'Green' },
        outcome:'loser',
        score:84,
        scoringSource:['measured', 'rule-based'],
        evidenceType:'measurable_audio_rule_based',
        breakdown:{ timing:{ available:true, score:84 } },
        components:{ timing:{ available:true, score:84 } },
        confidence:{ measurableComponentRatio:0.7 },
        timingEvidenceCount:1,
        recommendations:[]
      }
    ],
    ...overrides
  };
}

test('synchronized Battle Room resolution hides scores before reveal', () => {
  const window = loadAppDom();
  const { hooks, session } = configureRoom(window);
  const pending = {
    id:null,
    battleId:'battle-resolution',
    status:'judging',
    outcome:'unresolved',
    resolved:false,
    revealReady:false,
    requiredParticipants:2,
    completedParticipants:1,
    participants:[
      { self:true, profile:{ name:'Digital King' }, status:'completed', submitted:true, completed:true, score:null },
      { self:false, profile:{ name:'Rival Selector' }, status:'uploaded', submitted:true, completed:false, score:null }
    ]
  };

  hooks.applyServerBattleRoomState(baseRoom(pending), { session });
  const text = window.document.getElementById('br-judge-placeholder').textContent;
  assert.match(text, /Scores hidden/);
  assert.match(text, /Reveal lock/);
  assert.doesNotMatch(text, /91|84|Keep phrasing/);
});

test('synchronized resolution reveals head-to-head summaries and dedupes progression on repeated polling', () => {
  const window = loadAppDom();
  const { hooks, session } = configureRoom(window);
  const resolution = resolvedResolution();
  hooks.applyServerBattleRoomState(baseRoom(resolution), { session });
  const afterFirst = { ...hooks.getBattleProgress() };
  const firstText = window.document.getElementById('br-judge-placeholder').textContent;
  assert.match(firstText, /Authoritative result/);
  assert.match(firstText, /91/);
  assert.match(firstText, /84/);
  assert.match(firstText, /Keep phrasing tight/);
  assert.match(firstText, /Bitcoin Battle metadata preserved/);

  hooks.applyServerBattleRoomState(baseRoom(resolution), { session });
  const afterSecond = hooks.getBattleProgress();
  const secondText = window.document.getElementById('br-judge-placeholder').textContent;
  assert.equal(afterSecond.xp, afterFirst.xp);
  assert.equal(afterSecond.rankingRating, afterFirst.rankingRating);
  assert.match(secondText, /No duplicate XP/);
});

test('retryable award ledger state does not show optimistic progression as final', () => {
  const window = loadAppDom();
  const { hooks, session } = configureRoom(window);
  const before = { ...hooks.getBattleProgress() };
  const resolution = resolvedResolution({
    awardState:{ status:'retryable', appliedCount:0, retryableCount:1, totalCount:2, lastFailure:'profile unavailable' }
  });
  resolution.self = { ...resolution.self, progression:{ ...resolution.self.progression, status:'retryable', xpBefore:null, xpAfter:null, ratingBefore:null, ratingAfter:null } };
  resolution.participants[0] = { ...resolution.participants[0], progression:resolution.self.progression };
  hooks.applyServerBattleRoomState(baseRoom(resolution), { session });
  const after = hooks.getBattleProgress();
  const text = window.document.getElementById('br-judge-placeholder').textContent;
  assert.equal(after.xp, before.xp);
  assert.equal(after.rankingRating, before.rankingRating);
  assert.match(text, /Progression status: Retryable/);
  assert.match(text, /not final until the server ledger applies/);
});

test('manual resolution request uses the protected battle resolve endpoint', async () => {
  const window = loadAppDom();
  const { hooks, session } = configureRoom(window);
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, body:options.body });
    return { data:{ room:baseRoom(resolvedResolution()) } };
  };
  await hooks.requestServerBattleResolution(session);
  assert.equal(calls[0].url, '/api/battles/battle-resolution/resolve');
  assert.match(calls[0].body.idempotencyKey, /^battle-resolve/);
});

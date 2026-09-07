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

function runnerStatus(overrides = {}){
  return {
    success:true,
    runner:{
      configuredEnabled:true,
      enabled:true,
      active:false,
      currentActivity:null,
      lastRunAt:'2026-08-25T12:00:00.000Z',
      lastSuccessAt:'2026-08-25T12:00:01.000Z',
      lastFailureAt:null,
      lastFailure:null,
      consecutiveFailures:0,
      nextDelayMs:10000,
      nextScheduledRunAt:'2026-08-25T12:00:10.000Z',
      submissionsProcessed:7,
      staleRecoveriesCompleted:2,
      configuration:{
        ready:true,
        checks:[
          { id:'worker_enablement', label:'Worker enablement', status:'ok', message:'Automatic judging is explicitly enabled' },
          { id:'supabase_service_access', label:'Supabase service access', status:'ok', message:'Service client is configured' },
          { id:'ffmpeg_availability', label:'FFmpeg availability', status:'ok', message:'FFmpeg is available' }
        ]
      },
      ...overrides
    }
  };
}

test('normal users do not see the Judging Operations panel controls', () => {
  const { window, errors } = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  const nav = window.document.getElementById('operator-nav');

  assert.deepEqual(errors, []);
  assert.ok(nav.classList.contains('hidden'));
  hooks.updateAuthUI({ id:'user-1', app_metadata:{ roles:['dj'] }, user_metadata:{ full_name:'Regular DJ' } });
  hooks.switchView('operations');

  assert.equal(hooks.getOperatorState(), false);
  assert.ok(nav.classList.contains('hidden'));
  assert.equal(window.document.getElementById('judge-ops-denied').classList.contains('hidden'), false);
  assert.equal(window.document.getElementById('judge-ops-content').classList.contains('hidden'), true);
});

test('operator users can render runner status and configuration checks', () => {
  const { window, errors } = loadAppDom();
  const hooks = window.__DJBattleTestHooks;

  hooks.updateAuthUI({ id:'op-1', app_metadata:{ roles:['operator'] }, user_metadata:{ full_name:'Ops Lead' } });
  hooks.switchView('operations');
  hooks.renderJudgingOperationsStatus(runnerStatus().runner);

  assert.deepEqual(errors, []);
  assert.equal(window.document.getElementById('operator-nav').classList.contains('hidden'), false);
  assert.match(window.document.getElementById('judge-enabled-card').textContent, /Enabled/);
  assert.match(window.document.getElementById('judge-active-card').textContent, /Idle/);
  assert.match(window.document.getElementById('judge-health-card').textContent, /Stable/);
  assert.match(window.document.getElementById('judge-metrics').textContent, /Processed/);
  assert.match(window.document.getElementById('judge-metrics').textContent, /7/);
  assert.match(window.document.getElementById('judge-config-checks').textContent, /FFmpeg is available/);
});

test('operator status display redacts sensitive failure details', () => {
  const { window } = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  hooks.updateAuthUI({ id:'op-1', app_metadata:{ roles:['admin'] } });
  hooks.renderJudgingOperationsStatus(runnerStatus({
    enabled:false,
    active:false,
    consecutiveFailures:2,
    lastFailureAt:'2026-08-25T12:00:02.000Z',
    lastFailure:{ message:'read F:\\private\\secret.webm service_key=abc123 private/battle-entries/entry/submissions/sub/mix.webm' }
  }).runner);

  const text = window.document.getElementById('judge-error-readout').textContent;
  assert.match(text, /\[redacted-path\]/);
  assert.match(text, /service_key=\[redacted\]/);
  assert.match(text, /\[redacted-storage-object\]/);
  assert.doesNotMatch(text, /secret\.webm/);
  assert.doesNotMatch(text, /abc123/);
});

test('manual refresh calls the protected submission judge status endpoint', async () => {
  const { window } = loadAppDom();
  const hooks = window.__DJBattleTestHooks;
  const requestedPaths = [];
  window.DJBattleApi.apiRequest = async pathName => {
    requestedPaths.push(pathName);
    if(pathName === '/api/musicLibrary/schemaStatus') return { status:503, error:'Music Library schema unavailable', data:{ ready:false, status:'migration_required' } };
    if(pathName === '/api/musicLibrary/organizationStatus') return { status:503, error:'Music Library organization schema unavailable', data:{ ready:false, status:'migration_required' } };
    return { status:200, data:runnerStatus() };
  };

  hooks.updateAuthUI({ id:'op-1', app_metadata:{ roles:['judging_operator'] } });
  const result = await hooks.loadJudgingOperationsStatus();

  assert.ok(requestedPaths.includes('/api/submissionJudge/status'));
  assert.equal(result.status, 200);
  assert.match(window.document.getElementById('judge-enabled-card').textContent, /Enabled/);

  assert.equal(hooks.setJudgingOpsAutoRefresh(15000), 15000);
  assert.equal(hooks.setJudgingOpsAutoRefresh(12345), 0);
});

const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  buildBattleEntryPayload,
  buildDraftSubmissionPayload,
  canTransitionSubmissionStatus,
  getOwnedBattleEntry,
  getOwnedMixSubmission,
  getOrCreateBattleEntry,
  createDraftSubmission,
  SUBMISSION_SOURCES
} = require('../battle_submission');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'sql', '009_create_battle_entries_and_mix_submissions.sql'), 'utf8');
const sourceSql = fs.readFileSync(path.join(root, 'sql', '021_add_mix_submission_source.sql'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

function singleRowClient(table, row){
  return { from(name){ expect(name).to.equal(table); return { select(){ return this; }, eq(){ return this; }, limit(){ return this; }, single: async () => ({ data: row, error: null }) }; } };
}

describe('battle entry and mix submission contract', () => {
  it('builds owned entry and private draft submission payloads', () => {
    expect(buildBattleEntryPayload({ battleId: 1, userId: 'user-1' })).to.deep.equal({ battle_id: '1', user_id: 'user-1', status: 'active' });
    const submission = buildDraftSubmissionPayload({ entryId: 'entry-1', userId: 'user-1', originalFilename: 'mix.webm', declaredMimeType: 'audio/webm', fileSize: 1024, duration: 60, submissionSource: 'uploaded_mix' });
    expect(submission.user_id).to.equal('user-1');
    expect(submission.status).to.equal('draft');
    expect(submission.submission_source).to.equal('uploaded_mix');
    expect(submission.storage_object_path).to.match(/^private\/battle-entries\/entry-1\/submissions\//);
    expect(submission.storage_object_path).to.not.match(/^https?:/);
    const studio = buildDraftSubmissionPayload({ entryId: 'entry-1', userId: 'user-1', originalFilename: 'mix.webm', declaredMimeType: 'audio/webm', fileSize: 1024, submissionSource: 'battle_studio' });
    expect(studio.submission_source).to.equal('battle_studio');
    const bitcoin = buildDraftSubmissionPayload({ entryId: 'entry-1', userId: 'user-1', originalFilename: 'mix.webm', declaredMimeType: 'audio/webm', fileSize: 1024, submissionSource: 'uploaded_mix', battleContext:{ modeId:'bitcoin_battle', reward:{ type:'bitcoin', metadata:{ amountSats:2500, custody:'external_pending' } } } });
    expect(bitcoin.processing_info.battleContext.reward.metadata.amountSats).to.equal(2500);
  });

  it('rejects a missing or unrecognized submission source', () => {
    expect(SUBMISSION_SOURCES).to.deep.equal(['uploaded_mix', 'battle_studio']);
    expect(() => buildDraftSubmissionPayload({ entryId: 'entry-1', userId: 'user-1', originalFilename: 'mix.webm', declaredMimeType: 'audio/webm', fileSize: 1024 })).to.throw('Invalid submission source');
    expect(() => buildDraftSubmissionPayload({ entryId: 'entry-1', userId: 'user-1', originalFilename: 'mix.webm', declaredMimeType: 'audio/webm', fileSize: 1024, submissionSource: 'client_reported' })).to.throw('Invalid submission source');
  });

  it('allows only legal submission lifecycle transitions', () => {
    expect(canTransitionSubmissionStatus('draft', 'uploading')).to.equal(true);
    expect(canTransitionSubmissionStatus('uploaded', 'judging')).to.equal(true);
    expect(canTransitionSubmissionStatus('judging', 'completed')).to.equal(true);
    expect(canTransitionSubmissionStatus('processing', 'completed')).to.equal(true);
    expect(canTransitionSubmissionStatus('completed', 'processing')).to.equal(false);
    expect(canTransitionSubmissionStatus('draft', 'completed')).to.equal(false);
    expect(canTransitionSubmissionStatus('unknown', 'draft')).to.equal(false);
  });

  it('allows the owner to create and read an entry', async () => {
    const created = await getOrCreateBattleEntry(entryCreationClient(), 'user-1', 'battle-1');
    const entry = await getOwnedBattleEntry(singleRowClient('battle_entries', { id: 'entry-1', user_id: 'user-1' }), 'user-1', 'entry-1');
    expect(created.created).to.equal(true);
    expect(created.entry.user_id).to.equal('user-1');
    expect(entry.entry.id).to.equal('entry-1');
  });

  it('prevents access to another user entry or submission', async () => {
    const entry = await getOwnedBattleEntry(singleRowClient('battle_entries', { id: 'entry-1', user_id: 'user-2' }), 'user-1', 'entry-1');
    const submission = await getOwnedMixSubmission(singleRowClient('mix_submissions', { id: 'sub-1', user_id: 'user-2' }), 'user-1', 'sub-1');
    expect(entry.forbidden).to.equal(true);
    expect(submission.forbidden).to.equal(true);
  });

  it('creates one draft for an owned entry and rejects a completed duplicate', async () => {
    const calls = [];
    const client = {
      from(table){
        calls.push(table);
        if(table === 'battle_entries') return { select(){ return this; }, eq(){ return this; }, limit(){ return this; }, single: async () => ({ data: { id: 'entry-1', user_id: 'user-1' }, error: null }) };
        if(table === 'mix_submissions') return { select(){ return this; }, eq(){ return this; }, limit(){ return this; }, insert(rows){ this.rows = rows; return this; }, async single(){ return { data: this.rows ? this.rows[0] : null, error: null }; } };
      }
    };
    const created = await createDraftSubmission(client, 'user-1', 'entry-1', { originalFilename: 'mix.webm', declaredMimeType: 'audio/webm', fileSize: 1, submissionSource: 'uploaded_mix' });
    expect(created.created).to.equal(true);
    expect(created.submission.user_id).to.equal('user-1');
    expect(created.submission.submission_source).to.equal('uploaded_mix');
    expect(calls).to.deep.equal(['battle_entries', 'mix_submissions', 'mix_submissions']);

    const finalClient = {
      from(table){
        if(table === 'battle_entries') return { select(){ return this; }, eq(){ return this; }, limit(){ return this; }, single: async () => ({ data: { id: 'entry-1', user_id: 'user-1' }, error: null }) };
        return { data: [{ id: 'sub-1', status: 'completed' }], error: null, select(){ return this; }, eq(){ return this; }, limit(){ return this; } };
      }
    };
    const duplicate = await createDraftSubmission(finalClient, 'user-1', 'entry-1', { originalFilename: 'mix.webm', declaredMimeType: 'audio/webm', fileSize: 1, submissionSource: 'battle_studio' });
    expect(duplicate.conflict).to.equal(true);
  });

  it('defines owner relationships, lifecycle checks, private paths, and protected endpoints', () => {
    expect(sql).to.include('UNIQUE (battle_id, user_id)');
    expect(sql).to.include('UNIQUE (battle_entry_id)');
    expect(sql).to.include('FOREIGN KEY (battle_entry_id, user_id)');
    expect(sql).to.include("status IN ('draft', 'uploading', 'uploaded', 'queued', 'processing', 'judging', 'completed', 'failed')");
    expect(sql).to.include("storage_object_path !~* '^(https?|data):'");
    expect(sql).to.include('Completed submissions are immutable');
    expect(sql).to.include('Illegal mix submission status transition');
    expect(sql).to.include('allow_select_own_mix_submissions');
    expect(serverSource).to.include("app.post('/api/battleEntries', requireAuth");
    expect(serverSource).to.include("app.post('/api/battleEntries/:entryId/submissions', requireAuth");
    expect(serverSource).to.include("app.get('/api/mixSubmissions/:submissionId', requireAuth");
    expect(serverSource).to.include("app.get('/api/mixSubmissions/:submissionId/judgingResult', requireAuth");
    expect(serverSource).to.include('const userId = requireOwnedUserId(req, res, suppliedUserId);');
    expect(serverSource).to.include('getOwnedMixSubmission(supabaseService, req.authUser.id');
  });

  it('persists submission_source as a constrained, indexed, backward-compatible column', () => {
    expect(sourceSql).to.include("ADD COLUMN IF NOT EXISTS submission_source text NOT NULL DEFAULT 'uploaded_mix'");
    expect(sourceSql).to.include("CHECK (submission_source IN ('uploaded_mix', 'battle_studio'))");
    expect(sourceSql).to.include('mix_submissions_submission_source_idx');
    expect(serverSource).to.include('submissionSource');
  });
});

function entryCreationClient(){
  let insertedRows;
  return {
    from(table){
      expect(table).to.equal('battle_entries');
      return {
        data: [],
        error: null,
        select(){ return this; },
        eq(){ return this; },
        limit(){ return this; },
        insert(rows){ insertedRows = rows; return this; },
        async single(){ return { data: { id: 'entry-1', ...insertedRows[0] }, error: null }; }
      };
    }
  };
}

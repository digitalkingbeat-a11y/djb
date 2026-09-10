const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const {
  COMMUNITY_COMMENTS_TABLE,
  COMMUNITY_MODERATION_ACTIONS_TABLE,
  COMMUNITY_POSTS_TABLE,
  COMMUNITY_REACTIONS_TABLE,
  COMMUNITY_REPORTS_TABLE,
  checkCommunitySchemaReadiness,
  createCommunityComment,
  createCommunityPost,
  deleteCommunityComment,
  deleteCommunityPost,
  issueCommunityAttachmentPlaybackAccess,
  listCommunityFeed,
  listCommunityModerationHistory,
  listCommunityReports,
  moderateCommunityTarget,
  reportCommunityTarget,
  toggleCommunityReaction,
  updateCommunityComment,
  updateCommunityPost
} = require('../community');

const root = path.join(__dirname, '..');
const baseSql = fs.readFileSync(path.join(root, 'sql', '020_create_community_forum.sql'), 'utf8');
const hardeningSql = fs.readFileSync(path.join(root, 'sql', '027_harden_community_forum_contracts.sql'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

describe('server-backed community forum contract', () => {
  it('creates categorized posts with sanitized public profile identity and approved media attachments', async () => {
    const db = dataClient(baseDb());
    const result = await createCommunityPost(db, 'dj-1', {
      title:'Crate notes for tonight',
      bodyText:'Here is the routine breakdown https://example.com/set-notes',
      categoryId:'gear',
      attachments:[{ type:'library_track', mediaId:'track-public' }],
      idempotencyKey:'post-idem-1'
    }, new Date('2026-09-10T12:00:00Z'));

    expect(result.created).to.equal(true);
    expect(result.post.categoryId).to.equal('gear');
    expect(result.post.author.displayName).to.equal('Digital King');
    expect(result.post.safeLinks[0].host).to.equal('example.com');
    expect(result.post.attachments[0].mediaId).to.equal('track-public');
    expect(result.post.attachments[0].playbackContract).to.equal('protected_on_site_library_playback');
    expect(JSON.stringify(result.post)).to.not.include('email');
    expect(JSON.stringify(result.post)).to.not.include('private/library-audio');
    expect(JSON.stringify(result.post)).to.not.include('audio_storage_object_path');

    const duplicate = await createCommunityPost(db, 'dj-1', {
      title:'Different title should not duplicate',
      bodyText:'Different body',
      categoryId:'general',
      idempotencyKey:'post-idem-1'
    });
    expect(duplicate.duplicate).to.equal(true);
    expect(db.db[COMMUNITY_POSTS_TABLE]).to.have.length(1);
  });

  it('enforces post and threaded-comment ownership while preserving soft deletion tombstones', async () => {
    const db = dataClient(baseDb({ community_posts:[postRow()] }));
    const foreignPostUpdate = await updateCommunityPost(db, 'dj-2', 'post-1', { title:'Takeover' });
    expect(foreignPostUpdate.forbidden).to.equal(true);

    const parent = await createCommunityComment(db, 'dj-2', {
      postId:'post-1',
      bodyText:'First reply',
      idempotencyKey:'comment-idem-1'
    }, new Date('2026-09-10T12:02:00Z'));
    expect(parent.created).to.equal(true);
    const child = await createCommunityComment(db, 'dj-1', {
      postId:'post-1',
      parentCommentId:parent.comment.id,
      bodyText:'Threaded response'
    }, new Date('2026-09-10T12:03:00Z'));
    expect(child.comment.parentCommentId).to.equal(parent.comment.id);

    const foreignCommentUpdate = await updateCommunityComment(db, 'dj-1', parent.comment.id, { bodyText:'Nope' });
    expect(foreignCommentUpdate.forbidden).to.equal(true);
    const deletedComment = await deleteCommunityComment(db, 'dj-2', parent.comment.id, new Date('2026-09-10T12:04:00Z'));
    expect(deletedComment.deleted).to.equal(true);
    expect(deletedComment.comment.tombstone).to.equal(true);

    const foreignPostDelete = await deleteCommunityPost(db, 'dj-2', 'post-1');
    expect(foreignPostDelete.forbidden).to.equal(true);
    const deletedPost = await deleteCommunityPost(db, 'dj-1', 'post-1', new Date('2026-09-10T12:05:00Z'));
    expect(deletedPost.deleted).to.equal(true);
    expect(deletedPost.post.tombstone).to.equal(true);

    const feed = await listCommunityFeed(db, null, { limit:10 });
    expect(feed.posts).to.have.length(0);
  });

  it('filters global and following feeds with stable pagination order', async () => {
    const db = dataClient(baseDb({
      community_posts:[
        postRow({ id:'post-new', user_id:'dj-2', created_at:'2026-09-10T12:05:00Z' }),
        postRow({ id:'post-old', user_id:'dj-3', created_at:'2026-09-10T12:00:00Z' }),
        postRow({ id:'post-same-a', user_id:'dj-2', created_at:'2026-09-10T12:03:00Z' }),
        postRow({ id:'post-same-b', user_id:'dj-2', created_at:'2026-09-10T12:03:00Z' })
      ],
      dj_follows:[{ id:'follow-1', follower_user_id:'dj-1', followed_user_id:'dj-2', active:true }]
    }));

    const global = await listCommunityFeed(db, 'dj-1', { feed:'recent', limit:2 });
    expect(global.posts.map(post => post.id)).to.deep.equal(['post-new', 'post-same-a']);
    expect(global.pagination.hasMore).to.equal(true);
    const next = await listCommunityFeed(db, 'dj-1', { feed:'recent', cursor:global.pagination.nextCursor, limit:2 });
    expect(next.posts.map(post => post.id)).to.deep.equal(['post-same-b', 'post-old']);

    const following = await listCommunityFeed(db, 'dj-1', { feed:'following', limit:10 });
    expect(following.posts.map(post => post.id)).to.deep.equal(['post-new', 'post-same-a', 'post-same-b']);
  });

  it('allows one active reaction per user per post or comment target', async () => {
    const db = dataClient(baseDb({ community_posts:[postRow({ user_id:'dj-2' })] }));
    const like = await toggleCommunityReaction(db, 'dj-1', { targetType:'post', targetId:'post-1', type:'like' }, new Date('2026-09-10T12:10:00Z'));
    expect(like.reaction.active).to.equal(true);
    expect(like.counts).to.include({ like:1, total:1 });

    const fire = await toggleCommunityReaction(db, 'dj-1', { targetType:'post', targetId:'post-1', type:'fire' }, new Date('2026-09-10T12:11:00Z'));
    expect(fire.reaction.active).to.equal(true);
    expect(fire.reaction.type).to.equal('fire');
    expect(fire.counts).to.include({ like:0, fire:1, total:1 });
    expect(db.db[COMMUNITY_REACTIONS_TABLE]).to.have.length(1);

    const off = await toggleCommunityReaction(db, 'dj-1', { targetType:'post', targetId:'post-1', type:'fire' }, new Date('2026-09-10T12:12:00Z'));
    expect(off.reaction.active).to.equal(false);
    expect(off.counts.total).to.equal(0);
  });

  it('queues reports, updates moderation status and exposes moderator-only audit history', async () => {
    const db = dataClient(baseDb({ community_posts:[postRow({ user_id:'dj-2' })] }));
    const report = await reportCommunityTarget(db, 'dj-1', {
      targetType:'post',
      targetId:'post-1',
      reason:'unsafe_content',
      context:'Possible personal information.'
    }, new Date('2026-09-10T12:20:00Z'));
    expect(report.created).to.equal(true);
    expect(report.report.reporterUserId).to.equal(undefined);

    const duplicate = await reportCommunityTarget(db, 'dj-1', {
      targetType:'post',
      targetId:'post-1',
      reason:'unsafe_content'
    }, new Date('2026-09-10T12:21:00Z'));
    expect(duplicate.duplicate).to.equal(true);
    expect(db.db[COMMUNITY_REPORTS_TABLE]).to.have.length(1);

    const moderated = await moderateCommunityTarget(db, 'mod-1', {
      targetType:'post',
      targetId:'post-1',
      action:'hide',
      reportId:report.report.id,
      reason:'Contains private info'
    }, new Date('2026-09-10T12:22:00Z'));
    expect(moderated.action.auditTrail).to.equal('recorded');
    expect(moderated.report.status).to.equal('resolved');
    expect(db.db[COMMUNITY_POSTS_TABLE][0].status).to.equal('hidden');

    const reports = await listCommunityReports(db, 'mod-1', { status:'resolved' });
    expect(reports.reports[0]).to.include({ reporterUserId:'dj-1', targetId:'post-1', status:'resolved' });
    const history = await listCommunityModerationHistory(db, 'mod-1', { targetType:'post', targetId:'post-1' });
    expect(history.actions[0]).to.include({ action:'hide', targetId:'post-1' });
    expect(JSON.stringify(history.actions[0])).to.not.include('email');
  });

  it('issues signed community playback only after post, media, rights and storage authorization pass', async () => {
    const db = dataClient(baseDb({
      community_posts:[postRow({ attachments:[attachmentSnapshot()] })]
    }));
    const storage = storageClient();
    const result = await issueCommunityAttachmentPlaybackAccess(db, storage, 'dj-2', 'post-1', 'att-1', new Date('2026-09-10T12:30:00Z'));
    expect(result.playbackAccess).to.include({ accessScope:'community_playback', postId:'post-1', attachmentId:'att-1', trackId:'track-public' });
    expect(result.playbackAccess.expiresAt).to.equal('2026-09-10T12:35:00.000Z');
    expect(storage.signed[0]).to.deep.equal({ objectPath:'private/library-audio/dj-1/tracks/track-public/audio.webm', expiresIn:300 });
    expect(db.db.music_library_tracks[0].usage_relationships.posts).to.deep.equal(['post-1']);
    expect(JSON.stringify(result)).to.not.include('private/library-audio');
    expect(JSON.stringify(result)).to.not.include('audio_storage_object_path');

    db.db.music_library_tracks[0].community_approved = false;
    db.db.music_library_tracks[0].visibility = 'private';
    const unapproved = await issueCommunityAttachmentPlaybackAccess(db, storageClient(), 'dj-2', 'post-1', 'att-1');
    expect(unapproved.forbidden).to.equal(true);

    db.db.music_library_tracks[0].community_approved = true;
    db.db.music_library_tracks[0].visibility = 'public';
    db.db.music_library_tracks[0].audio_storage_object_path = 'private/marketplace/paid/master.wav';
    const paidPath = await issueCommunityAttachmentPlaybackAccess(db, storageClient(), 'dj-2', 'post-1', 'att-1');
    expect(paidPath.unavailable).to.equal(true);
  });

  it('keeps forum actions isolated from commerce and community-voting records', async () => {
    const initial = baseDb({ community_posts:[postRow({ attachments:[attachmentSnapshot()] })] });
    const db = dataClient(initial);
    await createCommunityComment(db, 'dj-2', { postId:'post-1', bodyText:'This is useful.' });
    await toggleCommunityReaction(db, 'dj-2', { targetType:'post', targetId:'post-1', type:'respect' });
    await reportCommunityTarget(db, 'dj-2', { targetType:'post', targetId:'post-1', reason:'other' });
    await issueCommunityAttachmentPlaybackAccess(db, storageClient(), 'dj-2', 'post-1', 'att-1');

    expect(db.db.marketplace_orders).to.have.length(0);
    expect(db.db.marketplace_order_items).to.have.length(0);
    expect(db.db.marketplace_payment_events).to.have.length(0);
    expect(db.db.marketplace_seller_settlements).to.have.length(0);
    expect(db.db.marketplace_seller_payouts).to.have.length(0);
    expect(db.db.marketplace_entitlements).to.have.length(0);
    expect(db.db.battle_community_votes).to.have.length(0);
    expect(db.db.battle_community_vote_audit).to.have.length(0);
  });

  it('documents schema hardening and exposes bounded authenticated routes', async () => {
    const ready = await checkCommunitySchemaReadiness(dataClient(baseDb()));
    expect(ready.ready).to.equal(true);
    expect(ready.schema).to.equal('020_create_community_forum');

    expect(baseSql).to.include('CREATE TABLE IF NOT EXISTS public.community_posts');
    expect(hardeningSql).to.include('027_harden_community_forum_contracts');
    expect(hardeningSql).to.include('community_reactions_one_active_per_target_idx');
    expect(hardeningSql).to.include('community_posts_no_private_attachment_paths');
    expect(hardeningSql).to.include('allow_operator_update_community_reports');
    expect(hardeningSql).to.not.include('marketplace_orders');
    expect(hardeningSql).to.not.include('marketplace_payment_events');

    expect(serverSource).to.include("app.post('/api/community/posts', requireAuth");
    expect(serverSource).to.include("app.post('/api/community/comments', requireAuth");
    expect(serverSource).to.include("app.post('/api/community/reactions/toggle', requireAuth");
    expect(serverSource).to.include("app.post('/api/community/reports', requireAuth");
    expect(serverSource).to.include("app.get('/api/community/reports', requireAuth, requireOperatorUser");
    expect(serverSource).to.include("app.post('/api/community/moderation/actions', requireAuth, requireOperatorUser");
    expect(serverSource).to.include("app.get('/api/community/moderation/history', requireAuth, requireOperatorUser");
    expect(serverSource).to.include('issueCommunityAttachmentPlaybackAccess(supabaseService, supabaseService.storage.from(MIX_BUCKET)');
    expect(serverSource).to.not.match(/community.*marketplace_orders|community.*payment_events|community.*seller_payouts/i);
  });
});

function baseDb(overrides = {}){
  return {
    community_categories:[
      { id:'general', slug:'general', label:'General DJ Discussion', description:'General talk', sort_order:10, status:'active', server_default:true },
      { id:'gear', slug:'gear', label:'Gear', description:'Hardware talk', sort_order:20, status:'active', server_default:true }
    ],
    community_posts:[],
    community_comments:[],
    community_reactions:[],
    community_reports:[],
    community_moderation_actions:[],
    dj_progression_profiles:[
      profileRow({ user_id:'dj-1', public_profile_id:'dj_digital', display_name:'Digital King', public_profile:{ displayName:'Digital King', email:'hidden@example.com' } }),
      profileRow({ user_id:'dj-2', public_profile_id:'dj_second', display_name:'Second DJ' }),
      profileRow({ user_id:'dj-3', public_profile_id:'dj_third', display_name:'Third DJ' })
    ],
    dj_blocks:[],
    dj_follows:[],
    dj_notification_mutes:[],
    dj_notifications:[],
    music_library_tracks:[libraryTrack()],
    marketplace_orders:[],
    marketplace_order_items:[],
    marketplace_payment_events:[],
    marketplace_entitlements:[],
    marketplace_seller_settlements:[],
    marketplace_seller_payouts:[],
    battle_community_votes:[],
    battle_community_vote_audit:[],
    ...overrides
  };
}

function profileRow(overrides = {}){
  return {
    user_id:'dj-1',
    public_profile_id:'dj_digital',
    display_name:'Digital King',
    country:'US',
    belt:'Blue',
    visibility:'public',
    public_profile:{ displayName:'Digital King', country:'US', belt:'Blue' },
    ...overrides
  };
}

function libraryTrack(overrides = {}){
  return {
    id:'track-public',
    user_id:'dj-1',
    source_type:'track',
    title:'Forum Dub',
    artist:'Digital King',
    bpm:128,
    key:'A minor',
    camelot_key:'8A',
    genre:'Bass House',
    duration:182,
    rights_classification:'original',
    visibility:'public',
    community_approved:true,
    audio_storage_object_path:'private/library-audio/dj-1/tracks/track-public/audio.webm',
    artwork_metadata:{ mimeType:'image/png', size:2048, storageObjectPath:'private/art.png' },
    usage_relationships:{ playlists:[], battles:[], posts:[], practiceHistory:[], submissions:[] },
    created_at:'2026-09-10T11:00:00Z',
    updated_at:'2026-09-10T11:00:00Z',
    archived_at:null,
    ...overrides
  };
}

function attachmentSnapshot(overrides = {}){
  return {
    id:'att-1',
    type:'library_track',
    mediaId:'track-public',
    title:'Forum Dub',
    artist:'Digital King',
    duration:182,
    bpm:128,
    camelotKey:'8A',
    rightsClassification:'original',
    rightsStatus:'classified',
    sourceType:'track',
    playbackPermitted:true,
    playbackContract:'protected_on_site_library_playback',
    status:'available',
    ...overrides
  };
}

function postRow(overrides = {}){
  return {
    id:'post-1',
    user_id:'dj-1',
    category_id:'general',
    title:'Public forum post',
    body_text:'Discuss this mix.',
    safe_links:[],
    attachments:[],
    visibility:'public',
    status:'active',
    idempotency_key:null,
    edited_at:null,
    hidden_at:null,
    locked_at:null,
    deleted_at:null,
    created_at:'2026-09-10T12:00:00Z',
    updated_at:'2026-09-10T12:00:00Z',
    ...overrides
  };
}

function dataClient(initial){
  const db = Object.fromEntries(Object.entries(initial).map(([table, rows]) => [table, rows.map(clone)]));
  return {
    db,
    from(table){
      if(!db[table]) db[table] = [];
      return new Query(db, table);
    }
  };
}

class Query{
  constructor(db, table){
    this.db = db;
    this.table = table;
    this.filters = [];
    this.limitValue = null;
    this.insertRows = null;
    this.updateValues = null;
  }
  select(){ return this; }
  eq(field, value){ this.filters.push([field, value]); return this; }
  limit(value){ this.limitValue = Number(value); return this; }
  insert(rows){ this.insertRows = rows.map(clone); return this; }
  update(values){ this.updateValues = clone(values); return this; }
  then(resolve, reject){ return this.execute().then(resolve, reject); }
  async single(){
    const result = await this.execute();
    if(result.error) return result;
    return { data:Array.isArray(result.data) ? result.data[0] || null : result.data, error:null };
  }
  async execute(){
    const rows = this.db[this.table];
    if(!rows) return { data:null, error:new Error(`Unknown table ${this.table}`) };
    if(this.insertRows){
      const inserted = this.insertRows.map(row => ({ id:row.id || `${this.table}-${rows.length + 1}`, ...clone(row) }));
      rows.push(...inserted.map(clone));
      return { data:inserted.map(clone), error:null };
    }
    const matched = rows.filter(row => this.filters.every(([field, value]) => String(row[field]) === String(value)));
    if(this.updateValues){
      matched.forEach(row => Object.assign(row, clone(this.updateValues)));
      return { data:matched.slice(0, this.limitValue || matched.length).map(clone), error:null };
    }
    const limited = this.limitValue != null ? matched.slice(0, this.limitValue) : matched;
    return { data:limited.map(clone), error:null };
  }
}

function storageClient(){
  return {
    signed:[],
    async createSignedUrl(objectPath, expiresIn){
      this.signed.push({ objectPath, expiresIn });
      return { data:{ signedUrl:`https://signed.local/${encodeURIComponent(objectPath)}` }, error:null };
    }
  };
}

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

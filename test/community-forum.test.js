const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function loadAppDom(){
  const root = path.join(__dirname, '..');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(index, {
    url:'http://127.0.0.1/index.html',
    runScripts:'outside-only',
    pretendToBeVisual:true
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

function forumPost(overrides = {}){
  return {
    id:'post-1',
    title:'Battle prep notes',
    bodyText:'Keeping the phrase structure tight.',
    categoryId:'general',
    visibility:'public',
    status:'active',
    createdAt:'2026-09-10T12:00:00.000Z',
    author:{ publicProfileId:'dj_rival', displayName:'Rival DJ', country:'US', belt:'Blue' },
    viewer:{ isOwner:false, canEdit:false, canDelete:false },
    reactionCounts:{ like:0, fire:0, respect:0, technique:0, total:0 },
    viewerReactionTypes:[],
    commentCount:2,
    attachments:[{
      id:'att-1',
      type:'library_track',
      mediaId:'track-public',
      title:'Forum Dub',
      artist:'Digital King',
      bpm:128,
      camelotKey:'8A',
      rightsStatus:'classified',
      sourceType:'track',
      playbackPermitted:true,
      playbackContract:'protected_on_site_library_playback',
      status:'available'
    }],
    ...overrides
  };
}

function feedResponse(posts, overrides = {}){
  return {
    status:200,
    data:{
      posts,
      categories:[{ id:'general', label:'General DJ Discussion', status:'active' }],
      pagination:{ page:1, limit:20, total:posts.length, hasMore:false, nextCursor:null, nextPage:null },
      generatedAt:'2026-09-10T12:01:00.000Z',
      source:'server_community',
      ...overrides
    }
  };
}

function setCommunityAccount(window, accountId = 'viewer-1'){
  const hooks = window.__DJBattleTestHooks;
  hooks.getLibraryState().sync.accountId = accountId;
  hooks.getLibraryState().sync.status = 'synced';
  return hooks;
}

test('community panel loads authenticated server feed with public identity, attachment controls and challenge action', async () => {
  const window = loadAppDom();
  const hooks = setCommunityAccount(window);
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, options });
    return feedResponse([forumPost()]);
  };

  const result = await hooks.loadCommunityFeed({ feed:'recent', page:1 });

  assert.equal(result.posts.length, 1);
  assert.match(calls[0].url, /^\/api\/community\/myFeed\?/);
  assert.equal(window.document.querySelector('#forum-feed').textContent.includes('Rival DJ'), true);
  assert.ok(window.document.querySelector('[data-community-media="att-1"]'));
  assert.ok(window.document.querySelector('[data-community-challenge="dj_rival"]'));
  assert.equal(window.document.body.innerHTML.includes('private/library-audio'), false);
  assert.equal(window.document.body.innerHTML.includes('storageObjectPath'), false);
});

test('community feed ignores stale responses and keeps the latest account-safe page', async () => {
  const window = loadAppDom();
  const hooks = setCommunityAccount(window);
  const pending = [];
  window.DJBattleApi.apiRequest = async url => new Promise(resolve => pending.push({ url, resolve }));

  const first = hooks.loadCommunityFeed({ feed:'recent', page:1 });
  const second = hooks.loadCommunityFeed({ feed:'popular', page:1 });
  assert.equal(pending.length, 2);

  pending[1].resolve(feedResponse([forumPost({ id:'newer-post', title:'Newest response' })]));
  await second;
  pending[0].resolve(feedResponse([forumPost({ id:'stale-post', title:'Stale response' })]));
  const stale = await first;

  assert.equal(stale.stale, true);
  assert.deepEqual(hooks.getCommunityState().posts.map(post => post.id), ['newer-post']);
  assert.equal(window.document.querySelector('#forum-feed').textContent.includes('Stale response'), false);
});

test('community reactions replace the active viewer reaction instead of stacking choices', async () => {
  const window = loadAppDom();
  const hooks = setCommunityAccount(window);
  hooks.getCommunityState().source = 'server';
  hooks.getCommunityState().posts = [forumPost()];
  hooks.renderPosts();
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, body:options.body });
    const type = options.body.type;
    return {
      status:200,
      data:{
        reaction:{ type, active:true },
        counts:type === 'fire'
          ? { like:0, fire:1, respect:0, technique:0, total:1 }
          : { like:1, fire:0, respect:0, technique:0, total:1 }
      }
    };
  };

  await hooks.toggleCommunityReaction('post-1', 'like');
  assert.equal(JSON.stringify(hooks.getCommunityState().posts[0].viewerReactionTypes), JSON.stringify(['like']));
  await hooks.toggleCommunityReaction('post-1', 'fire');

  assert.equal(JSON.stringify(hooks.getCommunityState().posts[0].viewerReactionTypes), JSON.stringify(['fire']));
  assert.equal(calls.length, 2);
  assert.equal(window.document.querySelectorAll('.community-reaction.active').length, 1);
  assert.match(window.document.querySelector('.community-reaction.active').textContent, /Fire/);
});

test('community media playback uses the signed server endpoint without exposing private paths', async () => {
  const window = loadAppDom();
  const hooks = setCommunityAccount(window);
  hooks.getCommunityState().source = 'server';
  hooks.getCommunityState().posts = [forumPost()];
  hooks.renderPosts();
  const audio = window.document.getElementById('library-player-audio');
  const calls = [];
  window.DJBattleApi.apiRequest = async (url, options = {}) => {
    calls.push({ url, method:options.method });
    return {
      status:200,
      data:{
        playbackAccess:{ url:'https://signed.local/community-playback-token', accessScope:'community_playback' },
        attachment:{ id:'att-1' },
        usage:{ recorded:true }
      }
    };
  };

  const response = await hooks.recordCommunityMediaUsage('post-1', 'att-1');

  assert.equal(response.data.playbackAccess.accessScope, 'community_playback');
  assert.equal(calls[0].url, '/api/community/posts/post-1/attachments/att-1/usage');
  assert.equal(calls[0].method, 'POST');
  assert.equal(audio.src, 'https://signed.local/community-playback-token');
  assert.equal(window.document.body.innerHTML.includes('private/library-audio'), false);
});

test('community state is cleared on authenticated account switch', async () => {
  const window = loadAppDom();
  const hooks = setCommunityAccount(window, 'viewer-1');
  hooks.getCommunityState().source = 'server';
  hooks.getCommunityState().status = 'synced';
  hooks.getCommunityState().posts = [forumPost()];
  hooks.getCommunityState().comments['post-1'] = [{ id:'comment-1' }];

  window.DJBattleApi.apiRequest = async url => {
    if(url === '/api/musicLibrary/schemaStatus') return { status:200, data:{ ready:true, status:'ready' } };
    if(url === '/api/musicLibrary/organizationStatus') return { status:200, data:{ ready:true, status:'ready' } };
    if(url.startsWith('/api/musicLibrary/tracks')) return { status:200, data:{ tracks:[], pagination:{ page:1, limit:50, hasMore:false } } };
    if(url === '/api/musicLibrary/crates') return { status:200, data:{ crates:[] } };
    if(url === '/api/challenges/count') return { status:200, data:{ counts:{ open:0 } } };
    if(url === '/api/notifications/count') return { status:200, data:{ counts:{ unreadTotal:0 } } };
    if(url.startsWith('/api/notifications?')) return { status:200, data:{ notifications:[], pagination:{ page:1, limit:10, hasMore:false } } };
    if(url.startsWith('/api/relationships/sync?')) return { status:200, data:{ sync:{ relationships:[], activity:[], opponentHistory:[], counts:{ following:0, followers:0 }, syncVersion:'v2' } } };
    return { status:200, data:{} };
  };

  await hooks.handleMusicLibraryAuthChange({ id:'viewer-2', email:'viewer2@example.com' });

  assert.equal(hooks.getLibraryState().sync.accountId, 'viewer-2');
  assert.equal(hooks.getCommunityState().posts.length, 0);
  assert.equal(JSON.stringify(hooks.getCommunityState().comments), '{}');
  assert.equal(hooks.getCommunityState().source, 'local');
  assert.equal(hooks.getCommunityState().feed, 'recent');
});

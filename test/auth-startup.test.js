const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const initialization = source.slice(source.indexOf('const authInitState = { initialized:false, reason:\'loading\' };'), source.indexOf("const judgeRefreshButton ="));

for (const readyAtStartup of [false, true]) {
  test(`auth initializes once when Supabase loads ${readyAtStartup ? 'before' : 'after'} the app`, async () => {
    const listeners = {};
    const button = {};
    const updates = [];
    let subscriptions = 0;
    let authChanged;
    const unavailableCalls = [];
    const client = { auth: {
      getSession: async () => ({ data: { session: { user: { id: 'account-a' } } } }),
      onAuthStateChange: callback => { subscriptions++; authChanged = callback; }
    } };
    const context = {
      document: { getElementById: () => button },
      openSignInModal: () => {},
      openSignInUnavailableModal: reason => unavailableCalls.push(reason),
      openEditProfileModal: () => {},
      shareCurrentProfile: async () => {},
      updateAuthUI: user => updates.push(user),
      renderCurrentUserUI: () => {},
      computeLiveMode: () => true,
      dataSourceState: {},
      renderOfflineDemoBanner: () => {},
      addEventListener: (name, callback) => { listeners[name] = callback; }
    };
    context.window = context;
    if (readyAtStartup) context.supabase = client;
    vm.runInNewContext(initialization, context);
    if (!readyAtStartup) {
      assert.equal(typeof button.onclick, 'function');
      button.onclick();
      assert.equal(unavailableCalls.at(-1), 'loading');
      context.supabase = client;
      listeners['djb:supabase-ready']({ detail: { configured: true, client: true } });
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(button.onclick, context.openSignInModal);
    assert.equal(updates[0].id, 'account-a');
    if (listeners['djb:supabase-ready']) listeners['djb:supabase-ready']({ detail: { configured: true, client: true } });
    assert.equal(subscriptions, 1);
    authChanged('SIGNED_OUT', null);
    assert.equal(updates.at(-1), null);
  });
}

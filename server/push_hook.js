// Oct 20: tiny bridge so code that creates Activity-bell notifications can also fire a phone
// lock-screen alert, without those modules needing to know about web push. index.js installs
// the real sender; tests can install a fake. A push failure never breaks the main action.
let hook = null;
function setPushHook(fn){ hook = typeof fn === 'function' ? fn : null; }
function firePush(dataClient, notificationRow){
  if(!hook || !notificationRow) return Promise.resolve({ skipped:true });
  return Promise.resolve().then(() => hook(dataClient, notificationRow)).catch(error => {
    console.warn('push alert skipped', error && error.message || error);
    return { error };
  });
}
module.exports = { setPushHook, firePush };

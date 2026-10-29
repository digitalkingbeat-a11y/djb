// Oct 29: Instagram / SoundCloud / Mixcloud / TikTok links on DJ profiles (sql/056).
// Same rules as the browser copy in oct29_five.js.
const SOCIAL_LINK_MAX = 200;
const SOCIAL_NETWORKS = {
  instagram: { label:'Instagram', hosts:['instagram.com', 'www.instagram.com', 'm.instagram.com'], handle:/^[A-Za-z0-9._]{1,30}$/, base:'https://instagram.com/', at:false },
  soundcloud: { label:'SoundCloud', hosts:['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com', 'on.soundcloud.com'], handle:/^[A-Za-z0-9_-]{1,50}$/, base:'https://soundcloud.com/', at:false },
  mixcloud: { label:'Mixcloud', hosts:['mixcloud.com', 'www.mixcloud.com', 'm.mixcloud.com'], handle:/^[A-Za-z0-9_-]{1,50}$/, base:'https://mixcloud.com/', at:false },
  tiktok: { label:'TikTok', hosts:['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com'], handle:/^[A-Za-z0-9._]{1,24}$/, base:'https://tiktok.com/@', at:true }
};
const SOCIAL_KEYS = Object.keys(SOCIAL_NETWORKS);

// A full https link on the right site, or an @handle that becomes one. Anything else is refused.
function cleanSocialLink(network, value){
  const spec = SOCIAL_NETWORKS[network];
  if(!spec) return { error:'Unknown link type.' };
  let text = String(value == null ? '' : value).trim();
  if(!text) return { value:'' };
  const bad = { error:`${spec.label} must be an https://${spec.hosts[0]}/… link or an @handle.` };
  if(/[\s<>"'`\\]/.test(text) || /[\u0000-\u001f\u007f]/.test(text)) return bad;
  const looksLikeLink = /^[a-z][a-z0-9+.-]*:/i.test(text) || text.includes('/') || /^([a-z0-9-]+\.)*[a-z0-9-]+\.com$/i.test(text);
  if(!looksLikeLink){
    const handle = text.replace(/^@/, '');
    if(!spec.handle.test(handle)) return bad;
    return { value:spec.base + handle };
  }
  if(/^[a-z][a-z0-9+.-]*:/i.test(text)){
    if(!/^https:\/\//i.test(text)) return { error:`${spec.label} link must start with https://.` };
  }else{
    text = `https://${text.replace(/^\/+/, '')}`;
  }
  let url;
  try{ url = new URL(text); }catch(e){ return bad; }
  if(url.protocol !== 'https:' || url.username || url.password || url.port) return bad;
  if(!spec.hosts.includes(url.hostname.toLowerCase())) return bad;
  const path = url.pathname.replace(/\/+$/, '');
  if(!path || path === '/' || !/^[A-Za-z0-9@._~\/-]+$/.test(path)) return bad;
  const out = `https://${url.hostname.toLowerCase()}${path}`;
  if(out.length > SOCIAL_LINK_MAX) return { error:`${spec.label} link must be ${SOCIAL_LINK_MAX} characters or fewer.` };
  return { value:out };
}

function cleanSocialLinks(input = {}){
  const out = {};
  for(const key of SOCIAL_KEYS){
    if(!input || !Object.prototype.hasOwnProperty.call(input, key)) continue;
    const r = cleanSocialLink(key, input[key]);
    if(r.error) return { error:r.error, field:key };
    out[key] = r.value;
  }
  return { value:out };
}

module.exports = { SOCIAL_LINK_MAX, SOCIAL_NETWORKS, SOCIAL_KEYS, cleanSocialLink, cleanSocialLinks };

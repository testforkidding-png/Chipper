/**
 * CIPHER DB v4
 * Pure-JS SHA-256 = identical to crypto.subtle on all platforms (HTTP/HTTPS/file://)
 */
const DB = (() => {
  const NS = 'cipher_';
  const _get = k => { try { return JSON.parse(localStorage.getItem(NS+k)); } catch { return null; } };
  const _set = (k, v) => { localStorage.setItem(NS+k, JSON.stringify(v)); try { _bc?.postMessage({key:k}); } catch {} };

  let _bc = null;
  try { _bc = new BroadcastChannel('cipher_sync'); } catch {}

  // ── Real SHA-256 (pure JS, same output as crypto.subtle) ─────────
  function _sha256(str) {
    const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const bytes=new TextEncoder().encode(str);
    const len=bytes.length,bitLen=len*8;
    const extra=(len+1+8)%64,padLen=extra<=56?55-(len+1)%64:119-(len+1)%64;
    const padded=new Uint8Array(len+1+padLen+1+8);
    padded.set(bytes);padded[len]=0x80;
    const dv=new DataView(padded.buffer);
    dv.setUint32(padded.length-4,bitLen&0xffffffff,false);
    dv.setUint32(padded.length-8,Math.floor(bitLen/0x100000000),false);
    const r=(n,b)=>(n>>>b)|(n<<(32-b));
    for(let i=0;i<padded.length;i+=64){
      const W=new Uint32Array(64);
      for(let t=0;t<16;t++)W[t]=dv.getUint32(i+t*4,false);
      for(let t=16;t<64;t++)W[t]=((r(W[t-2],17)^r(W[t-2],19)^(W[t-2]>>>10))+W[t-7]+(r(W[t-15],7)^r(W[t-15],18)^(W[t-15]>>>3))+W[t-16])|0;
      let[a,b,c,d,e,f,g,h]=H;
      for(let t=0;t<64;t++){
        const T1=(h+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+K[t]+W[t])|0;
        const T2=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))|0;
        h=g;g=f;f=e;e=(d+T1)|0;d=c;c=b;b=a;a=(T1+T2)|0;
      }
      H[0]=(H[0]+a)|0;H[1]=(H[1]+b)|0;H[2]=(H[2]+c)|0;H[3]=(H[3]+d)|0;
      H[4]=(H[4]+e)|0;H[5]=(H[5]+f)|0;H[6]=(H[6]+g)|0;H[7]=(H[7]+h)|0;
    }
    return H.map(n=>(n>>>0).toString(16).padStart(8,'0')).join('');
  }

  // Public hash — always uses pure-JS (same as crypto.subtle result)
  function quickHash(str) {
    return Promise.resolve(_sha256(str + '_cipher_salt'));
  }

  // ── User management ──────────────────────────────────────────────
  async function ensureUsers() {
    const deleted = JSON.parse(localStorage.getItem(NS+'deleted_users') || '[]');
    try {
      const r = await fetch('users.json?t=' + Date.now());
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data.users) && data.users.length) {
          const stored = _get('users') || {};
          for (const u of data.users) {
            if (deleted.includes(u.username)) continue;
            const hash = await quickHash(u.password);
            const prev = stored[u.username] || {};
            stored[u.username] = {
              ...u, password_hash: hash,
              avatar_url:   prev.avatar_url   ?? null,
              banner_color: prev.banner_color || u.banner_color || '#0A1628',
              bio:          prev.bio          != null ? prev.bio : (u.bio || ''),
              status:       prev.status       != null ? prev.status : (u.status || ''),
              status_emoji: prev.status_emoji != null ? prev.status_emoji : (u.status_emoji || ''),
              display_name: prev.display_name || u.display_name,
              created_at:   prev.created_at   || (Date.now() - 30*86400000),
            };
          }
          localStorage.setItem(NS+'users', JSON.stringify(stored));
          return;
        }
      }
    } catch(e) { console.warn('[CIPHER] users.json:', e.message); }
  }

  // ── Local ────────────────────────────────────────────────────────
  const Local = {
    async getUser(u)        { return (_get('users')||{})[u]||null; },
    async getAllUsers()      { return Object.values(_get('users')||{}); },
    async createUser(d)     { const us=_get('users')||{}; us[d.username]={...d,created_at:Date.now()}; _set('users',us); return us[d.username]; },
    async updateUser(u,d)   { const us=_get('users')||{}; if(!us[u])return null; us[u]={...us[u],...d,updated_at:Date.now()}; _set('users',us); return us[u]; },
    async deleteUser(u)     {
      const us=_get('users')||{}; delete us[u]; _set('users',us);
      const del=JSON.parse(localStorage.getItem(NS+'deleted_users')||'[]');
      if(!del.includes(u)){del.push(u);localStorage.setItem(NS+'deleted_users',JSON.stringify(del));}
    },
    async getConversations(uid) { return Object.values(_get('convs')||{}).filter(c=>c.participants?.includes(uid)); },
    async getConversation(id)   { return (_get('convs')||{})[id]||null; },
    async createConversation(d) { const cs=_get('convs')||{}; const id=d.id||'conv_'+Date.now(); cs[id]={...d,id,created_at:Date.now()}; _set('convs',cs); return cs[id]; },
    async updateConversation(id,d) { const cs=_get('convs')||{}; if(!cs[id])return null; cs[id]={...cs[id],...d}; _set('convs',cs); return cs[id]; },
    async getMessages(cid,lim=200) { return (_get('msgs_'+cid)||[]).slice(-lim); },
    async createMessage(d) {
      const msgs=_get('msgs_'+d.conv_id)||[];
      const msg={...d,id:d.id||'msg_'+Date.now()+Math.random().toString(36).substr(2,4),created_at:d.created_at||Date.now()};
      msgs.push(msg); _set('msgs_'+d.conv_id,msgs); return msg;
    },
    async updateMessage(cid,mid,d) {
      const msgs=_get('msgs_'+cid)||[];
      const i=msgs.findIndex(m=>m.id===mid); if(i<0)return null;
      msgs[i]={...msgs[i],...d,updated_at:Date.now()}; _set('msgs_'+cid,msgs); return msgs[i];
    },
    async deleteMessage(cid,mid) { _set('msgs_'+cid,(_get('msgs_'+cid)||[]).filter(m=>m.id!==mid)); },
    async getStories() { const now=Date.now(); return Object.values(_get('stories')||{}).filter(s=>s.expires_at>now); },
    async createStory(d) { const ss=_get('stories')||{}; const id='story_'+Date.now(); ss[id]={...d,id,created_at:Date.now(),expires_at:Date.now()+24*3600000}; _set('stories',ss); return ss[id]; },
    async deleteStory(id) { const ss=_get('stories')||{}; delete ss[id]; _set('stories',ss); },
  };

  // ── Supabase ─────────────────────────────────────────────────────
  let _sb=null;
  const sb=()=>{ if(_sb)return _sb; if(!window.supabase)throw new Error('Supabase not loaded'); _sb=window.supabase.createClient(CONFIG.SUPABASE_URL,CONFIG.SUPABASE_ANON_KEY); return _sb; };
  const Supa={
    async getUser(u){const{data}=await sb().from('users').select('*').eq('username',u).single();return data;},
    async getAllUsers(){const{data}=await sb().from('users').select('*').order('created_at');return data||[];},
    async createUser(d){const{data,error}=await sb().from('users').insert(d).select().single();if(error)throw error;return data;},
    async updateUser(u,d){const{data}=await sb().from('users').update(d).eq('username',u).select().single();return data;},
    async deleteUser(u){await sb().from('users').delete().eq('username',u);},
    async getConversations(uid){const{data}=await sb().from('conversations').select('*').contains('participants',[uid]).order('last_time',{ascending:false});return data||[];},
    async getConversation(id){const{data}=await sb().from('conversations').select('*').eq('id',id).single();return data;},
    async createConversation(d){const{data,error}=await sb().from('conversations').insert(d).select().single();if(error)throw error;return data;},
    async updateConversation(id,d){const{data}=await sb().from('conversations').update(d).eq('id',id).select().single();return data;},
    async getMessages(cid,lim=200){const{data}=await sb().from('messages').select('*').eq('conv_id',cid).order('created_at').limit(lim);return data||[];},
    async createMessage(d){const{data,error}=await sb().from('messages').insert(d).select().single();if(error)throw error;return data;},
    async updateMessage(cid,mid,d){const{data}=await sb().from('messages').update(d).eq('id',mid).select().single();return data;},
    async deleteMessage(cid,mid){await sb().from('messages').delete().eq('id',mid);},
    async getStories(){const{data}=await sb().from('stories').select('*').gt('expires_at',new Date().toISOString());return data||[];},
    async createStory(d){const exp=new Date(Date.now()+86400000).toISOString();const{data,error}=await sb().from('stories').insert({...d,expires_at:exp}).select().single();if(error)throw error;return data;},
    async deleteStory(id){await sb().from('stories').delete().eq('id',id);},
    subscribeMessages(cid,cb){return sb().channel('msgs_'+cid).on('postgres_changes',{event:'*',schema:'public',table:'messages',filter:`conv_id=eq.${cid}`},cb).subscribe();},
    unsubscribe(ch){if(ch)sb().removeChannel(ch);}
  };

  const impl=()=>CONFIG.USE_SUPABASE?Supa:Local;

  if(_bc){_bc.onmessage=e=>{try{window._onStorageSync?.(e.data?.key);}catch{}};}
  window.addEventListener('storage',e=>{if(e.key?.startsWith(NS))window._onStorageSync?.(e.key.slice(NS.length));});

  return {
    async init(){
      if(!CONFIG.USE_SUPABASE){
        await ensureUsers();
        // Migrate stale hashes: old broken fallback produced <64 char strings
        // Those users can't login until admin resets their password
        // Mark them so we can show a helpful error
        const users = _get('users') || {};
        let changed = false;
        for (const [uname, u] of Object.entries(users)) {
          if (u.password_hash && u.password_hash.length !== 64) {
            users[uname].password_hash_broken = true;
            changed = true;
          }
        }
        if (changed) localStorage.setItem(NS+'users', JSON.stringify(users));
      }
    },
    getUser:(...a)=>impl().getUser(...a),
    getAllUsers:(...a)=>impl().getAllUsers(...a),
    createUser:(...a)=>impl().createUser(...a),
    updateUser:(...a)=>impl().updateUser(...a),
    deleteUser:(...a)=>impl().deleteUser(...a),
    getConversations:(...a)=>impl().getConversations(...a),
    getConversation:(...a)=>impl().getConversation(...a),
    createConversation:(...a)=>impl().createConversation(...a),
    updateConversation:(...a)=>impl().updateConversation(...a),
    getMessages:(...a)=>impl().getMessages(...a),
    createMessage:(...a)=>impl().createMessage(...a),
    updateMessage:(...a)=>impl().updateMessage(...a),
    deleteMessage:(...a)=>impl().deleteMessage(...a),
    getStories:(...a)=>impl().getStories(...a),
    createStory:(...a)=>impl().createStory(...a),
    deleteStory:(...a)=>impl().deleteStory(...a),
    subscribeMessages:CONFIG.USE_SUPABASE?(...a)=>Supa.subscribeMessages(...a):()=>null,
    unsubscribe:CONFIG.USE_SUPABASE?(...a)=>Supa.unsubscribe(...a):()=>null,
    hashPassword: quickHash,
  };
})();

/**
 * CIPHER DB v10 — Clean rewrite
 * Supabase + localStorage fallback
 * Graceful column fallback (server_roles, last_from, etc. may not exist)
 */
const DB = (() => {
  const NS = 'cipher_';
  const _ls = k => { try { return JSON.parse(localStorage.getItem(NS+k)); } catch { return null; } };
  const _lsSet = (k,v) => { localStorage.setItem(NS+k, JSON.stringify(v)); try { _bc?.postMessage({key:k}); } catch {} };

  let _bc = null;
  try { _bc = new BroadcastChannel('cipher_sync'); } catch {}

  // ── In-memory cache ──────────────────────────────────────────
  const _C = { users: null, convs: null, msgs: {}, msgsTs: {} };
  const MSG_TTL = 3000; // 3s - realtime handles updates

  // ── SHA-256 (pure JS) ────────────────────────────────────────
  function _sha256(s) {
    const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const b=new TextEncoder().encode(s),L=b.length,bL=L*8;
    const eL=(L+1+8)%64,pL=eL<=56?55-(L+1)%64:119-(L+1)%64;
    const p=new Uint8Array(L+1+pL+1+8);p.set(b);p[L]=0x80;
    const dv=new DataView(p.buffer);
    dv.setUint32(p.length-4,bL&0xffffffff,false);dv.setUint32(p.length-8,Math.floor(bL/0x100000000),false);
    const r=(n,b)=>(n>>>b)|(n<<(32-b));
    for(let i=0;i<p.length;i+=64){
      const W=new Uint32Array(64);for(let t=0;t<16;t++)W[t]=dv.getUint32(i+t*4,false);
      for(let t=16;t<64;t++)W[t]=((r(W[t-2],17)^r(W[t-2],19)^(W[t-2]>>>10))+W[t-7]+(r(W[t-15],7)^r(W[t-15],18)^(W[t-15]>>>3))+W[t-16])|0;
      let[a,b,c,d,e,f,g,h]=H;
      for(let t=0;t<64;t++){const T1=(h+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+K[t]+W[t])|0,T2=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))|0;h=g;g=f;f=e;e=(d+T1)|0;d=c;c=b;b=a;a=(T1+T2)|0;}
      H[0]=(H[0]+a)|0;H[1]=(H[1]+b)|0;H[2]=(H[2]+c)|0;H[3]=(H[3]+d)|0;H[4]=(H[4]+e)|0;H[5]=(H[5]+f)|0;H[6]=(H[6]+g)|0;H[7]=(H[7]+h)|0;
    }
    return H.map(n=>(n>>>0).toString(16).padStart(8,'0')).join('');
  }
  const hashPassword = s => Promise.resolve(_sha256(s + '_cipher_salt'));

  // ── Supabase ──────────────────────────────────────────────────
  let _sb = null;
  function sb() {
    if (_sb) return _sb;
    if (!window.supabase) throw new Error('Supabase SDK yüklenmedi');
    if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes('YOUR_PROJECT'))
      throw new Error('Supabase ayarlanmamış');
    _sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    return _sb;
  }

  // Always-safe column sets
  const U_SAFE = 'username,password_hash,display_name,bio,avatar_url,banner_color,status,status_emoji,is_admin,locked,badges,created_at';
  const C_SAFE = 'id,type,name,participants,avatar,banner_color,last_msg,last_time,unread_for,admin,created_at';

  // ── User helpers ──────────────────────────────────────────────
  async function _queryUser(username) {
    // Try with extended cols, fall back to safe
    let { data, error } = await sb().from('users').select('*').eq('username', username).maybeSingle();
    if (error && (error.message.includes('column') || error.message.includes('schema'))) {
      ({ data, error } = await sb().from('users').select(U_SAFE).eq('username', username).maybeSingle());
    }
    if (error) throw new Error(error.message);
    return data;
  }

  async function _queryAllUsers() {
    let { data, error } = await sb().from('users').select('*').order('created_at');
    if (error && (error.message.includes('column') || error.message.includes('schema'))) {
      ({ data, error } = await sb().from('users').select(U_SAFE).order('created_at'));
    }
    if (error) throw new Error(error.message);
    return data || [];
  }

  // ── Supabase implementation ───────────────────────────────────
  const Supa = {
    async getUser(u) {
      if (_C.users?.has(u)) return _C.users.get(u);
      const d = await _queryUser(u);
      if (d) { if (!_C.users) _C.users = new Map(); _C.users.set(u, d); }
      return d;
    },

    _usersTs: 0,
    async getAllUsers(force = false) {
      const now = Date.now();
      const USERS_TTL = 45000; // 45s cache
      if (!force && _C.users?.size > 0 && (now - Supa._usersTs) < USERS_TTL) {
        // Background refresh if >20s old
        if (now - Supa._usersTs > 20000) {
          _queryAllUsers().then(rows => { rows.forEach(r => _C.users.set(r.username, r)); Supa._usersTs = Date.now(); }).catch(() => {});
        }
        return Array.from(_C.users.values());
      }
      const rows = await _queryAllUsers();
      _C.users = new Map(); rows.forEach(r => _C.users.set(r.username, r));
      Supa._usersTs = Date.now();
      return rows;
    },

    async createUser(d) {
      const payload = { locked: false, ...d };
      let { data, error } = await sb().from('users').insert(payload).select(U_SAFE).single();
      if (error) {
        console.warn('createUser retry basic:', error.message);
        const basic = { username:d.username, password_hash:d.password_hash, display_name:d.display_name||'', bio:'', avatar_url:null, banner_color:'#0A1628', status:'', status_emoji:'', is_admin:false, locked:false, badges:d.badges||[], created_at:d.created_at||Date.now() };
        ({ data, error } = await sb().from('users').insert(basic).select(U_SAFE).single());
        if (error) throw new Error(error.message);
      }
      if (!_C.users) _C.users = new Map(); _C.users.set(d.username, data);
      return data;
    },

    async updateUser(u, patch) {
      // Split known-safe from extended cols
      const safeKeys = ['display_name','bio','avatar_url','banner_color','status','status_emoji','is_admin','locked','badges','password_hash'];
      const extKeys  = ['server_roles','last_seen','online','stale_hash','status_mode'];
      const safe = {}, ext = {};
      for (const k in patch) { (safeKeys.includes(k) ? safe : ext)[k] = patch[k]; }

      let merged = { ..._C.users?.get(u) };

      if (Object.keys(safe).length) {
        const { data, error } = await sb().from('users').update(safe).eq('username', u).select(U_SAFE).single();
        if (!error) Object.assign(merged, data);
      }
      if (Object.keys(ext).length) {
        const { error } = await sb().from('users').update(ext).eq('username', u);
        if (error && error.message.includes('does not exist')) {
          throw new Error('Şema eksik — admin panelindeki SQL\'i çalıştırın: ' + error.message);
        }
        Object.assign(merged, ext);
      }

      if (_C.users) _C.users.set(u, merged);
      return merged;
    },

    async deleteUser(u) {
      // Delete conversations where user is a participant
      // Use cs() (contains) for TEXT[] array - Supabase JS v2 syntax
      try {
        await sb().from('conversations').delete().cs('participants', `{${u}}`);
      } catch(e1) {
        // Fallback: fetch then delete individually
        try {
          const { data: convs } = await sb().from('conversations').select('id').contains('participants', [u]);
          if (convs?.length) {
            const ids = convs.map(c => c.id);
            await sb().from('conversations').delete().in('id', ids);
          }
        } catch(e2) { console.warn('deleteUser convs cleanup:', e2); }
      }
      // Delete messages - 'from' is reserved, use filter
      try {
        await sb().from('messages').delete().filter('from', 'eq', u);
      } catch(e) { console.warn('deleteUser msgs cleanup:', e); }
      // Delete user
      const { error } = await sb().from('users').delete().eq('username', u);
      if (error) throw new Error(error.message);
      _C.users?.delete(u);
      // Clear conv cache entries involving this user
      if (_C.convs) _C.convs = _C.convs.filter(c => !c.participants?.includes(u));
    },

    async getConversations(uid) {
      let { data, error } = await sb().from('conversations').select('*').contains('participants', [uid]).order('last_time', { ascending: false });
      if (error && (error.message.includes('column') || error.message.includes('schema'))) {
        ({ data, error } = await sb().from('conversations').select(C_SAFE).contains('participants', [uid]).order('last_time', { ascending: false }));
      }
      if (error) throw new Error(error.message);
      _C.convs = data || [];
      return _C.convs;
    },

    async getConversation(id) {
      const cached = _C.convs?.find(c => c.id === id);
      if (cached) return cached;
      let { data, error } = await sb().from('conversations').select('*').eq('id', id).maybeSingle();
      if (error && (error.message.includes('column') || error.message.includes('schema'))) {
        ({ data, error } = await sb().from('conversations').select(C_SAFE).eq('id', id).maybeSingle());
      }
      if (error) throw new Error(error.message);
      return data;
    },

    async createConversation(d) {
      let { data, error } = await sb().from('conversations').upsert(d).select(C_SAFE).single();
      if (error) {
        const safe = { id:d.id, type:d.type, participants:d.participants, last_msg:d.last_msg||'', last_time:d.last_time||0, unread_for:d.unread_for||{}, banner_color:d.banner_color||'#0A1628' };
        if (d.name)   safe.name  = d.name;
        if (d.admin)  safe.admin = d.admin;
        if (d.avatar) safe.avatar = d.avatar;
        ({ data, error } = await sb().from('conversations').upsert(safe).select(C_SAFE).single());
        if (error) throw new Error(error.message);
      }
      if (_C.convs) _C.convs.unshift(data);
      return data;
    },

    async updateConversation(id, patch) {
      // Optimistic update in cache
      if (_C.convs) { const i = _C.convs.findIndex(c => c.id === id); if (i >= 0) Object.assign(_C.convs[i], patch); }
      // Try full patch first (all cols)
      const { error } = await sb().from('conversations').update(patch).eq('id', id);
      if (!error) return;
      // Fallback: safe cols only
      if (error.message.includes('column') || error.message.includes('schema')) {
        const safeKeys = ['last_msg','last_time','unread_for','name','avatar','banner_color','admin','participants','last_from','server'];
        const safe = {}; for (const k of safeKeys) if (k in patch) safe[k] = patch[k];
        if (Object.keys(safe).length) await sb().from('conversations').update(safe).eq('id', id).catch(() => {});
      }
    },

    async getMessages(cid) {
      const now = Date.now();
      if (_C.msgs[cid] && (now - _C.msgsTs[cid]) < MSG_TTL) return _C.msgs[cid];
      const { data, error } = await sb().from('messages').select('*').eq('conv_id', cid).order('created_at').limit(200);
      if (error) {
        // Return cached if available, even if stale
        if (_C.msgs[cid]) { console.warn('getMessages error (using cache):', error.message); return _C.msgs[cid]; }
        throw new Error(error.message);
      }
      _C.msgs[cid] = data || []; _C.msgsTs[cid] = now;
      return _C.msgs[cid];
    },

    async createMessage(d) {
      const { data, error } = await sb().from('messages').insert(d).select('*').single();
      if (error) {
        // Retry without unknown extended cols (doc_html, poll_data may not exist in schema)
        if (error.message.includes('column') || error.message.includes('schema')) {
          const safe = { ...d };
          ['doc_html'].forEach(k => delete safe[k]); // strip if not in schema
          const { data: d2, error: e2 } = await sb().from('messages').insert(safe).select('*').single();
          if (!e2) {
            if (_C.msgs[d.conv_id]) { _C.msgs[d.conv_id].push(d2); _C.msgsTs[d.conv_id] = Date.now(); }
            return d2;
          }
        }
        throw new Error(error.message);
      }
      if (_C.msgs[d.conv_id]) { _C.msgs[d.conv_id].push(data); _C.msgsTs[d.conv_id] = Date.now(); }
      return data;
    },

    async updateMessage(cid, mid, patch) {
      const { data, error } = await sb().from('messages').update(patch).eq('id', mid).select('*').single();
      if (error) throw new Error(error.message);
      if (_C.msgs[cid]) { const i = _C.msgs[cid].findIndex(m => m.id === mid); if (i >= 0) _C.msgs[cid][i] = data; }
      return data;
    },

    async deleteMessage(cid, mid) {
      await sb().from('messages').delete().eq('id', mid);
      if (cid && _C.msgs[cid]) _C.msgs[cid] = _C.msgs[cid].filter(m => m.id !== mid);
    },

    async getStories() {
      const { data } = await sb().from('stories').select('*').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false });
      return data || [];
    },
    async createStory(d) {
      const { data, error } = await sb().from('stories').insert({ ...d, expires_at: new Date(Date.now()+86400000).toISOString() }).select('*').single();
      if (error) throw new Error(error.message); return data;
    },
    async updateStory(id, patch) {
      const { error } = await sb().from('stories').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
    },
    async deleteStory(id) { await sb().from('stories').delete().eq('id', id); },

    invalidateMsgs(cid) { delete _C.msgs[cid]; delete _C.msgsTs[cid]; },

    subscribeMessages(cid, cb) {
      return sb().channel('msgs_' + cid)
        .on('postgres_changes', { event:'*', schema:'public', table:'messages', filter:`conv_id=eq.${cid}` }, () => { delete _C.msgs[cid]; delete _C.msgsTs[cid]; cb(); })
        .subscribe();
    },
    subscribeConversations(uid, cb) {
      return sb().channel('convs_' + uid)
        .on('postgres_changes', { event:'*', schema:'public', table:'conversations' }, () => { _C.convs = null; cb(); })
        .subscribe();
    },
    unsubscribe(ch) { try { sb().removeChannel(ch); } catch {} },
  };

  // ── localStorage fallback ─────────────────────────────────────
  const Local = {
    async getUser(u)     { return (_ls('users')||{})[u]||null; },
    async getAllUsers()   { return Object.values(_ls('users')||{}); },
    async createUser(d)  { const us=_ls('users')||{}; us[d.username]={...d,created_at:d.created_at||Date.now()}; _lsSet('users',us); return us[d.username]; },
    async updateUser(u,p){ const us=_ls('users')||{}; if(!us[u])return null; us[u]={...us[u],...p}; _lsSet('users',us); return us[u]; },
    async deleteUser(u)  { const us=_ls('users')||{}; delete us[u]; _lsSet('users',us); },
    async getConversations(uid) { return Object.values(_ls('convs')||{}).filter(c=>c.participants?.includes(uid)).sort((a,b)=>(b.last_time||0)-(a.last_time||0)); },
    async getConversation(id)   { return (_ls('convs')||{})[id]||null; },
    async createConversation(d) { const cs=_ls('convs')||{}; const id=d.id||'c_'+Date.now(); cs[id]={...cs[id],...d,id}; _lsSet('convs',cs); return cs[id]; },
    async updateConversation(id,p){ const cs=_ls('convs')||{}; if(!cs[id])return; cs[id]={...cs[id],...p}; _lsSet('convs',cs); },
    async getMessages(cid,lim=200) { return (_ls('msgs_'+cid)||[]).slice(-lim); },
    async createMessage(d) { const msgs=_ls('msgs_'+d.conv_id)||[]; const m={...d,id:d.id||'m_'+Date.now(),created_at:d.created_at||Date.now()}; msgs.push(m); _lsSet('msgs_'+d.conv_id,msgs); return m; },
    async updateMessage(cid,mid,p){ const msgs=_ls('msgs_'+cid)||[]; const i=msgs.findIndex(m=>m.id===mid); if(i>=0){msgs[i]={...msgs[i],...p};_lsSet('msgs_'+cid,msgs);return msgs[i];} return null; },
    async deleteMessage(cid,mid)  { _lsSet('msgs_'+cid,(_ls('msgs_'+cid)||[]).filter(m=>m.id!==mid)); },
    async getStories() { return Object.values(_ls('stories')||{}).filter(s=>{ const e=typeof s.expires_at==='string'?new Date(s.expires_at).getTime():s.expires_at; return e>Date.now(); }); },
    async createStory(d){ const ss=_ls('stories')||{}; const id='s_'+Date.now(); ss[id]={...d,id,created_at:Date.now(),expires_at:Date.now()+86400000}; _lsSet('stories',ss); return ss[id]; },
    async updateStory(id,p){ const ss=_ls('stories')||{}; if(ss[id]){ss[id]={...ss[id],...p};_lsSet('stories',ss);} },
    async deleteStory(id){ const ss=_ls('stories')||{}; delete ss[id]; _lsSet('stories',ss); },
    invalidateMsgs(){},'subscribeMessages':()=>null,'subscribeConversations':()=>null,'unsubscribe':()=>{},
  };

  function impl() { return CONFIG.USE_SUPABASE && !window._supabaseNotConfigured ? Supa : Local; }

  if (_bc) _bc.onmessage = e => { try { window._onStorageSync?.(e.data?.key); } catch {} };
  window.addEventListener('storage', e => { if (e.key?.startsWith(NS)) window._onStorageSync?.(e.key.slice(NS.length)); });

  return {
    async init() {
      window._supabaseConfigured = CONFIG.USE_SUPABASE && !!CONFIG.SUPABASE_URL && !CONFIG.SUPABASE_URL.includes('YOUR_PROJECT');
      window._supabaseNotConfigured = !window._supabaseConfigured;
    },
    hashPassword,
    invalidateMsgs: cid => impl().invalidateMsgs?.(cid),
    getUser:               (...a) => impl().getUser(...a),
    getAllUsers:            (...a) => impl().getAllUsers(...a),
    createUser:            (...a) => impl().createUser(...a),
    updateUser:            (...a) => impl().updateUser(...a),
    deleteUser:            (...a) => impl().deleteUser(...a),
    getConversations:      (...a) => impl().getConversations(...a),
    getConversation:       (...a) => impl().getConversation(...a),
    createConversation:    (...a) => impl().createConversation(...a),
    updateConversation:    (...a) => impl().updateConversation(...a),
    getMessages:           (...a) => impl().getMessages(...a),
    createMessage:         (...a) => impl().createMessage(...a),
    updateMessage:         (...a) => impl().updateMessage(...a),
    deleteMessage:         (...a) => impl().deleteMessage(...a),
    getStories:            (...a) => impl().getStories(...a),
    createStory:           (...a) => impl().createStory(...a),
    updateStory:           (...a) => impl().updateStory?.(...a),
    deleteStory:           (...a) => impl().deleteStory(...a),
    subscribeMessages:     (...a) => impl().subscribeMessages?.(...a),
    subscribeConversations:(...a) => impl().subscribeConversations?.(...a),
    unsubscribe:           (...a) => impl().unsubscribe?.(...a),
  };
})();

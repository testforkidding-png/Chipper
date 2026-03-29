/**
 * CIPHER DB v8 — Supabase + localStorage fallback
 * Pure-JS SHA-256, graceful column fallback, polling support
 */
const DB = (() => {
  const NS = 'cipher_';
  const _get = k => { try { return JSON.parse(localStorage.getItem(NS+k)); } catch { return null; } };
  const _set = (k,v) => { localStorage.setItem(NS+k, JSON.stringify(v)); try { _bc?.postMessage({key:k}); } catch {} };

  let _bc = null;
  try { _bc = new BroadcastChannel('cipher_sync'); } catch {}

  // ── SHA-256 ────────────────────────────────────────────────────
  function _sha256(str) {
    const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const bytes=new TextEncoder().encode(str);
    const len=bytes.length,bitLen=len*8;
    const padLen=((len+1+8)%64<=56?55-(len+1)%64:119-(len+1)%64);
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
  const quickHash = str => Promise.resolve(_sha256(str + '_cipher_salt'));

  // ── Supabase client (lazy init) ────────────────────────────────
  let _sb = null;
  function sb() {
    if (_sb) return _sb;
    if (!window.supabase) throw new Error('Supabase SDK yüklenmedi');
    if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes('YOUR_PROJECT'))
      throw new Error('Supabase ayarlanmamış — js/config.js dosyasını düzenleyin');
    _sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 10 } }
    });
    return _sb;
  }

  // ── Supabase implementation ────────────────────────────────────
  const Supa = {
    // Users
    async getUser(u) {
      const { data, error } = await sb().from('users').select('*').eq('username', u).maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async getAllUsers() {
      const { data, error } = await sb().from('users').select('*').order('created_at');
      if (error) throw error;
      return data || [];
    },
    async createUser(d) {
      // Try with all columns first
      const { data, error } = await sb().from('users').insert(d).select().single();
      if (!error) return data;
      // Fallback: minimal columns only
      console.warn('createUser full insert failed:', error.message);
      const basic = {
        username: d.username, password_hash: d.password_hash,
        display_name: d.display_name || '', bio: d.bio || '',
        avatar_url: d.avatar_url || null, banner_color: d.banner_color || '#0A1628',
        status: d.status || '', status_emoji: d.status_emoji || '',
        is_admin: d.is_admin || false, locked: false,
        badges: d.badges || [], created_at: d.created_at || Date.now(),
      };
      const { data: d2, error: e2 } = await sb().from('users').insert(basic).select().single();
      if (e2) throw new Error(e2.message || 'Kayıt başarısız. Admin panelindeki SQL şemasını çalıştırın.');
      return d2;
    },
    async updateUser(u, d) {
      const { data, error } = await sb().from('users').update(d).eq('username', u).select().single();
      if (!error) return data;
      // If column missing (schema cache error), retry without extended columns
      if (error.message && (error.message.includes('column') || error.message.includes('schema'))) {
        console.warn('updateUser column error, retrying without extended cols:', error.message);
        const safe = {};
        const safeKeys = ['display_name','bio','avatar_url','banner_color','status','status_emoji','is_admin','locked','badges','password_hash'];
        for (const k of safeKeys) { if (k in d) safe[k] = d[k]; }
        // Try extended keys separately
        const ext = {};
        const extKeys = ['server_roles','last_seen','online','stale_hash'];
        for (const k of extKeys) { if (k in d) ext[k] = d[k]; }
        if (Object.keys(safe).length) {
          const { data: d2, error: e2 } = await sb().from('users').update(safe).eq('username', u).select().single();
          if (!e2) {
            if (Object.keys(ext).length) {
              // Try to add extended cols silently
              await sb().from('users').update(ext).eq('username', u).select().single().catch(() => {});
            }
            return d2;
          }
          throw new Error(e2.message);
        }
        throw new Error(error.message);
      }
      throw error;
    },
    async deleteUser(u) {
      const { error } = await sb().from('users').delete().eq('username', u);
      if (error) throw error;
    },

    // Conversations
    async getConversations(uid) {
      const { data, error } = await sb().from('conversations').select('*')
        .contains('participants', [uid]).order('last_time', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    async getConversation(id) {
      const { data, error } = await sb().from('conversations').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async createConversation(d) {
      const { data, error } = await sb().from('conversations').upsert(d).select().single();
      if (!error) return data;
      // Fallback: minimal columns
      console.warn('createConversation failed:', error.message);
      const minimal = {
        id: d.id, type: d.type, participants: d.participants,
        last_msg: d.last_msg || '', last_time: d.last_time || 0,
        unread_for: d.unread_for || {},
      };
      if (d.name) minimal.name = d.name;
      if (d.admin) minimal.admin = d.admin;
      if (d.avatar) minimal.avatar = d.avatar;
      if (d.banner_color) minimal.banner_color = d.banner_color;
      const { data: d2, error: e2 } = await sb().from('conversations').upsert(minimal).select().single();
      if (e2) throw new Error(e2.message);
      return d2;
    },
    async updateConversation(id, d) {
      const { data, error } = await sb().from('conversations').update(d).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },

    // Messages
    async getMessages(cid, lim = 200) {
      const { data, error } = await sb().from('messages').select('*')
        .eq('conv_id', cid).order('created_at').limit(lim);
      if (error) throw error;
      return data || [];
    },
    async createMessage(d) {
      const { data, error } = await sb().from('messages').insert(d).select().single();
      if (error) throw error;
      return data;
    },
    async updateMessage(c, mid, d) {
      const { data, error } = await sb().from('messages').update(d).eq('id', mid).select().single();
      if (error) throw error;
      return data;
    },
    async deleteMessage(c, mid) {
      const { error } = await sb().from('messages').delete().eq('id', mid);
      if (error) console.warn('deleteMessage:', error.message);
    },

    // Stories
    async getStories() {
      const { data } = await sb().from('stories').select('*')
        .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false });
      return data || [];
    },
    async createStory(d) {
      const exp = new Date(Date.now() + 86400000).toISOString();
      const { data, error } = await sb().from('stories').insert({ ...d, expires_at: exp }).select().single();
      if (error) throw error;
      return data;
    },
    async deleteStory(id) { await sb().from('stories').delete().eq('id', id); },

    // Real-time
    subscribeMessages(cid, cb) {
      return sb().channel('msgs_' + cid)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conv_id=eq.${cid}` }, cb)
        .subscribe();
    },
    subscribeConversations(uid, cb) {
      return sb().channel('convs_' + uid)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, cb)
        .subscribe();
    },
    unsubscribe(ch) { if (ch) { try { sb().removeChannel(ch); } catch {} } },
  };

  // ── localStorage fallback ──────────────────────────────────────
  const Local = {
    async getUser(u) { return (_get('users') || {})[u] || null; },
    async getAllUsers() { return Object.values(_get('users') || {}); },
    async createUser(d) {
      const us = _get('users') || {};
      us[d.username] = { ...d, created_at: d.created_at || Date.now() };
      _set('users', us); return us[d.username];
    },
    async updateUser(u, d) {
      const us = _get('users') || {};
      if (!us[u]) return null;
      us[u] = { ...us[u], ...d };
      _set('users', us); return us[u];
    },
    async deleteUser(u) { const us = _get('users') || {}; delete us[u]; _set('users', us); },

    async getConversations(uid) {
      return Object.values(_get('convs') || {}).filter(c => c.participants?.includes(uid));
    },
    async getConversation(id) { return (_get('convs') || {})[id] || null; },
    async createConversation(d) {
      const cs = _get('convs') || {};
      const id = d.id || 'conv_' + Date.now();
      cs[id] = { ...cs[id], ...d, id };
      _set('convs', cs); return cs[id];
    },
    async updateConversation(id, d) {
      const cs = _get('convs') || {};
      if (!cs[id]) return null;
      cs[id] = { ...cs[id], ...d };
      _set('convs', cs); return cs[id];
    },

    async getMessages(cid, lim = 200) { return (_get('msgs_' + cid) || []).slice(-lim); },
    async createMessage(d) {
      const msgs = _get('msgs_' + d.conv_id) || [];
      const msg = { ...d, id: d.id || 'msg_' + Date.now() + Math.random().toString(36).slice(2, 6), created_at: d.created_at || Date.now() };
      msgs.push(msg); _set('msgs_' + d.conv_id, msgs); return msg;
    },
    async updateMessage(cid, mid, d) {
      const msgs = _get('msgs_' + cid) || [];
      const i = msgs.findIndex(m => m.id === mid);
      if (i < 0) return null;
      msgs[i] = { ...msgs[i], ...d }; _set('msgs_' + cid, msgs); return msgs[i];
    },
    async deleteMessage(cid, mid) {
      _set('msgs_' + cid, (_get('msgs_' + cid) || []).filter(m => m.id !== mid));
    },

    async getStories() {
      const now = Date.now();
      return Object.values(_get('stories') || {}).filter(s => {
        const exp = typeof s.expires_at === 'string' ? new Date(s.expires_at).getTime() : s.expires_at;
        return exp > now;
      });
    },
    async createStory(d) {
      const ss = _get('stories') || {};
      const id = 'story_' + Date.now();
      ss[id] = { ...d, id, created_at: Date.now(), expires_at: Date.now() + 86400000 };
      _set('stories', ss); return ss[id];
    },
    async deleteStory(id) { const ss = _get('stories') || {}; delete ss[id]; _set('stories', ss); },

    subscribeMessages: () => null,
    subscribeConversations: () => null,
    unsubscribe: () => {},
  };

  const impl = () => CONFIG.USE_SUPABASE ? Supa : Local;

  // Cross-tab sync
  if (_bc) { _bc.onmessage = e => { try { window._onStorageSync?.(e.data?.key); } catch {} }; }
  window.addEventListener('storage', e => { if (e.key?.startsWith(NS)) window._onStorageSync?.(e.key.slice(NS.length)); });

  return {
    async init() {
      window._supabaseConfigured = CONFIG.USE_SUPABASE &&
        !!CONFIG.SUPABASE_URL && !CONFIG.SUPABASE_URL.includes('YOUR_PROJECT');
      window._supabaseNotConfigured = !window._supabaseConfigured;
    },
    hashPassword: quickHash,
    getUser:              (...a) => impl().getUser(...a),
    getAllUsers:           (...a) => impl().getAllUsers(...a),
    createUser:           (...a) => impl().createUser(...a),
    updateUser:           (...a) => impl().updateUser(...a),
    deleteUser:           (...a) => impl().deleteUser(...a),
    getConversations:     (...a) => impl().getConversations(...a),
    getConversation:      (...a) => impl().getConversation(...a),
    createConversation:   (...a) => impl().createConversation(...a),
    updateConversation:   (...a) => impl().updateConversation(...a),
    getMessages:          (...a) => impl().getMessages(...a),
    createMessage:        (...a) => impl().createMessage(...a),
    updateMessage:        (...a) => impl().updateMessage(...a),
    deleteMessage:        (...a) => impl().deleteMessage(...a),
    getStories:           (...a) => impl().getStories(...a),
    createStory:          (...a) => impl().createStory(...a),
    deleteStory:          (...a) => impl().deleteStory(...a),
    subscribeMessages:    (...a) => impl().subscribeMessages?.(...a),
    subscribeConversations:(...a) => impl().subscribeConversations?.(...a),
    unsubscribe:          (...a) => impl().unsubscribe?.(...a),
  };
})();

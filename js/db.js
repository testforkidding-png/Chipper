/**
 * CIPHER — DB Layer v2.1
 * users.json → localStorage with hardcoded fallback
 * BroadcastChannel for real cross-tab sync
 */
const DB = (() => {
  const NS = 'cipher_';
  const _get = k => { try { return JSON.parse(localStorage.getItem(NS+k)); } catch { return null; } };
  const _set = (k, v) => { localStorage.setItem(NS+k, JSON.stringify(v)); _bc?.postMessage({key:k}); };

  // ── BroadcastChannel (cross-tab sync) ───────────────────────────
  let _bc = null;
  try { _bc = new BroadcastChannel('cipher_sync'); } catch {}

  // ── Password hashing ─────────────────────────────────────────────
  async function quickHash(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str + '_cipher_salt'));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  // ── Fallback users (used when users.json can't be fetched) ───────
  const FALLBACK_USERS = [
    { username:'admin',  password:'admin123',  display_name:'Admin',       bio:'Sistem yöneticisi ⚡',                 is_admin:true,  badges:['admin','verified','early'], banner_color:'#0A1628', status:'Sistemi yönetiyorum', status_emoji:'⚡', avatar_url:null },
    { username:'alice',  password:'alice123',  display_name:'Alice Chen',  bio:'Tasarımcı & şifreli iletişim meraklısı 🎨', is_admin:false, badges:['verified','early'],          banner_color:'#1A0A28', status:'Tasarım yapıyorum',   status_emoji:'🎨', avatar_url:null },
    { username:'marcus', password:'marcus123', display_name:'Marcus Webb', bio:'Backend developer. Privacy matters. 🔒', is_admin:false, badges:['secure'],                   banner_color:'#0A2818', status:'Kod yazıyorum',        status_emoji:'💻', avatar_url:null },
  ];

  // ── User management ──────────────────────────────────────────────
  async function ensureUsers() {
    // Try users.json first
    try {
      const r = await fetch('users.json?t=' + Date.now());
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data.users) && data.users.length) {
          const stored = _get('users') || {};
          for (const u of data.users) {
            const hash = await quickHash(u.password);
            const prev = stored[u.username] || {};
            stored[u.username] = {
              ...u,
              password_hash: hash,
              // Preserve profile customizations from localStorage
              avatar_url:   prev.avatar_url   ?? null,
              banner_color: prev.banner_color || u.banner_color,
              bio:          prev.bio          || u.bio,
              status:       prev.status       || u.status,
              status_emoji: prev.status_emoji || u.status_emoji,
              display_name: prev.display_name || u.display_name,
              created_at:   prev.created_at   || (Date.now() - 30*86400000),
            };
          }
          localStorage.setItem(NS+'users', JSON.stringify(stored));
          console.log('[CIPHER] users.json yüklendi:', data.users.length, 'kullanıcı');
          return;
        }
      }
    } catch(e) {
      console.warn('[CIPHER] users.json yüklenemedi:', e.message);
    }
    // Fallback: seed hardcoded users if none exist
    if (!_get('users') || Object.keys(_get('users')||{}).length === 0) {
      console.log('[CIPHER] Fallback kullanıcılar yükleniyor…');
      const stored = {};
      for (const u of FALLBACK_USERS) {
        const hash = await quickHash(u.password);
        stored[u.username] = { ...u, password_hash: hash, created_at: Date.now() - 30*86400000 };
      }
      localStorage.setItem(NS+'users', JSON.stringify(stored));
    }
  }

  // Seed kaldırıldı — demo konuşmalar artık oluşturulmuyor

  // ── Local Implementation ─────────────────────────────────────────
  const Local = {
    async getUser(u)        { return (_get('users')||{})[u]||null; },
    async getAllUsers()      { return Object.values(_get('users')||{}); },
    async createUser(d)     { const us=_get('users')||{}; us[d.username]={...d,created_at:Date.now()}; _set('users',us); return us[d.username]; },
    async updateUser(u,d)   { const us=_get('users')||{}; if(!us[u])return null; us[u]={...us[u],...d,updated_at:Date.now()}; _set('users',us); return us[u]; },
    async deleteUser(u)     { const us=_get('users')||{}; delete us[u]; _set('users',us); },

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
  const Supa = {
    async getUser(u)            { const{data}=await sb().from('users').select('*').eq('username',u).single(); return data; },
    async getAllUsers()          { const{data}=await sb().from('users').select('*').order('created_at'); return data||[]; },
    async createUser(d)         { const{data,error}=await sb().from('users').insert(d).select().single(); if(error)throw error; return data; },
    async updateUser(u,d)       { const{data}=await sb().from('users').update(d).eq('username',u).select().single(); return data; },
    async deleteUser(u)         { await sb().from('users').delete().eq('username',u); },
    async getConversations(uid) { const{data}=await sb().from('conversations').select('*').contains('participants',[uid]).order('last_time',{ascending:false}); return data||[]; },
    async getConversation(id)   { const{data}=await sb().from('conversations').select('*').eq('id',id).single(); return data; },
    async createConversation(d) { const{data,error}=await sb().from('conversations').insert(d).select().single(); if(error)throw error; return data; },
    async updateConversation(id,d) { const{data}=await sb().from('conversations').update(d).eq('id',id).select().single(); return data; },
    async getMessages(cid,lim=200) { const{data}=await sb().from('messages').select('*').eq('conv_id',cid).order('created_at').limit(lim); return data||[]; },
    async createMessage(d)      { const{data,error}=await sb().from('messages').insert(d).select().single(); if(error)throw error; return data; },
    async updateMessage(cid,mid,d) { const{data}=await sb().from('messages').update(d).eq('id',mid).select().single(); return data; },
    async deleteMessage(cid,mid)   { await sb().from('messages').delete().eq('id',mid); },
    async getStories()             { const{data}=await sb().from('stories').select('*').gt('expires_at',new Date().toISOString()); return data||[]; },
    async createStory(d)           { const exp=new Date(Date.now()+86400000).toISOString(); const{data,error}=await sb().from('stories').insert({...d,expires_at:exp}).select().single(); if(error)throw error; return data; },
    async deleteStory(id)          { await sb().from('stories').delete().eq('id',id); },
    subscribeMessages(cid,cb) { return sb().channel('msgs_'+cid).on('postgres_changes',{event:'*',schema:'public',table:'messages',filter:`conv_id=eq.${cid}`},cb).subscribe(); },
    unsubscribe(ch) { if(ch)sb().removeChannel(ch); }
  };

  const impl = () => CONFIG.USE_SUPABASE ? Supa : Local;

  // ── Cross-tab event listener ─────────────────────────────────────
  if (_bc) {
    _bc.onmessage = e => window._onStorageSync?.(e.data?.key);
  }
  window.addEventListener('storage', e => {
    if (e.key?.startsWith(NS)) window._onStorageSync?.(e.key.slice(NS.length));
  });

  return {
    async init() {
      if (!CONFIG.USE_SUPABASE) {
        await ensureUsers();
      }
    },
    getUser:            (...a) => impl().getUser(...a),
    getAllUsers:         (...a) => impl().getAllUsers(...a),
    createUser:         (...a) => impl().createUser(...a),
    updateUser:         (...a) => impl().updateUser(...a),
    deleteUser:         (...a) => impl().deleteUser(...a),
    getConversations:   (...a) => impl().getConversations(...a),
    getConversation:    (...a) => impl().getConversation(...a),
    createConversation: (...a) => impl().createConversation(...a),
    updateConversation: (...a) => impl().updateConversation(...a),
    getMessages:        (...a) => impl().getMessages(...a),
    createMessage:      (...a) => impl().createMessage(...a),
    updateMessage:      (...a) => impl().updateMessage(...a),
    deleteMessage:      (...a) => impl().deleteMessage(...a),
    getStories:         (...a) => impl().getStories(...a),
    createStory:        (...a) => impl().createStory(...a),
    deleteStory:        (...a) => impl().deleteStory(...a),
    subscribeMessages:  CONFIG.USE_SUPABASE ? (...a) => Supa.subscribeMessages(...a) : () => null,
    unsubscribe:        CONFIG.USE_SUPABASE ? (...a) => Supa.unsubscribe(...a)        : () => null,
    hashPassword: quickHash,
  };
})();

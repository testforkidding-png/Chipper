/**
 * CIPHER — DB Layer v3.1 (Temizlenmiş & Dinamik)
 */
const DB = (() => {
  const NS = 'cipher_';
  
  const _get = k => { try { return JSON.parse(localStorage.getItem(NS+k)); } catch { return null; } };
  const _set = (k, v) => { localStorage.setItem(NS+k, JSON.stringify(v)); if(_bc) _bc.postMessage({key:k}); };

  let _bc = null;
  try { _bc = new BroadcastChannel('cipher_sync'); } catch {}

  // Şifreleme (Eşleşme garantisi için standart SHA-256)
  async function quickHash(str) {
    if(!str) return "";
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str.toString().trim()));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  async function ensureUsers() {
    let stored = _get('users') || {};
    const deleted = JSON.parse(localStorage.getItem(NS+'deleted_users') || '[]');

    try {
      // Sadece senin users.json dosyanı baz alır
      const r = await fetch('users.json?t=' + Date.now());
      if (r.ok) {
        const data = await r.json();
        if (data.users && Array.isArray(data.users)) {
          for (const u of data.users) {
            const uname = u.username.toLowerCase().trim();
            if (deleted.includes(uname)) continue;
            
            // Mevcut kullanıcıyı güncelle veya yeni ekle
            stored[uname] = { 
              ...u, 
              username: uname, 
              password_hash: await quickHash(u.password),
              // Profil resmini koru (JSON'da yoksa null bırakma, varsayılan avatar üret)
              avatar_url: u.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.display_name || uname)}&background=00FFB3&color=062B1F`
            };
          }
          _set('users', stored);
        }
      }
    } catch(e) { 
      console.warn("[CIPHER] users.json okunamadı. Mevcut yerel kullanıcılarla devam ediliyor."); 
    }
  }

  // --- Fonksiyonlar ---
  const Local = {
    async getUser(u) { 
      const us = _get('users') || {}; 
      return us[u.toString().toLowerCase().trim()] || null; 
    },
    async getAllUsers() { return Object.values(_get('users')||{}); },
    async createUser(d) { 
      const us=_get('users')||{}; 
      const uname = d.username.toLowerCase().trim();
      us[uname]={...d, username: uname, created_at:Date.now()}; 
      _set('users',us); 
      return us[uname]; 
    },
    async updateUser(u,d) { 
      const us=_get('users')||{}; 
      const uname = u.toLowerCase().trim();
      if(!us[uname]) return null; 
      us[uname]={...us[uname],...d}; 
      _set('users',us); 
      return us[uname]; 
    },
    async getConversations(uid) { return Object.values(_get('convs')||{}).filter(c=>c.participants?.includes(uid)); },
    async createConversation(d) { 
      const cs=_get('convs')||{}; 
      const id=d.id||'conv_'+Date.now(); 
      cs[id]={...d, id, created_at:Date.now()}; 
      _set('convs',cs); 
      return cs[id]; 
    },
    async getMessages(cid,lim=200) { return (_get('msgs_'+cid)||[]).slice(-lim); },
    async createMessage(d) {
      const msgs=_get('msgs_'+d.conv_id)||[];
      const msg={...d, id:'msg_'+Date.now()+Math.random().toString(36).substr(2,4), created_at:Date.now()};
      msgs.push(msg); 
      _set('msgs_'+d.conv_id, msgs); 
      return msg;
    }
  };

  return {
    init: async () => { await ensureUsers(); },
    getUser: (...a) => Local.getUser(...a),
    getAllUsers: (...a) => Local.getAllUsers(...a),
    createUser: (...a) => Local.createUser(...a),
    updateUser: (...a) => Local.updateUser(...a),
    getConversations: (...a) => Local.getConversations(...a),
    createConversation: (...a) => Local.createConversation(...a

/**
 * CIPHER — DB Layer v2.2 (Mobil Uyumlu)
 */
const DB = (() => {
  const NS = 'cipher_';
  const _get = k => { try { return JSON.parse(localStorage.getItem(NS+k)); } catch { return null; } };
  const _set = (k, v) => { localStorage.setItem(NS+k, JSON.stringify(v)); _bc?.postMessage({key:k}); };

  let _bc = null;
  try { _bc = new BroadcastChannel('cipher_sync'); } catch {}

  // Şifreleme: Hem şifreyi hem kullanıcı adını temizleyerek işler
  async function quickHash(str) {
    if (!str) return '';
    const cleanStr = str.toString().trim(); // Boşlukları temizle
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cleanStr + '_cipher_salt'));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  const FALLBACK_USERS = [
    { username:'admin',  password:'admin123',  display_name:'Admin',       bio:'Sistem yöneticisi ⚡', is_admin:true },
    { username:'alice',  password:'alice123',  display_name:'Alice Chen',  bio:'Tasarımcı 🎨', is_admin:false },
    { username:'marcus', password:'marcus123', display_name:'Marcus Webb', bio:'Backend developer 🔒', is_admin:false },
  ];

  async function ensureUsers() {
    const deleted = JSON.parse(localStorage.getItem(NS+'deleted_users') || '[]');
    let stored = _get('users') || {};

    try {
      const r = await fetch('users.json?t=' + Date.now());
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data.users)) {
          for (const u of data.users) {
            const uname = u.username.toLowerCase(); // Küçük harfe zorla
            if (deleted.includes(uname)) continue;
            stored[uname] = { 
                ...u, 
                username: uname,
                password_hash: await quickHash(u.password),
                created_at: Date.now() 
            };
          }
        }
      }
    } catch(e) {
      console.warn('[CIPHER] users.json yüklenemedi, yerel veriler kullanılıyor.');
    }

    // Eğer hiç kullanıcı yoksa Fallback yükle
    if (Object.keys(stored).length === 0) {
      for (const u of FALLBACK_USERS) {
        const uname = u.username.toLowerCase();
        if (deleted.includes(uname)) continue;
        stored[uname] = { 
            ...u, 
            username: uname,
            password_hash: await quickHash(u.password), 
            created_at: Date.now() 
        };
      }
    }
    localStorage.setItem(NS+'users', JSON.stringify(stored));
  }

  const Local = {
    async getUser(u) { 
        const users = _get('users') || {};
        return users[u.toLowerCase().trim()] || null; 
    },
    async getAllUsers() { return Object.values(_get('users')||{}); },
    // ... diğer Local metodları aynı kalabilir
  };

  const impl = () => CONFIG.USE_SUPABASE ? Supa : Local;

  return {
    async init() { if (!CONFIG.USE_SUPABASE) await ensureUsers(); },
    getUser: (...a) => impl().getUser(...a),
    hashPassword: quickHash,
    // Diğer metodları buraya eklemeyi unutmayın (createConversation vb.)
  };
})();

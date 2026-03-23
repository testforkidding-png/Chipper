const DB = (() => {
  const NS = 'cipher_';
  const _get = k => { try { return JSON.parse(localStorage.getItem(NS+k)); } catch { return null; } };
  const _set = (k, v) => { localStorage.setItem(NS+k, JSON.stringify(v)); _bc?.postMessage({key:k}); };

  let _bc = null;
  try { _bc = new BroadcastChannel('cipher_sync'); } catch {}

  async function quickHash(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str + '_cipher_salt'));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  const FALLBACK_USERS = [
    { username:'admin',  password:'admin123',  display_name:'Admin',       avatar_url:'https://ui-avatars.com/api/?name=Admin&background=00FFB3&color=062B1F' },
    { username:'alice',  password:'alice123',  display_name:'Alice Chen',  avatar_url:'https://ui-avatars.com/api/?name=Alice+Chen&background=0066FF&color=fff' },
    { username:'marcus', password:'marcus123', display_name:'Marcus Webb', avatar_url:'https://ui-avatars.com/api/?name=Marcus+Webb&background=FF3D6B&color=fff' }
  ];

  async function ensureUsers() {
    let stored = _get('users') || {};
    const deleted = JSON.parse(localStorage.getItem(NS+'deleted_users') || '[]');

    // 1. Önce Fallback kullanıcılarını yükle (Garantici yöntem)
    for (const u of FALLBACK_USERS) {
      if (!stored[u.username] && !deleted.includes(u.username)) {
        stored[u.username] = { ...u, password_hash: await quickHash(u.password), created_at: Date.now() };
      }
    }

    // 2. Sonra users.json'dan çekmeye çalış (Eğer varsa üstüne yazar)
    try {
      const r = await fetch('users.json?t=' + Date.now());
      if (r.ok) {
        const data = await r.json();
        if (data.users) {
          for (const u of data.users) {
            if (deleted.includes(u.username)) continue;
            stored[u.username] = {
              ...u,
              password_hash: await quickHash(u.password),
              // Eğer eski veride resim varsa onu koru, yoksa json'dakini al
              avatar_url: stored[u.username]?.avatar_url || u.avatar_url || null 
            };
          }
        }
      }
    } catch(e) { console.warn("Kullanıcı listesi güncellenemedi, yerel liste aktif."); }

    _set('users', stored);
  }

  return {
    init: async () => { await ensureUsers(); },
    getUser: async (u) => { 
        const users = _get('users') || {};
        // Hem küçük harf hem temizlenmiş kontrol
        return users[u.toString().toLowerCase().trim()] || null; 
    },
    hashPassword: quickHash,
    // Diğer metodlarını (createConversation vs) buraya eklemeyi unutma
  };
})();

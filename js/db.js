/**
 * CIPHER DB — localStorage + BroadcastChannel real-time sync
 * İki sekme açılırsa gerçek zamanlı mesajlaşma çalışır.
 */
const DB = (() => {
  const NS = 'cipher2_';
  const g = k => { try { return JSON.parse(localStorage.getItem(NS+k)); } catch { return null; } };
  const s = (k,v) => { localStorage.setItem(NS+k, JSON.stringify(v)); BC.post(k); };
  const d = k => { localStorage.removeItem(NS+k); };

  // BroadcastChannel for cross-tab real-time
  const BC = {
    _ch: null,
    _cbs: [],
    init() {
      if (!('BroadcastChannel' in window)) return;
      this._ch = new BroadcastChannel('cipher_sync');
      this._ch.onmessage = e => this._cbs.forEach(cb => cb(e.data));
    },
    post(key) { this._ch?.postMessage({ key, ts: Date.now() }); },
    on(cb) { this._cbs.push(cb); },
  };
  BC.init();

  // ── User management (from users.json + localStorage overrides) ──
  let _usersCache = null;

  async function loadUsersFromJSON() {
    try {
      const r = await fetch(CONFIG.USERS_JSON_PATH + '?t=' + Date.now());
      const data = await r.json();
      const map = {};
      for (const u of (data.users || [])) {
        // Hash password if not already hashed
        const hash = await hashPwd(u.password);
        map[u.username] = { ...u, password_hash: hash, created_at: u.created_at || Date.now() - 30*86400000 };
        delete map[u.username].password; // don't keep plaintext in memory
      }
      return map;
    } catch (e) {
      console.warn('users.json yüklenemedi, localStorage kullanılıyor:', e);
      return g('users') || {};
    }
  }

  async function hashPwd(pass) {
    if (!pass) return '';
    // Simple deterministic hash (SHA-256 sim)
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pass + '_cph'));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  async function getUsers() {
    if (_usersCache) return _usersCache;
    // Merge users.json with any localStorage overrides (avatar_url, bio edits etc.)
    const base = await loadUsersFromJSON();
    const overrides = g('user_overrides') || {};
    _usersCache = {};
    for (const [k,v] of Object.entries(base)) {
      _usersCache[k] = { ...v, ...(overrides[k] || {}) };
    }
    return _usersCache;
  }

  function invalidateUsersCache() { _usersCache = null; }

  async function getUser(username) {
    const users = await getUsers();
    return users[username] || null;
  }

  async function getAllUsers() {
    return Object.values(await getUsers());
  }

  async function verifyPassword(username, plainPass) {
    const user = await getUser(username);
    if (!user) return false;
    const hash = await hashPwd(plainPass);
    return user.password_hash === hash;
  }

  async function updateUserOverride(username, data) {
    const overrides = g('user_overrides') || {};
    overrides[username] = { ...(overrides[username]||{}), ...data };
    s('user_overrides', overrides);
    invalidateUsersCache();
    return await getUser(username);
  }

  // ── Conversations ───────────────────────────────────────────────
  function getConvs() { return g('convs') || {}; }
  function setConvs(v) { s('convs', v); }

  async function getUserConversations(userId) {
    const convs = getConvs();
    return Object.values(convs).filter(c => c.participants?.includes(userId));
  }

  async function getConversation(convId) {
    return getConvs()[convId] || null;
  }

  async function createConversation(data) {
    const convs = getConvs();
    convs[data.id] = { ...data, created_at: Date.now() };
    setConvs(convs);
    return convs[data.id];
  }

  async function updateConversation(convId, data) {
    const convs = getConvs();
    if (!convs[convId]) return null;
    convs[convId] = { ...convs[convId], ...data };
    setConvs(convs);
    return convs[convId];
  }

  // ── Messages ────────────────────────────────────────────────────
  function getMsgs(convId) { return g('msgs_'+convId) || []; }
  function setMsgs(convId, v) { s('msgs_'+convId, v); }

  async function getMessages(convId) {
    return getMsgs(convId);
  }

  async function createMessage(data) {
    const msgs = getMsgs(data.conv_id);
    const msg = { ...data, id: data.id || 'msg_'+Date.now()+'_'+Math.random().toString(36).substr(2,6), created_at: data.created_at || Date.now() };
    msgs.push(msg);
    setMsgs(data.conv_id, msgs);
    return msg;
  }

  async function updateMessage(convId, msgId, data) {
    const msgs = getMsgs(convId);
    const i = msgs.findIndex(m => m.id === msgId);
    if (i < 0) return null;
    msgs[i] = { ...msgs[i], ...data, updated_at: Date.now() };
    setMsgs(convId, msgs);
    return msgs[i];
  }

  async function deleteMessage(convId, msgId) {
    setMsgs(convId, getMsgs(convId).filter(m => m.id !== msgId));
  }

  // ── Stories ─────────────────────────────────────────────────────
  function getStories() {
    const all = g('stories') || {};
    const now = Date.now();
    return Object.values(all).filter(s => s.expires_at > now);
  }

  async function createStory(data) {
    const stories = g('stories') || {};
    const id = 'story_'+Date.now();
    stories[id] = { ...data, id, created_at: Date.now(), expires_at: Date.now() + 24*3600000 };
    s('stories', stories);
    return stories[id];
  }

  // ── Seed demo conversations (not users — those come from users.json) ─
  function seedConvs() {
    if (g('convs_seeded')) return;
    const now = Date.now();
    const convs = {
      'admin_alice': { id:'admin_alice', type:'direct', participants:['admin','alice'], last_msg:'Merhaba!', last_time:now-3600000, unread_for:{admin:1} },
      'admin_marcus': { id:'admin_marcus', type:'direct', participants:['admin','marcus'], last_msg:'Nasılsın?', last_time:now-7200000, unread_for:{} },
      'alice_marcus': { id:'alice_marcus', type:'direct', participants:['alice','marcus'], last_msg:'👋 Selam!', last_time:now-1800000, unread_for:{alice:1} },
      'group_cipher': { id:'group_cipher', type:'group', name:'CIPHER Team 🔐', participants:['admin','alice','marcus'], avatar:'CT', banner_color:'#0A2818', last_msg:'Herkese merhaba!', last_time:now-900000, unread_for:{}, admin:'admin' },
    };
    setConvs(convs);

    setMsgs('admin_alice', [
      { id:'m1', conv_id:'admin_alice', from:'alice', text:'Merhaba! CIPHER çalışıyor 🎉', type:'text', created_at:now-7200000, status:'read' },
      { id:'m2', conv_id:'admin_alice', from:'admin', text:'Harika! Uçtan uca şifreleme aktif 🔒', type:'text', created_at:now-7100000, status:'read' },
      { id:'m3', conv_id:'admin_alice', from:'alice', text:'', type:'gif', gif_url:'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif', gif_title:'Excited', created_at:now-3700000, status:'read', reactions:{'🔥':['admin']} },
      { id:'m4', conv_id:'admin_alice', from:'admin', text:'Merhaba!', type:'text', created_at:now-3600000, status:'sent' },
    ]);

    setMsgs('admin_marcus', [
      { id:'m1', conv_id:'admin_marcus', from:'marcus', text:'Hey! Her şey hazır.', type:'text', created_at:now-10000000, status:'read' },
      { id:'m2', conv_id:'admin_marcus', from:'admin', text:'Nasılsın?', type:'text', created_at:now-7200000, status:'sent' },
    ]);

    setMsgs('alice_marcus', [
      { id:'m1', conv_id:'alice_marcus', from:'marcus', text:'Selam Alice! 🤙', type:'text', created_at:now-5000000, status:'read' },
      { id:'m2', conv_id:'alice_marcus', from:'alice', text:'', type:'sticker', sticker:'🎨', created_at:now-4900000, status:'read' },
      { id:'m3', conv_id:'alice_marcus', from:'marcus', text:'👋 Selam!', type:'text', created_at:now-1800000, status:'sent' },
    ]);

    setMsgs('group_cipher', [
      { id:'m1', conv_id:'group_cipher', from:'admin', text:'CIPHER Team grubuna hoş geldiniz! 🔐', type:'text', created_at:now-86400000, status:'read' },
      { id:'m2', conv_id:'group_cipher', from:'alice', text:'Merhaba herkese! 👋', type:'text', created_at:now-85000000, reactions:{'❤️':['admin','marcus']}, status:'read' },
      { id:'m3', conv_id:'group_cipher', from:'marcus', text:'Herkese merhaba!', type:'text', created_at:now-900000, status:'read' },
    ]);

    s('convs_seeded', true);
  }

  // ── On storage event (cross-tab real-time) ───────────────────────
  BC.on(data => {
    window._onStorageSync?.(data.key);
  });

  window.addEventListener('storage', e => {
    if (e.key?.startsWith(NS)) {
      const k = e.key.slice(NS.length);
      window._onStorageSync?.(k);
    }
  });

  return {
    init() { seedConvs(); },
    hashPwd,
    getUser, getAllUsers, verifyPassword, updateUserOverride, invalidateUsersCache,
    getUserConversations, getConversation, createConversation, updateConversation,
    getMessages, createMessage, updateMessage, deleteMessage,
    getStories, createStory,
    onSync(cb) { BC.on(cb); },
  };
})();

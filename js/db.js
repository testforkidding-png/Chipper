/**
 * CIPHER — Database Layer
 * localStorage (dev) veya Supabase (prod) ile çalışır.
 */

const DB = (() => {
  // ── Local Storage Implementation ──────────────────────────────
  const Local = {
    _ns: 'cipher_',
    _get: k => { try { return JSON.parse(localStorage.getItem(Local._ns + k)); } catch { return null; } },
    _set: (k, v) => localStorage.setItem(Local._ns + k, JSON.stringify(v)),
    _del: k => localStorage.removeItem(Local._ns + k),

    async getUser(username) {
      const users = Local._get('users') || {};
      return users[username] || null;
    },
    async getAllUsers() {
      return Object.values(Local._get('users') || {});
    },
    async createUser(data) {
      const users = Local._get('users') || {};
      users[data.username] = { ...data, created_at: Date.now() };
      Local._set('users', users);
      return users[data.username];
    },
    async updateUser(username, data) {
      const users = Local._get('users') || {};
      if (!users[username]) return null;
      users[username] = { ...users[username], ...data, updated_at: Date.now() };
      Local._set('users', users);
      return users[username];
    },
    async deleteUser(username) {
      const users = Local._get('users') || {};
      delete users[username];
      Local._set('users', users);
    },

    async getConversations(userId) {
      const convs = Local._get('convs') || {};
      return Object.values(convs).filter(c => c.participants?.includes(userId));
    },
    async getConversation(convId) {
      const convs = Local._get('convs') || {};
      return convs[convId] || null;
    },
    async createConversation(data) {
      const convs = Local._get('convs') || {};
      const id = data.id || 'conv_' + Date.now();
      convs[id] = { ...data, id, created_at: Date.now() };
      Local._set('convs', convs);
      return convs[id];
    },
    async updateConversation(convId, data) {
      const convs = Local._get('convs') || {};
      if (!convs[convId]) return null;
      convs[convId] = { ...convs[convId], ...data };
      Local._set('convs', convs);
      return convs[convId];
    },

    async getMessages(convId, limit = 100) {
      const msgs = Local._get('msgs_' + convId) || [];
      return msgs.slice(-limit);
    },
    async createMessage(data) {
      const msgs = Local._get('msgs_' + data.conv_id) || [];
      const msg = { ...data, id: data.id || 'msg_' + Date.now() + Math.random().toString(36).substr(2,5), created_at: Date.now() };
      msgs.push(msg);
      Local._set('msgs_' + data.conv_id, msgs);
      return msg;
    },
    async updateMessage(convId, msgId, data) {
      const msgs = Local._get('msgs_' + convId) || [];
      const idx = msgs.findIndex(m => m.id === msgId);
      if (idx < 0) return null;
      msgs[idx] = { ...msgs[idx], ...data, updated_at: Date.now() };
      Local._set('msgs_' + convId, msgs);
      return msgs[idx];
    },
    async deleteMessage(convId, msgId) {
      const msgs = (Local._get('msgs_' + convId) || []).filter(m => m.id !== msgId);
      Local._set('msgs_' + convId, msgs);
    },

    async getStories() {
      const stories = Local._get('stories') || {};
      const now = Date.now();
      return Object.values(stories).filter(s => s.expires_at > now);
    },
    async createStory(data) {
      const stories = Local._get('stories') || {};
      const id = 'story_' + Date.now();
      stories[id] = { ...data, id, created_at: Date.now(), expires_at: Date.now() + 24 * 3600 * 1000 };
      Local._set('stories', stories);
      return stories[id];
    },
    async deleteStory(id) {
      const stories = Local._get('stories') || {};
      delete stories[id];
      Local._set('stories', stories);
    },
  };

  // ── Supabase Implementation ────────────────────────────────────
  let _sb = null;
  const initSupabase = () => {
    if (_sb) return _sb;
    if (typeof window.supabase === 'undefined') throw new Error('Supabase client not loaded');
    _sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    return _sb;
  };

  const Supa = {
    async getUser(username) {
      const sb = initSupabase();
      const { data } = await sb.from('users').select('*').eq('username', username).single();
      return data;
    },
    async getAllUsers() {
      const sb = initSupabase();
      const { data } = await sb.from('users').select('*').order('created_at');
      return data || [];
    },
    async createUser(data) {
      const sb = initSupabase();
      const { data: row, error } = await sb.from('users').insert(data).select().single();
      if (error) throw error;
      return row;
    },
    async updateUser(username, data) {
      const sb = initSupabase();
      const { data: row, error } = await sb.from('users').update(data).eq('username', username).select().single();
      if (error) throw error;
      return row;
    },
    async deleteUser(username) {
      const sb = initSupabase();
      await sb.from('users').delete().eq('username', username);
    },

    async getConversations(userId) {
      const sb = initSupabase();
      const { data } = await sb.from('conversations').select('*').contains('participants', [userId]).order('last_time', { ascending: false });
      return data || [];
    },
    async getConversation(convId) {
      const sb = initSupabase();
      const { data } = await sb.from('conversations').select('*').eq('id', convId).single();
      return data;
    },
    async createConversation(data) {
      const sb = initSupabase();
      const { data: row, error } = await sb.from('conversations').insert(data).select().single();
      if (error) throw error;
      return row;
    },
    async updateConversation(convId, data) {
      const sb = initSupabase();
      const { data: row } = await sb.from('conversations').update(data).eq('id', convId).select().single();
      return row;
    },

    async getMessages(convId, limit = 100) {
      const sb = initSupabase();
      const { data } = await sb.from('messages').select('*').eq('conv_id', convId).order('created_at').limit(limit);
      return data || [];
    },
    async createMessage(data) {
      const sb = initSupabase();
      const { data: row, error } = await sb.from('messages').insert(data).select().single();
      if (error) throw error;
      return row;
    },
    async updateMessage(convId, msgId, data) {
      const sb = initSupabase();
      const { data: row } = await sb.from('messages').update(data).eq('id', msgId).select().single();
      return row;
    },
    async deleteMessage(convId, msgId) {
      const sb = initSupabase();
      await sb.from('messages').delete().eq('id', msgId);
    },

    async getStories() {
      const sb = initSupabase();
      const { data } = await sb.from('stories').select('*').gt('expires_at', new Date().toISOString());
      return data || [];
    },
    async createStory(data) {
      const sb = initSupabase();
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      const { data: row, error } = await sb.from('stories').insert({ ...data, expires_at: expiresAt }).select().single();
      if (error) throw error;
      return row;
    },
    async deleteStory(id) {
      const sb = initSupabase();
      await sb.from('stories').delete().eq('id', id);
    },

    subscribeMessages(convId, cb) {
      const sb = initSupabase();
      return sb.channel('msgs_' + convId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conv_id=eq.${convId}` }, cb)
        .subscribe();
    },
    unsubscribe(channel) {
      if (channel) initSupabase().removeChannel(channel);
    }
  };

  // ── Seed Demo Data (Local only) ────────────────────────────────
  function seedLocalDemo() {
    if (Local._get('seeded')) return;
    const hash = str => Array.from(new TextEncoder().encode(str)).map(b => b.toString(16).padStart(2,'0')).join('');
    const users = {
      admin: {
        username: 'admin', password_hash: hash('admin123'),
        display_name: 'Admin', bio: 'Sistem yöneticisi', is_admin: true,
        banner_color: '#0A1628', avatar_url: null,
        badges: ['admin', 'verified', 'early'], status: 'Sistemi yönetiyorum ⚡',
        status_emoji: '⚡', created_at: Date.now() - 30 * 86400000
      },
      alice: {
        username: 'alice', password_hash: hash('alice123'),
        display_name: 'Alice Chen', bio: 'Tasarımcı & Şifreli iletişim meraklısı 🎨',
        is_admin: false, banner_color: '#1A0A28', avatar_url: null,
        badges: ['verified', 'early'], status: 'Tasarım yapıyorum',
        status_emoji: '🎨', created_at: Date.now() - 20 * 86400000
      },
      marcus: {
        username: 'marcus', password_hash: hash('marcus123'),
        display_name: 'Marcus Webb', bio: 'Backend developer. Privacy matters.',
        is_admin: false, banner_color: '#0A1628', avatar_url: null,
        badges: ['secure'], status: 'Kod yazıyorum',
        status_emoji: '💻', created_at: Date.now() - 15 * 86400000
      },
    };
    Local._set('users', users);

    const now = Date.now();
    const convs = {
      'admin_alice': {
        id: 'admin_alice', type: 'direct',
        participants: ['admin', 'alice'],
        last_msg: 'Merhaba Alice!', last_time: now - 3600000, unread_for: {}
      },
      'admin_marcus': {
        id: 'admin_marcus', type: 'direct',
        participants: ['admin', 'marcus'],
        last_msg: 'Nasılsın?', last_time: now - 7200000, unread_for: {}
      },
      'group_team': {
        id: 'group_team', type: 'group', name: 'CIPHER Team 🔐',
        participants: ['admin', 'alice', 'marcus'],
        avatar: 'CT', banner_color: '#0A2818',
        last_msg: 'Herkese merhaba!', last_time: now - 1800000,
        unread_for: {}, admin: 'admin',
      }
    };
    Local._set('convs', convs);

    Local._set('msgs_admin_alice', [
      { id: 'm1', conv_id: 'admin_alice', from: 'alice', text: 'Merhaba! CIPHER kurulumu tamamlandı 🎉', type: 'text', created_at: now - 7200000, status: 'read' },
      { id: 'm2', conv_id: 'admin_alice', from: 'admin', text: 'Harika! Uçtan uca şifreleme aktif.', type: 'text', created_at: now - 7100000, status: 'read' },
      { id: 'm3', conv_id: 'admin_alice', from: 'alice', text: 'Güvenlik ayarlarını test edeyim.', type: 'text', created_at: now - 3700000, reactions: { '👍': ['admin'] }, status: 'read' },
      { id: 'm4', conv_id: 'admin_alice', from: 'admin', text: 'Merhaba Alice!', type: 'text', created_at: now - 3600000, status: 'sent' },
    ]);

    Local._set('msgs_admin_marcus', [
      { id: 'm1', conv_id: 'admin_marcus', from: 'marcus', text: 'CIPHER çok iyi bir platform 🔒', type: 'text', created_at: now - 10000000, status: 'read' },
      { id: 'm2', conv_id: 'admin_marcus', from: 'admin', text: 'Nasılsın?', type: 'text', created_at: now - 7200000, status: 'sent' },
    ]);

    Local._set('msgs_group_team', [
      { id: 'm1', conv_id: 'group_team', from: 'admin', text: 'CIPHER Team grubuna hoş geldiniz! 🔐', type: 'text', created_at: now - 86400000, status: 'read' },
      { id: 'm2', conv_id: 'group_team', from: 'alice', text: 'Merhaba herkese! 👋', type: 'text', created_at: now - 85000000, reactions: { '❤️': ['admin', 'marcus'] }, status: 'read' },
      { id: 'm3', conv_id: 'group_team', from: 'marcus', text: 'Herkese merhaba!', type: 'text', created_at: now - 1800000, status: 'read' },
    ]);

    Local._set('seeded', true);
  }

  // ── Public API ─────────────────────────────────────────────────
  const impl = () => CONFIG.USE_SUPABASE ? Supa : Local;

  return {
    init() {
      if (!CONFIG.USE_SUPABASE) seedLocalDemo();
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
    unsubscribe:        CONFIG.USE_SUPABASE ? (...a) => Supa.unsubscribe(...a) : () => null,
  };
})();

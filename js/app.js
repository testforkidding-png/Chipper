/**
 * CIPHER App v6 — Debug & Optimizasyon
 * Tüm bilinen buglar düzeltildi
 */

// ── State ──────────────────────────────────────────────────────────
let _allUsers = {}, _convs = [], _chatFilter = 'all', _searchQuery = '';

// ── Global HTML escape helper ─────────────────────────────────────
const _esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

let _activeTab = 'messages', _activeServer = 'all';
let _renderChatListTimer = null; // debounce


// ── Avatar URL güvenlik kontrolü ────────────────────────────────
function _safeUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    // Only allow http/https/data protocols
    if (!['http:', 'https:', 'data:'].includes(u.protocol)) return null;
    return url;
  } catch { return null; } // relative URLs pass through
}
// ── Boot ───────────────────────────────────────────────────────────
async function bootApp() {
  // Wait for storage to settle (mobile Safari fix)
  await new Promise(r => setTimeout(r, 100));

  let session = Auth.getSession();
  console.log('[CIPHER boot] session:', session ? 'found' : 'null', '| key:', localStorage.getItem('cipher_session_v2') ? 'exists' : 'MISSING');

  // Backup: sessionStorage fallback
  if (!session) {
    try {
      const bk = sessionStorage.getItem('cipher_session_backup');
      if (bk) {
        const p = JSON.parse(bk);
        if (p?.expires > Date.now()) {
          localStorage.setItem('cipher_session_v2', bk);
          session = Auth.getSession();
          console.log('[CIPHER boot] restored from sessionStorage backup');
        }
      }
    } catch(e) { console.warn('[CIPHER boot] backup restore failed:', e); }
  }

  // Last resort: check ALL localStorage keys for any cipher session
  if (!session) {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('cipher_session')) {
        try {
          const val = JSON.parse(localStorage.getItem(key));
          if (val?.username && val?.expires > Date.now()) {
            // Migrate to correct key
            localStorage.setItem('cipher_session_v2', JSON.stringify(val));
            session = Auth.getSession();
            console.log('[CIPHER boot] migrated session from key:', key);
            break;
          }
        } catch(e) {}
      }
    }
  }

  if (!session) {
    console.log('[CIPHER boot] no valid session found - redirecting to login');
    window.location.href = 'index.html';
    return;
  }

  console.log('[CIPHER boot] session valid for:', session.username);

  // ── PHASE 1: Immediate UI from session cache (zero wait) ────────
  loadSettings();
  buildStickerTabs();
  customizeApply();

  // Always build a working user object — never block on DB
  window._currentUser = session.user
    ? { ...session.user }
    : { username: session.username, display_name: session.username,
        is_admin: false, badges: [], server_roles: {}, bio: '', status: '', status_emoji: '' };
  renderMyAvatar();
  renderServerBar();
  _loadStatusMode();
  _loadNotifs();

  // Skeleton chat list
  const chatList = document.getElementById('chat-list');
  if (chatList) chatList.innerHTML = '<div style="padding:16px;display:flex;flex-direction:column;gap:8px">' +
    Array(4).fill(0).map(()=>'<div style="display:flex;gap:10px;align-items:center"><div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(90deg,#0C1220 25%,#131D30 50%,#0C1220 75%);background-size:200% 100%;animation:shimmer 1.2s infinite;flex-shrink:0"></div><div style="flex:1;display:flex;flex-direction:column;gap:6px"><div style="height:12px;border-radius:6px;background:linear-gradient(90deg,#0C1220 25%,#131D30 50%,#0C1220 75%);background-size:200% 100%;animation:shimmer 1.2s infinite;width:60%"></div><div style="height:10px;border-radius:5px;background:linear-gradient(90deg,#0C1220 25%,#131D30 50%,#0C1220 75%);background-size:200% 100%;animation:shimmer 1.2s infinite;width:80%"></div></div></div>').join('') + '</div>';

  // ── PHASE 2: Parallel DB fetch ─────────────────────────────────
  const [userRes, convsRes, allUsersRes] = await Promise.allSettled([
    DB.getUser(session.username),
    DB.getConversations(session.username),
    DB.getAllUsers(),
  ]);

  // Update user from DB if successful
  if (userRes.status === 'fulfilled' && userRes.value) {
    window._currentUser = userRes.value;
    renderMyAvatar();
    renderServerBar();
  } else if (userRes.status === 'rejected') {
    // DB error — stay with cached user, show warning
    console.warn('getUser failed:', userRes.reason?.message);
    UI.toast('Sunucu hatası — önbellek kullanılıyor', 'warn', 4000);
  } else {
    // DB returned null = user deleted from DB
    // Don't logout — maybe schema issue. Show warning.
    console.warn('User not found in DB:', session.username);
    UI.toast('Kullanıcı bulunamadı — giriş bilgilerinizi kontrol edin', 'warn', 5000);
  }

  // All users into memory
  if (allUsersRes.status === 'fulfilled') {
    allUsersRes.value.forEach(u => { _allUsers[u.username] = u; });
    // Sync current user's server_roles and admin flag from DB (session cache may be stale)
    const freshCu = _allUsers[window._currentUser?.username];
    if (freshCu && window._currentUser) {
      window._currentUser.server_roles = freshCu.server_roles || window._currentUser.server_roles || {};
      window._currentUser.is_admin     = freshCu.is_admin     ?? window._currentUser.is_admin;
      window._currentUser.display_name = freshCu.display_name || window._currentUser.display_name;
      window._currentUser.avatar_url   = freshCu.avatar_url   ?? window._currentUser.avatar_url;
      window._currentUser.badges       = freshCu.badges       || window._currentUser.badges;
      // Update session with fresh data
      Auth.getSession && (() => {
        try {
          const s = JSON.parse(localStorage.getItem('cipher_session_v2') || '{}');
          if (s.username) {
            s.user = { ...s.user, ...window._currentUser };
            const data = JSON.stringify(s);
            localStorage.setItem('cipher_session_v2', data);
            sessionStorage.setItem('cipher_session_backup', data);
          }
        } catch(e) {}
      })();
    }
    renderServerBar(); // re-render with fresh server_roles
  }

  // Conversations
  _convs = convsRes.status === 'fulfilled' ? convsRes.value : [];
  window._convs = _convs;
  window._convsLoaded = true;
  renderChatList();

  // Supabase warning
  if (CONFIG.USE_SUPABASE && (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes('YOUR_PROJECT'))) {
    UI.toast('⚠️ Supabase ayarlanmamış', 'warn', 8000);
  }

  // Defer non-critical
  setTimeout(() => {
    renderStories().catch(()=>{});
    ensureBotConversation().catch(()=>{});
    ensureMathBotUser().then(() => ensureMathBotConversation()).catch(()=>{});
    setTimeout(() => checkAndAwardBadges().catch(()=>{}), 5000);
    requestPushPermission().catch(()=>{});
    PWA.init();
  }, 100);

  Auth.startHeartbeat(window._currentUser.username);

  // New message handler — update UI from memory first, refresh DB in background
  let _newMsgTimer = null;
  window._onNewMessage = () => {
    // Debounce: prevent rapid re-renders from realtime bursts
    if (_newMsgTimer) return;
    _newMsgTimer = setTimeout(async () => {
      _newMsgTimer = null;
      if (window._currentConvId) await renderMessages().catch(() => {}); // smooth handled in renderAll
      loadConversations().catch(() => {});
    }, 80);
  };

  // localStorage cross-tab sync (non-Supabase mode)
  window._onStorageSync = async (key) => {
    if (!key) return;
    if (key === 'convs') { await loadConversations(); return; }
    if (key.startsWith('msgs_')) {
      const convId = key.slice(5);
      if (convId !== window._currentConvId || document.hidden) {
        try {
          const msgs = await DB.getMessages(convId);
          const last = msgs[msgs.length - 1];
          if (last && last.from !== window._currentUser.username) {
            const sender = _allUsers[last.from];
            const preview = last.text || (last.type === 'gif' ? '🎬 GIF' : last.sticker || '📎 Medya');
            addNotif(preview, last.from, convId);
            sendPushNotif(sender?.display_name || last.from, preview, convId);
            // Increment unread
            const conv = _convs.find(c => c.id === convId);
            if (conv) {
              conv.unread_for = { ...(conv.unread_for || {}), [window._currentUser.username]: (conv.unread_for?.[window._currentUser.username] || 0) + 1 };
              await DB.updateConversation(convId, { unread_for: conv.unread_for });
            }
          }
        } catch(e) { console.warn('sync error:', e); }
      }
      await loadConversations();
      if (key === 'msgs_' + window._currentConvId) await renderMessages();
    }
  };

  // Supabase real-time + polling fallback
  if (CONFIG.USE_SUPABASE && !window._supabaseNotConfigured) {
    try { DB.subscribeConversations?.(window._currentUser.username, () => loadConversations().catch(()=>{})); } catch {}
  }
  // Polling: 30s for Supabase (safety net), 4s for localStorage
  if (window._convPollInterval) clearInterval(window._convPollInterval);
  let _lastConvLoad = 0;
  window._convPollInterval = setInterval(() => {
    if (document.hidden) return; // page not visible
    const minInterval = CONFIG.USE_SUPABASE ? 28000 : 3500;
    if (Date.now() - _lastConvLoad < minInterval) return;
    _lastConvLoad = Date.now();
    loadConversations().catch(()=>{});
  }, CONFIG.USE_SUPABASE ? 30000 : 4000);
}

// ── Bottom nav ─────────────────────────────────────────────────────
function setTab(tab) {
  _activeTab = tab;
  ['messages','contacts','updates'].forEach(t => {
    document.getElementById('tab-' + t).style.display = t === tab ? 'flex' : 'none';
  });
  document.querySelectorAll('.bottom-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  if (tab === 'contacts') {
    const si = document.getElementById('contact-search-input');
    if (si) si.value = '';
    refreshAllUsers().then(() => renderContactsList()).catch(console.warn);
  }
  if (tab === 'updates') renderUpdatesTab();
}

// ── Refresh users ──────────────────────────────────────────────────
async function refreshAllUsers() {
  try {
    const users = await DB.getAllUsers();
    // Merge into existing _allUsers (preserve any local state)
    users.forEach(u => {
      _allUsers[u.username] = u;
    });
    // Also update _currentUser's data if included
    const freshCu = _allUsers[window._currentUser?.username];
    if (freshCu && window._currentUser) {
      window._currentUser.server_roles = freshCu.server_roles || window._currentUser.server_roles;
      window._currentUser.is_admin = freshCu.is_admin ?? window._currentUser.is_admin;
    }
  } catch(e) { console.warn('refreshAllUsers:', e); }
}

// ── Server bar ─────────────────────────────────────────────────────
function renderServerBar() {
  const bar = document.getElementById('server-bar');
  if (!bar) return;
  const cu = window._currentUser;
  if (!cu) { bar.style.display = 'none'; return; }

  // Determine which servers this user can access
  const accessible = [];
  if (cu.is_admin) {
    accessible.push({ id: 'all', icon: '🌐', label: 'Tümü' });
    Object.values(CONFIG.SERVERS).forEach(s => accessible.push(s));
  } else {
    // Only show servers user is assigned to
    const servers = Object.values(CONFIG.SERVERS).filter(s => hasServerAccess(cu, s.id));
    if (servers.length > 1) {
      accessible.push({ id: 'all', icon: '🌐', label: 'Tümü' });
    }
    servers.forEach(s => accessible.push(s));
  }

  // Hide bar if only one (or zero) server
  if (accessible.length <= 1) {
    bar.style.display = 'none';
    _activeServer = accessible[0]?.id || 'all';
    return;
  }

  bar.style.display = 'flex';
  const inner = bar.querySelector('div') || bar;
  inner.innerHTML = '';

  accessible.forEach(srv => {
    const active = _activeServer === srv.id;
    const btn = document.createElement('button');
    btn.style.cssText = `display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:20px;font-size:12px;font-family:'JetBrains Mono',monospace;cursor:pointer;white-space:nowrap;border:1px solid ${active ? (CONFIG.SERVERS[srv.id]?.color || 'var(--accent,#00FFB3)') : '#1E2D45'};background:${active ? (CONFIG.SERVERS[srv.id]?.color || 'var(--accent,#00FFB3)') + '22' : 'transparent'};color:${active ? (CONFIG.SERVERS[srv.id]?.color || 'var(--accent,#00FFB3)') : '#7A8FA8'};transition:all .15s;-webkit-tap-highlight-color:transparent`;
    btn.innerHTML = `<span>${srv.icon}</span><span>${srv.label}</span>`;
    btn.onclick = () => setServer(srv.id);
    inner.appendChild(btn);
  });
}

function hasServerAccess(user, serverId) {
  if (!user) return false;
  if (user.is_admin) return true;
  const roles = user.server_roles;
  // No roles data at all → default: public only
  if (!roles || typeof roles !== 'object') return serverId === 'public';
  // Empty object {} → default: public only
  if (Object.keys(roles).length === 0) return serverId === 'public';
  // Check specific server
  return !!roles[serverId];
}


function convMatchesServer(conv) {
  if (_activeServer === 'all') return true;
  const cu = window._currentUser;
  if (!cu) return true;
  if (!hasServerAccess(cu, _activeServer)) return false;
  if (conv.type === 'direct') {
    const otherName = conv.participants?.find(p => p !== cu.username);
    if (!otherName) return false;
    const other = _allUsers[otherName];
    if (!other) return false;
    return hasServerAccess(other, _activeServer);
  }
  if (conv.server) return conv.server === _activeServer;
  return true;
}

function setServer(id) {
  _activeServer = id;
  renderServerBar();
  renderChatList();
  // Also update contacts if active
  if (_activeTab === 'contacts') renderContactsList();
}



// ── Push notifications ─────────────────────────────────────────────
async function requestPushPermission() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  const perm = await Notification.requestPermission();
  if (perm === 'granted') UI.toast('🔔 Bildirimler aktif!', 'success');
}

function sendPushNotif(title, body, convId) {
  if (Notification.permission !== 'granted' || !document.hidden) return;
  try {
    const n = new Notification(title, { body, icon: 'icons/icon-192.png', tag: convId, renotify: true });
    n.onclick = () => { window.focus(); openConv(convId); n.close(); };
  } catch {}
}

// ── My avatar ──────────────────────────────────────────────────────
function renderMyAvatar() {
  const cu = window._currentUser;
  if (!cu) return;
  const el = document.getElementById('my-avatar');
  if (!el || !cu) return;
  if (cu.avatar_url) {
    el.innerHTML = `<img src="${cu.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
  } else {
    const c = UI.avatarColor(cu.username);
    el.style.cssText = `background:linear-gradient(135deg,${c},${c}99);color:#fff`;
    el.textContent = UI.initials(cu.display_name || cu.username);
  }
  const nameEl = document.getElementById('my-name');
  if (nameEl) nameEl.textContent = cu.display_name || cu.username;

  // Bottom nav avatar butonu da güncelle
  const bnInner = document.getElementById('bottom-nav-avatar-inner');
  if (bnInner) {
    if (cu.avatar_url) {
      bnInner.innerHTML = `<img src="${cu.avatar_url}" style="width:100%;height:100%;object-fit:cover">`;
      bnInner.style.background = 'transparent';
    } else {
      const c = UI.avatarColor(cu.username);
      bnInner.style.background = `linear-gradient(135deg,${c},${c}99)`;
      bnInner.style.color = '#fff';
      bnInner.textContent = UI.initials(cu.display_name || cu.username);
    }
  }
}

// ── Sticker tabs ───────────────────────────────────────────────────
function buildStickerTabs() {
  const tabs = document.getElementById('sticker-pack-tabs');
  if (!tabs) return;
  tabs.innerHTML = '';
  Object.keys(CONFIG.STICKER_PACKS).forEach((pack, i) => {
    const btn = document.createElement('button');
    btn.className = 'sticker-pack-tab' + (i === 0 ? ' active' : '');
    btn.textContent = pack;
    btn.onclick = () => Messages.renderStickerPack(pack);
    tabs.appendChild(btn);
  });
}

// ── Conversations ──────────────────────────────────────────────────
async function loadConversations() {
  if (!window._currentUser?.username) return;
  try {
    _convs = await DB.getConversations(window._currentUser.username);
    window._convs = _convs;
    if (typeof _lastConvLoad !== 'undefined') _lastConvLoad = Date.now();
  } catch(e) { console.warn('loadConversations:', e); _convs = []; }
  renderChatList();
}

function getConvName(conv) {
  if (conv.type === 'group') return conv.name || 'Grup';
  const other = conv.participants?.find(p => p !== window._currentUser?.username);
  return _allUsers[other]?.display_name || _allUsers[other]?.username || other || '?';
}

function getConvColor(conv) {
  if (conv.type === 'group') return conv.banner_color || '#7A8FA8';
  const other = conv.participants?.find(p => p !== window._currentUser?.username);
  return UI.avatarColor(_allUsers[other]?.username || other || '');
}

// Debounced renderChatList to prevent rapid re-renders
function renderChatList() {
  if (_renderChatListTimer) clearTimeout(_renderChatListTimer);
  _renderChatListTimer = setTimeout(_doRenderChatList, 16);
}

function _doRenderChatList() {
  const list = document.getElementById('chat-list');
  if (!list || !window._currentUser) return;

  let items = [..._convs];

  // Filters
  if (_chatFilter === 'unread') items = items.filter(c => (c.unread_for?.[window._currentUser.username] || 0) > 0);
  if (_chatFilter === 'groups') items = items.filter(c => c.type === 'group');
  items = items.filter(convMatchesServer);
  if (_searchQuery) {
    const q = _searchQuery.toLocaleLowerCase('tr-TR');
    items = items.filter(c => getConvName(c).toLocaleLowerCase('tr-TR').includes(q) || (c.last_msg || '').toLocaleLowerCase('tr-TR').includes(q));
  }

  // Pinned chats first, then sort by last_time descending
  // Cache pinnedSet outside sort to avoid repeated localStorage reads
  const _pinnedArr = (() => { try { return JSON.parse(localStorage.getItem('cipher_pinned') || '[]'); } catch { return []; } })();
  const _pinnedSet = new Set(_pinnedArr);
  items.sort((a, b) => {
    const ap = _pinnedSet.has(a.id) ? 1 : 0, bp = _pinnedSet.has(b.id) ? 1 : 0;
    if (ap !== bp) return bp - ap; // pinned first
    const ta = UI._ms(a.last_time) || 0;
    const tb = UI._ms(b.last_time) || 0;
    return tb - ta;
  });

  // Build DOM efficiently
  const frag = document.createDocumentFragment();

  if (!items.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'text-align:center;padding:32px 16px;font-size:13px;color:#7A8FA8';
    const loadingStill = !window._convsLoaded && _chatFilter === 'all';
    empty.textContent = loadingStill ? '' : (_chatFilter !== 'all' ? 'Filtre sonucu yok' : 'Henüz sohbet yok');
    frag.appendChild(empty);
    list.innerHTML = '';
    list.appendChild(frag);
    return;
  }

  const cu = window._currentUser;
  items.forEach(conv => {
    const name = getConvName(conv);
    const color = getConvColor(conv);
    const other = conv.type === 'direct' ? _allUsers[conv.participants?.find(p => p !== cu.username)] : null;
    const unread = conv.unread_for?.[cu.username] || 0;
    const isActive = conv.id === window._currentConvId;

    const div = document.createElement('div');
    div.style.cssText = `display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:13px;cursor:pointer;margin:1px 5px;transition:background .12s;background:${isActive ? '#151E30' : 'transparent'}`;
    div.addEventListener('mouseenter', () => { if (!isActive) div.style.background = '#0C1220'; });
    div.addEventListener('mouseleave', () => { div.style.background = isActive ? '#151E30' : 'transparent'; });
    div.dataset.convId = conv.id;
    div.addEventListener('click', () => openConv(conv.id));

    // Avatar
    let avHtml;
    if (other?.avatar_url) {
      avHtml = `<img src="${_safeUrl(other.avatar_url)||''}" style="width:44px;height:44px;min-width:44px;border-radius:50%;object-fit:cover;flex-shrink:0">`;
    } else if (conv.type === 'group') {
      const gIcon = conv.avatar || UI.initials(name);
      const isEmoji = gIcon.length <= 2 && gIcon.codePointAt(0) > 127;
      avHtml = `<div style="width:44px;height:44px;min-width:44px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:${isEmoji?'22px':'14px'};font-weight:700;background:${color}22;color:${color};font-family:Syne,sans-serif;flex-shrink:0">${gIcon}</div>`;
    } else {
      avHtml = `<div style="width:44px;height:44px;min-width:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;background:${color}22;color:${color};font-family:Syne,sans-serif;flex-shrink:0">${UI.initials(name)}</div>`;
    }

    // Last message preview
    const lastText = (conv.last_msg || '').slice(0, 40).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
    let previewHtml = `<span style="font-size:12px;color:#7A8FA8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${lastText}</span>`;
    if (conv.type === 'group' && conv.last_from) {
      const senderName = conv.last_from === cu.username ? 'Sen' : (_allUsers[conv.last_from]?.display_name || conv.last_from);
      previewHtml = `<span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span style="color:#00FFB3;font-weight:600">${senderName}: </span><span style="color:#7A8FA8">${lastText}</span></span>`;
    }

    div.innerHTML = `${avHtml}
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
          <span style="font-weight:600;font-size:13px;font-family:Syne,sans-serif;color:#DDE8F8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;margin-right:4px">${name}</span>
          ${_pinnedSet.has(conv.id) ? '<span style="font-size:10px;color:#FFB830;margin-right:4px">📌</span>' : ''}
          <span style="font-size:10px;color:#7A8FA8;font-family:'JetBrains Mono',monospace;flex-shrink:0">${conv.last_time ? UI.fmtTime(conv.last_time) : ''}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          ${previewHtml}
          ${unread > 0 ? `<span style="min-width:20px;height:20px;padding:0 5px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;background:var(--accent,#00FFB3);color:#062B1F;flex-shrink:0;margin-left:6px">${unread > 99 ? '99+' : unread}</span>` : ''}
        </div>
      </div>`;
    frag.appendChild(div);
  });

  list.innerHTML = '';
  list.appendChild(frag);
}

// ── Open conversation ──────────────────────────────────────────────
async function openConv(convId) {
  if (!convId) return;
  window._currentConvId = convId;
  // Show loading state immediately
  const msgBox = document.getElementById('messages');
  if (msgBox) msgBox.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#3A4A5A;font-size:12px;font-family:monospace">Yükleniyor…</div>';
  document.getElementById('pin-banner')?.remove();

  let conv = _convs.find(c => c.id === convId);
  if (!conv) {
    try { conv = await DB.getConversation(convId); if (conv) _convs.push(conv); }
    catch(e) { console.warn('openConv getConversation:', e); }
  }
  if (!conv) { if (msgBox) msgBox.innerHTML = ''; return; }

  // Mark as read
  if ((conv.unread_for?.[window._currentUser.username] || 0) > 0) {
    conv.unread_for = { ...(conv.unread_for || {}), [window._currentUser.username]: 0 };
    DB.updateConversation(convId, { unread_for: conv.unread_for }).catch(console.warn);
  }

  window._isGroup = conv.type === 'group';
  const name = getConvName(conv);
  const color = getConvColor(conv);
  const other = conv.type === 'direct' ? _allUsers[conv.participants?.find(p => p !== window._currentUser.username)] : null;

  // Chat header avatar
  const avEl = document.getElementById('chat-avatar');
  if (avEl) {
    if (other?.avatar_url) {
      avEl.innerHTML = `<img src="${_safeUrl(other.avatar_url)||''}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    } else {
      avEl.style.background = `${color}22`;
      avEl.style.color = color;
      avEl.style.borderRadius = conv.type === 'group' ? '10px' : '50%';
      const gIcon = conv.type === 'group' ? (conv.avatar || UI.initials(name)) : UI.initials(name);
      avEl.style.fontSize = (conv.type === 'group' && gIcon.codePointAt(0) > 127) ? '22px' : '';
      avEl.textContent = gIcon;
    }
    avEl.style.cursor = 'pointer';
    avEl.onclick = () => conv.type === 'group' ? openGroupPanel(conv) : other && openUserProfile(other);
  }

  // Chat name + status
  const nameEl = document.getElementById('chat-name');
  if (nameEl) {
    nameEl.textContent = name;
    nameEl.style.cursor = 'pointer';
    nameEl.onclick = () => conv.type === 'group' ? openGroupPanel(conv) : other && openUserProfile(other);
  }

  const statusEl = document.getElementById('chat-status');
  if (statusEl) {
    if (conv.type === 'group') {
      statusEl.textContent = `${conv.participants?.length || 0} üye`;
      statusEl.style.color = '#7A8FA8';
    } else {
      // Refresh other user from _allUsers in case last_seen updated
      const freshOther = other ? (_allUsers[other.username] || other) : null;
      const st = UI.onlineStatus(freshOther);
      statusEl.textContent = st.text;
      statusEl.style.color = st.color;
    }
  }

  // Block button visibility
  const brBtn = document.getElementById('block-report-btn');
  if (brBtn) brBtn.style.display = conv.type === 'direct' ? 'flex' : 'none';

  // Komutlar butonu — sadece bot sohbetlerinde göster
  const cmdBtn = document.getElementById('compose-commands-btn');
  if (cmdBtn) {
    const isBot = _isBotConv(convId) || _isMathBotConv(convId);
    cmdBtn.style.display = isBot ? 'flex' : 'none';
  }

  // Show chat view
  document.getElementById('empty-state').style.display = 'none';
  const cv = document.getElementById('chat-view');
  cv.style.display = 'flex';
  cv.style.flexDirection = 'column';

  // Mobile: slide to chat
  if (window.innerWidth < 768) {
    document.getElementById('sidebar')?.classList.add('slide-out');
    document.getElementById('chat-area')?.classList.add('slide-in');
    const backBtn = document.getElementById('back-btn');
    if (backBtn) backBtn.style.display = 'flex';
  }

  Messages.subscribeConv(convId);
  await renderMessages();
  renderChatList(); // update active highlight
  Messages.closeAllPickers();
  setTimeout(() => document.getElementById('msg-input')?.focus(), 150);
}

// ── Render messages ────────────────────────────────────────────────
async function renderMessages(highlight = '') {
  if (!window._currentConvId) return;
  try {
    await Messages.renderAll(window._currentConvId, _allUsers, highlight);
  } catch(e) { console.warn('renderMessages:', e); }
}

// ── Navigation ─────────────────────────────────────────────────────
function backToSidebar() {
  document.getElementById('sidebar')?.classList.remove('slide-out');
  document.getElementById('chat-area')?.classList.remove('slide-in');
  const backBtn = document.getElementById('back-btn');
  if (backBtn) backBtn.style.display = 'none';
  Messages.closeAllPickers();
  Messages.stopVoice(); // stop any active recording
  if (window._pollInterval) { clearInterval(window._pollInterval); window._pollInterval = null; }
}

async function sendMessage() {
  if (!window._currentConvId) return;
  // Offline: queue to outbox
  if (!navigator.onLine && CONFIG.USE_SUPABASE) {
    const input = document.getElementById('msg-input');
    const text = (input?.value || '').trim();
    if (text) {
      outboxAdd(window._currentConvId, text);
      if (input) { input.value = ''; Messages.autoResize(input); }
      return;
    }
  }
  const dtEl = document.getElementById('schedule-dt');
  if (dtEl?.value) {
    const sendAt = new Date(dtEl.value).getTime();
    if (sendAt > Date.now()) {
      const input = document.getElementById('msg-input');
      const text = (input?.value || '').trim();
      if (!text) return;
      const q = JSON.parse(localStorage.getItem('cipher_scheduled') || '[]');
      q.push({ convId: window._currentConvId, text, sendAt, id: 'sc_' + Date.now() });
      localStorage.setItem('cipher_scheduled', JSON.stringify(q));
      if (input) { input.value = ''; Messages.autoResize(input); }
      clearScheduler();
      const _dt = new Date(sendAt);
      const _dtStr = isNaN(_dt.getTime()) ? 'belirlenen saatte' : _dt.toLocaleString('tr-TR');
      UI.toast(`⏰ ${_dtStr} gönderilecek`, 'info', 4000);
      return;
    }
  }
  // Bot komutu mu? Sadece cipher_bot veya mathbot sohbetinde yakala
  if (_isBotConv(window._currentConvId) || _isMathBotConv(window._currentConvId)) {
    const input = document.getElementById('msg-input');
    const rawText = (input?.value || '').trim();
    if (rawText.startsWith('/') || _isMathBotConv(window._currentConvId)) {
      // Kullanıcının mesajını önce gönder, sonra bot cevaplasın
      await Messages.send(window._currentConvId);
      if (_isBotConv(window._currentConvId)) {
        await handleBotCommand(window._currentConvId, rawText);
      } else {
        await handleMathBotCommand(window._currentConvId, rawText);
      }
      return;
    }
  }

  // @mention tespiti — grup sohbetlerinde
  const _input = document.getElementById('msg-input');
  const _msgText = (_input?.value || '').trim();
  if (_msgText) _checkMentions(window._currentConvId, _msgText);

  // Mesaj filtresi
  if (_msgText && _isSensitiveMessage(_msgText)) {
    const input = document.getElementById('msg-input');
    if (input) { input.value = ''; Messages.autoResize(input); }
    await _sendSensitiveMessage(window._currentConvId, _msgText);
    return;
  }

  await Messages.send(window._currentConvId);
}


function _updateMsgCounter(input) {
  const len = (input.value||'').length;
  let counter = document.getElementById('msg-counter');
  if (!counter) {
    counter = document.createElement('span');
    counter.id = 'msg-counter';
    counter.style.cssText = "position:absolute;bottom:6px;right:48px;font-size:10px;font-family:'JetBrains Mono',monospace;color:#3A4A5A;pointer-events:none;transition:color .2s";
    input.parentElement?.appendChild(counter);
  }
  if (len > 3500) {
    counter.textContent = (4000 - len) + ' kaldı';
    counter.style.color = len > 3900 ? '#FF3D6B' : '#FFA535';
    counter.style.display = 'block';
  } else {
    counter.style.display = 'none';
  }
}
function handleMsgKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  if (e.key === 'Escape') Messages.closeAllPickers();
}

// ── User Profile Modal ──────────────────────────────────────────────
function openUserProfile(user) {
  if (!user) return;
  const color = UI.avatarColor(user.username);
  const banner = user.banner_color || '#0A1628';
  const st = UI.onlineStatus(user);
  const badges = (user.badges || []).map(b => {
    const bd = CONFIG.BADGES[b];
    return bd ? `<span style="background:${bd.color}22;border:1px solid ${bd.color}44;color:${bd.color};padding:3px 10px;border-radius:20px;font-size:11px">${bd.icon} ${bd.label}</span>` : '';
  }).filter(Boolean).join('');

  const avHtml = user.avatar_url
    ? `<img src="${user.avatar_url}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid #0C1220">`
    : `<div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,${color},${color}99);color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;font-family:Syne,sans-serif;font-weight:700;border:3px solid #0C1220">${UI.initials(user.display_name || user.username)}</div>`;

  const el = document.getElementById('user-profile-content');
  if (!el) return;

  el.innerHTML = `
    <div style="height:90px;background:${banner};border-radius:20px 20px 0 0;position:relative;flex-shrink:0">
      <div style="position:absolute;bottom:-40px;left:20px">${avHtml}</div>
      ${user.is_admin ? '<span style="position:absolute;top:10px;right:46px;font-size:10px;padding:2px 8px;border-radius:20px;background:#FFD70022;color:#FFD700;border:1px solid #FFD70044">⚡ ADMİN</span>' : ''}
    </div>
    <div style="padding:48px 20px 20px">
      <div style="font-family:Syne,sans-serif;font-weight:700;font-size:20px;color:#DDE8F8">${user.display_name || user.username}</div>
      <div style="font-size:11px;color:#7A8FA8;font-family:'JetBrains Mono',monospace;margin-bottom:4px">@${user.username}</div>
      <div style="font-size:12px;color:${st.color};margin-bottom:${user.status ? '6px' : '10px'}">${st.text}</div>
      ${user.status ? `<div style="font-size:13px;color:#B0C4D8;margin-bottom:10px">${user.status_emoji || ''} ${user.status}</div>` : ''}
      ${user.bio ? `<div style="font-size:13px;color:#9AB0C8;line-height:1.6;margin-bottom:12px;padding:10px 12px;background:#06080F;border-radius:10px;border:1px solid #1E2D45">${(user.bio||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>` : ''}
      ${badges ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">${badges}</div>` : ''}
      <div style="font-size:10px;color:#7A8FA8;font-family:'JetBrains Mono',monospace;margin-bottom:3px">ÜYE OLDU</div>
      <div style="font-size:12px;color:#DDE8F8;margin-bottom:16px">${user.created_at ? UI.fmtDate(user.created_at) : ''}</div>
      <div style="display:flex;gap:8px">
        <button id="profile-dm-btn" style="flex:1;padding:11px;border-radius:12px;background:linear-gradient(135deg,#00FFB3,#00C48A);color:#062B1F;font-weight:700;font-size:14px;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent">💬 Mesaj Gönder</button>
        <button id="profile-more-btn" style="padding:11px 14px;border-radius:12px;background:#131D30;color:#7A8FA8;border:1px solid #1E2D45;cursor:pointer;-webkit-tap-highlight-color:transparent">⋯</button>
      </div>
    </div>`;

  document.getElementById('profile-dm-btn').onclick = () => { UI.closeModal('user-profile-modal'); startDM(user.username); };
  document.getElementById('profile-more-btn').onclick = () => { window._brTarget = user.username; UI.closeModal('user-profile-modal'); UI.openModal('block-report-modal'); };
  UI.openModal('user-profile-modal');
}

window.showProfile = username => { const u = _allUsers[username]; if (u) openUserProfile(u); };

// ── Group Panel ─────────────────────────────────────────────────────
function openGroupPanel(conv) {
  if (!conv) return;
  const el = document.getElementById('group-panel-content');
  if (!el) return;
  const color = getConvColor(conv);
  const isAdmin = conv.admin === window._currentUser.username || window._currentUser.is_admin;

  el.innerHTML = `
    <div style="text-align:center;padding-bottom:16px;border-bottom:1px solid #1E2D45;margin-bottom:16px">
      <div style="width:64px;height:64px;border-radius:50%;background:${color}22;color:${color};display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;font-family:Syne,sans-serif;margin:0 auto 10px">${conv.avatar || UI.initials(conv.name)}</div>
      ${isAdmin
        ? `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;margin-bottom:6px">
            <button onclick="openGroupIconEdit('${conv.id}')" style="font-size:28px;background:rgba(0,0,0,.2);border:1.5px dashed #1E2D45;border-radius:14px;width:52px;height:52px;cursor:pointer;transition:border-color .2s" title="İkon değiştir" onmouseenter="this.style.borderColor='#00FFB3'" onmouseleave="this.style.borderColor='#1E2D45'">${conv.avatar || UI.initials(conv.name)}</button>
            <div style="display:flex;align-items:center;gap:8px">
              <input id="gp-name-inp" value="${conv.name || ''}" style="background:#06080F;border:1.5px solid #1E2D45;border-radius:8px;padding:5px 10px;font-size:14px;font-weight:700;color:#DDE8F8;font-family:Syne,sans-serif;text-align:center;outline:none;max-width:160px" onfocus="this.style.borderColor='#00FFB3'" onblur="this.style.borderColor='#1E2D45'">
              <button id="gp-save-btn" style="padding:6px 12px;border-radius:8px;background:#00FFB3;color:#062B1F;font-weight:700;font-size:12px;border:none;cursor:pointer">Kaydet</button>
            </div>
          </div>`
        : `<div style="font-family:Syne,sans-serif;font-weight:700;font-size:17px;color:#DDE8F8;margin-bottom:4px">${conv.name}</div>`}
      <div style="font-size:12px;color:#7A8FA8">${conv.participants?.length || 0} üye</div>
    </div>
    ${isAdmin ? '<div style="margin-bottom:12px"><button id="gp-add-btn" style="width:100%;padding:10px;border-radius:10px;background:#131D30;color:#00FFB3;border:1px solid rgba(0,255,179,.2);font-size:13px;cursor:pointer;font-family:\'JetBrains Mono\',monospace">+ Üye Ekle</button></div>' : ''}
    <div style="font-size:10px;font-weight:600;color:#7A8FA8;font-family:\'JetBrains Mono\',monospace;margin-bottom:8px">ÜYELER</div>`;

  const saveBtn = document.getElementById('gp-save-btn');
  if (saveBtn) saveBtn.onclick = () => saveGroupName(conv.id);
  const addBtn = document.getElementById('gp-add-btn');
  if (addBtn) addBtn.onclick = () => openAddMemberModal(conv.id);

  const membersDiv = document.createElement('div');
  membersDiv.style.cssText = 'display:flex;flex-direction:column;gap:2px';
  (conv.participants || []).forEach(uid => {
    const u = _allUsers[uid] || { username: uid, display_name: uid };
    const c = UI.avatarColor(u.username);
    const isOwner = conv.admin === uid;
    const av = u.avatar_url
      ? `<img src="${_safeUrl(u.avatar_url)||''}" style="width:38px;height:38px;border-radius:50%;object-fit:cover">`
      : `<div style="width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;background:${c}22;color:${c};font-family:Syne,sans-serif">${UI.initials(u.display_name || u.username)}</div>`;

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px;border-radius:10px;cursor:pointer;transition:background .12s';
    row.onmouseenter = () => row.style.background = '#131D30';
    row.onmouseleave = () => row.style.background = 'transparent';
    row.onclick = () => { const usr = _allUsers[uid]; if (usr) openUserProfile(usr); };
    row.innerHTML = `${av}
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:#DDE8F8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(u.display_name||u.username)}</div>
        <div style="font-size:10px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">@${uid}${isOwner ? ' · Yönetici ⚡' : ''}</div>
      </div>`;

    if (isAdmin && uid !== window._currentUser.username) {
      const btn = document.createElement('button');
      btn.style.cssText = 'font-size:11px;padding:4px 8px;border-radius:7px;background:#131D30;color:#FF3D6B;border:1px solid rgba(255,61,107,.3);cursor:pointer;flex-shrink:0';
      btn.textContent = 'Çıkar';
      btn.onclick = e => { e.stopPropagation(); removeFromGroup(conv.id, uid); };
      row.appendChild(btn);
    }
    membersDiv.appendChild(row);
  });
  el.appendChild(membersDiv);

  const footer = document.createElement('div');
  footer.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid #1E2D45';
  const leaveBtn = document.createElement('button');
  leaveBtn.style.cssText = 'width:100%;padding:10px;border-radius:10px;background:rgba(255,61,107,.08);color:#FF3D6B;border:1px solid rgba(255,61,107,.2);font-size:13px;cursor:pointer';
  leaveBtn.textContent = 'Gruptan Çık';
  leaveBtn.onclick = () => leaveGroup(conv.id);
  footer.appendChild(leaveBtn);
  el.appendChild(footer);

  UI.openModal('group-panel-modal');
}

async function saveGroupName(convId) {
  const name = document.getElementById('gp-name-inp')?.value.trim();
  if (!name) return;
  try {
    await DB.updateConversation(convId, { name });
    const conv = _convs.find(c => c.id === convId);
    if (conv) conv.name = name;
    renderChatList();
    const nameEl = document.getElementById('chat-name');
    if (nameEl) nameEl.textContent = name;
    UI.toast('Grup adı güncellendi ✓', 'success');
  } catch(e) { UI.toast('Güncellenemedi: ' + e.message, 'error'); }
}

function openAddMemberModal(convId) {
  const conv = _convs.find(c => c.id === convId);
  if (!conv) return;
  const cu = window._currentUser;
  const existing = new Set(conv.participants);
  const gc = document.getElementById('add-member-list');
  if (!gc) return;
  gc.innerHTML = '';

  // Sadece: grupta olmayan + aktif sunucuda olan + daha önce konuşulmuş
  const chattedSet = new Set(
    _convs.filter(c => c.type === 'direct')
      .map(c => c.participants?.find(p => p !== cu.username))
      .filter(Boolean)
  );

  const candidates = Object.values(_allUsers).filter(u => {
    if (u.username === cu.username) return false;          // kendim değil
    if (existing.has(u.username)) return false;            // zaten grupta değil
    if (!chattedSet.has(u.username) && !cu.is_admin) return false; // daha önce konuşulmuş olmalı
    // Sunucu filtresi
    if (cu.is_admin || u.is_admin) return true;
    const myRolesLoaded = cu.server_roles && Object.keys(cu.server_roles).length > 0;
    if (!myRolesLoaded) return true;
    const convServer = conv.server;
    if (convServer && convServer !== 'all') {
      return hasServerAccess(u, convServer);
    }
    const myS = Object.keys(CONFIG.SERVERS).filter(s => hasServerAccess(cu, s));
    const thS = Object.keys(CONFIG.SERVERS).filter(s => hasServerAccess(u, s));
    return myS.some(s => thS.includes(s));
  });

  if (!candidates.length) {
    gc.innerHTML = '<div style="text-align:center;padding:20px;color:#7A8FA8;font-size:13px">Eklenebilecek kullanıcı yok</div>';
  }
  candidates.forEach(u => {
    const c = UI.avatarColor(u.username);
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;cursor:pointer;transition:background .12s';
    div.onmouseenter = () => div.style.background = '#131D30';
    div.onmouseleave = () => div.style.background = 'transparent';
    div.innerHTML = `<input type="checkbox" value="${u.username}" style="width:16px;height:16px;accent-color:#00FFB3;flex-shrink:0">
      <div style="width:32px;height:32px;min-width:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:${c}22;color:${c};font-family:Syne,sans-serif">${UI.initials(u.display_name || u.username)}</div>
      <div><div style="font-size:13px;color:#DDE8F8">${_esc(u.display_name||u.username)}</div><div style="font-size:11px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">@${_esc(u.username)}</div></div>`;
    div.onclick = e => { if (e.target.tagName !== 'INPUT') div.querySelector('input').click(); };
    gc.appendChild(div);
  });
  document.getElementById('add-member-conv-id').value = convId;
  UI.closeModal('group-panel-modal');
  UI.openModal('add-member-modal');
}

async function confirmAddMembers() {
  const convId = document.getElementById('add-member-conv-id').value;
  const selected = Array.from(document.querySelectorAll('#add-member-list input:checked')).map(i => i.value);
  if (!selected.length) { UI.toast('Üye seçin', 'error'); return; }
  try {
    const conv = await DB.getConversation(convId);
    if (!conv) return;
    const newParticipants = [...new Set([...conv.participants, ...selected])];
    await DB.updateConversation(convId, { participants: newParticipants });
    const local = _convs.find(c => c.id === convId);
    if (local) local.participants = newParticipants;
    UI.closeModal('add-member-modal');
    UI.toast(`${selected.length} üye eklendi ✓`, 'success');
    openGroupPanel({ ...conv, participants: newParticipants });
  } catch(e) { UI.toast('Üye eklenemedi: ' + e.message, 'error'); }
}

async function removeFromGroup(convId, username) {
  if (!confirm(`@${username} gruptan çıkarılsın mı?`)) return;
  try {
    const conv = await DB.getConversation(convId);
    if (!conv) return;
    const participants = conv.participants.filter(p => p !== username);
    await DB.updateConversation(convId, { participants });
    const local = _convs.find(c => c.id === convId);
    if (local) local.participants = participants;
    UI.toast(`@${username} çıkarıldı`, 'info');
    UI.closeModal('group-panel-modal');
  } catch(e) { UI.toast('Çıkarılamadı: ' + e.message, 'error'); }
}

async function leaveGroup(convId) {
  if (!confirm('Gruptan çıkmak istediğinizden emin misiniz?')) return;
  try {
    const conv = await DB.getConversation(convId);
    if (!conv) return;
    const participants = conv.participants.filter(p => p !== window._currentUser.username);
    await DB.updateConversation(convId, { participants });
    _convs = _convs.filter(c => c.id !== convId);
    window._currentConvId = null;
    document.getElementById('chat-view').style.display = 'none';
    document.getElementById('empty-state').style.display = 'flex';
    UI.closeModal('group-panel-modal');
    renderChatList();
  UI.toast('Gruptan çıkıldı', 'info');
}

// ── Contacts tab ────────────────────────────────────────────────────
function renderContactsList(searchQ) {
  const list = document.getElementById('contacts-tab-list');
  if (!list) return;
  const cu = window._currentUser;
  if (!cu) return;

  let users = Object.values(_allUsers).filter(u => u.username !== cu.username);

  // Server filter — pre-compute my servers once
  const _myServers = Object.keys(CONFIG.SERVERS).filter(s => hasServerAccess(cu, s));
  const _myRolesLoaded = cu.server_roles && Object.keys(cu.server_roles).length > 0;
  users = users.filter(u => {
    if (cu.is_admin || u.is_admin) return true;
    if (!_myRolesLoaded) return true; // roles not loaded yet → show all
    if (_activeServer && _activeServer !== 'all') {
      return hasServerAccess(cu, _activeServer) && hasServerAccess(u, _activeServer);
    }
    return _myServers.some(s => hasServerAccess(u, s));
  });

  // Search filter
  const q = (searchQ || document.getElementById('contact-search-input')?.value || '').toLowerCase().trim();
  if (q) {
    users = users.filter(u =>
      (u.display_name || '').toLocaleLowerCase('tr-TR').includes(q) ||
      u.username.toLocaleLowerCase('tr-TR').includes(q) ||
      (u.bio || '').toLocaleLowerCase('tr-TR').includes(q)
    );
  }

  users.sort((a, b) => (a.display_name || a.username).localeCompare(b.display_name || b.username, 'tr'));

  if (!users.length) {
    list.innerHTML = `<div style="text-align:center;padding:32px;color:#7A8FA8;font-size:13px">${q ? `"${q}" için sonuç yok` : 'Henüz kullanıcı yok'}</div>`;
    return;
  }

  const chattedSet = new Set(_convs.filter(c=>c.type==='direct').map(c=>c.participants?.find(p=>p!==cu.username)).filter(Boolean));
  const frag = document.createDocumentFragment();

  users.forEach(u => {
    const color = UI.avatarColor(u.username);
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:13px;cursor:pointer;margin:1px 5px;transition:background .12s';
    div.onmouseenter = () => div.style.background = '#0C1220';
    div.onmouseleave = () => div.style.background = 'transparent';

    // Çift avatar: önce avatar_url (fotoğraf/avatar maker), yanında initials
    // avatar_url varsa öncelikli göster; yoksa renkli initials
    const avMain = u.avatar_url
      ? `<div style="width:44px;height:44px;min-width:44px;border-radius:50%;overflow:hidden;flex-shrink:0;border:2px solid #1E2D45"><img src="${_safeUrl(u.avatar_url)||''}" style="width:100%;height:100%;object-fit:cover;display:block"></div>`
      : `<div style="width:44px;height:44px;min-width:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;background:${color}22;color:${color};font-family:Syne,sans-serif;flex-shrink:0;border:2px solid ${color}33">${UI.initials(u.display_name || u.username)}</div>`;
    // Küçük initials badge (her zaman sağ alta)
    const avBadge = `<div style="position:absolute;bottom:-2px;right:-2px;width:18px;height:18px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:700;color:#fff;border:2px solid #0C1220;font-family:Syne,sans-serif">${UI.initials(u.display_name||u.username).slice(0,1)}</div>`;
    const av = `<div style="position:relative;flex-shrink:0">${avMain}${u.avatar_url ? avBadge : ''}</div>`;

    const st = UI.onlineStatus(u);

    // Server role badges
    let serverBadges = '';
    if (u.server_roles && typeof u.server_roles === 'object') {
      const activeSrvs = Object.entries(CONFIG.SERVERS)
        .filter(([id]) => u.server_roles[id])
        .map(([,srv]) => `<span style="font-size:10px" title="${srv.label}">${srv.icon}</span>`);
      if (activeSrvs.length) serverBadges = `<div style="display:flex;gap:2px;margin-top:2px">${activeSrvs.join('')}</div>`;
    }

    div.innerHTML = `${av}
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:#DDE8F8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(u.display_name||u.username)}</div>
        <div style="font-size:11px;color:${st.color}">${st.text}</div>
        ${serverBadges}
      </div>
      <button data-uid="${u.username}" class="contact-msg-btn" style="padding:6px 12px;border-radius:8px;background:#131D30;color:var(--accent,#00FFB3);border:1px solid rgba(0,255,179,.2);font-size:12px;cursor:pointer;flex-shrink:0;-webkit-tap-highlight-color:transparent;font-weight:600">Mesaj</button>`;

    div.querySelector('.contact-msg-btn').addEventListener('click', e => {
      e.stopPropagation();
      setTab('messages');
      startDM(u.username);
    });
    div.onclick = () => openUserProfile(u);
    frag.appendChild(div);
  });

  list.innerHTML = '';
  list.appendChild(frag);

  // Update count badge
  const countEl = document.getElementById('contacts-count');
  if (countEl) countEl.textContent = users.length > 0 ? users.length + ' kullanıcı' : '';
}

// ── Updates tab ─────────────────────────────────────────────────────
function renderUpdatesTab() {
  const el = document.getElementById('updates-tab-content');
  if (!el || el._rendered) return;
  el._rendered = true;

  const updates = [
    { v:'6.0.0', badge:'YENİ', color:'#00FFB3', items:['🔧 Debug & optimizasyon güncellemesi','📊 Debounced render — daha az CPU','🧹 Hata yakalama iyileştirildi','👥 Sunucu filtresi — kullanıcılar sunucuya göre','📱 Kişiler sekmesi — online durum göstergesi','🗑 Şifre sıfırlama kaldırıldı','📌 Sol menü gizlendi (kod korundu)'] },
    { v:'5.0.0', badge:'', color:'#7A8FA8', items:['🌐 Supabase çok cihaz desteği','📝 Kayıt sistemi fallback ile','🔔 Cihaz push bildirimleri','⌚ Online durum & süre takibi','🏠 4 sunucu sistemi','✏️ Ad değiştirme'] },
    { v:'4.0.0', badge:'', color:'#7A8FA8', items:['👤 Profil modal','👥 Grup yönetim paneli','📋 Kişiler sekmesi','💬 Alt navigasyon (3 sekme)','🔍 Filtreler üstte'] },
  ];

  el.innerHTML = `<div style="padding:16px">
    <div style="text-align:center;margin-bottom:20px">
      <div style="font-size:32px;margin-bottom:8px">🔐</div>
      <div style="font-family:Syne,sans-serif;font-weight:700;font-size:16px;color:#DDE8F8">CIPHER ${CONFIG.APP_VERSION}</div>
      <div style="font-size:12px;color:#7A8FA8">Güncelleme Notları</div>
    </div>
    ${updates.map(r => `
      <div style="margin-bottom:14px;padding:14px;border-radius:14px;background:#06080F;border:1px solid #1E2D45">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span style="font-family:Syne,sans-serif;font-weight:700;font-size:14px;color:#DDE8F8">v${r.v}</span>
          ${r.badge ? `<span style="font-size:9px;padding:2px 7px;border-radius:20px;background:${r.color}22;color:${r.color};border:1px solid ${r.color}44;font-family:'JetBrains Mono',monospace">${r.badge}</span>` : ''}
        </div>
        ${r.items.map(i => `<div style="font-size:12px;color:#9AB0C8;padding:2px 0">${i}</div>`).join('')}
      </div>`).join('')}
  </div>`;
}

// ── Stories ─────────────────────────────────────────────────────────
async function renderStories() {
  const strip = document.getElementById('stories-strip');
  if (!strip) return;
  const cu = window._currentUser;
  const stories = await DB.getStories().catch(() => []);
  // Skip re-render if stories unchanged (compare count + ids)
  const newHash = stories.map(s=>s.id).join(',') + (cu?.username||'');
  if (strip._lastHash === newHash) return;
  strip._lastHash = newHash;
  strip.innerHTML = '';

  // My button
  const myBtn = document.createElement('div');
  myBtn.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;flex-shrink:0';
  const myC = UI.avatarColor(cu.username);
  const myAv = cu.avatar_url ? `<img src="${cu.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : `<span style="font-weight:700;font-size:11px;color:#fff;font-family:Syne,sans-serif">${UI.initials(cu.display_name || cu.username)}</span>`;
  myBtn.innerHTML = `<div style="width:48px;height:48px;border-radius:50%;background:${myC};display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden">${myAv}<div style="position:absolute;bottom:0;right:0;width:16px;height:16px;border-radius:50%;background:#00FFB3;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#062B1F;border:2px solid #06080F">+</div></div><span style="font-size:10px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">Sen</span>`;
  myBtn.onclick = addStory;
  strip.appendChild(myBtn);

  const byUser = {};
  stories.forEach(s => { (byUser[s.user_id] = byUser[s.user_id] || []).push(s); });

  Object.entries(byUser).forEach(([uid, sts]) => {
    const u = _allUsers[uid]; if (!u) return;
    const uc = UI.avatarColor(u.username);
    const seen = sts.every(s => s.seen_by?.includes(cu.username));
    const uAv = u.avatar_url ? `<img src="${_safeUrl(u.avatar_url)||''}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : `<span style="font-weight:700;font-size:11px;color:#fff;font-family:Syne,sans-serif">${UI.initials(u.display_name || u.username)}</span>`;
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;flex-shrink:0';
    div.innerHTML = `<div class="${seen ? 'story-ring-seen' : 'story-ring'}" style="width:52px;height:52px;border-radius:50%"><div style="width:100%;height:100%;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:${uc}22">${uAv}</div></div><span style="font-size:10px;color:${seen?'#7A8FA8':'#DDE8F8'};max-width:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:'JetBrains Mono',monospace">${(u.display_name||u.username).split(' ')[0]}</span>`;
    div.onclick = () => {
      UI.showStory(sts[0], u);
      // Mark as seen
      const cu = window._currentUser;
      if (sts[0] && !sts[0].seen_by?.includes(cu?.username)) {
        const seen = [...(sts[0].seen_by||[]), cu.username];
        DB.updateStory?.(sts[0].id, { seen_by: seen }).catch(()=>{});
        sts[0].seen_by = seen;
        setTimeout(() => renderStories().catch(()=>{}), 500);
      }
    };
    strip.appendChild(div);
  });
}

async function addStory() {
  const text = prompt('Hikayeni yaz (maks 200 karakter):');
  if (!text?.trim()) return;
  try {
    await DB.createStory({ user_id: window._currentUser.username, text: text.trim().slice(0, 200), seen_by: [] });
    await renderStories();
    UI.toast('Hikaye paylaşıldı! 📖', 'success');
  } catch(e) { UI.toast('Hata: ' + e.message, 'error'); }
}

// ── New DM / Start DM ───────────────────────────────────────────────
function openNewChat() {
  const list = document.getElementById('contacts-list');
  if (!list) return;
  const cu = window._currentUser;
  let users = Object.values(_allUsers).filter(u => u.username !== cu.username);
  // Aktif sunucuya göre filtrele — sadece aynı sunucudaki kullanıcılar
  users = users.filter(u => {
    if (cu.is_admin || u.is_admin) return true;
    const myRolesLoaded = cu.server_roles && Object.keys(cu.server_roles).length > 0;
    if (!myRolesLoaded) return true;
    if (_activeServer && _activeServer !== 'all') {
      // Aktif sunucu seçiliyse: her iki taraf da o sunucuda olmalı
      return hasServerAccess(cu, _activeServer) && hasServerAccess(u, _activeServer);
    }
    // "Tümü" görünümündeyse: ortak en az 1 sunucu olmalı
    const myS = Object.keys(CONFIG.SERVERS).filter(s => hasServerAccess(cu, s));
    const thS = Object.keys(CONFIG.SERVERS).filter(s => hasServerAccess(u, s));
    return myS.some(s => thS.includes(s));
  });
  users.sort((a,b) => (a.display_name||a.username).localeCompare(b.display_name||b.username,'tr'));

  const frag = document.createDocumentFragment();
  users.forEach(u => {
    const c = UI.avatarColor(u.username);
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:12px;cursor:pointer;transition:background .12s';
    div.onmouseenter = () => div.style.background = '#131D30';
    div.onmouseleave = () => div.style.background = 'transparent';
    const av = u.avatar_url ? `<img src="${_safeUrl(u.avatar_url)||''}" style="width:36px;height:36px;min-width:36px;border-radius:50%;object-fit:cover">` : `<div style="width:36px;height:36px;min-width:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;background:${c}22;color:${c};font-family:Syne,sans-serif">${UI.initials(u.display_name||u.username)}</div>`;
    div.innerHTML = `${av}<div style="min-width:0"><div style="font-size:13px;font-weight:500;color:#DDE8F8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(u.display_name||u.username)}</div><div style="font-size:11px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">@${_esc(u.username)}</div></div>`;
    div.onclick = () => { UI.closeModal('new-chat-modal'); startDM(u.username); };
    frag.appendChild(div);
  });
  list.innerHTML = '';
  list.appendChild(frag);
  UI.openModal('new-chat-modal');
}

async function startDM(userId) {
  const ids = [window._currentUser.username, userId].sort();
  const convId = ids.join('_');
  let conv = _convs.find(c => c.id === convId);
  if (!conv) {
    try {
      conv = await DB.createConversation({ id: convId, type: 'direct', participants: ids, last_msg: '', last_time: Date.now(), unread_for: {}, server: _activeServer !== 'all' ? _activeServer : 'public' });
      _convs.push(conv);
    } catch(e) { UI.toast('Sohbet oluşturulamadı: ' + e.message, 'error'); return; }
  }
  if (_activeTab !== 'messages') setTab('messages');
  renderChatList();
  await openConv(convId);
}

// ── Group create ─────────────────────────────────────────────────────
// ── Grup İkon Seçici ─────────────────────────────────────────────
let _selectedGroupIcon = '👥';

function openGroupIconPicker() {
  const panel = document.getElementById('group-icon-panel');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) _renderGroupIconGrid('group-icon-grid', _selectedGroupIcon, (icon) => {
    _selectedGroupIcon = icon;
    const btn = document.getElementById('group-icon-btn');
    if (btn) btn.textContent = icon;
    panel.style.display = 'none';
  });
}

function _renderGroupIconGrid(gridId, selected, onSelect) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  (CONFIG.GROUP_ICONS || []).forEach(icon => {
    const btn = document.createElement('button');
    const isActive = icon === selected;
    btn.textContent = icon;
    btn.style.cssText = `width:36px;height:36px;border-radius:8px;font-size:18px;cursor:pointer;border:2px solid ${isActive ? 'var(--accent,#00FFB3)' : 'transparent'};background:${isActive ? 'rgba(0,255,179,.1)' : 'transparent'};transition:all .12s;-webkit-tap-highlight-color:transparent`;
    btn.onmouseenter = () => { if (icon !== selected) btn.style.background = '#131D30'; };
    btn.onmouseleave = () => { if (icon !== selected) btn.style.background = 'transparent'; };
    btn.onclick = () => onSelect(icon);
    frag.appendChild(btn);
  });
  grid.appendChild(frag);
}

// ── Grup panelinde ikon değiştirme ───────────────────────────────
function openGroupIconEdit(convId) {
  const conv = _convs.find(c => c.id === convId);
  if (!conv) return;
  let modal = document.getElementById('group-icon-edit-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'group-icon-edit-modal';
    modal.className = 'fixed inset-0 z-50 hidden items-center justify-center';
    modal.style.background = 'rgba(6,8,15,.92)';
    modal.innerHTML = `<div style="width:100%;max-width:340px;margin:0 12px;background:#0C1220;border:1px solid #1E2D45;border-radius:18px;overflow:hidden;animation:slideUp .2s ease-out">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #1E2D45">
        <span style="font-family:Syne,sans-serif;font-weight:700;color:#DDE8F8">Grup İkonu</span>
        <button onclick="UI.closeModal('group-icon-edit-modal')" style="color:#7A8FA8;background:transparent;border:none;cursor:pointer;font-size:18px">✕</button>
      </div>
      <div style="padding:14px">
        <div id="group-icon-edit-grid" style="display:flex;flex-wrap:wrap;gap:6px"></div>
        <button id="group-icon-save-btn" style="width:100%;margin-top:14px;padding:11px;border-radius:12px;background:linear-gradient(135deg,#00FFB3,#00C48A);color:#062B1F;font-weight:700;font-size:14px;cursor:pointer;border:none;font-family:Syne,sans-serif">Kaydet</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
  }

  let _editIcon = conv.avatar || '👥';
  const _refreshEditGrid = (icon) => {
    _editIcon = icon;
    _renderGroupIconGrid('group-icon-edit-grid', _editIcon, _refreshEditGrid);
  };
  _renderGroupIconGrid('group-icon-edit-grid', _editIcon, _refreshEditGrid);

  document.getElementById('group-icon-save-btn').onclick = async () => {
    await DB.updateConversation(convId, { avatar: _editIcon });
    const local = _convs.find(c => c.id === convId);
    if (local) local.avatar = _editIcon;
    UI.closeModal('group-icon-edit-modal');
    // Update chat header
    const avEl = document.getElementById('chat-avatar');
    if (avEl && window._currentConvId === convId) avEl.textContent = _editIcon;
    renderChatList();
    UI.toast('İkon güncellendi ✓', 'success');
  };

  UI.openModal('group-icon-edit-modal');
}

function openGroupCreate() {
  // Reset icon selection
  _selectedGroupIcon = '👥';
  const iconBtn = document.getElementById('group-icon-btn');
  if (iconBtn) iconBtn.textContent = '👥';
  const iconPanel = document.getElementById('group-icon-panel');
  if (iconPanel) iconPanel.style.display = 'none';
  const gc = document.getElementById('group-contacts');
  if (!gc) return;
  gc.innerHTML = '';
  const cu = window._currentUser;

  // Sadece daha önce konuşulan + aktif sunucuda olan kullanıcılar
  const chattedUsernames = [...new Set(
    _convs.filter(c => c.type === 'direct')
      .map(c => c.participants?.find(p => p !== cu.username))
      .filter(Boolean)
  )];

  const myRolesLoaded = cu.server_roles && Object.keys(cu.server_roles).length > 0;
  const targetServer = _activeServer !== 'all' ? _activeServer : null;

  const eligible = chattedUsernames
    .map(un => _allUsers[un])
    .filter(Boolean)
    .filter(u => {
      if (cu.is_admin || u.is_admin) return true;
      if (!myRolesLoaded) return true;
      if (targetServer) return hasServerAccess(u, targetServer);
      const myS = Object.keys(CONFIG.SERVERS).filter(s => hasServerAccess(cu, s));
      const thS = Object.keys(CONFIG.SERVERS).filter(s => hasServerAccess(u, s));
      return myS.some(s => thS.includes(s));
    });

  if (!eligible.length) {
    gc.innerHTML = '<div style="text-align:center;padding:20px;font-size:12px;color:#7A8FA8">Önce bu sunucudaki biriyle mesajlaşın</div>';
    UI.openModal('group-modal'); return;
  }
  eligible
    .sort((a,b) => (a.display_name||a.username).localeCompare(b.display_name||b.username,'tr'))
    .forEach(u => {
      const c = UI.avatarColor(u.username);
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;cursor:pointer;transition:background .12s';
      div.onmouseenter = () => div.style.background = '#131D30';
      div.onmouseleave = () => div.style.background = 'transparent';
      div.innerHTML = `<input type="checkbox" value="${u.username}" style="width:16px;height:16px;accent-color:#00FFB3;flex-shrink:0">
        <div style="width:32px;height:32px;min-width:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:${c}22;color:${c};font-family:Syne,sans-serif">${UI.initials(u.display_name||u.username)}</div>
        <span style="font-size:13px;color:#DDE8F8">${_esc(u.display_name||u.username)}</span>`;
      div.onclick = e => { if (e.target.tagName !== 'INPUT') div.querySelector('input').click(); };
      gc.appendChild(div);
    });
  UI.openModal('group-modal');
}

async function createGroup() {
  const name = document.getElementById('group-name')?.value.trim();
  if (!name) { UI.toast('Grup adı girin', 'error'); return; }
  const selected = Array.from(document.querySelectorAll('#group-contacts input:checked')).map(i => i.value);
  if (!selected.length) { UI.toast('En az 1 üye seçin', 'error'); return; }
  try {
    const convId = 'group_' + Date.now();
    const conv = await DB.createConversation({
      id: convId, type: 'group', name,
      participants: [window._currentUser.username, ...selected],
      avatar: _selectedGroupIcon || UI.initials(name),
      banner_color: ['#0A2818','#1A0A28','#0A1628','#281A0A','#0A1A28'][Math.floor(Math.random()*5)],
      last_msg: '', last_time: Date.now(), unread_for: {}, admin: window._currentUser.username,
      server: _activeServer !== 'all' ? _activeServer : 'public',
    });
    _convs.push(conv);
    document.getElementById('group-name').value = '';
    UI.closeModal('group-modal');
    renderChatList();
    await openConv(convId);
    UI.toast(`"${name}" grubu oluşturuldu 🎉`, 'success');
  } catch(e) { UI.toast('Grup oluşturulamadı: ' + e.message, 'error'); }
}

// ── Info panel ───────────────────────────────────────────────────────
function toggleInfoPanel() {
  const panel = document.getElementById('info-panel');
  if (!panel) return;
  const isOpen = panel.style.display === 'flex';
  panel.style.display = isOpen ? 'none' : 'flex';
  if (!isOpen && window._currentConvId) updateInfoPanel(_convs.find(c => c.id === window._currentConvId));
}

function updateInfoPanel(conv) {
  const el = document.getElementById('info-panel-content');
  if (!el || !conv) return;
  el.innerHTML = '';
  if (conv.type === 'direct') {
    const other = _allUsers[conv.participants?.find(p => p !== window._currentUser.username)] || {};
    const c = UI.avatarColor(other.username || '');
    const avEl = Object.assign(document.createElement(other.avatar_url ? 'img' : 'div'), other.avatar_url ? { src: other.avatar_url } : {});
    if (other.avatar_url) avEl.style.cssText = 'width:60px;height:60px;border-radius:50%;object-fit:cover;margin:0 auto 12px;display:block;cursor:pointer';
    else { avEl.style.cssText = `width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;margin:0 auto 12px;cursor:pointer;background:${c}22;color:${c};font-family:Syne,sans-serif`; avEl.textContent = UI.initials(other.display_name || other.username); }
    avEl.onclick = () => { const u = _allUsers[other.username]; if (u) openUserProfile(u); };
    const st = UI.onlineStatus(other);
    const info = document.createElement('div');
    info.style.textAlign = 'center';
    info.appendChild(avEl);
    info.innerHTML += `<div style="font-weight:700;font-family:Syne,sans-serif;color:#DDE8F8">${_esc(other.display_name||other.username)}</div><div style="font-size:11px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">@${_esc(other.username)}</div><div style="font-size:11px;color:${st.color};margin-top:3px">${st.text}</div>`;
    el.appendChild(info);
  } else {
    const header = document.createElement('div');
    header.style.cssText = 'text-align:center;cursor:pointer';
    header.onclick = () => { const cv = _convs.find(c=>c.id===conv.id); if(cv) openGroupPanel(cv); };
    const gColor = getConvColor(conv);
    header.innerHTML = `<div style="width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;margin:0 auto 10px;background:${gColor}22;color:${gColor};font-family:Syne,sans-serif">${conv.avatar||UI.initials(conv.name)}</div><div style="font-weight:700;font-family:Syne,sans-serif;color:#DDE8F8">${conv.name}</div><div style="font-size:12px;color:#7A8FA8">${conv.participants?.length||0} üye</div>`;
    el.appendChild(header);
  }
}

// ── Search ───────────────────────────────────────────────────────────
function handleSidebarSearch(q) { _searchQuery = q; document.getElementById('search-clear')?.classList.toggle('hidden', !q); renderChatList(); }
function clearSidebarSearch() { _searchQuery=''; const i=document.getElementById('search-input'); if(i) i.value=''; document.getElementById('search-clear')?.classList.add('hidden'); renderChatList(); }
function toggleMsgSearch() { const b=document.getElementById('chat-search-bar'); b?.classList.toggle('hidden'); if(!b?.classList.contains('hidden')) document.getElementById('msg-search')?.focus(); }
async function searchInMessages(q) {
  const ce = document.getElementById('search-count');
  if (!q) { if(ce) ce.textContent=''; await renderMessages(); return; }
  const msgs = await DB.getMessages(window._currentConvId).catch(()=>[]);
  const hits = msgs.filter(m => (m.text||'').toLocaleLowerCase('tr-TR').includes(q.toLocaleLowerCase('tr-TR')));
  if(ce) ce.textContent = hits.length + ' sonuç';
  await renderMessages(q);
  if(hits.length) document.getElementById('msg-'+hits[0].id)?.scrollIntoView({behavior:'smooth',block:'center'});
}

// ── Evrensel Arama ──────────────────────────────────────────────────
let _uTab = 'all', _uSearchTimer = null;

function openUniversalSearch() {
  document.getElementById('universal-search-modal')?.classList.replace('hidden','flex');
  setTimeout(() => document.getElementById('universal-search-input')?.focus(), 80);
}

function closeUniversalSearch() {
  document.getElementById('universal-search-modal')?.classList.replace('flex','hidden');
  const inp = document.getElementById('universal-search-input');
  if (inp) inp.value = '';
  const res = document.getElementById('universal-search-results');
  if (res) res.innerHTML = '<div style="text-align:center;padding:40px 20px;color:#7A8FA8;font-size:13px"><div style="font-size:28px;margin-bottom:8px">🔍</div>Aramak istediğiniz kelimeyi yazın</div>';
}

function setUTab(tab) {
  _uTab = tab;
  ['all','convs','users','messages'].forEach(t => {
    const btn = document.getElementById('us-tab-' + t);
    if (!btn) return;
    btn.style.color            = t === tab ? '#00FFB3' : '#7A8FA8';
    btn.style.borderBottomColor = t === tab ? '#00FFB3' : 'transparent';
  });
  universalSearch(document.getElementById('universal-search-input')?.value || '');
}

function universalSearch(q) {
  if (_uSearchTimer) clearTimeout(_uSearchTimer);
  _uSearchTimer = setTimeout(() => _doUniversalSearch(q.trim()), 200);
}

async function _doUniversalSearch(q) {
  const res = document.getElementById('universal-search-results');
  if (!res) return;
  if (!q) {
    res.innerHTML = '<div style="text-align:center;padding:40px 20px;color:#7A8FA8;font-size:13px"><div style="font-size:28px;margin-bottom:8px">🔍</div>Aramak istediğiniz kelimeyi yazın</div>';
    return;
  }
  res.innerHTML = '<div style="text-align:center;padding:24px;color:#7A8FA8;font-size:12px;font-family:\'JetBrains Mono\',monospace">Aranıyor…</div>';

  const ql = q.toLocaleLowerCase('tr-TR');
  const cu = window._currentUser;
  const frag = document.createDocumentFragment();
  let totalResults = 0;

  // ── Sohbetler ───────────────────────────────────────────────────
  if (_uTab === 'all' || _uTab === 'convs') {
    const convHits = _convs.filter(c => {
      const name = getConvName(c).toLocaleLowerCase('tr-TR');
      const lastMsg = (c.last_msg || '').toLocaleLowerCase('tr-TR');
      return name.includes(ql) || lastMsg.includes(ql);
    }).slice(0, 8);

    if (convHits.length) {
      const sec = _usSection('💬 Sohbetler', convHits.length);
      frag.appendChild(sec);
      convHits.forEach(conv => {
        const name = getConvName(conv);
        const color = getConvColor(conv);
        const other = conv.type === 'direct' ? _allUsers[conv.participants?.find(p=>p!==cu.username)] : null;
        const avHtml = other?.avatar_url
          ? `<div style="width:36px;height:36px;min-width:36px;border-radius:50%;overflow:hidden;flex-shrink:0"><img src="${_safeUrl(other.avatar_url)||''}" style="width:100%;height:100%;object-fit:cover" loading="lazy"></div>`
          : `<div style="width:36px;height:36px;min-width:36px;border-radius:50%;background:${color}22;color:${color};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${UI.initials(name)}</div>`;
        const row = _usRow(avHtml,
          `<strong>${_usHighlight(name, q)}</strong>`,
          _usHighlight((conv.last_msg||'').slice(0,60), q),
          () => { closeUniversalSearch(); openConv(conv.id); }
        );
        frag.appendChild(row);
        totalResults++;
      });
    }
  }

  // ── Kullanıcılar ────────────────────────────────────────────────
  if (_uTab === 'all' || _uTab === 'users') {
    const userHits = Object.values(_allUsers).filter(u => {
      if (u.username === cu.username) return false;
      return (u.display_name||'').toLocaleLowerCase('tr-TR').includes(ql)
          || u.username.toLocaleLowerCase('tr-TR').includes(ql)
          || (u.bio||'').toLocaleLowerCase('tr-TR').includes(ql);
    }).slice(0, 6);

    if (userHits.length) {
      frag.appendChild(_usSection('👤 Kişiler', userHits.length));
      userHits.forEach(u => {
        const c = UI.avatarColor(u.username);
        const avHtml = u.avatar_url
          ? `<div style="width:36px;height:36px;min-width:36px;border-radius:50%;overflow:hidden;flex-shrink:0"><img src="${_safeUrl(u.avatar_url)||''}" style="width:100%;height:100%;object-fit:cover" loading="lazy"></div>`
          : `<div style="width:36px;height:36px;min-width:36px;border-radius:50%;background:${c}22;color:${c};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${UI.initials(u.display_name||u.username)}</div>`;
        const row = _usRow(avHtml,
          `<strong>${_usHighlight(_esc(u.display_name||u.username), q)}</strong>`,
          `@${_usHighlight(_esc(u.username), q)}`,
          () => { closeUniversalSearch(); openUserProfile(u); }
        );
        frag.appendChild(row);
        totalResults++;
      });
    }
  }

  // ── Mesajlar ────────────────────────────────────────────────────
  if (_uTab === 'all' || _uTab === 'messages') {
    const msgHits = [];
    for (const conv of _convs.slice(0, 20)) {
      try {
        const msgs = await DB.getMessages(conv.id);
        const hits = msgs.filter(m => m.text && m.text.toLocaleLowerCase('tr-TR').includes(ql));
        hits.slice(0, 3).forEach(m => msgHits.push({ msg: m, conv }));
      } catch {}
      if (msgHits.length >= 10) break;
    }

    if (msgHits.length) {
      frag.appendChild(_usSection('✉️ Mesajlar', msgHits.length));
      msgHits.forEach(({ msg, conv }) => {
        const sender = _allUsers[msg.from];
        const c = UI.avatarColor(msg.from);
        const avHtml = sender?.avatar_url
          ? `<div style="width:36px;height:36px;min-width:36px;border-radius:50%;overflow:hidden;flex-shrink:0"><img src="${_safeUrl(sender.avatar_url)||''}" style="width:100%;height:100%;object-fit:cover" loading="lazy"></div>`
          : `<div style="width:36px;height:36px;min-width:36px;border-radius:50%;background:${c}22;color:${c};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${UI.initials(sender?.display_name||msg.from)}</div>`;
        const row = _usRow(avHtml,
          `<strong>${_esc(getConvName(conv))}</strong> <span style="font-size:10px;color:#7A8FA8">• ${UI.fmtTime(msg.created_at)}</span>`,
          _usHighlight(_esc(msg.text.slice(0,80)), q),
          () => { closeUniversalSearch(); openConv(conv.id); setTimeout(() => document.getElementById('msg-'+msg.id)?.scrollIntoView({behavior:'smooth',block:'center'}), 400); }
        );
        frag.appendChild(row);
        totalResults++;
      });
    }
  }

  res.innerHTML = '';
  if (!totalResults) {
    res.innerHTML = `<div style="text-align:center;padding:32px;color:#7A8FA8;font-size:13px"><div style="font-size:28px;margin-bottom:8px">😕</div>"${_esc(q)}" için sonuç bulunamadı</div>`;
  } else {
    res.appendChild(frag);
  }
}

function _usSection(title, count) {
  const d = document.createElement('div');
  d.style.cssText = 'padding:8px 14px 4px;font-size:10px;font-weight:700;color:#7A8FA8;font-family:\'JetBrains Mono\',monospace;letter-spacing:.08em;display:flex;justify-content:space-between';
  d.innerHTML = `<span>${title}</span><span>${count}</span>`;
  return d;
}

function _usRow(avHtml, title, subtitle, onClick) {
  const d = document.createElement('div');
  d.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;transition:background .12s';
  d.onmouseenter = () => d.style.background = '#131D30';
  d.onmouseleave = () => d.style.background = 'transparent';
  d.innerHTML = `${avHtml}<div style="flex:1;min-width:0"><div style="font-size:13px;color:#DDE8F8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</div><div style="font-size:11px;color:#7A8FA8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${subtitle}</div></div>`;
  d.onclick = onClick;
  return d;
}

function _usHighlight(text, q) {
  if (!q || !text) return text || '';
  const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
  return text.replace(re, '<mark style="background:rgba(0,255,179,.3);color:#DDE8F8;border-radius:2px;padding:0 1px">$1</mark>');
}

// ── Medya Galerisi ─────────────────────────────────────────────────
let _galleryTab = 'all';

async function openMediaGallery() {
  if (!window._currentConvId) return;
  UI.openModal('media-gallery-modal');
  _galleryTab = 'all';
  ['all','image','file','link'].forEach(t => {
    const btn = document.getElementById('gal-tab-' + t);
    if (btn) { btn.style.background = t==='all' ? '#131D30' : 'transparent'; btn.style.color = t==='all' ? '#DDE8F8' : '#7A8FA8'; }
  });
  await _loadGallery();
}

function setGalleryTab(tab) {
  _galleryTab = tab;
  ['all','image','file','link'].forEach(t => {
    const btn = document.getElementById('gal-tab-' + t);
    if (btn) { btn.style.background = t===tab ? '#131D30' : 'transparent'; btn.style.color = t===tab ? '#DDE8F8' : '#7A8FA8'; }
  });
  _loadGallery();
}

async function _loadGallery() {
  const grid = document.getElementById('gallery-grid');
  const countEl = document.getElementById('gallery-count');
  if (!grid) return;
  grid.innerHTML = '<div style="text-align:center;padding:24px;color:#7A8FA8;font-size:12px">Yükleniyor…</div>';
  try {
    const msgs = await DB.getMessages(window._currentConvId);
    let items = msgs.filter(m => {
      if (_galleryTab === 'image') return (m.type==='file' && m.file_type?.startsWith('image/')) || m.type==='gif';
      if (_galleryTab === 'file')  return m.type==='file' && !m.file_type?.startsWith('image/');
      if (_galleryTab === 'link')  return m.text && /https?:\/\/\S+/i.test(m.text);
      return (m.type==='file') || m.type==='gif' || (m.text && /https?:\/\/\S+/i.test(m.text));
    }).reverse();

    if (countEl) countEl.textContent = items.length + ' öğe';
    if (!items.length) { grid.innerHTML = '<div style="text-align:center;padding:32px;color:#7A8FA8;font-size:13px">Bu kategoride medya yok</div>'; return; }

    const frag = document.createDocumentFragment();

    if (_galleryTab === 'image' || _galleryTab === 'all') {
      const imgItems = items.filter(m => (m.type==='file'&&m.file_type?.startsWith('image/'))||m.type==='gif');
      if (imgItems.length) {
        const gridDiv = document.createElement('div');
        gridDiv.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:3px;margin-bottom:12px';
        imgItems.forEach(m => {
          const src = m.type==='gif' ? m.gif_url : m.file_data;
          if (!src) return;
          const d = document.createElement('div');
          d.style.cssText = 'aspect-ratio:1;overflow:hidden;border-radius:4px;cursor:pointer;background:#131D30';
          d.innerHTML = `<img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy" onclick="Messages._lightbox('${src.replace(/'/g,'&#39;')}')">`;
          gridDiv.appendChild(d);
        });
        frag.appendChild(gridDiv);
      }
    }

    if (_galleryTab === 'file' || _galleryTab === 'all') {
      const fileItems = items.filter(m => m.type==='file' && !m.file_type?.startsWith('image/'));
      fileItems.forEach(m => {
        const d = document.createElement('div');
        d.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:#06080F;border:1px solid #1E2D45;margin-bottom:6px';
        const ext = (m.file_name||'').split('.').pop().toUpperCase().slice(0,4) || 'FILE';
        d.innerHTML = `<div style="width:36px;height:36px;border-radius:8px;background:rgba(0,255,179,.1);color:#00FFB3;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;font-family:'JetBrains Mono',monospace;flex-shrink:0">${ext}</div><div style="flex:1;min-width:0"><div style="font-size:12px;color:#DDE8F8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(m.file_name||'Dosya')}</div><div style="font-size:10px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">${UI.fmtTime(m.created_at)}</div></div><a href="${m.file_data}" download="${_esc(m.file_name||'file')}" style="color:#00FFB3;text-decoration:none;font-size:18px" onclick="event.stopPropagation()">↓</a>`;
        frag.appendChild(d);
      });
    }

    if (_galleryTab === 'link' || _galleryTab === 'all') {
      const linkItems = items.filter(m => m.text && /https?:\/\/\S+/i.test(m.text));
      linkItems.slice(0, 20).forEach(m => {
        const urls = m.text.match(/https?:\/\/\S+/gi) || [];
        urls.forEach(url => {
          const d = document.createElement('div');
          d.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:#06080F;border:1px solid #1E2D45;margin-bottom:6px;cursor:pointer';
          d.innerHTML = `<div style="width:36px;height:36px;border-radius:8px;background:rgba(14,165,233,.1);color:#0EA5E9;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">🔗</div><div style="flex:1;min-width:0"><div style="font-size:12px;color:#0EA5E9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(url.slice(0,60))}</div><div style="font-size:10px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">${UI.fmtTime(m.created_at)}</div></div>`;
          d.onclick = () => window.open(url, '_blank', 'noopener');
          frag.appendChild(d);
        });
      });
    }

    grid.innerHTML = '';
    grid.appendChild(frag);
  } catch(e) { grid.innerHTML = `<div style="text-align:center;padding:24px;color:#FF3D6B;font-size:12px">Hata: ${_esc(e.message)}</div>`; }
}

// ── Sohbet İstatistikleri ──────────────────────────────────────────
async function openChatStats() {
  if (!window._currentConvId) return;
  const content = document.getElementById('chat-stats-content');
  if (!content) return;
  content.innerHTML = '<div style="text-align:center;padding:24px;color:#7A8FA8;font-size:12px">Hesaplanıyor…</div>';
  UI.openModal('chat-stats-modal');

  try {
    const msgs = await DB.getMessages(window._currentConvId);
    const conv = _convs.find(c => c.id === window._currentConvId);
    const cu = window._currentUser;
    if (!msgs.length) { content.innerHTML = '<div style="text-align:center;padding:24px;color:#7A8FA8">Henüz mesaj yok</div>'; return; }

    // Hesaplamalar
    const total = msgs.length;
    const byUser = {};
    const byHour = Array(24).fill(0);
    const byDay  = Array(7).fill(0);
    let mediaCount = 0, gifCount = 0, stickerCount = 0, voiceCount = 0, linkCount = 0;
    let totalChars = 0;
    let firstMsg = msgs[0], lastMsg = msgs[msgs.length-1];

    msgs.forEach(m => {
      byUser[m.from] = (byUser[m.from] || 0) + 1;
      const d = new Date(m.created_at);
      byHour[d.getHours()]++;
      byDay[d.getDay()]++;
      if (m.type === 'file') mediaCount++;
      if (m.type === 'gif') gifCount++;
      if (m.type === 'sticker') stickerCount++;
      if (m.type === 'voice') voiceCount++;
      if (m.text) {
        totalChars += m.text.length;
        if (/https?:\/\/\S+/i.test(m.text)) linkCount++;
      }
    });

    const topUsers = Object.entries(byUser).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const peakHour = byHour.indexOf(Math.max(...byHour));
    const dayNames = ['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'];
    const peakDay  = dayNames[byDay.indexOf(Math.max(...byDay))];
    const avgPerDay = (() => {
      const diff = (lastMsg.created_at - firstMsg.created_at) / 86400000 || 1;
      return (total / diff).toFixed(1);
    })();

    // HTML oluştur
    const _stat = (icon, label, value, color='#DDE8F8') =>
      `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:10px;background:#06080F;border:1px solid #1E2D45"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:16px">${icon}</span><span style="font-size:13px;color:#7A8FA8">${label}</span></div><span style="font-size:14px;font-weight:700;color:${color};font-family:'JetBrains Mono',monospace">${value}</span></div>`;

    // Sohbet süresi
    const durationMs = lastMsg.created_at - firstMsg.created_at;
    const durationDays = Math.floor(durationMs / 86400000);
    const durationStr = durationDays > 0 ? `${durationDays} gün` : `${Math.floor(durationMs/3600000)} saat`;

    // Çubuk grafik yardımcısı
    const maxHourVal = Math.max(...byHour, 1);
    const hourBars = byHour.map((v,i) => {
      const pct = Math.round(v/maxHourVal*100);
      const isActive = i === peakHour;
      return `<div title="${i}:00 — ${v} mesaj" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px"><div style="width:100%;height:${Math.max(4,pct*0.5)}px;background:${isActive?'#00FFB3':'#1E2D45'};border-radius:2px 2px 0 0;transition:height .3s"></div></div>`;
    }).join('');

    content.innerHTML = `
      <div style="font-size:10px;font-weight:700;color:#7A8FA8;font-family:'JetBrains Mono',monospace;letter-spacing:.1em">GENEL</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${_stat('💬','Toplam Mesaj', total.toLocaleString('tr-TR'), '#00FFB3')}
        ${_stat('📅','Sohbet Süresi', durationStr)}
        ${_stat('📈','Günlük Ortalama', avgPerDay + ' mesaj')}
        ${_stat('✏️','Toplam Karakter', totalChars.toLocaleString('tr-TR'))}
      </div>

      <div style="font-size:10px;font-weight:700;color:#7A8FA8;font-family:'JetBrains Mono',monospace;letter-spacing:.1em">İÇERİK</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${_stat('🖼','Medya', mediaCount)}
        ${_stat('🎬','GIF', gifCount)}
        ${_stat('😊','Sticker', stickerCount)}
        ${_stat('🎙','Sesli Mesaj', voiceCount)}
        ${_stat('🔗','Link', linkCount)}
      </div>

      <div style="font-size:10px;font-weight:700;color:#7A8FA8;font-family:'JetBrains Mono',monospace;letter-spacing:.1em">EN AKTİF</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${_stat('⏰','En Aktif Saat', `${peakHour}:00 – ${peakHour+1}:00`, '#FFA535')}
        ${_stat('📆','En Aktif Gün', peakDay, '#FFA535')}
      </div>

      <div style="font-size:10px;font-weight:700;color:#7A8FA8;font-family:'JetBrains Mono',monospace;letter-spacing:.1em">SAATLİK DAĞILIM</div>
      <div style="background:#06080F;border:1px solid #1E2D45;border-radius:10px;padding:10px">
        <div style="display:flex;align-items:flex-end;gap:1px;height:40px">${hourBars}</div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:9px;color:#5A6E88;font-family:'JetBrains Mono',monospace">
          <span>0</span><span>6</span><span>12</span><span>18</span><span>23</span>
        </div>
      </div>

      <div style="font-size:10px;font-weight:700;color:#7A8FA8;font-family:'JetBrains Mono',monospace;letter-spacing:.1em">KATILIMCI SIRALAMASI</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${topUsers.map(([uid, count], i) => {
          const u = _allUsers[uid] || { username: uid, display_name: uid };
          const pct = Math.round(count/total*100);
          const color = ['#FFD700','#C0C0C0','#CD7F32','#7A8FA8','#7A8FA8'][i];
          return `<div style="padding:8px 12px;border-radius:10px;background:#06080F;border:1px solid #1E2D45">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
              <span style="font-size:12px;color:#DDE8F8">${i+1}. ${_esc(u.display_name||u.username)}</span>
              <span style="font-size:11px;color:${color};font-family:'JetBrains Mono',monospace">${count} (${pct}%)</span>
            </div>
            <div style="height:4px;border-radius:2px;background:#1E2D45;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:${color};border-radius:2px;transition:width .5s"></div>
            </div>
          </div>`;
        }).join('')}
      </div>
    `;
  } catch(e) { content.innerHTML = `<div style="text-align:center;padding:24px;color:#FF3D6B;font-size:12px">Hata: ${_esc(e.message)}</div>`; }
}

// ── Şu An Dinliyorum ───────────────────────────────────────────────
function clearNowPlaying() {
  const inp = document.getElementById('pe-nowplaying');
  if (inp) inp.value = '';
}

function renderNowPlaying(user) {
  // Profil kartında ve user profile modalda göster
  const np = user?.now_playing || localStorage.getItem('cipher_nowplaying_' + user?.username);
  return np ? `<div style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:8px;background:rgba(30,215,96,.08);border:1px solid rgba(30,215,96,.2);margin-top:6px"><span style="font-size:14px">🎵</span><div style="min-width:0"><div style="font-size:11px;color:#1ED760;font-weight:600">Şu an dinliyor</div><div style="font-size:12px;color:#DDE8F8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(np)}</div></div></div>` : '';
}

// ── Filter ───────────────────────────────────────────────────────────
function setFilter(f) {
  _chatFilter = f;
  ['all','unread','groups'].forEach(id => {
    const btn = document.getElementById('filter-' + id);
    if (btn) { btn.style.background = f===id ? '#131D30' : 'transparent'; btn.style.color = f===id ? '#DDE8F8' : '#7A8FA8'; }
  });
  renderChatList();
}

// ── Settings ─────────────────────────────────────────────────────────
let _settings = { dark:true, lowData:false, notifs:true };
function loadSettings() {
  try { _settings = { dark:true, lowData:false, notifs:true, ...JSON.parse(localStorage.getItem('cipher_settings')||'{}') }; } catch {}
  applyDark(_settings.dark); applyLowData(_settings.lowData);
}
function saveSettings() { localStorage.setItem('cipher_settings', JSON.stringify(_settings)); }
function applyDark(on) { document.documentElement.classList.toggle('light-mode', !on); updateToggle('dark-toggle', on); }
function applyLowData(on) { document.documentElement.classList.toggle('low-data', on); updateToggle('lowdata-toggle', on); }
function updateToggle(id, on) { const e=document.getElementById(id); if(e) e.className='toggle-track '+(on?'on':'off'); }
function toggleDark() { _settings.dark=!_settings.dark; saveSettings(); applyDark(_settings.dark); }
function toggleLowData() { _settings.lowData=!_settings.lowData; saveSettings(); applyLowData(_settings.lowData); UI.toast(_settings.lowData?'Düşük veri modu':'Normal mod','info'); }
function toggleNotifs() { _settings.notifs=!_settings.notifs; saveSettings(); updateToggle('notif-toggle',_settings.notifs); if(_settings.notifs&&'Notification'in window) Notification.requestPermission(); }

// ── Profile edit ──────────────────────────────────────────────────────
function setPeTab(tab) {
  ['profil','avatar','qr'].forEach(t => {
    const btn   = document.getElementById('pe-tab-'+t);
    const panel = document.getElementById('pe-panel-'+t);
    if (btn) {
      btn.style.color             = t===tab ? '#00FFB3' : '#7A8FA8';
      btn.style.borderBottomColor = t===tab ? '#00FFB3' : 'transparent';
    }
    if (panel) panel.style.display = t===tab ? 'flex' : 'none';
  });
  // Avatar tabında modal scroll'u kapat (iframe için gerekli)
  const inner = document.getElementById('profile-edit-inner');
  if (inner) inner.style.overflowY = tab === 'avatar' ? 'hidden' : 'auto';

  if (tab === 'avatar') initAvatarMaker();
  if (tab === 'qr')     initQRCode();
}

function openProfileEdit() {
  const cu = window._currentUser;
  document.getElementById('pe-displayname').value = cu.display_name||'';
  document.getElementById('pe-bio').value = cu.bio||'';
  document.getElementById('pe-status').value = cu.status||'';
  document.getElementById('pe-statusemoji').value = cu.status_emoji||'';
  const bp = document.getElementById('banner-colors');
  if (bp) {
    bp.innerHTML = '';
    CONFIG.BANNER_COLORS.forEach(col => {
      const btn = document.createElement('button');
      btn.style.cssText = `width:28px;height:28px;border-radius:50%;background:${col};border:2.5px solid ${cu.banner_color===col?'#00FFB3':'transparent'};cursor:pointer`;
      btn.onclick = () => { bp.querySelectorAll('button').forEach(b=>b.style.borderColor='transparent'); btn.style.borderColor='#00FFB3'; window._selectedBannerColor=col; };
      bp.appendChild(btn);
    });
  }
  window._selectedBannerColor = cu.banner_color;
  const prev = document.getElementById('avatar-preview');
  if (prev) {
    if (cu.avatar_url) prev.innerHTML = `<img src="${cu.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    else { const c=UI.avatarColor(cu.username); prev.style.background=`linear-gradient(135deg,${c},${c}99)`; prev.style.color='#fff'; prev.textContent=UI.initials(cu.display_name||cu.username); }
  }
  setPeTab('profil');
  // now_playing yükle
  const npInp = document.getElementById('pe-nowplaying');
  if (npInp) npInp.value = localStorage.getItem('cipher_nowplaying_' + cu.username) || '';
  UI.openModal('profile-edit-modal');
}

// ─── Avatar Maker — Canvas İnsan Figürü ────────────────────────────
// Tamamen tarayıcı tabanlı, internet gerektirmez.
// avatar_data alanına kaydedilir. avatar_url (profil fotoğrafı) DOKUNULMAZ.

const _AV = {
  skin:     0,
  hair:     0,
  hairColor:0,
  eye:      0,
  mouth:    0,
  acc:      0,
  outfit:   0,
  bg:       0,

  skins:     ['#FFDBB4','#F5C18E','#E8A96A','#C68642','#8D5524','#4A2912','#FFCBA4','#FFB347'],
  hairColors:['#2C1810','#5C3317','#8B4513','#D2691E','#DAA520','#F5DEB3','#FFFACD','#C0C0C0','#1C1C1C','#8B0000','#FF6347','#4169E1'],
  eyeColors: ['#4A3728','#6B8E23','#4682B4','#708090','#2F4F4F','#191970','#8B4513'],
  hairStyles:['Kısa','Uzun','Dalgalı','Afro','Topuz','Örgü','Kel','Sakal'],
  mouths:    ['Gülümseme','Gülen','Düz','Şaşkın','Sevinçli','Ciddi'],
  accs:      ['Yok','Gözlük','Güneş Gözlüğü','Kep','Bere','Kulaklık','Taç','Maske'],
  outfits:   ['#1E3A5F','#2D5016','#4A0E0E','#2D2D2D','#5C3317','#1A1A2E','#0D3B47','#3D1A6B'],
  bgs:       ['#06080F','#0A1628','#1A0A28','#0A2818','#1A0A0A','#0A1A0A','linear-gradient(135deg,#06080F,#1E2D45)','linear-gradient(135deg,#0A1628,#00FFB322)'],
};

function initAvatarMaker() {
  _buildAvatarSwatches();
  drawAvatar();
}

function _avSwatch(containerId, items, key, isColor, labels) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  items.forEach((val, i) => {
    const btn = document.createElement('button');
    btn.style.cssText = isColor
      ? `width:26px;height:26px;border-radius:50%;background:${val.startsWith('linear') ? val : val};border:2.5px solid ${_AV[key]===i?'#00FFB3':'transparent'};cursor:pointer;flex-shrink:0;transition:all .15s`
      : `padding:4px 9px;border-radius:8px;border:1.5px solid ${_AV[key]===i?'#00FFB3':'#1E2D45'};background:${_AV[key]===i?'rgba(0,255,179,.12)':'transparent'};cursor:pointer;font-size:11px;color:${_AV[key]===i?'#00FFB3':'#7A8FA8'};font-family:'JetBrains Mono',monospace;white-space:nowrap;transition:all .15s`;
    btn.title = labels ? labels[i] : (isColor ? '' : val);
    btn.textContent = isColor ? '' : (labels ? labels[i] : val);
    btn.onclick = () => {
      _AV[key] = i;
      el.querySelectorAll('button').forEach((b, bi) => {
        if (isColor) b.style.borderColor = bi===i ? '#00FFB3' : 'transparent';
        else { b.style.borderColor = bi===i?'#00FFB3':'#1E2D45'; b.style.background=bi===i?'rgba(0,255,179,.12)':'transparent'; b.style.color=bi===i?'#00FFB3':'#7A8FA8'; }
      });
      drawAvatar();
    };
    el.appendChild(btn);
  });
}

function _buildAvatarSwatches() {
  _avSwatch('av-skin-btns',      _AV.skins,      'skin',      true);
  _avSwatch('av-haircolor-btns', _AV.hairColors,  'hairColor', true);
  _avSwatch('av-eye-btns',       _AV.eyeColors,   'eye',       true);
  _avSwatch('av-outfit-btns',    _AV.outfits,     'outfit',    true);
  _avSwatch('av-hair-btns',      _AV.hairStyles,  'hair',      false);
  _avSwatch('av-mouth-btns',     _AV.mouths,      'mouth',     false);
  _avSwatch('av-acc-btns',       _AV.accs,        'acc',       false);
  // bg swatches — renk + gradient
  const bgEl = document.getElementById('av-bg-btns');
  if (bgEl) {
    bgEl.innerHTML = '';
    _AV.bgs.forEach((val, i) => {
      const btn = document.createElement('button');
      btn.style.cssText = `width:26px;height:26px;border-radius:6px;background:${val};border:2.5px solid ${_AV.bg===i?'#00FFB3':'transparent'};cursor:pointer;flex-shrink:0;transition:all .15s`;
      btn.onclick = () => { _AV.bg=i; bgEl.querySelectorAll('button').forEach((b,bi)=>b.style.borderColor=bi===i?'#00FFB3':'transparent'); drawAvatar(); };
      bgEl.appendChild(btn);
    });
  }
}

function drawAvatar() {
  const canvas = document.getElementById('av-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 120, H = 120;
  ctx.clearRect(0, 0, W, H);

  // ── Arka plan ──────────────────────────────────────────────────
  const bgVal = _AV.bgs[_AV.bg];
  if (bgVal.startsWith('linear-gradient')) {
    // Parse gradient colors
    const stops = bgVal.match(/#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?/g) || ['#06080F','#1E2D45'];
    const grd = ctx.createLinearGradient(0,0,W,H);
    grd.addColorStop(0, stops[0]);
    grd.addColorStop(1, stops[1]||stops[0]);
    ctx.fillStyle = grd;
  } else {
    ctx.fillStyle = bgVal;
  }
  // Daire klip
  ctx.save();
  ctx.beginPath(); ctx.arc(W/2, H/2, W/2, 0, Math.PI*2);
  ctx.clip();
  ctx.fillRect(0, 0, W, H);

  const skin = _AV.skins[_AV.skin];
  const hairCol = _AV.hairColors[_AV.hairColor];
  const eyeCol  = _AV.eyeColors[_AV.eye];
  const outfitCol = _AV.outfits[_AV.outfit];

  // ── Gövde / Kıyafet ───────────────────────────────────────────
  ctx.fillStyle = outfitCol;
  ctx.beginPath();
  ctx.ellipse(W/2, H*0.92, W*0.36, H*0.28, 0, 0, Math.PI*2);
  ctx.fill();

  // Yaka (beyaz)
  ctx.fillStyle = '#DDE8F8';
  ctx.beginPath();
  ctx.moveTo(W/2-10, H*0.72);
  ctx.lineTo(W/2, H*0.80);
  ctx.lineTo(W/2+10, H*0.72);
  ctx.closePath();
  ctx.fill();

  // ── Boyun ──────────────────────────────────────────────────────
  ctx.fillStyle = skin;
  ctx.fillRect(W/2-7, H*0.58, 14, H*0.16);

  // ── Kafa ──────────────────────────────────────────────────────
  const headCY = H*0.42, headR = W*0.28;
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(W/2, headCY, headR*0.88, headR, 0, 0, Math.PI*2);
  ctx.fill();

  // ── Saç ───────────────────────────────────────────────────────
  ctx.fillStyle = hairCol;
  const hairStyle = _AV.hair;
  if (hairStyle === 7) {
    // Kel — sakal
    ctx.fillStyle = hairCol;
    ctx.beginPath();
    ctx.ellipse(W/2, headCY+headR*0.75, headR*0.7, headR*0.22, 0, 0, Math.PI*2);
    ctx.fill();
  } else if (hairStyle === 0) {
    // Kısa
    ctx.beginPath();
    ctx.ellipse(W/2, headCY-headR*0.1, headR*0.9, headR*0.65, 0, Math.PI, 0);
    ctx.fill();
  } else if (hairStyle === 1) {
    // Uzun
    ctx.beginPath();
    ctx.ellipse(W/2, headCY-headR*0.1, headR*0.9, headR*0.65, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(W/2-headR*0.88, headCY, headR*0.25, H*0.2);
    ctx.fillRect(W/2+headR*0.63, headCY, headR*0.25, H*0.2);
  } else if (hairStyle === 2) {
    // Dalgalı
    ctx.beginPath();
    ctx.moveTo(W/2-headR*0.88, headCY-headR*0.1);
    for(let i=0;i<6;i++){
      const x1=W/2-headR*0.88+i*headR*0.3;
      const x2=x1+headR*0.15;
      const y1=headCY-headR*(0.6+Math.sin(i)*0.1);
      ctx.quadraticCurveTo(x1,y1-headR*0.1,x2,y1);
    }
    ctx.ellipse(W/2, headCY-headR*0.25, headR*0.9, headR*0.4, 0, 0, Math.PI, true);
    ctx.fill();
    ctx.fillRect(W/2-headR*0.88, headCY, headR*0.25, H*0.18);
  } else if (hairStyle === 3) {
    // Afro
    ctx.beginPath();
    ctx.arc(W/2, headCY-headR*0.2, headR*1.05, 0, Math.PI*2);
    ctx.fill();
  } else if (hairStyle === 4) {
    // Topuz
    ctx.beginPath();
    ctx.ellipse(W/2, headCY-headR*0.1, headR*0.9, headR*0.65, 0, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(W/2, headCY-headR*0.7, headR*0.28, 0, Math.PI*2);
    ctx.fill();
  } else if (hairStyle === 5) {
    // Örgü
    ctx.beginPath();
    ctx.ellipse(W/2, headCY-headR*0.1, headR*0.9, headR*0.65, 0, Math.PI, 0);
    ctx.fill();
    const braidX = W/2;
    for(let i=0;i<5;i++){
      const y=headCY+headR*0.3+i*12;
      const w=headR*(0.18-i*0.02);
      ctx.fillRect(braidX-w, y, w*2, 10);
    }
  } else if (hairStyle === 6) {
    // Kel
    // no hair
  }

  // ── Kulaklar ──────────────────────────────────────────────────
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.ellipse(W/2-headR*0.85, headCY, headR*0.14, headR*0.2, -0.2, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(W/2+headR*0.85, headCY, headR*0.14, headR*0.2,  0.2, 0, Math.PI*2); ctx.fill();

  // ── Kaşlar ────────────────────────────────────────────────────
  ctx.strokeStyle = hairCol; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  const browY = headCY - headR*0.28;
  ctx.beginPath(); ctx.moveTo(W/2-headR*0.5, browY); ctx.lineTo(W/2-headR*0.15, browY-3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W/2+headR*0.5, browY); ctx.lineTo(W/2+headR*0.15, browY-3); ctx.stroke();

  // ── Gözler ────────────────────────────────────────────────────
  const eyeY = headCY - headR*0.1;
  const eyeLX = W/2 - headR*0.32, eyeRX = W/2 + headR*0.32;
  const eyeRad = headR*0.12;

  // Göz beyazı
  ctx.fillStyle = '#fff';
  [eyeLX, eyeRX].forEach(ex => {
    ctx.beginPath(); ctx.ellipse(ex, eyeY, eyeRad*1.4, eyeRad, 0, 0, Math.PI*2); ctx.fill();
  });
  // İris
  ctx.fillStyle = eyeCol;
  [eyeLX, eyeRX].forEach(ex => {
    ctx.beginPath(); ctx.arc(ex, eyeY, eyeRad*0.85, 0, Math.PI*2); ctx.fill();
  });
  // Pupil
  ctx.fillStyle = '#000';
  [eyeLX, eyeRX].forEach(ex => {
    ctx.beginPath(); ctx.arc(ex, eyeY, eyeRad*0.45, 0, Math.PI*2); ctx.fill();
  });
  // Işık yansıması
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  [eyeLX, eyeRX].forEach(ex => {
    ctx.beginPath(); ctx.arc(ex+eyeRad*0.25, eyeY-eyeRad*0.3, eyeRad*0.2, 0, Math.PI*2); ctx.fill();
  });

  // ── Burun ─────────────────────────────────────────────────────
  const noseY = headCY + headR*0.1;
  ctx.strokeStyle = skin.replace(/^#/, '') > '999999' ? 'rgba(0,0,0,.15)' : 'rgba(0,0,0,.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(W/2-4, noseY-4);
  ctx.lineTo(W/2, noseY+5);
  ctx.lineTo(W/2+4, noseY-4);
  ctx.stroke();

  // ── Ağız ──────────────────────────────────────────────────────
  const mouthY = headCY + headR*0.35;
  const mouthW = headR*0.45;
  ctx.strokeStyle = '#c0524a'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  switch(_AV.mouth) {
    case 0: // Gülümseme
      ctx.beginPath(); ctx.arc(W/2, mouthY-4, mouthW, 0.2, Math.PI-0.2); ctx.stroke(); break;
    case 1: // Gülen
      ctx.fillStyle = '#c0524a';
      ctx.beginPath(); ctx.arc(W/2, mouthY-5, mouthW*1.1, 0.1, Math.PI-0.1); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(W/2-mouthW*0.8, mouthY-5, mouthW*1.6, mouthW*0.55);
      break;
    case 2: // Düz
      ctx.beginPath(); ctx.moveTo(W/2-mouthW, mouthY); ctx.lineTo(W/2+mouthW, mouthY); ctx.stroke(); break;
    case 3: // Şaşkın
      ctx.beginPath(); ctx.ellipse(W/2, mouthY, mouthW*0.5, mouthW*0.6, 0, 0, Math.PI*2);
      ctx.fillStyle = '#8B2020'; ctx.fill(); break;
    case 4: // Sevinçli
      ctx.beginPath(); ctx.arc(W/2, mouthY-8, mouthW*1.2, 0, Math.PI); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillRect(W/2-mouthW, mouthY-8, mouthW*2, mouthW*0.7); break;
    case 5: // Ciddi
      ctx.beginPath(); ctx.moveTo(W/2-mouthW, mouthY+3); ctx.quadraticCurveTo(W/2, mouthY-3, W/2+mouthW, mouthY+3); ctx.stroke(); break;
  }

  // ── Aksesuar ──────────────────────────────────────────────────
  switch(_AV.acc) {
    case 0: break; // Yok
    case 1: // Gözlük
      ctx.strokeStyle='#888'; ctx.lineWidth=1.8;
      [eyeLX, eyeRX].forEach(ex => { ctx.beginPath(); ctx.arc(ex, eyeY, eyeRad*1.55, 0, Math.PI*2); ctx.stroke(); });
      ctx.beginPath(); ctx.moveTo(eyeLX+eyeRad*1.55, eyeY); ctx.lineTo(eyeRX-eyeRad*1.55, eyeY); ctx.stroke();
      break;
    case 2: // Güneş gözlüğü
      ctx.fillStyle='rgba(0,50,100,.7)';
      [eyeLX, eyeRX].forEach(ex => { ctx.beginPath(); ctx.ellipse(ex, eyeY, eyeRad*1.7, eyeRad*1.1, 0, 0, Math.PI*2); ctx.fill(); });
      ctx.strokeStyle='#aaa'; ctx.lineWidth=1.5;
      [eyeLX, eyeRX].forEach(ex => { ctx.beginPath(); ctx.ellipse(ex, eyeY, eyeRad*1.7, eyeRad*1.1, 0, 0, Math.PI*2); ctx.stroke(); });
      ctx.beginPath(); ctx.moveTo(eyeLX+eyeRad*1.7, eyeY); ctx.lineTo(eyeRX-eyeRad*1.7, eyeY); ctx.stroke();
      break;
    case 3: // Kep
      ctx.fillStyle=hairCol;
      ctx.fillRect(W/2-headR*0.92, headCY-headR*0.72, headR*1.84, headR*0.5);
      ctx.beginPath(); ctx.ellipse(W/2, headCY-headR*0.72, headR*0.92, headR*0.28, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillRect(W/2-headR*1.05, headCY-headR*0.25, headR*0.25, headR*0.15);
      break;
    case 4: // Bere
      ctx.fillStyle=outfitCol;
      ctx.beginPath();
      ctx.arc(W/2, headCY-headR*0.3, headR*1.0, Math.PI*1.15, Math.PI*1.85);
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(W/2+headR*0.3, headCY-headR*1.15, headR*0.18, 0, Math.PI*2); ctx.fill();
      break;
    case 5: // Kulaklık
      ctx.strokeStyle='#444'; ctx.lineWidth=5;
      ctx.beginPath(); ctx.arc(W/2, headCY-headR*0.2, headR*0.95, Math.PI*1.1, Math.PI*1.9); ctx.stroke();
      ctx.fillStyle='#333';
      [W/2-headR*0.95, W/2+headR*0.95].forEach(x => {
        ctx.beginPath(); ctx.ellipse(x+(x<W/2?headR*0.05:-headR*0.05), headCY-headR*0.15, headR*0.2, headR*0.28, x<W/2?-0.3:0.3, 0, Math.PI*2); ctx.fill();
      });
      break;
    case 6: // Taç
      ctx.fillStyle='#FFD700';
      const crownPts = [W/2-headR*0.6, W/2-headR*0.3, W/2, W/2+headR*0.3, W/2+headR*0.6];
      ctx.beginPath(); ctx.moveTo(crownPts[0], headCY-headR*0.68);
      crownPts.forEach((x,i)=>{ ctx.lineTo(x, headCY-headR*(0.68+(i%2===0?0.32:0))); });
      ctx.lineTo(crownPts[4], headCY-headR*0.68); ctx.closePath(); ctx.fill();
      break;
    case 7: // Maske
      ctx.fillStyle='rgba(20,20,20,.85)';
      ctx.beginPath(); ctx.ellipse(W/2, mouthY-2, mouthW*1.6, mouthW*0.85, 0, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle='#555'; ctx.lineWidth=1;
      for(let i=-2;i<=2;i++){
        ctx.beginPath(); ctx.moveTo(W/2-mouthW*1.4, mouthY-4+i*4); ctx.lineTo(W/2+mouthW*1.4, mouthY-4+i*4); ctx.stroke();
      }
      break;
  }

  ctx.restore();

  // Daire kenarlık
  ctx.strokeStyle = 'rgba(0,255,179,.3)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(W/2, H/2, W/2-1, 0, Math.PI*2); ctx.stroke();
}

async function applyMakerAvatar() {
  const canvas = document.getElementById('av-canvas');
  if (!canvas) return;
  try {
    // Yüksek çözünürlüklü versiyon üret
    const hiCanvas = document.createElement('canvas');
    hiCanvas.width = 400; hiCanvas.height = 400;
    const hiCtx = hiCanvas.getContext('2d');
    hiCtx.drawImage(canvas, 0, 0, 400, 400);
    const dataUrl = hiCanvas.toDataURL('image/png');

    const cu = window._currentUser;
    // avatar_data'ya kaydet — avatar_url'ye DOKUNMA
    await DB.updateUser(cu.username, { avatar_data: dataUrl }).catch(e => {
      console.warn('[Avatar] DB save failed:', e.message);
    });
    cu.avatar_data = dataUrl;
    if (_allUsers[cu.username]) _allUsers[cu.username].avatar_data = dataUrl;
    localStorage.setItem('cipher_avatar_data_' + cu.username, dataUrl);

    const prev = document.getElementById('avatar-preview');
    if (prev) prev.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;

    renderMyAvatar();
    setPeTab('profil');
    UI.toast('🎨 Avatar kaydedildi! Profil fotoğrafın korundu.', 'success', 4000);
  } catch(e) {
    UI.toast('Avatar kaydedilemedi: ' + e.message, 'error');
  }
}

// avatar gösterim yardımcısı
function getUserAvatarDisplay(user) {
  if (user?.avatar_url) return { type: 'photo', src: user.avatar_url };
  const localData = localStorage.getItem('cipher_avatar_data_' + user?.username);
  const src = user?.avatar_data || localData;
  if (src) return { type: 'avatar3d', src };
  return { type: 'initials', color: UI.avatarColor(user?.username || '') };
}


// ─── QR Code ────────────────────────────────────────────────────────
function initQRCode() {
  const cu = window._currentUser;
  const label = document.getElementById('qr-username-label');
  if (label) label.textContent = `@${_esc(cu.username)}`;
  const canvas = document.getElementById('qr-canvas'); if (!canvas) return;
  // QR içerik: cipher://user/<username>
  const text = `cipher://user/${cu.username}`;
  _drawQR(canvas, text, 168);
}

function _drawQR(canvas, text, size) {
  // Mini QR encoder — sadece alphanumeric/byte, hata düzeltme L
  // Basit görsel QR — gerçek QR decode edilebilir değil ama estetik amaçlı
  // Production'da qrcode.js kütüphanesi kullanılmalı
  const ctx = canvas.getContext('2d');
  canvas.width = size; canvas.height = size;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // Gerçek QR üretimi için deterministik hash → hücre matrisi
  const N = 25; // 25x25 grid (versiyon 2 benzeri)
  const cell = size / N;
  const matrix = _qrMatrix(text, N);

  ctx.fillStyle = '#06080F';
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (matrix[r][c]) {
        const x = c * cell, y = r * cell;
        const r2 = cell * 0.18;
        ctx.beginPath();
        ctx.roundRect(x+1, y+1, cell-2, cell-2, r2);
        ctx.fill();
      }
    }
  }

  // Finder patterns (köşe kareler)
  _drawFinder(ctx, 0, 0, cell);
  _drawFinder(ctx, (N-7)*cell, 0, cell);
  _drawFinder(ctx, 0, (N-7)*cell, cell);

  // CIPHER yazısı ortada
  ctx.fillStyle = '#00FFB3';
  ctx.font = `bold ${Math.round(cell*1.2)}px 'JetBrains Mono', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CIPHER', size/2, size/2);
}

function _qrMatrix(text, N) {
  const m = Array.from({length:N}, ()=>new Array(N).fill(0));
  // Pseudo-random fill based on text content
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) & 0x7FFFFFFF;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; return seed / 0x7FFFFFFF; };
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) m[r][c] = rand() > 0.5 ? 1 : 0;
  // Clear finder areas
  [[0,0],[N-7,0],[0,N-7]].forEach(([fr,fc])=>{
    for (let r=fr-1; r<=fr+7; r++) for (let c=fc-1; c<=fc+7; c++) if(r>=0&&r<N&&c>=0&&c<N) m[r][c]=0;
  });
  // Clear center for text
  const mid = Math.floor(N/2);
  for (let r=mid-3;r<=mid+3;r++) for (let c=mid-7;c<=mid+7;c++) if(r>=0&&r<N&&c>=0&&c<N) m[r][c]=0;
  return m;
}

function _drawFinder(ctx, x, y, cell) {
  ctx.fillStyle = '#06080F';
  ctx.fillRect(x, y, cell*7, cell*7);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x+cell, y+cell, cell*5, cell*5);
  ctx.fillStyle = '#06080F';
  ctx.fillRect(x+cell*2, y+cell*2, cell*3, cell*3);
}

function downloadQR() {
  const canvas = document.getElementById('qr-canvas'); if (!canvas) return;
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `cipher-qr-${window._currentUser.username}.png`;
  a.click();
}

async function shareQR() {
  const cu = window._currentUser;
  const shareUrl = `${location.origin}${location.pathname}?add=${cu.username}`;
  if (navigator.share) {
    await navigator.share({ title:'CIPHER\'da beni ekle', text:`@${_esc(cu.username)} olarak CIPHER\'dayım!`, url: shareUrl });
  } else {
    navigator.clipboard.writeText(shareUrl).then(()=>UI.toast('Link kopyalandı ✓','success'));
  }
}

async function saveProfile() {
  const cu = window._currentUser;
  const _sanitize = s => (s||'').replace(/[<>]/g,'').slice(0,200);
  const nowPlaying = document.getElementById('pe-nowplaying')?.value.trim() || '';
  const d = {
    display_name: _sanitize(document.getElementById('pe-displayname').value)||cu.display_name,
    bio:          _sanitize(document.getElementById('pe-bio').value),
    status:       _sanitize(document.getElementById('pe-status').value).slice(0,100),
    status_emoji: (document.getElementById('pe-statusemoji').value||'').slice(0,4),
    banner_color: window._selectedBannerColor||cu.banner_color
  };
  // now_playing localStorage'a kaydet (DB kolonu olmayabilir)
  if (nowPlaying) localStorage.setItem('cipher_nowplaying_' + cu.username, nowPlaying);
  else localStorage.removeItem('cipher_nowplaying_' + cu.username);
  try {
    await DB.updateUser(cu.username, d);
    Object.assign(window._currentUser, d); _allUsers[cu.username] = { ..._allUsers[cu.username], ...d };
    UI.closeModal('profile-edit-modal'); renderMyAvatar(); UI.toast('Profil güncellendi ✓','success');
  } catch(e) { UI.toast('Güncellenemedi: '+e.message,'error'); }
}

async function uploadAvatar(input) {
  const file = input.files[0]; if (!file) return;
  if (file.size > CONFIG.MAX_FILE_MB*1024*1024) { UI.toast(`Maks. ${CONFIG.MAX_FILE_MB}MB`,'error'); return; }
  const r = new FileReader(); r.readAsDataURL(file);
  r.onload = async () => {
    try {
      await DB.updateUser(window._currentUser.username, { avatar_url: r.result });
      window._currentUser.avatar_url = r.result; _allUsers[window._currentUser.username].avatar_url = r.result;
      renderMyAvatar();
      const prev = document.getElementById('avatar-preview');
      if (prev) prev.innerHTML = `<img src="${r.result}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
      UI.toast('Fotoğraf güncellendi ✓','success');
    } catch(e) { UI.toast('Yüklenemedi: '+e.message,'error'); }
  };
}

// ── Change name ───────────────────────────────────────────────────────
function openChangeName() {
  document.getElementById('cn-input').value = window._currentUser.display_name||'';
  document.getElementById('cn-err').style.display = 'none';
  UI.openModal('change-name-modal');
}
async function submitChangeName() {
  const val = document.getElementById('cn-input').value.trim();
  const errEl = document.getElementById('cn-err');
  errEl.style.display = 'none';
  try {
    await Auth.changeDisplayName(window._currentUser.username, val);
    window._currentUser.display_name = val; _allUsers[window._currentUser.username].display_name = val;
    renderMyAvatar(); UI.closeModal('change-name-modal'); UI.toast('Ad güncellendi ✓','success');
  } catch(e) { errEl.textContent=e.message; errEl.style.display=''; }
}

// ── Block / Report ────────────────────────────────────────────────────
function openBlockReport() {
  const conv = _convs.find(c => c.id === window._currentConvId);
  if (!conv || conv.type !== 'direct') return;
  const otherU = conv.participants?.find(p => p !== window._currentUser.username);
  const u = _allUsers[otherU]; if (!u) return;
  window._brTarget = u.username;
  const blocked = getBlockedList();
  const color = UI.avatarColor(u.username);
  document.getElementById('br-user-info').innerHTML = `${u.avatar_url?`<img src="${_safeUrl(u.avatar_url)||''}" style="width:36px;height:36px;border-radius:50%;object-fit:cover">`:`<div style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;background:${color}22;color:${color};font-family:Syne,sans-serif">${UI.initials(u.display_name||u.username)}</div>`}<div><div style="font-size:13px;font-weight:600;color:#DDE8F8">${_esc(u.display_name||u.username)}</div><div style="font-size:11px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">@${_esc(u.username)}</div></div>`;
  document.getElementById('br-block-btn').innerHTML = blocked.includes(u.username) ? `<span style="font-size:18px">✅</span><div><div style="font-size:13px;font-weight:600">Engeli Kaldır</div></div>` : `<span style="font-size:18px">🚫</span><div><div style="font-size:13px;font-weight:600">Engelle</div></div>`;
  UI.openModal('block-report-modal');
}
function getBlockedList() { try{return JSON.parse(localStorage.getItem('cipher_blocked_'+window._currentUser.username)||'[]');}catch{return[];} }
function saveBlockedList(l) { localStorage.setItem('cipher_blocked_'+window._currentUser.username, JSON.stringify(l)); }
function blockUser() { const t=window._brTarget; if(!t)return; const b=getBlockedList(); const i=b.indexOf(t); if(i>=0){b.splice(i,1);saveBlockedList(b);UI.toast(`@${t} engeli kaldırıldı`,'info');}else{b.push(t);saveBlockedList(b);UI.toast(`@${t} engellendi 🚫`,'warn');} UI.closeModal('block-report-modal'); }
function reportUser() { const t=window._brTarget; if(!t)return; const r=JSON.parse(localStorage.getItem('cipher_admin_reports')||'[]'); r.push({type:'user',target:t,from:window._currentUser.username,time:Date.now()}); localStorage.setItem('cipher_admin_reports',JSON.stringify(r)); UI.closeModal('block-report-modal'); UI.toast('Şikayet iletildi 🚨','success'); }
function openReportModal() { UI.openModal('report-modal'); }
function submitReport() { const type=document.getElementById('report-type').value; const text=document.getElementById('report-text').value.trim(); if(!text){UI.toast('Açıklama girin','error');return;} const r=JSON.parse(localStorage.getItem('cipher_admin_reports')||'[]'); r.push({type,from:window._currentUser.username,text,time:Date.now()}); localStorage.setItem('cipher_admin_reports',JSON.stringify(r)); document.getElementById('report-text').value=''; UI.closeModal('report-modal'); UI.toast('Sorun bildirildi ✓','success'); }
function openLockAccount() { document.getElementById('lock-pwd').value=''; document.getElementById('lock-err').style.display='none'; UI.openModal('lock-modal'); }
async function confirmLock() {
  const pwd=document.getElementById('lock-pwd').value; if(!pwd)return;
  const lockErr=document.getElementById('lock-err');
  lockErr.style.display='none';
  try {
    const hash=await DB.hashPassword(pwd);
    // Always fetch fresh from DB (session no longer stores password_hash)
    const u=await DB.getUser(window._currentUser.username);
    if(!u?.password_hash||hash!==u.password_hash){lockErr.textContent='Şifre yanlış.';lockErr.style.display='';return;}
    UI.closeModal('lock-modal'); Auth.logout();
  } catch(e) { lockErr.textContent='Hata: '+e.message; lockErr.style.display=''; }
}
function openDeleteAccount() { document.getElementById('delete-confirm').value=''; document.getElementById('delete-pwd').value=''; document.getElementById('del-err').style.display='none'; UI.openModal('delete-account-modal'); }
async function confirmDeleteAccount() { const cf=document.getElementById('delete-confirm').value.trim(); const pwd=document.getElementById('delete-pwd').value; const errEl=document.getElementById('del-err'); const showE=msg=>{errEl.textContent=msg;errEl.style.display='';}; if(cf!=='SİL'){showE('"SİL" yazın.');return;} if(!pwd){showE('Şifre girin.');return;} const hash=await DB.hashPassword(pwd);
    const freshU=await DB.getUser(window._currentUser.username).catch(()=>null);
    if(!freshU?.password_hash||hash!==freshU.password_hash){showE('Şifre yanlış.');return;} try{await DB.deleteUser(window._currentUser.username); setTimeout(()=>Auth.logout(),1500); UI.toast('Hesap silindi 👋','info');}catch(e){showE(e.message);} }
function shareApp() { const url=window.location.origin+window.location.pathname.replace('app.html',''); if(navigator.share){navigator.share({title:'CIPHER Messenger',url}).catch(()=>{});}else{navigator.clipboard.writeText(url).then(()=>UI.toast('Link kopyalandı 🔗','success'));} }

// ── Notifications ──────────────────────────────────────────────────
let _notifs = [];
function addNotif(msg, from, convId) {
  _notifs.unshift({msg,from,convId,time:Date.now(),read:false});
  if (_notifs.length>50) _notifs.length=50;
  try { localStorage.setItem('cipher_notifs_'+window._currentUser?.username, JSON.stringify(_notifs.slice(0,20))); } catch {}
  updateNotifBadge();
}
function _loadNotifs() {
  try {
    const saved = JSON.parse(localStorage.getItem('cipher_notifs_'+window._currentUser?.username) || '[]');
    _notifs = saved;
    updateNotifBadge();
  } catch {}
}
function updateNotifBadge() {
  const unread=_notifs.filter(n=>!n.read).length;
  let badge=document.getElementById('notif-badge');
  if(!badge){const btn=document.getElementById('notif-btn');if(!btn)return;badge=document.createElement('span');badge.id='notif-badge';badge.style.cssText='position:absolute;top:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:#FF3D6B;color:#fff;font-size:9px;display:flex;align-items:center;justify-content:center;border:2px solid #06080F';btn.style.position='relative';btn.appendChild(badge);}
  badge.textContent=unread>9?'9+':unread;
  badge.style.display=unread>0?'flex':'none';
}
function openNotifs() {
  _notifs.forEach(n=>n.read=true); updateNotifBadge();
  const list=document.getElementById('notif-list');
  if(!list)return;
  if(!_notifs.length){list.innerHTML='<div style="text-align:center;padding:24px;color:#7A8FA8;font-size:13px">Henüz bildirim yok</div>';UI.openModal('notif-modal');return;}
  const frag=document.createDocumentFragment();
  _notifs.forEach(n=>{
    const u=_allUsers[n.from]||{username:n.from,display_name:n.from};
    const c=UI.avatarColor(u.username);
    const div=document.createElement('div');
    div.style.cssText='display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;cursor:pointer;background:#06080F;border:1px solid #1E2D45;transition:background .12s;margin-bottom:6px';
    div.onmouseenter=()=>div.style.background='#0C1220';
    div.onmouseleave=()=>div.style.background='#06080F';
    div.onclick=()=>{UI.closeModal('notif-modal');openConv(n.convId);};
    div.innerHTML=`<div style="width:32px;height:32px;min-width:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:${c}22;color:${c};font-family:Syne,sans-serif">${UI.initials(u.display_name||u.username)}</div><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;color:#DDE8F8">${_esc(u.display_name||u.username)}</div><div style="font-size:11px;color:#7A8FA8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.msg}</div></div><span style="font-size:10px;color:#7A8FA8;flex-shrink:0">${UI.fmtTime(n.time)}</span>`;
    frag.appendChild(div);
  });
  list.innerHTML=''; list.appendChild(frag);
  UI.openModal('notif-modal');
}
function clearAllNotifs() { _notifs=[]; updateNotifBadge(); UI.closeModal('notif-modal'); }

// ── Kaydedilen Mesajlar ─────────────────────────────────────────────
const _SAVED_KEY = () => 'cipher_saved_' + (window._currentUser?.username || '');

function saveMessage(msgId, text) {
  const saved = JSON.parse(localStorage.getItem(_SAVED_KEY()) || '[]');
  if (saved.find(m => m.id === msgId)) { UI.toast('Zaten kaydedilmiş', 'info'); return; }
  saved.unshift({ id: msgId, text: text?.slice(0,300) || '', time: Date.now(), convId: window._currentConvId });
  if (saved.length > 100) saved.length = 100;
  localStorage.setItem(_SAVED_KEY(), JSON.stringify(saved));
  UI.toast('📌 Mesaj kaydedildi', 'success');
}

function openSavedMessages() {
  const list = document.getElementById('saved-messages-list');
  if (!list) return;
  const saved = JSON.parse(localStorage.getItem(_SAVED_KEY()) || '[]');
  if (!saved.length) {
    list.innerHTML = '<div style="text-align:center;padding:32px;color:#7A8FA8;font-size:13px">Henüz kaydedilen mesaj yok.<br><br>Mesaja uzun bas → 📌 Kaydet</div>';
  } else {
    list.innerHTML = '';
    saved.forEach((m, i) => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:10px 12px;border-radius:12px;background:#06080F;border:1px solid #1E2D45;display:flex;gap:10px;align-items:start';
      div.innerHTML = `<div style="flex:1;min-width:0"><div style="font-size:13px;color:#DDE8F8;line-height:1.5;word-break:break-word">${String(m.text||'').replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</div><div style="font-size:10px;color:#5A6E88;font-family:'JetBrains Mono',monospace;margin-top:4px">${UI.fmtDate(m.time)}</div></div><div style="display:flex;gap:4px;flex-shrink:0"><button onclick="goToSavedMsg('${m.convId}');UI.closeModal('saved-messages-modal')" style="font-size:11px;padding:4px 8px;border-radius:6px;background:#131D30;color:#00FFB3;border:1px solid rgba(0,255,179,.2);cursor:pointer">Git</button><button onclick="deleteSavedMsg(${i})" style="font-size:11px;padding:4px 8px;border-radius:6px;background:#131D30;color:#FF3D6B;border:1px solid rgba(255,61,107,.2);cursor:pointer">✕</button></div>`;
      list.appendChild(div);
    });
  }
  UI.openModal('saved-messages-modal');
}

function deleteSavedMsg(idx) {
  const saved = JSON.parse(localStorage.getItem(_SAVED_KEY()) || '[]');
  saved.splice(idx, 1);
  localStorage.setItem(_SAVED_KEY(), JSON.stringify(saved));
  openSavedMessages();
}

function goToSavedMsg(convId) {
  if (!convId) return;
  UI.closeModal('saved-messages-modal');
  // Mobilde sidebar'ı kapat, chat'e geç
  if (window.innerWidth < 768) {
    document.getElementById('sidebar')?.classList.add('slide-out');
    document.getElementById('chat-area')?.classList.add('slide-in');
  }
  openConv(convId);
}

// ── Story Görüntüleyenler ───────────────────────────────────────────
function openStoryViewers(storyId) {
  // Find story in cached stories
  DB.getStories().then(stories => {
    const story = stories.find(s => s.id === storyId);
    if (!story) return;
    const viewers = story.seen_by || [];
    const list = document.getElementById('story-viewers-list');
    if (!list) return;
    if (!viewers.length) {
      list.innerHTML = '<div style="text-align:center;padding:20px;color:#7A8FA8;font-size:13px">Henüz kimse görmedi</div>';
    } else {
      list.innerHTML = '';
      viewers.forEach(uid => {
        const u = _allUsers[uid] || { username: uid, display_name: uid };
        const c = UI.avatarColor(u.username);
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px';
        const av = u.avatar_url
          ? `<div style="width:32px;height:32px;border-radius:50%;overflow:hidden;flex-shrink:0"><img src="${_safeUrl(u.avatar_url)||''}" style="width:100%;height:100%;object-fit:cover"></div>`
          : `<div style="width:32px;height:32px;border-radius:50%;background:${c}22;color:${c};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${UI.initials(u.display_name||u.username)}</div>`;
        div.innerHTML = `${av}<div><div style="font-size:13px;color:#DDE8F8">${_esc(u.display_name||u.username)}</div><div style="font-size:11px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">@${_esc(u.username)}</div></div><span style="margin-left:auto;font-size:16px">👁</span>`;
        list.appendChild(div);
      });
    }
    UI.openModal('story-viewers-modal');
  }).catch(() => {});
}

// ── @Mention Bildirimleri ──────────────────────────────────────────
function _checkMentions(convId, text) {
  if (!convId || !text) return;
  const conv = _convs.find(c => c.id === convId);
  if (!conv || conv.type !== 'group') return;
  const cu = window._currentUser;
  // Find all @username mentions in text
  const mentions = [...text.matchAll(/@([a-z0-9_.-]+)/gi)].map(m => m[1].toLowerCase());
  mentions.forEach(uid => {
    if (uid === cu.username) return; // kendi kendine mention
    const u = _allUsers[uid];
    if (!u || !conv.participants?.includes(uid)) return;
    // Bildirim ekle
    addNotif(`@${_esc(cu.username)} seni bahsetti: ${text.slice(0,60)}`, cu.username, convId);
  });
}

// ── Mesaj Filtresi ─────────────────────────────────────────────────
const _SENSITIVE_WORDS = [
  'küfür','sövme','hakaret','bok','sik','göt','orospu','piç','salak','mal','aptal','gerize',
  'nefret','öldür','öldüreceğim','intihar','kendini öldür','kes','kesin','koy','koyayım'
];

function _isSensitiveMessage(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return _SENSITIVE_WORDS.some(w => lower.includes(w));
}

async function _sendSensitiveMessage(convId, text) {
  const cu = window._currentUser;
  const now = Date.now();
  const tmpId = 'tmp_' + now;
  // Mesajı "hassas" flag ile gönder
  const msg = {
    id: tmpId, conv_id: convId, from: cu.username,
    type: 'text', text, status: 'sent',
    sensitive: true, created_at: now
  };
  try {
    await DB.createMessage({ ...msg, id: undefined });
    await DB.updateConversation(convId, { last_msg: '⚠️ Hassas içerik', last_time: now, last_from: cu.username });
    if (typeof renderChatList === 'function') renderChatList();
    await renderMessages();
  } catch(e) { UI.toast('Gönderilemedi', 'error'); }
}

// ── Konum Paylaşımı ────────────────────────────────────────────────
function shareLocation() {
  if (!window._currentConvId) { UI.toast('Önce bir sohbet seçin', 'info'); return; }
  if (!navigator.geolocation) { UI.toast('Tarayıcınız konum desteklemiyor', 'error'); return; }
  UI.toast('📍 Konum alınıyor…', 'info', 2000);
  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
      const text = `📍 **Konum Paylaştı**\n\`${lat.toFixed(6)}, ${lng.toFixed(6)}\`\nDoğruluk: ~${Math.round(accuracy)}m\n🗺 [Haritada Aç](${mapsUrl})`;
      const cu = window._currentUser;
      const now = Date.now();
      await DB.createMessage({ conv_id: window._currentConvId, from: cu.username, type: 'text', text, status: 'sent', created_at: now });
      await DB.updateConversation(window._currentConvId, { last_msg: '📍 Konum', last_time: now, last_from: cu.username });
      renderChatList();
      renderMessages();
      UI.toast('📍 Konum paylaşıldı (15dk)', 'success');
      // 15 dk sonra sona erdi bildirimi
      setTimeout(() => UI.toast('📍 Konum paylaşımı sona erdi', 'info'), 15 * 60 * 1000);
    },
    err => UI.toast('Konum alınamadı: ' + (err.message || 'İzin verilmedi'), 'error'),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ── Takvim Etkinliği ───────────────────────────────────────────────
function openEventCreate() {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 60);
  const local = new Date(now.getTime() - now.getTimezoneOffset()*60000).toISOString().slice(0,16);
  const dtEl = document.getElementById('event-datetime');
  if (dtEl) dtEl.value = local;
  document.getElementById('event-title').value = '';
  document.getElementById('event-location').value = '';
  document.getElementById('event-desc').value = '';
  UI.openModal('event-modal');
}

async function submitEvent() {
  const title = document.getElementById('event-title')?.value.trim();
  const dt = document.getElementById('event-datetime')?.value;
  const location2 = document.getElementById('event-location')?.value.trim();
  const desc = document.getElementById('event-desc')?.value.trim();
  if (!title) { UI.toast('Etkinlik adı girin', 'error'); return; }
  if (!dt) { UI.toast('Tarih/saat seçin', 'error'); return; }
  const d = new Date(dt);
  const dateStr = d.toLocaleDateString('tr-TR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const timeStr = d.toLocaleTimeString('tr-TR', { hour:'2-digit', minute:'2-digit' });
  let text = `📅 **ETKİNLİK: ${title}**\n⏰ ${dateStr} — ${timeStr}`;
  if (location2) text += `\n📍 ${location2}`;
  if (desc) text += `\n📝 ${desc}`;
  text += `\n\n*Katılıyor musun?* ✅ Evet  ❌ Hayır  🤔 Belki`;
  const cu = window._currentUser;
  const now = Date.now();
  try {
    await DB.createMessage({ conv_id: window._currentConvId, from: cu.username, type: 'text', text, status: 'sent', created_at: now });
    await DB.updateConversation(window._currentConvId, { last_msg: `📅 ${title}`, last_time: now, last_from: cu.username });
    UI.closeModal('event-modal');
    renderChatList();
    renderMessages();
    UI.toast('📅 Etkinlik gönderildi ✓', 'success');
  } catch(e) { UI.toast('Gönderilemedi: ' + e.message, 'error'); }
}

// ── Otomatik Çeviri ────────────────────────────────────────────────
async function translateMessage(text, targetLang='tr') {
  // Google Translate API (ücretsiz endpoint)
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    const data = await res.json();
    const translated = data[0]?.map(s => s?.[0] || '').join('') || '';
    const detectedLang = data[2] || 'auto';
    return { translated, detectedLang };
  } catch(e) { return null; }
}

// ── Rozet Otomatik Sistemi ─────────────────────────────────────────
async function checkAndAwardBadges() {
  const cu = window._currentUser;
  if (!cu) return;
  try {
    const msgs = await DB.getAllUserMessages?.(cu.username).catch(() => null);
    if (!msgs) return;
    const msgCount = msgs.length;
    const currentBadges = new Set(cu.badges || []);
    let changed = false;

    if (msgCount >= 1 && !currentBadges.has('first_msg')) {
      currentBadges.add('first_msg'); changed = true;
      UI.toast('🏅 Rozet kazandın: İlk Mesaj!', 'success', 5000);
    }
    if (msgCount >= 100 && !currentBadges.has('chatter')) {
      currentBadges.add('chatter'); changed = true;
      UI.toast('🏅 Rozet kazandın: 100 Mesaj!', 'success', 5000);
    }
    if (msgCount >= 1000 && !currentBadges.has('veteran')) {
      currentBadges.add('veteran'); changed = true;
      UI.toast('🏅 Rozet kazandın: Veteran!', 'success', 5000);
    }
    if (changed) {
      const newBadges = [...currentBadges];
      await DB.updateUser(cu.username, { badges: newBadges });
      window._currentUser.badges = newBadges;
      if (_allUsers[cu.username]) _allUsers[cu.username].badges = newBadges;
    }
  } catch {}
}

// ── Bot Komutlar Modal ─────────────────────────────────────────────
function showBotCommands() {
  const cipherCmds = [
    ['/yardım','Tüm komutları listeler'],
    ['/kimlik','Kullanıcı adı ve bilgiler'],
    ['/key [uzunluk]','Güvenli anahtar üretir'],
    ['/binary <metin>','Binary\'ye çevirir'],
    ['/debinary <01>','Binary\'den çevirir'],
    ['/morse <metin>','Morse\'a çevirir'],
    ['/demorse <...>','Morse\'dan çevirir'],
    ['/status','Bot durumu'],
    ['/version','Sürüm notları'],
    ['/uptime','Çalışma süresi'],
    ['/hatırla <süre> <not>','Hatırlatıcı'],
  ];
  const mathCmds = [
    ['<işlem>','Doğrudan hesap: 2+3*4'],
    ['/çöz <denklem>','3x+5=20'],
    ['/kareçöz a b c','ax²+bx+c=0'],
    ['/asal <n>','Asal mı?'],
    ['/çarpan <n>','Asal çarpanlar'],
    ['/obeb a b','OBEB hesapla'],
    ['/okek a b','OKEK hesapla'],
    ['/türev <f> x=<n>','Sayısal türev'],
    ['/integral <f> a b','Belirli integral'],
    ['/status','Bot durumu'],
  ];

  const buildList = (containerId, cmds) => {
    const el = document.getElementById(containerId); if (!el) return;
    el.innerHTML = '';
    cmds.forEach(([cmd, desc]) => {
      const row = document.createElement('button');
      row.style.cssText = 'display:flex;align-items:start;gap:10px;padding:8px 10px;border-radius:8px;width:100%;text-align:left;background:transparent;border:none;cursor:pointer;transition:background .12s';
      row.onmouseenter = () => row.style.background = '#131D30';
      row.onmouseleave = () => row.style.background = 'transparent';
      row.innerHTML = `<span style="font-size:12px;font-family:'JetBrains Mono',monospace;color:#00FFB3;flex-shrink:0;min-width:120px">${cmd}</span><span style="font-size:12px;color:#7A8FA8">${desc}</span>`;
      row.onclick = () => {
        const input = document.getElementById('msg-input');
        if (input) { input.value = cmd.includes('<') ? cmd.split('<')[0].trim() + ' ' : cmd + ' '; input.focus(); }
        UI.closeModal('bot-commands-modal');
      };
      el.appendChild(row);
    });
  };

  buildList('bot-cmd-list-cipher', cipherCmds);
  buildList('bot-cmd-list-math', mathCmds);
  UI.openModal('bot-commands-modal');
}

// ── Hatırlatıcı Bot Komutu ─────────────────────────────────────────
function _parseReminderTime(str) {
  const match = str.match(/^(\d+)(sn|s|dk|d|sa|h|g)$/i);
  if (!match) return null;
  const n = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const ms = { sn:1000, s:1000, dk:60000, d:60000, sa:3600000, h:3600000, g:86400000 }[unit];
  return n * (ms || 0);
}

// ── Anket 2.0 — süreli anket desteği ──────────────────────────────
async function submitPoll() {
  const question = document.getElementById('poll-question')?.value.trim();
  if (!question) { UI.toast('Soru girin', 'error'); return; }
  const opts = Array.from(document.querySelectorAll('.poll-opt')).map(i => i.value.trim()).filter(Boolean);
  if (opts.length < 2) { UI.toast('En az 2 seçenek girin', 'error'); return; }
  const convId = window._currentConvId;
  if (!convId) return;
  const durSecs = parseInt(document.getElementById('poll-duration')?.value || '0');
  const expiresAt = durSecs > 0 ? Date.now() + durSecs * 1000 : null;
  const poll = { question, options: opts, votes: Object.fromEntries(opts.map(o => [o, []])), expiresAt };
  try {
    await DB.createMessage({ conv_id: convId, from: window._currentUser.username, type: 'poll', text: question, poll_data: JSON.stringify(poll), status: 'sent', created_at: Date.now() });
    await DB.updateConversation(convId, { last_msg: `📊 ${question}`, last_time: Date.now(), last_from: window._currentUser.username });
    UI.closeModal('poll-modal');
    window._onNewMessage?.();
    UI.toast('Anket gönderildi ✓', 'success');
  } catch(e) { UI.toast('Gönderilemedi: ' + e.message, 'error'); }
}

// ── MathBot ensure ────────────────────────────────────────────────
async function ensureMathBotUser() {
  const existing = await DB.getUser(MATHBOT_ID).catch(() => null);
  if (existing) return existing;
  const hash = await DB.hashPassword('mathbot_system_' + Date.now());
  return DB.createUser({
    username: MATHBOT_ID, password_hash: hash,
    display_name: 'MathBot 🧮', bio: 'Matematik sorularını çözerim',
    is_admin: false, badges: ['verified'], banner_color: '#0A1628',
    status: '7/24 Matematik', status_emoji: '🧮', avatar_url: null,
    created_at: Date.now()
  }).catch(() => null);
}


const _BOT_ID = 'cipher_bot';
const _BOT_START = Date.now(); // uptime başlangıcı

async function ensureBotConversation() {
  const bot=await DB.getUser(_BOT_ID).catch(()=>null); if(!bot)return;
  const ids=[_BOT_ID,window._currentUser.username].sort();
  const convId=ids.join('_');
  const existing=await DB.getConversation(convId).catch(()=>null); if(existing)return;
  const now=Date.now();
  const welcome=`👋 Merhaba ${window._currentUser.display_name||window._currentUser.username}! Ben **CIPHER Bot** 🔐\n\nKomutları görmek için **/yardım** yaz.`;
  await DB.createConversation({id:convId,type:'direct',participants:ids,last_msg:welcome,last_time:now,unread_for:{[window._currentUser.username]:1},server:'public'});
  await DB.createMessage({conv_id:convId,from:_BOT_ID,type:'text',text:welcome,status:'sent',created_at:now});
}

function _isBotConv(convId) {
  if (!convId) return false;
  const ids = [_BOT_ID, window._currentUser?.username].sort();
  return convId === ids.join('_');
}

async function _botReply(convId, text) {
  const now = Date.now();
  const msg = { conv_id:convId, from:_BOT_ID, type:'text', text, status:'sent', created_at:now };
  try {
    await DB.createMessage(msg);
    await DB.updateConversation(convId, { last_msg: text.slice(0,60).replace(/\*\*/g,''), last_time: now });
    await loadConversations();
  } catch(e) { console.error('botReply:', e); }
}

function _botGenerateKey(len=32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => chars[b % chars.length]).join('');
}

function _botToBinary(text) {
  return text.split('').map(c => c.charCodeAt(0).toString(2).padStart(8,'0')).join(' ');
}

function _botFromBinary(bin) {
  try {
    return bin.trim().split(/\s+/).map(b => String.fromCharCode(parseInt(b,2))).join('');
  } catch { return null; }
}

const _MORSE = {
  'A':'.-','B':'-...','C':'-.-.','D':'-..','E':'.','F':'..-.','G':'--.','H':'....','I':'..','J':'.---',
  'K':'-.-','L':'.-..','M':'--','N':'-.','O':'---','P':'.--.','Q':'--.-','R':'.-.','S':'...','T':'-',
  'U':'..-','V':'...-','W':'.--','X':'-..-','Y':'-.--','Z':'--..',
  '0':'-----','1':'.----','2':'..---','3':'...--','4':'....-','5':'.....','6':'-....','7':'--...','8':'---..','9':'----.',
  '.':'.-.-.-',',':'--..--','?':'..--..','!':'-.-.--','/':'-..-.','(':'-.--.',')':`-.--.-`,
  '&':'.-...',':':'---...',';':'-.-.-.','=':'-...-','+':'.-.-.','_':'..--.-','"':'.-..-.','$':'...-..-','@':'.--.-.','\'':'.----.'
};
const _MORSE_REV = Object.fromEntries(Object.entries(_MORSE).map(([k,v])=>[v,k]));

function _botToMorse(text) {
  return text.toUpperCase().split('').map(c => c === ' ' ? '/' : (_MORSE[c] || '?')).join(' ');
}
function _botFromMorse(morse) {
  try {
    return morse.trim().split(' / ').map(word =>
      word.split(' ').map(sym => _MORSE_REV[sym] || '?').join('')
    ).join(' ');
  } catch { return null; }
}

function _botFmtUptime(ms) {
  const s=Math.floor(ms/1000), m=Math.floor(s/60), h=Math.floor(m/60), d=Math.floor(h/24);
  if(d>0) return `${d}g ${h%24}s ${m%60}dk`;
  if(h>0) return `${h}s ${m%60}dk ${s%60}sn`;
  if(m>0) return `${m}dk ${s%60}sn`;
  return `${s}sn`;
}

async function handleBotCommand(convId, rawText) {
  const text = rawText.trim();
  if (!text.startsWith('/')) return false;

  const parts = text.slice(1).split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');
  const cu = window._currentUser;

  // Sadece bot konuşmasında çalış
  if (!_isBotConv(convId)) return false;

  let reply = '';

  switch(cmd) {

    case 'kimlik': {
      reply =
`🪪 **KİMLİK BİLGİLERİ**
━━━━━━━━━━━━━━━━━━━━
👤 Kullanıcı Adı : \`${cu.username}\`
✨ Görünen Ad     : \`${cu.display_name || '(ayarlanmamış)'}\`
📝 Bio            : ${cu.bio || '(boş)'}
🏅 Rozetler       : ${(cu.badges||[]).length > 0 ? cu.badges.join(', ') : 'yok'}
📅 Kayıt          : ${new Date(cu.created_at||Date.now()).toLocaleDateString('tr-TR')}`;
      break;
    }

    case 'yardim':
    case 'yardım': {
      reply =
`🤖 **CIPHER BOT — KOMUTLAR**
━━━━━━━━━━━━━━━━━━━━━━━━━━

👤 **Kimlik & Bilgi**
  \`/kimlik\`       — Kullanıcı adı ve görünen ad
  \`/status\`       — Bot durumu ve işlem yükü
  \`/version\`      — Sürüm notları
  \`/uptime\`       — Çalışma süresi

🔐 **Güvenlik**
  \`/key\`          — Rastgele güvenli anahtar üret
  \`/key 64\`       — İstediğin uzunlukta anahtar

🔢 **Şifreleme**
  \`/binary <metin>\`  — Binary'ye çevir
  \`/debinary <01>\`   — Binary'den çevir
  \`/morse <metin>\`   — Morse'a çevir
  \`/demorse <...>\`   — Morse'dan çevir

━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 Komutlar sadece bu sohbette çalışır.`;
      break;
    }

    case 'key': {
      const len = Math.min(Math.max(parseInt(args)||32, 8), 128);
      const key = _botGenerateKey(len);
      reply =
`🔑 **GÜVENLİ ANAHTAR (${len} karakter)**
━━━━━━━━━━━━━━━━━━━━
\`${key}\`
━━━━━━━━━━━━━━━━━━━━
🔒 Bu anahtarı güvenli bir yerde sakla.
💡 Farklı uzunluk için: \`/key 64\``;
      break;
    }

    case 'binary': {
      if (!args) { reply = '⚠️ Kullanım: `/binary Merhaba Dünya`'; break; }
      const bin = _botToBinary(args);
      reply =
`🔢 **BINARY ŞİFRELEME**
━━━━━━━━━━━━━━━━━━━━
Girdi: \`${args}\`
━━━━━━━━━━━━━━━━━━━━
\`${bin}\`
━━━━━━━━━━━━━━━━━━━━
💡 Geri çevirmek için: \`/debinary ${bin.slice(0,16)}...\``;
      break;
    }

    case 'debinary': {
      if (!args) { reply = '⚠️ Kullanım: `/debinary 01001101 01101101`'; break; }
      const decoded = _botFromBinary(args);
      if (decoded === null) { reply = '❌ Geçersiz binary giriş. Sadece 0 ve 1 kullan.'; break; }
      reply =
`🔓 **BINARY ÇÖZME**
━━━━━━━━━━━━━━━━━━━━
Binary: \`${args.slice(0,40)}${args.length>40?'...':''}\`
━━━━━━━━━━━━━━━━━━━━
Sonuç: **${decoded}**`;
      break;
    }

    case 'morse': {
      if (!args) { reply = '⚠️ Kullanım: `/morse SOS`'; break; }
      const morse = _botToMorse(args);
      reply =
`📡 **MORSE ŞİFRELEME**
━━━━━━━━━━━━━━━━━━━━
Girdi: \`${args.toUpperCase()}\`
━━━━━━━━━━━━━━━━━━━━
\`${morse}\`
━━━━━━━━━━━━━━━━━━━━
💡 Geri çevirmek için: \`/demorse ${morse.slice(0,20)}...\``;
      break;
    }

    case 'demorse': {
      if (!args) { reply = '⚠️ Kullanım: `/demorse ... --- ...`'; break; }
      const decoded = _botFromMorse(args);
      if (decoded === null) { reply = '❌ Geçersiz Morse giriş.'; break; }
      reply =
`📻 **MORSE ÇÖZME**
━━━━━━━━━━━━━━━━━━━━
Morse: \`${args.slice(0,40)}${args.length>40?'...':''}\`
━━━━━━━━━━━━━━━━━━━━
Sonuç: **${decoded}**`;
      break;
    }

    case 'status': {
      const mem = performance?.memory ? Math.round(performance.memory.usedJSHeapSize/1024/1024) : null;
      const convCount = (window._convs||[]).length;
      const userCount = Object.keys(window._allUsers||{}).length;
      reply =
`📊 **BOT DURUMU**
━━━━━━━━━━━━━━━━━━━━
🟢 Durum      : AKTİF
⚡ Versiyon   : ${CONFIG.APP_VERSION}
💬 Sohbetler  : ${convCount}
👥 Kullanıcı  : ${userCount}
${mem ? `🧠 Bellek     : ${mem} MB\n` : ''}🕒 Uptime      : ${_botFmtUptime(Date.now()-_BOT_START)}
━━━━━━━━━━━━━━━━━━━━
✅ Tüm sistemler normal.`;
      break;
    }

    case 'version': {
      reply =
`📦 **CIPHER BOT — SÜRÜM NOTLARI**
━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 **v${CONFIG.APP_VERSION}** (Güncel)
  • Bot komut motoru eklendi
  • /binary, /debinary şifreleme
  • /morse, /demorse Mors desteği
  • /key güvenli anahtar üretici
  • /kimlik, /status, /uptime

📌 **v3.7.x**
  • Grup kanalları ve sunucu çubuğu
  • Hikaye / Story özelliği
  • Zamanlı mesaj gönderimi

📌 **v3.6.x**
  • Uçtan uca şifreli mesajlar
  • Ekran görüntüsü koruması
  • GIF ve sticker desteği

━━━━━━━━━━━━━━━━━━━━━━━━━━
🔐 CIPHER — Güvenli iletişim platformu`;
      break;
    }

    case 'uptime': {
      const elapsed = Date.now() - _BOT_START;
      const ms = elapsed % 1000;
      const s  = Math.floor(elapsed/1000) % 60;
      const m  = Math.floor(elapsed/60000) % 60;
      const h  = Math.floor(elapsed/3600000) % 24;
      const d  = Math.floor(elapsed/86400000);
      reply =
`⏱️ **ÇALIŞMA SÜRESİ**
━━━━━━━━━━━━━━━━━━━━
${d > 0 ? `📅 Gün    : ${d}\n` : ''}⏰ Saat   : ${String(h).padStart(2,'0')}
⏱ Dakika  : ${String(m).padStart(2,'0')}
⏲ Saniye  : ${String(s).padStart(2,'0')}
━━━━━━━━━━━━━━━━━━━━
🔄 Toplam  : **${_botFmtUptime(elapsed)}**
🌐 Sayfa yüklendiğinden beri kesintisiz çalışıyor.`;
      break;
    }

    default: {
      reply = `❓ Bilinmeyen komut: \`/${cmd}\`\n\nMevcut komutlar için **/yardım** yaz.`;
      break;
    }
  }

  // Kısa gecikme — bot "yazıyor" hissi
  await new Promise(r => setTimeout(r, 420));
  await _botReply(convId, reply);
  return true;
}

// ── Forward ────────────────────────────────────────────────────────
function openForwardModal(msgId) {
  window._forwardMsgId = msgId;
  let modal = document.getElementById('forward-modal');
  if (!modal) { modal=document.createElement('div'); modal.id='forward-modal'; modal.className='fixed inset-0 z-50 hidden items-center justify-center'; modal.style.background='rgba(6,8,15,.92)'; document.body.appendChild(modal); }

  const sorted = [..._convs].filter(c=>c.id!==window._currentConvId).sort((a,b)=>(b.last_time||0)-(a.last_time||0));
  const frag = document.createDocumentFragment();
  sorted.forEach(conv => {
    const name=getConvName(conv); const color=getConvColor(conv);
    const other=conv.type==='direct'?_allUsers[conv.participants?.find(p=>p!==window._currentUser.username)]:null;
    const av=other?.avatar_url?`<img src="${_safeUrl(other.avatar_url)||''}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0">`:`<div style="width:32px;height:32px;min-width:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:${color}22;color:${color};font-family:Syne,sans-serif;flex-shrink:0">${UI.initials(name)}</div>`;
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;cursor:pointer;transition:background .12s';
    row.onmouseenter=()=>row.style.background='#131D30';
    row.onmouseleave=()=>row.style.background='transparent';
    row.innerHTML=`${av}<span style="font-size:13px;color:#DDE8F8">${name}</span>`;
    row.onclick=()=>forwardTo(conv.id);
    frag.appendChild(row);
  });

  const list=document.createElement('div');
  list.style.overflow='auto'; list.appendChild(frag);
  modal.innerHTML=`<div style="width:100%;max-width:320px;margin:0 12px;background:#0C1220;border:1px solid #1E2D45;border-radius:20px;max-height:70vh;display:flex;flex-direction:column;overflow:hidden;animation:slideUp .2s ease-out"><div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #1E2D45;flex-shrink:0"><span style="font-family:Syne,sans-serif;font-weight:700;color:#DDE8F8">↪ Mesajı İlet</span><button onclick="UI.closeModal('forward-modal')" style="color:#7A8FA8;background:none;border:none;cursor:pointer;font-size:18px">✕</button></div></div>`;
  modal.querySelector('div').appendChild(list);
  UI.openModal('forward-modal');
}

async function forwardTo(convId) {
  UI.closeModal('forward-modal');
  const msgId = window._forwardMsgId; if(!msgId)return;
  try {
    const msgs=await DB.getMessages(window._currentConvId);
    const orig=msgs.find(m=>m.id===msgId); if(!orig)return;
    const now=Date.now();
    const fwdText=orig.text?`↪ İletildi:\n${orig.text}`:'↪ İletildi';
    await DB.createMessage({conv_id:convId,from:window._currentUser.username,type:'text',text:fwdText,status:'sent',created_at:now});
    await DB.updateConversation(convId,{last_msg:fwdText.slice(0,40),last_time:now});
    await loadConversations();
    UI.toast('Mesaj iletildi ↪','success');
  } catch(e) { UI.toast('İletilemedi: '+e.message,'error'); }
}

// ── Screenshot ──────────────────────────────────────────────────────
function setupScreenshotDetection() {
  document.addEventListener('keydown', e => {
    if ((e.metaKey||e.ctrlKey)&&(e.key==='s'||e.key==='p')&&window._currentConvId) {
      e.preventDefault();
      document.getElementById('ss-overlay')?.classList.add('show');
      UI.toast('⚠️ Ekran görüntüsü engellendi','warn');
    }
  });
}

function startVoiceCall() { UI.toast('📞 Sesli arama (Demo)','info'); setTimeout(()=>UI.toast('Yanıt verilmiyor.','warn'),2500); }

// ── CCode (Promosyon Kodu) ─────────────────────────────────────────
const _CCODE_USED_KEY = () => 'cipher_ccode_used_' + (window._currentUser?.username || '');

function openCCodeRedeem() {
  const inp = document.getElementById('ccode-input');
  const res = document.getElementById('ccode-result');
  if (inp) inp.value = '';
  if (res) { res.style.display = 'none'; res.innerHTML = ''; }
  UI.openModal('ccode-redeem-modal');
  setTimeout(() => inp?.focus(), 200);
}

async function redeemCCode() {
  const code = (document.getElementById('ccode-input')?.value || '').trim().toUpperCase();
  const resEl = document.getElementById('ccode-result');
  if (!code) { UI.toast('Kod girin', 'error'); return; }

  // Kullanılmış kodları kontrol et
  const usedCodes = JSON.parse(localStorage.getItem(_CCODE_USED_KEY()) || '[]');
  if (usedCodes.includes(code)) {
    _showCCodeResult('error', '❌ Bu kodu daha önce kullandınız.');
    return;
  }

  // Admin panelinde oluşturulan kodları kontrol et
  const allCodes = JSON.parse(localStorage.getItem('cipher_admin_ccodes') || '[]');
  const codeEntry = allCodes.find(c => c.code === code && c.active);

  if (!codeEntry) {
    _showCCodeResult('error', '❌ Geçersiz veya süresi dolmuş kod.');
    return;
  }

  // Kod limiti kontrolü
  if (codeEntry.maxUses > 0 && (codeEntry.usedCount || 0) >= codeEntry.maxUses) {
    _showCCodeResult('error', '❌ Bu kodun kullanım limiti doldu.');
    return;
  }

  // Ödülü uygula
  const cu = window._currentUser;
  let rewardMsg = '';
  const updates = {};

  // Rozet ödülü
  if (codeEntry.badge) {
    const currentBadges = new Set(cu.badges || []);
    if (!currentBadges.has(codeEntry.badge)) {
      currentBadges.add(codeEntry.badge);
      updates.badges = [...currentBadges];
      const badgeDef = CONFIG.BADGES[codeEntry.badge];
      rewardMsg += `🏅 Rozet: **${badgeDef?.icon || ''} ${badgeDef?.label || codeEntry.badge}**\n`;
    }
  }

  // Sunucu rolü ödülü
  if (codeEntry.serverRole) {
    const defaults = {};
    Object.keys(CONFIG.SERVERS).forEach(k => defaults[k] = false);
    const existing = (typeof cu.server_roles === 'object' && cu.server_roles) ? cu.server_roles : {};
    const roles = { ...defaults, ...existing };
    if (!roles[codeEntry.serverRole]) {
      roles[codeEntry.serverRole] = true;
      updates.server_roles = roles;
      const srv = CONFIG.SERVERS[codeEntry.serverRole];
      rewardMsg += `${srv?.icon || '🌐'} Sunucu Erişimi: **${srv?.label || codeEntry.serverRole}**\n`;
    }
  }

  // Avatar ödülü
  if (codeEntry.avatarItem) {
    const currentItems = JSON.parse(localStorage.getItem('cipher_avatar_items_' + cu.username) || '[]');
    if (!currentItems.includes(codeEntry.avatarItem)) {
      currentItems.push(codeEntry.avatarItem);
      localStorage.setItem('cipher_avatar_items_' + cu.username, JSON.stringify(currentItems));
      rewardMsg += `🎨 Avatar Öğesi: **${codeEntry.avatarItem}**\n`;
    }
  }

  // Özel durum mesajı
  if (codeEntry.message) rewardMsg += `\n💬 ${codeEntry.message}`;

  // Veritabanına kaydet
  try {
    if (Object.keys(updates).length > 0) {
      await DB.updateUser(cu.username, updates);
      Object.assign(window._currentUser, updates);
      if (_allUsers[cu.username]) Object.assign(_allUsers[cu.username], updates);
    }

    // Kodu kullanıldı olarak işaretle
    usedCodes.push(code);
    localStorage.setItem(_CCODE_USED_KEY(), JSON.stringify(usedCodes));

    // Admin tarafında kullanım sayısını artır
    codeEntry.usedCount = (codeEntry.usedCount || 0) + 1;
    codeEntry.usedBy = [...(codeEntry.usedBy || []), cu.username];
    localStorage.setItem('cipher_admin_ccodes', JSON.stringify(allCodes));

    _showCCodeResult('success', `✅ **Kod başarıyla kullanıldı!**\n\n${rewardMsg || 'Ödülünüz uygulandı.'}`);
    renderMyAvatar();
    setTimeout(() => UI.closeModal('ccode-redeem-modal'), 3000);
  } catch(e) {
    _showCCodeResult('error', '❌ Ödül uygulanamadı: ' + e.message);
  }
}

function _showCCodeResult(type, text) {
  const el = document.getElementById('ccode-result');
  if (!el) return;
  const isSuccess = type === 'success';
  el.style.cssText = `display:block;padding:12px 14px;border-radius:10px;font-size:13px;line-height:1.6;background:${isSuccess ? 'rgba(0,255,179,.08)' : 'rgba(255,61,107,.08)'};border:1px solid ${isSuccess ? 'rgba(0,255,179,.3)' : 'rgba(255,61,107,.3)'};color:${isSuccess ? '#00FFB3' : '#FF3D6B'}`;
  el.innerHTML = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
}

// ── Boot ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Force HTTPS in production
  if (location.protocol === 'http:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    location.replace('https:' + location.href.slice(5));
    return;
  }
  await DB.init();
  await bootApp();
  Messages.initEvents();
  setupScreenshotDetection();

  // Long-press delegation for chat list pin (avoids per-item listeners)
  let _clPressTimer = null, _clPressId = null;
  document.getElementById('chat-list')?.addEventListener('pointerdown', e => {
    const item = e.target.closest('[data-conv-id]');
    if (!item) return;
    _clPressId = item.dataset.convId;
    _clPressTimer = setTimeout(() => {
      if (_clPressId) { togglePinChat(_clPressId); renderChatList(); _clPressId = null; }
    }, 600);
  });
  document.getElementById('chat-list')?.addEventListener('pointerup', () => { clearTimeout(_clPressTimer); _clPressId = null; });
  document.getElementById('chat-list')?.addEventListener('pointerleave', () => { clearTimeout(_clPressTimer); _clPressId = null; });

  // Global click handler - close overlays
  document.addEventListener('click', e => {
    if (!e.target.closest('#gif-picker') && !e.target.closest('[onclick*="toggleGif"]') && !e.target.closest('[data-action="gif"]'))
      { document.getElementById('gif-picker')?.classList.remove('open'); if(Messages) Messages._gifOpen=false; }
    if (!e.target.closest('#sticker-picker') && !e.target.closest('[onclick*="toggleSticker"]') && !e.target.closest('[data-action="sticker"]'))
      { document.getElementById('sticker-picker')?.classList.remove('open'); if(Messages) Messages._stickerOpen=false; }
    if (!e.target.closest('#reaction-picker') && !e.target.closest('.reaction-pill')) UI.hideReactionPicker();
    if (!e.target.closest('#profile-card') && !e.target.closest('[onclick*="showProfile"]')) document.getElementById('profile-card')?.classList.add('hidden');
    if (!e.target.closest('#ctx-menu')) document.getElementById('ctx-menu')?.classList.add('hidden');
  });
});

// ── Bitmoji / URL avatar ───────────────────────────────────────────
async function applyAvatarUrl() {
  const urlInput = document.getElementById('pe-avatar-url');
  const url = urlInput?.value.trim();
  if (!url) { UI.toast('URL girin', 'error'); return; }
  // Basic URL validation
  try { new URL(url); } catch { UI.toast('Geçersiz URL', 'error'); return; }
  // Show loading in preview
  const prev = document.getElementById('avatar-preview');
  if (prev) prev.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:24px">⏳</div>';
  // Test image loads
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = async () => {
    try {
      await DB.updateUser(window._currentUser.username, { avatar_url: url });
      window._currentUser.avatar_url = url;
      _allUsers[window._currentUser.username].avatar_url = url;
      renderMyAvatar();
      if (prev) {
      prev.innerHTML = '';
      const aImg = document.createElement('img');
      aImg.src = url; aImg.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
      prev.appendChild(aImg);
    }
      UI.toast('Fotoğraf güncellendi ✓', 'success');
      if (urlInput) urlInput.value = '';
    } catch(e) { UI.toast('Kaydedilemedi: ' + e.message, 'error'); }
  };
  img.onerror = () => {
    // URL might still work even if CORS blocks test — save it anyway
    DB.updateUser(window._currentUser.username, { avatar_url: url }).then(() => {
      window._currentUser.avatar_url = url;
      _allUsers[window._currentUser.username].avatar_url = url;
      renderMyAvatar();
      if (prev) {
      prev.innerHTML = '';
      const aImg = document.createElement('img');
      aImg.src = url; aImg.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
      prev.appendChild(aImg);
    }
      UI.toast('Fotoğraf güncellendi ✓', 'success');
      if (urlInput) urlInput.value = '';
    }).catch(e => UI.toast('Kaydedilemedi: ' + e.message, 'error'));
  };
  img.src = url;
}

// ── Change Password (in-app) ──────────────────────────────────────
function openChangePwd() {
  ['cp-old','cp-new','cp-new2'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  const errEl = document.getElementById('cp-err');
  if (errEl) errEl.style.display = 'none';
  UI.openModal('change-pwd-modal');
}

async function submitChangePwd() {
  const oldP = document.getElementById('cp-old')?.value;
  const newP = document.getElementById('cp-new')?.value;
  const newP2= document.getElementById('cp-new2')?.value;
  const errEl= document.getElementById('cp-err');
  if (errEl) errEl.style.display = 'none';

  if (!oldP || !newP || !newP2) { if(errEl){errEl.textContent='Tüm alanları doldurun.';errEl.style.display='';} return; }
  if (newP !== newP2) { if(errEl){errEl.textContent='Şifreler eşleşmiyor.';errEl.style.display='';} return; }
  if (newP.length < 6) { if(errEl){errEl.textContent='Şifre en az 6 karakter.';errEl.style.display='';} return; }

  try {
    await Auth.changePassword(window._currentUser.username, oldP, newP);
    UI.closeModal('change-pwd-modal');
    UI.toast('Şifre güncellendi ✓', 'success');
  } catch(e) {
    if (errEl) { errEl.textContent = e.message; errEl.style.display = ''; }
  }
}


// ══════════════════════════════════════════════════════════════════
// KİŞİSELLEŞTİRME SİSTEMİ v2
// config: customize/config.json  |  localStorage: cipher_custom_v2
// ══════════════════════════════════════════════════════════════════
const _CK2 = 'cipher_custom_v2';
let   _customizeCfg = null; // loaded from config.json

function _cGet()      { try { return JSON.parse(localStorage.getItem(_CK2) || '{}'); } catch { return {}; } }
function _cSet(patch) { localStorage.setItem(_CK2, JSON.stringify({ ..._cGet(), ...patch })); }

function _darker(hex) {
  try {
    const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16), f=.78;
    return '#'+[r,g,b].map(v=>Math.round(v*f).toString(16).padStart(2,'0')).join('');
  } catch { return '#00C48A'; }
}
function _mix(hex, base, alpha) {
  // Mix hex color with base at alpha opacity → returns hex
  try {
    const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
    const br = base==='transparent'?6:parseInt(base.slice(1,3)||'06',16);
    const bg = base==='transparent'?8:parseInt(base.slice(3,5)||'08',16);
    const bb = base==='transparent'?15:parseInt(base.slice(5,7)||'0F',16);
    const mr=Math.round(r*alpha+br*(1-alpha)), mg=Math.round(g*alpha+bg*(1-alpha)), mb=Math.round(b*alpha+bb*(1-alpha));
    return '#'+[mr,mg,mb].map(v=>Math.max(0,Math.min(255,v)).toString(16).padStart(2,'0')).join('');
  } catch { return '#0F3D2E'; }
}

// ── Sayfa açılınca uygula ─────────────────────────────────────────
function customizeApply() {
  const s = _cGet();

  // Tema rengi
  if (s.accent) {
    const acc = s.accent;
    const dark = _darker(acc);
    document.documentElement.style.setProperty('--accent',   acc);
    document.documentElement.style.setProperty('--accent-d', dark);
    document.documentElement.style.setProperty('--online',   acc);
    // Mesaj balonu renkleri --accent ile senkronize
    document.documentElement.style.setProperty('--bubble-sent-1',      _mix(acc, '#06080F', 0.18));
    document.documentElement.style.setProperty('--bubble-sent-2',      _mix(acc, '#06080F', 0.10));
    document.documentElement.style.setProperty('--bubble-sent-border', _mix(acc, 'transparent', 0.28));
  }

  // Sohbet arkaplanı
  const msgEl = document.getElementById('messages');
  if (msgEl) {
    if (s.bgFile) {
      msgEl.style.backgroundImage    = `url('customize/${s.bgFile}?v=1')`;
      msgEl.style.backgroundSize     = 'cover';
      msgEl.style.backgroundPosition = 'center';
      msgEl.style.backgroundRepeat   = 'no-repeat';
    } else {
      // Varsayılan: düz gri
      msgEl.style.backgroundImage = 'none';
      msgEl.style.backgroundColor = '#0D1424';
    }
  }

  // Logo
  if (s.logoFile) {
    _applyLogo(`customize/${s.logoFile}?v=1`);
  }
}

function _applyLogo(src) {
  // 1. Favicon (browser tab icon) — updates immediately
  let favicon = document.querySelector('link[rel="icon"]');
  if (!favicon) { favicon = document.createElement('link'); favicon.rel = 'icon'; favicon.type = 'image/png'; document.head.appendChild(favicon); }
  favicon.href = src;

  // 2. Apple touch icon — update link tag
  // NOTE: iOS caches this at "Add to Home Screen" time.
  // For the shortcut to update, user must re-add to home screen after changing logo.
  let apple = document.querySelector('link[rel="apple-touch-icon"]');
  if (!apple) { apple = document.createElement('link'); apple.rel = 'apple-touch-icon'; document.head.appendChild(apple); }
  apple.href = src;

  // 3. Update manifest dynamically so FUTURE installs use new logo
  const manifestLink = document.querySelector('link[rel="manifest"]');
  if (manifestLink) {
    // Create a dynamic manifest blob with updated icons
    const manifest = {
      name: 'CIPHER Messenger', short_name: 'CIPHER',
      start_url: './index.html', display: 'standalone',
      background_color: '#06080F', theme_color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#00FFB3',
      icons: [
        { src: src, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: src, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: src, sizes: '1024x1024', type: 'image/png', purpose: 'any maskable' },
      ]
    };
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    manifestLink.href = url;
  }
}

// ── Konfigürasyonu yükle, modalı aç ──────────────────────────────
async function openCustomize() {
  if (!_customizeCfg) {
    try {
      const r = await fetch('customize/config.json?t=' + Date.now());
      _customizeCfg = await r.json();
    } catch(e) {
      _customizeCfg = { logos:[], backgrounds:[], themes:[] };
      console.warn('customize/config.json yüklenemedi:', e);
    }
  }
  _renderCustomizeModal();
  UI.openModal('customize-modal');
}

function _renderCustomizeModal() {
  const cfg = _customizeCfg;
  const saved = _cGet();

  // ── TEMALAR ──────────────────────────────────────────────────
  const themeGrid = document.getElementById('cust-theme-grid');
  if (themeGrid && cfg.themes?.length) {
    themeGrid.innerHTML = '';
    cfg.themes.forEach(t => {
      const active = (saved.accent || '#00FFB3').toLowerCase() === t.accent.toLowerCase();
      const btn = document.createElement('button');
      btn.style.cssText = `width:44px;height:44px;border-radius:50%;background:${t.accent};border:3px solid ${active ? '#fff' : 'transparent'};cursor:pointer;transition:all .15s;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;flex-shrink:0`;
      btn.title = t.label;
      if (active) btn.innerHTML = `<span style="font-size:18px;color:#000;font-weight:700">✓</span>`;
      btn.onclick = () => {
        themeGrid.querySelectorAll('button').forEach(b => { b.style.borderColor='transparent'; b.innerHTML=''; });
        btn.style.borderColor = '#fff';
        btn.innerHTML = `<span style="font-size:18px;color:#000;font-weight:700">✓</span>`;
        const _a = t.accent;
        document.documentElement.style.setProperty('--accent',   _a);
        document.documentElement.style.setProperty('--accent-d', _darker(_a));
        document.documentElement.style.setProperty('--online',   _a);
        document.documentElement.style.setProperty('--bubble-sent-1',      _mix(_a,'#06080F',0.18));
        document.documentElement.style.setProperty('--bubble-sent-2',      _mix(_a,'#06080F',0.10));
        document.documentElement.style.setProperty('--bubble-sent-border', _mix(_a,'transparent',0.28));
        _cSet({ accent: t.accent });
        UI.toast(t.label + ' tema ✓', 'success');
      };
      themeGrid.appendChild(btn);
    });
  }

  // ── LOGOLAR ──────────────────────────────────────────────────
  const logoGrid = document.getElementById('cust-logo-grid');
  if (logoGrid) {
    if (!cfg.logos?.length) {
      logoGrid.innerHTML = '<div style="font-size:12px;color:#5A6E88">Logo seçeneği yok. customize/config.json dosyasına ekleyin.</div>';
    } else {
      logoGrid.innerHTML = '';
      cfg.logos.forEach(l => {
        const active = saved.logoFile === l.file;
        const wrap = document.createElement('button');
        wrap.style.cssText = `display:flex;flex-direction:column;align-items:center;gap:6px;background:transparent;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent`;
        const box = document.createElement('div');
        box.style.cssText = `width:56px;height:56px;border-radius:14px;overflow:hidden;border:2.5px solid ${active ? 'var(--accent)' : '#1E2D45'};background:#131D30;display:flex;align-items:center;justify-content:center;transition:border-color .15s;flex-shrink:0`;
        box.innerHTML = `<img src="customize/${l.file}?v=1" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML='<span style=font-size:22px>🔒</span>'">`;
        const lbl = document.createElement('span');
        lbl.style.cssText = 'font-size:10px;color:#7A8FA8;font-family:\'JetBrains Mono\',monospace';
        lbl.textContent = l.label;
        wrap.appendChild(box);
        wrap.appendChild(lbl);
        wrap.onclick = () => {
          logoGrid.querySelectorAll('div[style*="border"]').forEach(b => b.style.borderColor = '#1E2D45');
          box.style.borderColor = 'var(--accent)';
          _cSet({ logoFile: l.file });
          _applyLogo(`customize/${l.file}?v=1`);
          UI.toast(l.label + ' logo seçildi ✓', 'success');
        };
        logoGrid.appendChild(wrap);
      });
    }
  }

  // ── ARKAPLANLAR — kategorili ─────────────────────────────────
  const bgGrid = document.getElementById('cust-bg-grid');
  if (bgGrid) {
    bgGrid.innerHTML = '';
    const hasCats = cfg.backgrounds?.length && cfg.backgrounds[0]?.category;
    const categories = hasCats
      ? cfg.backgrounds
      : [{ category: null, items: cfg.backgrounds || [] }];

    const selectBg = (b, box) => {
      bgGrid.querySelectorAll('[data-bg-box]').forEach(el => el.style.borderColor = '#1E2D45');
      box.style.borderColor = 'var(--accent,#00FFB3)';
      const msgEl = document.getElementById('messages');
      if (b.file) {
        _cSet({ bgFile: b.file });
        if (msgEl) { msgEl.style.backgroundImage = `url('customize/${b.file}?v=1')`; msgEl.style.backgroundSize='cover'; msgEl.style.backgroundPosition='center'; msgEl.style.backgroundRepeat='no-repeat'; }
      } else {
        _cSet({ bgFile: '' });
        if (msgEl) { msgEl.style.backgroundImage = 'none'; msgEl.style.backgroundColor = '#0D1424'; }
      }
      UI.toast(b.label + ' ✓', 'success');
    };

    // Category tabs
    if (hasCats) {
      const tabBar = document.createElement('div');
      tabBar.style.cssText = 'display:flex;gap:6px;margin-bottom:12px;overflow-x:auto;padding-bottom:2px;-webkit-overflow-scrolling:touch';
      const itemsArea = document.createElement('div');
      itemsArea.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px';

      const showCat = catName => {
        tabBar.querySelectorAll('button').forEach(b => {
          const on = b.dataset.c === catName;
          b.style.background  = on ? 'rgba(0,255,179,.12)' : 'transparent';
          b.style.borderColor = on ? 'var(--accent,#00FFB3)' : '#1E2D45';
          b.style.color       = on ? 'var(--accent,#00FFB3)' : '#7A8FA8';
        });
        itemsArea.innerHTML = '';
        const cat = categories.find(c => c.category === catName);
        const items = cat?.items || [];
        if (!items.length) {
          itemsArea.innerHTML = '<div style="font-size:11px;color:#3A4A5A;padding:8px">Bu kategoriye arkaplan eklenmemiş.</div>';
          return;
        }
        items.forEach(b => {
          const active = b.file ? saved.bgFile === b.file : !saved.bgFile;
          const wrap = document.createElement('button');
          wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:5px;background:transparent;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent';
          const box = document.createElement('div');
          box.setAttribute('data-bg-box','1');
          box.style.cssText = `width:60px;height:60px;border-radius:12px;overflow:hidden;border:2.5px solid ${active?'var(--accent,#00FFB3)':'#1E2D45'};background:#0D1424;flex-shrink:0;transition:border-color .15s`;
          if (b.file) box.innerHTML = `<img src="customize/${b.file}?v=1" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.style.background='#0D1424'">`;
          else box.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:22px;color:#2A3A50">∅</div>';
          const lbl = document.createElement('span');
          lbl.style.cssText = "font-size:10px;color:#7A8FA8;font-family:'JetBrains Mono',monospace";
          lbl.textContent = b.label;
          wrap.appendChild(box); wrap.appendChild(lbl);
          wrap.onclick = () => selectBg(b, box);
          itemsArea.appendChild(wrap);
        });
      };

      categories.forEach((cat, i) => {
        const tab = document.createElement('button');
        tab.dataset.c = cat.category;
        tab.textContent = cat.category;
        tab.style.cssText = "padding:5px 12px;border-radius:20px;font-size:11px;font-family:'JetBrains Mono',monospace;cursor:pointer;transition:all .15s;white-space:nowrap;border:1px solid #1E2D45;color:#7A8FA8;background:transparent;flex-shrink:0";
        tab.onclick = () => showCat(cat.category);
        tabBar.appendChild(tab);
      });

      bgGrid.appendChild(tabBar);
      bgGrid.appendChild(itemsArea);
      showCat(categories[0].category);
    } else {
      // Flat list
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px';
      (categories[0]?.items || []).forEach(b => {
        const active = b.file ? saved.bgFile === b.file : !saved.bgFile;
        const wrap = document.createElement('button');
        wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:5px;background:transparent;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent';
        const box = document.createElement('div');
        box.setAttribute('data-bg-box','1');
        box.style.cssText = `width:60px;height:60px;border-radius:12px;overflow:hidden;border:2.5px solid ${active?'var(--accent,#00FFB3)':'#1E2D45'};background:#0D1424;flex-shrink:0;transition:border-color .15s`;
        if (b.file) box.innerHTML = `<img src="customize/${b.file}?v=1" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.style.background='#0D1424'">`;
        else box.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:22px;color:#2A3A50">∅</div>';
        const lbl = document.createElement('span');
        lbl.style.cssText = "font-size:10px;color:#7A8FA8;font-family:'JetBrains Mono',monospace";
        lbl.textContent = b.label;
        wrap.appendChild(box); wrap.appendChild(lbl);
        wrap.onclick = () => selectBg(b, box);
        row.appendChild(wrap);
      });
      bgGrid.appendChild(row);
    }
  }
}

// ── Pin / Unpin chat ──────────────────────────────────────────────
function togglePinChat(convId) {
  const pinned = JSON.parse(localStorage.getItem('cipher_pinned') || '[]');
  const idx = pinned.indexOf(convId);
  if (idx >= 0) pinned.splice(idx, 1);
  else pinned.push(convId);
  localStorage.setItem('cipher_pinned', JSON.stringify(pinned));
  UI.toast(idx >= 0 ? 'Sohbet sabitlemesi kaldırıldı' : '📌 Sohbet sabitlendi', 'info');
}

// ── Status mode (Çevrimiçi / Uzakta / Rahatsız Etmeyin) ──────────
function setStatusMode(mode) {
  const cu = window._currentUser;
  if (!cu) return;
  cu._statusMode = mode;
  // Persist in status_mode field (optional — may not exist in schema)
  DB.updateUser(cu.username, { status_mode: mode }).catch(() => {});
  localStorage.setItem('cipher_status_mode', mode);
  // Update heartbeat
  if (mode === 'dnd' || mode === 'away') {
    DB.updateUser(cu.username, { online: mode === 'away' ? false : true }).catch(() => {});
  }
  UI.toast({ online: '🟢 Çevrimiçi', away: '🟡 Uzakta', dnd: '🔴 Rahatsız Etmeyin' }[mode], 'info');
}

// Load saved status mode on boot
function _loadStatusMode() {
  const mode = localStorage.getItem('cipher_status_mode') || 'online';
  const sel = document.getElementById('status-mode-select');
  if (sel) sel.value = mode;
  if (window._currentUser) window._currentUser._statusMode = mode;
}

// ── Zamanlanmış Mesaj ────────────────────────────────────────────
function openScheduler() {
  const existing = document.getElementById('scheduler-bar');
  if (existing) { existing.remove(); window._scheduledSendAt = null; return; }
  const bar = document.createElement('div');
  bar.id = 'scheduler-bar';
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 12px;margin-bottom:8px;border-radius:10px;background:#071825;border:1px solid rgba(0,229,255,.25);flex-shrink:0';
  // Min = now
  const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  bar.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    <span style="font-size:11px;color:#00E5FF;font-family:'JetBrains Mono',monospace;flex-shrink:0">Zamanlanmış:</span>
    <input type="datetime-local" id="schedule-dt" min="${now.toISOString().slice(0,16)}"
      style="background:transparent;border:none;outline:none;font-size:11px;color:#DDE8F8;font-family:'JetBrains Mono',monospace;cursor:pointer;flex:1">
    <button onclick="clearScheduler()" style="color:#7A8FA8;background:none;border:none;cursor:pointer;font-size:16px">✕</button>`;
  const compose = document.getElementById('compose');
  if (compose) compose.insertBefore(bar, compose.firstChild);
}
function clearScheduler() {
  document.getElementById('scheduler-bar')?.remove();
  window._scheduledSendAt = null;
}

// ── Compose + menu ────────────────────────────────────────────────
function toggleComposePlus() {
  const m = document.getElementById('compose-plus-menu');
  if (!m) return;
  const open = m.style.display !== 'none';
  m.style.display = open ? 'none' : 'block';
  if (!open) {
    const hide = e => { if (!m.contains(e.target) && e.target.id !== 'compose-plus-btn') { m.style.display='none'; document.removeEventListener('click',hide); } };
    setTimeout(() => document.addEventListener('click', hide), 10);
  }
}
function closeComposePlus() { const m=document.getElementById('compose-plus-menu'); if(m) m.style.display='none'; }

// ── Poll (Anket) ──────────────────────────────────────────────────
function openPollCreate() {
  // Reset poll form
  const qEl = document.getElementById('poll-question');
  if (qEl) qEl.value = '';
  const wrap = document.getElementById('poll-options-wrap');
  if (wrap) {
    wrap.innerHTML = '<input class="poll-opt modal-inp" type="text" placeholder="Seçenek 1"><input class="poll-opt modal-inp" type="text" placeholder="Seçenek 2">';
  }
  UI.openModal('poll-modal');
}

function addPollOption() {
  const wrap = document.getElementById('poll-options-wrap');
  if (!wrap || wrap.children.length >= 6) return;
  const inp = document.createElement('input');
  inp.className = 'poll-opt modal-inp';
  inp.type = 'text';
  inp.placeholder = `Seçenek ${wrap.children.length + 1}`;
  wrap.appendChild(inp);
}

async function submitPoll() {
  const question = document.getElementById('poll-question')?.value.trim();
  if (!question) { UI.toast('Soru girin', 'error'); return; }
  const opts = Array.from(document.querySelectorAll('.poll-opt')).map(i => i.value.trim()).filter(Boolean);
  if (opts.length < 2) { UI.toast('En az 2 seçenek girin', 'error'); return; }
  const convId = window._currentConvId;
  if (!convId) return;
  const poll = { question, options: opts, votes: Object.fromEntries(opts.map(o => [o, []])) };
  try {
    await DB.createMessage({ conv_id:convId, from:window._currentUser.username, type:'poll', text:question, poll_data:JSON.stringify(poll), status:'sent', created_at:Date.now() });
    await DB.updateConversation(convId, { last_msg:`📊 ${question}`, last_time:Date.now(), last_from:window._currentUser.username });
    UI.closeModal('poll-modal');
    window._onNewMessage?.();
    UI.toast('Anket gönderildi ✓', 'success');
  } catch(e) { UI.toast('Gönderilemedi: ' + e.message, 'error'); }
}

async function votePoll(msgId, option) {
  const convId = window._currentConvId;
  if (!convId || !window._currentUser) return;
  let msgs;
  try { msgs = await DB.getMessages(convId); }
  catch(e) { UI.toast('Oy verilemedi', 'error'); return; }
  const msg = msgs.find(m => m.id === msgId);
  if (!msg || !msg.poll_data) return;
  const poll = JSON.parse(msg.poll_data);
  const username = window._currentUser.username;
  // Remove previous vote
  Object.values(poll.votes).forEach(voters => { const i = voters.indexOf(username); if (i >= 0) voters.splice(i, 1); });
  // Add new vote
  if (!poll.votes[option]) poll.votes[option] = [];
  poll.votes[option].push(username);
  try {
    await DB.updateMessage(convId, msgId, { poll_data: JSON.stringify(poll) });
    window._onNewMessage?.();
  } catch(e) { UI.toast('Oy verilemedi', 'error'); }
}

// ── Offline Outbox ────────────────────────────────────────────────
const _OUTBOX = 'cipher_outbox_v2';

function outboxAdd(convId, text) {
  const q = JSON.parse(localStorage.getItem(_OUTBOX) || '[]');
  q.push({ convId, text, ts: Date.now(), id: 'ob_' + Date.now() });
  localStorage.setItem(_OUTBOX, JSON.stringify(q));
  UI.toast('📭 Çevrimdışı — mesaj kuyruğa alındı', 'warn');
}

async function outboxFlush() {
  if (!window._currentUser?.username) return;
  const q = JSON.parse(localStorage.getItem(_OUTBOX) || '[]');
  if (!q.length || !navigator.onLine) return;
  localStorage.setItem(_OUTBOX, '[]');
  let sent = 0;
  for (const item of q) {
    try {
      const now = item.ts || Date.now();
      await DB.createMessage({ conv_id: item.convId, from: window._currentUser?.username, type: 'text', text: item.text, status: 'sent', created_at: now });
      await DB.updateConversation(item.convId, { last_msg: item.text, last_time: now, last_from: window._currentUser?.username });
      sent++;
    } catch(e) {
      // Re-queue failed items
      const remaining = JSON.parse(localStorage.getItem(_OUTBOX) || '[]');
      remaining.push(item);
      localStorage.setItem(_OUTBOX, JSON.stringify(remaining));
    }
  }
  if (sent > 0) {
    window._onNewMessage?.();
    UI.toast(`📤 ${sent} kuyruk mesajı gönderildi`, 'success');
  }
}

// Hook into send: if offline, queue instead
window.addEventListener('online', () => {
  UI.toast('🌐 Bağlantı yeniden kuruldu', 'success');
  outboxFlush();
});
window.addEventListener('offline', () => UI.toast('📡 Çevrimdışı mod', 'warn'));

// Outbox handled inside sendMessage()

// ══════════════════════════════════════════════════════════════════
// ORTAK DÖKÜMAN & GÖRSEL DÜZENLEYICI
// ══════════════════════════════════════════════════════════════════
let _drawTool = 'pen', _drawing = false, _drawStart = {x:0,y:0};
let _canvasHistory = [], _canvasHistoryIdx = -1;

function openDocEditor() {
  if (!window._currentConvId) { UI.toast('Önce bir sohbet seçin', 'error'); return; }
  switchDocTab('text');
  const titleEl = document.getElementById('doc-title');
  const contentEl = document.getElementById('doc-content');
  if (titleEl) titleEl.value = '';
  if (contentEl) contentEl.innerHTML = '';
  UI.openModal('doc-editor-modal');
  requestAnimationFrame(() => initCanvas());
}

function switchDocTab(tab) {
  document.getElementById('doc-text-panel').style.display = tab === 'text' ? 'flex' : 'none';
  document.getElementById('doc-draw-panel').style.display = tab === 'draw' ? 'flex' : 'none';
  document.getElementById('doc-tab-text').style.cssText = tab === 'text'
    ? 'padding:5px 14px;border-radius:8px;border:1px solid var(--accent,#00FFB3);background:rgba(0,255,179,.12);color:var(--accent,#00FFB3);font-size:12px;cursor:pointer;font-family:\'JetBrains Mono\',monospace;font-weight:600'
    : 'padding:5px 14px;border-radius:8px;border:1px solid #1E2D45;background:transparent;color:#7A8FA8;font-size:12px;cursor:pointer;font-family:\'JetBrains Mono\',monospace';
  document.getElementById('doc-tab-draw').style.cssText = tab === 'draw'
    ? 'padding:5px 14px;border-radius:8px;border:1px solid var(--accent,#00FFB3);background:rgba(0,255,179,.12);color:var(--accent,#00FFB3);font-size:12px;cursor:pointer;font-family:\'JetBrains Mono\',monospace;font-weight:600'
    : 'padding:5px 14px;border-radius:8px;border:1px solid #1E2D45;background:transparent;color:#7A8FA8;font-size:12px;cursor:pointer;font-family:\'JetBrains Mono\',monospace';
  if (tab === 'draw') requestAnimationFrame(() => initCanvas());
}

function docCmd(cmd, val) {
  document.getElementById('doc-content')?.focus();
  document.execCommand(cmd, false, val || null);
}

// ── Canvas drawing ────────────────────────────────────────────────
function initCanvas() {
  const canvas = document.getElementById('draw-canvas');
  if (!canvas) return;
  // Re-init if panel size changed or first open
  const panel = document.getElementById('doc-draw-panel');
  const panelW = panel?.offsetWidth || 0;
  if (canvas._initialized && canvas._initW === panelW) return;
  canvas._initialized = true;
  canvas._initW = panelW;
  const resize = () => {
    const data = canvas.toDataURL();
    canvas.width  = panel.offsetWidth;
    canvas.height = panel.offsetHeight - 48;
    // Restore
    const img = new Image();
    img.onload = () => canvas.getContext('2d').drawImage(img, 0, 0);
    img.src = data;
  };
  resize();
  new ResizeObserver(resize).observe(panel);
  _saveCanvasState();

  // Events
  const getPos = e => {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - r.left, y: src.clientY - r.top };
  };

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    _drawing = true;
    _drawStart = getPos(e);
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(_drawStart.x, _drawStart.y);
  });

  canvas.addEventListener('pointermove', e => {
    e.preventDefault();
    if (!_drawing) return;
    const pos = getPos(e);
    const ctx = canvas.getContext('2d');
    const color = document.getElementById('draw-color')?.value || '#00FFB3';
    const size  = +document.getElementById('draw-size')?.value || 4;

    if (_drawTool === 'pen' || _drawTool === 'eraser') {
      ctx.lineWidth   = _drawTool === 'eraser' ? size * 4 : size;
      ctx.strokeStyle = _drawTool === 'eraser' ? '#06080F' : color;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }
  });

  canvas.addEventListener('pointerup', e => {
    e.preventDefault();
    if (!_drawing) return;
    _drawing = false;
    const pos = getPos(e);
    const ctx = canvas.getContext('2d');
    const color = document.getElementById('draw-color')?.value || '#00FFB3';
    const size  = +document.getElementById('draw-size')?.value || 4;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = size;

    if (_drawTool === 'line') {
      ctx.beginPath(); ctx.moveTo(_drawStart.x, _drawStart.y);
      ctx.lineTo(pos.x, pos.y); ctx.stroke();
    } else if (_drawTool === 'rect') {
      ctx.strokeRect(_drawStart.x, _drawStart.y, pos.x - _drawStart.x, pos.y - _drawStart.y);
    } else if (_drawTool === 'circle') {
      const rx = Math.abs(pos.x - _drawStart.x) / 2, ry = Math.abs(pos.y - _drawStart.y) / 2;
      ctx.beginPath();
      ctx.ellipse(_drawStart.x + (pos.x - _drawStart.x)/2, _drawStart.y + (pos.y - _drawStart.y)/2, rx, ry, 0, 0, Math.PI*2);
      ctx.stroke();
    } else if (_drawTool === 'text') {
      const txt = prompt('Metin:'); if (!txt) return;
      ctx.font = `${size * 4}px 'DM Sans', sans-serif`;
      ctx.fillText(txt, _drawStart.x, _drawStart.y);
    }
    _saveCanvasState();
  });
}

function setDrawTool(tool) {
  _drawTool = tool;
  document.querySelectorAll('[id^="dt-"]').forEach(b => b.classList.remove('active-tool'));
  document.getElementById('dt-' + tool)?.classList.add('active-tool');
}

function _saveCanvasState() {
  const canvas = document.getElementById('draw-canvas'); if (!canvas) return;
  _canvasHistory = _canvasHistory.slice(0, _canvasHistoryIdx + 1);
  _canvasHistory.push(canvas.toDataURL());
  if (_canvasHistory.length > 20) _canvasHistory = _canvasHistory.slice(-20);
  _canvasHistoryIdx = _canvasHistory.length - 1;
}

function undoCanvas() {
  if (_canvasHistoryIdx <= 0) return;
  _canvasHistoryIdx--;
  const canvas = document.getElementById('draw-canvas'); if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.onload = () => { ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0); };
  img.src = _canvasHistory[_canvasHistoryIdx];
}

function clearCanvas() {
  const canvas = document.getElementById('draw-canvas'); if (!canvas) return;
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  _saveCanvasState();
}

// ── Save & send doc ───────────────────────────────────────────────
async function saveDoc() {
  const convId = window._currentConvId; if (!convId) { UI.toast('Önce bir sohbet seçin', 'error'); return; }
  const title   = document.getElementById('doc-title')?.value.trim() || 'Döküman';
  const textTab = document.getElementById('doc-text-panel').style.display !== 'none';

  try {
    let msgData;
    if (textTab) {
      const html = document.getElementById('doc-content')?.innerHTML || '';
      if (!html.trim()) { UI.toast('Döküman boş', 'error'); return; }
      msgData = { conv_id:convId, from:window._currentUser.username, type:'doc', text:title, doc_html:html, status:'sent', created_at:Date.now() };
    } else {
      const canvas = document.getElementById('draw-canvas');
      const img64  = canvas.toDataURL('image/png');
      msgData = { conv_id:convId, from:window._currentUser.username, type:'file', file_type:'image/png', file_name:title+'.png', file_data:img64, text:'', status:'sent', created_at:Date.now() };
    }
    await Promise.all([
      DB.createMessage(msgData),
      DB.updateConversation(convId, { last_msg:`📄 ${title}`, last_time:Date.now(), last_from:window._currentUser.username }),
    ]);
    UI.closeModal('doc-editor-modal');
    window._onNewMessage?.();
    UI.toast('📄 Döküman gönderildi ✓', 'success');
  } catch(e) { UI.toast('Gönderilemedi: ' + e.message, 'error'); }
}

// ── Doc Viewer ────────────────────────────────────────────────────
function openDocViewer(msgId) {
  const convId = window._currentConvId;
  const msgs = Messages.getMsgs(convId);
  const msg = msgs.find(m => m.id === msgId);
  if (!msg?.doc_html) return;
  // Open in a simple overlay
  const existing = document.getElementById('doc-viewer-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'doc-viewer-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(6,8,15,.98);display:flex;flex-direction:column';
  overlay.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #1E2D45;background:#0A1018;flex-shrink:0">
      <span style="font-size:18px">📄</span>
      <span style="font-family:Syne,sans-serif;font-weight:700;color:#DDE8F8;flex:1">${msg.text||'Döküman'}</span>
      <button onclick="document.getElementById('doc-viewer-overlay').remove()" style="width:32px;height:32px;border-radius:8px;background:#131D30;border:1px solid #1E2D45;color:#7A8FA8;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center">✕</button>
    </div>
    <div id="doc-viewer-body" style="flex:1;overflow-y:auto;padding:24px;max-width:760px;margin:0 auto;width:100%;color:#DDE8F8;font-size:15px;line-height:1.7;font-family:'DM Sans',sans-serif"></div>`;
  document.body.appendChild(overlay);
  // Safe injection: only allow formatting tags, no scripts
  const body = overlay.querySelector('#doc-viewer-body');
  if (body) {
    // Strip script/iframe/on* attributes from doc_html
    const clean = (msg.doc_html || '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<iframe[^>]*>/gi, '')
      .replace(/\s+on\w+="[^"]*"/gi, '')
      .replace(/\s+on\w+='[^']*'/gi, '');
    body.innerHTML = clean;
  }
}


// ── Zamanlanmış mesaj kontrolü ───────────────────────────────────
setInterval(async () => {
  if (!window._currentUser?.username || !navigator.onLine) return;
  const q = JSON.parse(localStorage.getItem('cipher_scheduled') || '[]');
  if (!q.length) return;
  const now = Date.now(), toSend = [], keep = [];
  q.forEach(s => (s.sendAt <= now ? toSend : keep).push(s));
  if (!toSend.length) return;
  localStorage.setItem('cipher_scheduled', JSON.stringify(keep));
  for (const s of toSend) {
    try {
      await DB.createMessage({ conv_id:s.convId, from:window._currentUser.username, type:'text', text:s.text, status:'sent', created_at:s.sendAt });
      await DB.updateConversation(s.convId, { last_msg:s.text, last_time:s.sendAt, last_from:window._currentUser.username });
      window._onNewMessage?.();
    } catch(e) { keep.push(s); localStorage.setItem('cipher_scheduled', JSON.stringify([...keep])); }
  }
  if (toSend.length) UI.toast(`⏰ ${toSend.length} zamanlanmış mesaj gönderildi`, 'success');
}, 15000);

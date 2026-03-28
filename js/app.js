/**
 * CIPHER App v5
 * - Bottom nav: Mesajlar / Kişiler / Güncelleme
 * - Unread/Gruplar filtresi üste
 * - Profile tıklama → tam profil
 * - Grup tıklama → grup yönetim paneli
 */

let _allUsers = {}, _convs = [], _chatFilter = 'all', _searchQuery = '', _activeTab = 'messages';

// ── Boot ──────────────────────────────────────────────────────────
async function bootApp() {
  if (!Auth.requireAuth()) return;
  window._currentUser = await Auth.currentUser();
  if (!window._currentUser) { Auth.logout(); return; }

  if (window._supabaseNotConfigured || CONFIG.SUPABASE_URL.includes('YOUR_PROJECT')) {
    UI.toast('⚠️ Supabase ayarlanmamış — tek cihaz modu', 'warn', 8000);
  }

  const users = await DB.getAllUsers();
  users.forEach(u => { _allUsers[u.username] = u; });

  renderMyAvatar();
  renderServerBar();
  await ensureBotConversation();
  await loadConversations();
  await renderStories();
  loadSettings();
  PWA.init();
  setupScreenshotDetection();
  buildStickerTabs();
  Auth.startHeartbeat(window._currentUser.username);
  await requestPushPermission();

  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  window._onNewMessage = async () => {
    await loadConversations();
    if (window._currentConvId) await renderMessages();
  };

  window._onStorageSync = async (key) => {
    if (!key) return;
    if (key === 'convs') await loadConversations();
    if (key.startsWith('msgs_')) {
      const convId = key.slice(5);
      if (convId !== window._currentConvId || document.hidden) {
        const msgs = await DB.getMessages(convId);
        const last = msgs[msgs.length - 1];
        if (last && last.from !== window._currentUser.username) {
          const sender = _allUsers[last.from];
          addNotif(last.text || (last.type === 'gif' ? '🎬 GIF' : last.sticker || '📎'), last.from, convId);
          sendPushNotif(sender?.display_name || last.from, last.text || '📎 Medya', convId);
          const convs = await DB.getConversations(window._currentUser.username);
          const conv = convs.find(c => c.id === convId);
          if (conv) {
            const unread = (conv.unread_for?.[window._currentUser.username] || 0) + 1;
            conv.unread_for = { ...(conv.unread_for || {}), [window._currentUser.username]: unread };
            await DB.updateConversation(convId, { unread_for: conv.unread_for });
          }
        }
      }
      await loadConversations();
      if (key === 'msgs_' + window._currentConvId) await renderMessages();
    }
  };

  if (CONFIG.USE_SUPABASE && !window._supabaseNotConfigured) {
    DB.subscribeConversations?.(window._currentUser.username, async () => {
      await loadConversations();
    });
  }
}

// ── Bottom nav tab switching ───────────────────────────────────────
function setTab(tab) {
  _activeTab = tab;
  document.querySelectorAll('.bottom-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  document.getElementById('tab-messages').style.display = tab === 'messages' ? 'flex' : 'none';
  document.getElementById('tab-contacts').style.display = tab === 'contacts' ? 'flex' : 'none';
  document.getElementById('tab-updates').style.display = tab === 'updates' ? 'flex' : 'none';
  if (tab === 'contacts') { refreshAllUsers().then(renderContactsList); }
  if (tab === 'updates') renderUpdatesTab();
}

// ── Refresh users ─────────────────────────────────────────────────
async function refreshAllUsers() {
  const users = await DB.getAllUsers();
  users.forEach(u => { _allUsers[u.username] = u; });
}

// ── Server / Space system ─────────────────────────────────────────
let _activeServer = 'all';

function renderServerBar() {
  const bar = document.getElementById('server-bar');
  if (!bar) return;
  const cu = window._currentUser;
  bar.innerHTML = '';
  if (cu?.is_admin) {
    const btn = document.createElement('button');
    btn.className = 'server-btn' + (_activeServer === 'all' ? ' active' : '');
    btn.title = 'Tüm Sunucular'; btn.textContent = '🌐';
    btn.onclick = () => setServer('all');
    bar.appendChild(btn);
  }
  Object.values(CONFIG.SERVERS).forEach(srv => {
    if (!cu?.is_admin && !hasServerAccess(cu, srv.id)) return;
    const btn = document.createElement('button');
    btn.className = 'server-btn' + (_activeServer === srv.id ? ' active' : '');
    btn.title = srv.label + ' — ' + srv.desc;
    btn.textContent = srv.icon;
    btn.onclick = () => setServer(srv.id);
    bar.appendChild(btn);
  });
}

function hasServerAccess(user, serverId) {
  if (!user) return false;
  if (user.is_admin) return true;
  return user.server_roles?.[serverId] === true;
}

function setServer(id) {
  _activeServer = id;
  renderServerBar();
  renderChatList();
}

function convMatchesServer(conv) {
  if (_activeServer === 'all') return true;
  return (conv.server || 'public') === _activeServer;
}

// ── Push notifications ────────────────────────────────────────────
async function requestPushPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') UI.toast('🔔 Bildirimler aktif!', 'success');
  }
}

function sendPushNotif(title, body, convId) {
  if (Notification.permission !== 'granted' || !document.hidden) return;
  try {
    const n = new Notification(title, { body, icon: 'icons/icon-192.png', tag: convId, renotify: true });
    n.onclick = () => { window.focus(); if (convId) openConv(convId); n.close(); };
  } catch {}
}

// ── My avatar ─────────────────────────────────────────────────────
function renderMyAvatar() {
  const cu = window._currentUser;
  const el = document.getElementById('my-avatar');
  if (!el || !cu) return;
  if (cu.avatar_url) {
    el.innerHTML = `<img src="${cu.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
  } else {
    const c = UI.avatarColor(cu.username);
    el.style.background = `linear-gradient(135deg,${c},${c}99)`;
    el.style.color = '#fff';
    el.textContent = UI.initials(cu.display_name || cu.username);
  }
  document.getElementById('my-name').textContent = cu.display_name || cu.username;
}

// ── Sticker tabs ──────────────────────────────────────────────────
function buildStickerTabs() {
  const tabs = document.getElementById('sticker-pack-tabs');
  if (!tabs) return;
  tabs.innerHTML = '';
  Object.keys(CONFIG.STICKER_PACKS).forEach((pack, i) => {
    const btn = document.createElement('button');
    btn.className = 'sticker-pack-tab' + (i === 0 ? ' active' : '');
    btn.dataset.pack = pack;
    btn.textContent = pack;
    btn.onclick = () => Messages.renderStickerPack(pack);
    tabs.appendChild(btn);
  });
}

// ── Conversations ─────────────────────────────────────────────────
async function loadConversations() {
  _convs = await DB.getConversations(window._currentUser.username);
  renderChatList();
}

function getConvName(conv) {
  if (conv.type === 'group') return conv.name;
  const other = conv.participants.find(p => p !== window._currentUser?.username);
  return _allUsers[other]?.display_name || _allUsers[other]?.username || other;
}

function getConvColor(conv) {
  if (conv.type === 'group') return conv.banner_color || '#7A8FA8';
  const other = conv.participants.find(p => p !== window._currentUser?.username);
  return UI.avatarColor(_allUsers[other]?.username || other);
}

function renderChatList() {
  const list = document.getElementById('chat-list');
  if (!list) return;
  let items = [..._convs];
  if (_chatFilter === 'unread') items = items.filter(c => (c.unread_for?.[window._currentUser.username] || 0) > 0);
  if (_chatFilter === 'groups') items = items.filter(c => c.type === 'group');
  // Server filter
  items = items.filter(convMatchesServer);
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    items = items.filter(c => getConvName(c).toLowerCase().includes(q) || (c.last_msg || '').toLowerCase().includes(q));
  }
  // Sort: my messages NOT on top. Truly sort by last_time (most recent conv first)
  items.sort((a, b) => {
    const ta = typeof a.last_time === 'string' ? new Date(a.last_time).getTime() : (a.last_time || 0);
    const tb = typeof b.last_time === 'string' ? new Date(b.last_time).getTime() : (b.last_time || 0);
    return tb - ta;
  });
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div style="text-align:center;padding:32px 16px;font-size:13px;color:#7A8FA8">Sohbet yok</div>';
    return;
  }
  items.forEach(conv => {
    const name = getConvName(conv);
    const color = getConvColor(conv);
    const other = conv.type === 'direct' ? _allUsers[conv.participants.find(p => p !== window._currentUser.username)] : null;
    const unread = conv.unread_for?.[window._currentUser.username] || 0;
    const isActive = conv.id === window._currentConvId;

    const div = document.createElement('div');
    div.style.cssText = `display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:14px;cursor:pointer;margin:1px 6px;transition:background .15s;background:${isActive ? '#151E30' : 'transparent'}`;
    div.onmouseenter = () => { if (!isActive) div.style.background = '#0C1220'; };
    div.onmouseleave = () => { div.style.background = isActive ? '#151E30' : 'transparent'; };
    div.onclick = () => openConv(conv.id);

    const avHtml = other?.avatar_url
      ? `<img src="${other.avatar_url}" style="width:44px;height:44px;min-width:44px;border-radius:50%;object-fit:cover">`
      : `<div style="width:44px;height:44px;min-width:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;background:${color}22;color:${color};font-family:'Syne',sans-serif">${UI.initials(name)}</div>`;

    // Last sender: show who sent last message
    const lastSender = conv.last_from && conv.last_from !== window._currentUser?.username
      ? (_allUsers[conv.last_from]?.display_name || conv.last_from)
      : (conv.last_from === window._currentUser?.username ? 'Sen' : '');
    const msgCount = conv.msg_count || '';
    const lastMsgText = (conv.last_msg || '').slice(0, 36);
    const lastMsgPreview = conv.type === 'group' && lastSender
      ? `<span style="color:#00FFB3;font-size:10px;font-weight:600;margin-right:3px">${lastSender}:</span>${lastMsgText}`
      : lastMsgText;

    div.innerHTML = `${avHtml}
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
          <span style="font-weight:600;font-size:13px;font-family:'Syne',sans-serif;color:#DDE8F8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:148px">${name}</span>
          <span style="font-size:10px;color:#7A8FA8;font-family:'JetBrains Mono',monospace;flex-shrink:0;margin-left:4px">${conv.last_time ? UI.fmtTime(conv.last_time) : ''}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:12px;color:#7A8FA8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:155px">${lastMsgPreview}</span>
          <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;margin-left:4px">
            ${msgCount ? `<span style="font-size:10px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">${msgCount}</span>` : ''}
            ${unread > 0 ? `<span style="min-width:20px;height:20px;padding:0 5px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;background:#00FFB3;color:#062B1F;">${unread > 99 ? '99+' : unread}</span>` : ''}
          </div>
        </div>
      </div>`;
    list.appendChild(div);
  });
}

// ── Open conversation ──────────────────────────────────────────────
async function openConv(convId) {
  window._currentConvId = convId;
  const conv = _convs.find(c => c.id === convId);
  if (!conv) return;

  if ((conv.unread_for?.[window._currentUser.username] || 0) > 0) {
    if (!conv.unread_for) conv.unread_for = {};
    conv.unread_for[window._currentUser.username] = 0;
    await DB.updateConversation(convId, { unread_for: conv.unread_for });
  }

  window._isGroup = conv.type === 'group';
  const name = getConvName(conv);
  const color = getConvColor(conv);
  const other = conv.type === 'direct' ? _allUsers[conv.participants.find(p => p !== window._currentUser.username)] : null;

  const avEl = document.getElementById('chat-avatar');
  if (other?.avatar_url) {
    avEl.innerHTML = `<img src="${other.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
  } else {
    avEl.style.background = `${color}22`;
    avEl.style.color = color;
    avEl.textContent = conv.type === 'group' ? (conv.avatar || UI.initials(name)) : UI.initials(name);
  }
  document.getElementById('chat-name').textContent = name;
  {
    const statusEl = document.getElementById('chat-status');
    if (conv.type === 'group') {
      statusEl.textContent = `${conv.participants.length} üye · Grup`;
    } else {
      const st = UI.onlineStatus(other);
      statusEl.textContent = st.text;
      statusEl.style.color = st.color;
    }
  }

  // Avatar click: profile for DM, group panel for groups
  avEl.style.cursor = 'pointer';
  avEl.onclick = () => {
    if (conv.type === 'group') openGroupPanel(conv);
    else if (other) openUserProfile(other);
  };
  // Name click too
  document.getElementById('chat-name').style.cursor = 'pointer';
  document.getElementById('chat-name').onclick = () => {
    if (conv.type === 'group') openGroupPanel(conv);
    else if (other) openUserProfile(other);
  };

  // Block/report button visibility
  const brBtn = document.getElementById('block-report-btn');
  if (brBtn) brBtn.style.display = (conv.type === 'direct') ? 'flex' : 'none';

  document.getElementById('empty-state').style.display = 'none';
  const cv = document.getElementById('chat-view');
  cv.style.display = 'flex';
  cv.style.flexDirection = 'column';

  if (window.innerWidth < 768) {
    document.getElementById('sidebar').classList.add('slide-out');
    document.getElementById('chat-area').classList.add('slide-in');
    document.getElementById('back-btn').style.display = 'flex';
  }

  Messages.subscribeConv(convId);
  await renderMessages();
  renderChatList();
  Messages.closeAllPickers();
  setTimeout(() => document.getElementById('msg-input')?.focus(), 100);
}

// ── Render messages ───────────────────────────────────────────────
async function renderMessages(highlight = '') {
  if (!window._currentConvId) return;
  await Messages.renderAll(window._currentConvId, _allUsers, highlight);
}

// ── Back button ───────────────────────────────────────────────────
function backToSidebar() {
  document.getElementById('sidebar').classList.remove('slide-out');
  document.getElementById('chat-area').classList.remove('slide-in');
  document.getElementById('back-btn').style.display = 'none';
  Messages.closeAllPickers();
}

// ── Send ──────────────────────────────────────────────────────────
async function sendMessage() {
  if (!window._currentConvId) return;
  await Messages.send(window._currentConvId);
}

function handleMsgKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  if (e.key === 'Escape') Messages.closeAllPickers();
}

// ── User Profile Modal ────────────────────────────────────────────
function openUserProfile(user) {
  if (!user) return;
  const color = UI.avatarColor(user.username);
  const banner = user.banner_color || '#0A1628';
  const st = UI.onlineStatus(user);
  const badges = (user.badges || []).map(b => {
    const bd = CONFIG.BADGES[b];
    return bd ? `<span style="background:${bd.color}22;border:1px solid ${bd.color}44;color:${bd.color};padding:3px 10px;border-radius:20px;font-size:11px">${bd.icon} ${bd.label}</span>` : '';
  }).join('');
  const avHtml = user.avatar_url
    ? `<img src="${user.avatar_url}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid #0C1220">`
    : `<div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,${color},${color}99);color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;font-family:Syne,sans-serif;font-weight:700;border:3px solid #0C1220">${UI.initials(user.display_name || user.username)}</div>`;

  const el = document.getElementById('user-profile-content');
  if (!el) return;
  // Kapatma butonu profile content dışında (modal'da) — padding:0 ile banner tam köşeye oturur
  el.innerHTML = `
    <div style="height:90px;background:${banner};border-radius:20px 20px 0 0;position:relative;flex-shrink:0">
      <div style="position:absolute;bottom:-40px;left:20px">${avHtml}</div>
      ${user.is_admin ? '<span style="position:absolute;top:10px;left:20px;font-size:10px;padding:2px 8px;border-radius:20px;background:#FFD70022;color:#FFD700;border:1px solid #FFD70044">⚡ ADMİN</span>' : ''}
    </div>
    <div style="padding:48px 20px 20px">
      <div style="font-family:Syne,sans-serif;font-weight:700;font-size:20px;color:#DDE8F8">${user.display_name || user.username}</div>
      <div style="font-size:11px;color:#7A8FA8;font-family:'JetBrains Mono',monospace;margin-bottom:4px">@${user.username}</div>
      <div style="font-size:12px;color:${st.color};margin-bottom:8px">${st.text}</div>
      ${user.status ? `<div style="font-size:13px;color:#B0C4D8;margin-bottom:10px">${user.status_emoji || ''} ${user.status}</div>` : ''}
      ${user.bio ? `<div style="font-size:13px;color:#9AB0C8;line-height:1.6;margin-bottom:12px;padding:10px 12px;background:#06080F;border-radius:10px;border:1px solid #1E2D45">${user.bio}</div>` : ''}
      ${badges ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">${badges}</div>` : ''}
      <div style="font-size:11px;color:#7A8FA8;font-family:'JetBrains Mono',monospace;margin-bottom:4px">ÜYE OLDU</div>
      <div style="font-size:13px;color:#DDE8F8;margin-bottom:16px">${UI.fmtDate(user.created_at || Date.now())}</div>
      <div style="display:flex;gap:8px">
        <button id="profile-dm-btn" style="flex:1;padding:11px;border-radius:12px;background:linear-gradient(135deg,#00FFB3,#00C48A);color:#062B1F;font-weight:700;font-size:14px;border:none;cursor:pointer">💬 Mesaj Gönder</button>
        <button id="profile-more-btn" style="padding:11px 14px;border-radius:12px;background:#131D30;color:#7A8FA8;border:1px solid #1E2D45;cursor:pointer">⋯</button>
      </div>
    </div>`;
  // Wire buttons safely
  document.getElementById('profile-dm-btn').onclick = () => { UI.closeModal('user-profile-modal'); startDM(user.username); };
  document.getElementById('profile-more-btn').onclick = () => { window._brTarget = user.username; UI.closeModal('user-profile-modal'); UI.openModal('block-report-modal'); };
  UI.openModal('user-profile-modal');
}

window.showProfile = (username) => {
  const u = _allUsers[username];
  if (u) openUserProfile(u);
};

// ── Group Panel ───────────────────────────────────────────────────
function openGroupPanel(conv) {
  if (!conv) return;
  const el = document.getElementById('group-panel-content');
  if (!el) return;
  const color = getConvColor(conv);
  const isAdmin = conv.admin === window._currentUser.username;

  // Build header HTML
  const headerHtml = `
    <div style="text-align:center;padding-bottom:16px;border-bottom:1px solid #1E2D45;margin-bottom:16px">
      <div style="width:70px;height:70px;border-radius:50%;background:${color}22;color:${color};display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;font-family:Syne,sans-serif;margin:0 auto 10px">${conv.avatar || UI.initials(conv.name)}</div>
      ${isAdmin
        ? `<div style="display:flex;align-items:center;gap:8px;justify-content:center;margin-bottom:8px">
            <input id="gp-name-inp" value="${conv.name}" style="background:#06080F;border:1.5px solid #1E2D45;border-radius:8px;padding:6px 10px;font-size:14px;font-weight:700;color:#DDE8F8;font-family:Syne,sans-serif;text-align:center;outline:none;width:160px" onfocus="this.style.borderColor='#00FFB3'" onblur="this.style.borderColor='#1E2D45'">
            <button id="gp-save-btn" style="padding:6px 12px;border-radius:8px;background:#00FFB3;color:#062B1F;font-weight:700;font-size:12px;border:none;cursor:pointer">Kaydet</button>
          </div>`
        : `<div style="font-family:Syne,sans-serif;font-weight:700;font-size:18px;color:#DDE8F8;margin-bottom:4px">${conv.name}</div>`
      }
      <div style="font-size:12px;color:#7A8FA8">${conv.participants.length} üye</div>
    </div>
    ${isAdmin ? '<div style="margin-bottom:12px"><button id="gp-add-btn" style="width:100%;padding:10px;border-radius:10px;background:#131D30;color:#00FFB3;border:1px solid rgba(0,255,179,.2);font-size:13px;cursor:pointer;font-family:\'JetBrains Mono\',monospace">+ Üye Ekle</button></div>' : ''}
    <div style="font-size:10px;font-weight:600;color:#7A8FA8;font-family:\'JetBrains Mono\',monospace;margin-bottom:8px">ÜYELER</div>`;

  el.innerHTML = headerHtml;

  // Wire up save/add buttons safely
  const saveBtn = document.getElementById('gp-save-btn');
  if (saveBtn) saveBtn.onclick = () => saveGroupName(conv.id);
  const addBtn = document.getElementById('gp-add-btn');
  if (addBtn) addBtn.onclick = () => openAddMemberModal(conv.id);

  // Build members as DOM nodes (no inline eval)
  const membersDiv = document.createElement('div');
  membersDiv.style.cssText = 'display:flex;flex-direction:column;gap:2px';
  conv.participants.forEach(uid => {
    const u = _allUsers[uid] || { username: uid, display_name: uid };
    const c = UI.avatarColor(u.username);
    const isOwner = conv.admin === uid;
    // In group panel: group members have chatted → show avatar
    const av = u.avatar_url
      ? `<img src="${u.avatar_url}" style="width:40px;height:40px;border-radius:50%;object-fit:cover">`
      : `<div style="width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;background:${c}22;color:${c};font-family:Syne,sans-serif">${UI.initials(u.display_name || u.username)}</div>`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px;border-radius:12px;cursor:pointer;transition:background .15s';
    row.onmouseenter = () => row.style.background = '#131D30';
    row.onmouseleave = () => row.style.background = '';
    row.onclick = () => { const usr = _allUsers[uid]; if (usr) openUserProfile(usr); };
    row.innerHTML = `${av}<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:#DDE8F8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${u.display_name || u.username}</div><div style="font-size:11px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">@${uid}${isOwner ? ' · Yönetici ⚡' : ''}</div></div>`;
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

  // Leave button
  const footer = document.createElement('div');
  footer.style.cssText = 'margin-top:16px;padding-top:14px;border-top:1px solid #1E2D45';
  const leaveBtn = document.createElement('button');
  leaveBtn.style.cssText = 'width:100%;padding:10px;border-radius:10px;background:rgba(255,61,107,.08);color:#FF3D6B;border:1px solid rgba(255,61,107,.2);font-size:13px;cursor:pointer';
  leaveBtn.textContent = 'Gruptan Çık';
  leaveBtn.onclick = () => leaveGroup(conv.id);
  footer.appendChild(leaveBtn);
  el.appendChild(footer);

  UI.openModal('group-panel-modal');
}

async function saveGroupName(convId) {
  const inp = document.getElementById('gp-name-inp');
  const name = inp?.value.trim();
  if (!name) return;
  await DB.updateConversation(convId, { name });
  const conv = _convs.find(c => c.id === convId);
  if (conv) conv.name = name;
  renderChatList();
  document.getElementById('chat-name').textContent = name;
  UI.toast('Grup adı güncellendi ✓', 'success');
}

function openAddMemberModal(convId) {
  const conv = _convs.find(c => c.id === convId);
  if (!conv) return;
  const existing = new Set(conv.participants);
  const gc = document.getElementById('add-member-list');
  if (!gc) return;
  gc.innerHTML = '';
  Object.values(_allUsers)
    .filter(u => !existing.has(u.username))
    .forEach(u => {
      const c = UI.avatarColor(u.username);
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;cursor:pointer;transition:background .15s';
      div.onmouseenter = () => div.style.background = '#131D30';
      div.onmouseleave = () => div.style.background = 'transparent';
      div.innerHTML = `<input type="checkbox" value="${u.username}" style="width:16px;height:16px;accent-color:#00FFB3;flex-shrink:0">
        <div style="width:32px;height:32px;min-width:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:${c}22;color:${c};font-family:Syne,sans-serif">${UI.initials(u.display_name || u.username)}</div>
        <span style="font-size:13px;color:#DDE8F8">${u.display_name || u.username}</span>`;
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
  const conv = await DB.getConversation(convId);
  if (!conv) return;
  const newParticipants = [...new Set([...conv.participants, ...selected])];
  await DB.updateConversation(convId, { participants: newParticipants });
  const local = _convs.find(c => c.id === convId);
  if (local) local.participants = newParticipants;
  UI.closeModal('add-member-modal');
  UI.toast(`${selected.length} üye eklendi ✓`, 'success');
  openGroupPanel({ ...conv, participants: newParticipants });
}

async function removeFromGroup(convId, username) {
  if (!confirm(`@${username} gruptan çıkarılsın mı?`)) return;
  const conv = await DB.getConversation(convId);
  if (!conv) return;
  const participants = conv.participants.filter(p => p !== username);
  await DB.updateConversation(convId, { participants });
  const local = _convs.find(c => c.id === convId);
  if (local) local.participants = participants;
  UI.toast(`@${username} çıkarıldı`, 'info');
  UI.closeModal('group-panel-modal');
}

async function leaveGroup(convId) {
  if (!confirm('Gruptan çıkmak istediğinizden emin misiniz?')) return;
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

// ── Contacts tab ──────────────────────────────────────────────────
function renderContactsList() {
  const list = document.getElementById('contacts-tab-list');
  if (!list) return;
  const users = Object.values(_allUsers)
    .filter(u => u.username !== window._currentUser.username)
    .sort((a, b) => (a.display_name || a.username).localeCompare(b.display_name || b.username, 'tr'));

  if (!users.length) {
    list.innerHTML = '<div style="text-align:center;padding:32px;color:#7A8FA8;font-size:13px">Henüz kullanıcı yok</div>';
    return;
  }

  // Mesajlaşılan kullanıcıların setini oluştur
  const chattedSet = new Set(
    _convs
      .filter(c => c.type === 'direct')
      .map(c => c.participants.find(p => p !== window._currentUser.username))
      .filter(Boolean)
  );

  list.innerHTML = '';
  users.forEach(u => {
    const c = UI.avatarColor(u.username);
    const hasChatted = chattedSet.has(u.username);
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:14px;cursor:pointer;margin:1px 6px;transition:background .15s';
    div.onmouseenter = () => div.style.background = '#0C1220';
    div.onmouseleave = () => div.style.background = 'transparent';
    // Profil fotoğrafı sadece mesajlaştığımız kişilerde görünsün
    const av = (hasChatted && u.avatar_url)
      ? `<img src="${u.avatar_url}" style="width:44px;height:44px;min-width:44px;border-radius:50%;object-fit:cover">`
      : `<div style="width:44px;height:44px;min-width:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;background:${c}22;color:${c};font-family:Syne,sans-serif">${UI.initials(u.display_name || u.username)}</div>`;
    div.innerHTML = `${av}
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:#DDE8F8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${u.display_name || u.username}</div>
        <div style="font-size:11px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">@${u.username}${u.status ? ' · ' + u.status : ''}</div>
      </div>
      <button onclick="event.stopPropagation();setTab('messages');startDM('${u.username}')" style="padding:6px 12px;border-radius:8px;background:#131D30;color:#00FFB3;border:1px solid rgba(0,255,179,.2);font-size:12px;cursor:pointer;flex-shrink:0;-webkit-tap-highlight-color:transparent">Mesaj</button>`;
    div.onclick = () => openUserProfile(u);
    list.appendChild(div);
  });
}

// ── Updates tab ───────────────────────────────────────────────────
function renderUpdatesTab() {
  const el = document.getElementById('updates-tab-content');
  if (!el) return;
  el.innerHTML = `
    <div style="padding:16px">
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:32px;margin-bottom:8px">🔐</div>
        <div style="font-family:Syne,sans-serif;font-weight:700;font-size:16px;color:#DDE8F8">CIPHER ${CONFIG.APP_VERSION}</div>
        <div style="font-size:12px;color:#7A8FA8;margin-top:2px">Güncelleme Notları</div>
      </div>

      ${[
        { version: '4.0.0', date: '2025', badge: 'YENİ', color: '#00FFB3', items: [
          '☁️ Supabase ile gerçek çok cihaz desteği',
          '📝 Kullanıcı kayıt sistemi eklendi',
          '📱 Mobil giriş sorunu tamamen çözüldü',
          '🔑 Pure-JS SHA-256 — tüm platformlarda aynı hash',
          '👤 Profil sayfası — ada tıklayınca açılır',
          '👥 Grup yönetim paneli — üye ekle/çıkar',
          '📋 Kişiler sekmesi — tüm kullanıcılar',
        ]},
        { version: '3.0.0', date: '2025', badge: '', color: '#7A8FA8', items: [
          '🎬 GIF picker düzeltildi',
          '😄 Sticker picker düzeltildi',
          '✉️ Mesaj iletme özelliği',
          '🔗 Uygulama paylaşma',
          '🤖 CIPHER Bot',
          '🚨 Şikayet ve bildirim sistemi',
        ]},
        { version: '2.0.0', date: '2025', badge: '', color: '#7A8FA8', items: [
          '🔒 AES-256-GCM şifreleme',
          '🏃 Self-destruct mesajlar',
          '↩ Reaksiyon sistemi',
          '🎙 Sesli mesaj',
          '📎 Dosya paylaşımı',
        ]},
      ].map(r => `
        <div style="margin-bottom:16px;padding:14px;border-radius:14px;background:#06080F;border:1px solid #1E2D45">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <span style="font-family:Syne,sans-serif;font-weight:700;font-size:14px;color:#DDE8F8">v${r.version}</span>
            ${r.badge ? `<span style="font-size:9px;padding:2px 7px;border-radius:20px;background:${r.color}22;color:${r.color};border:1px solid ${r.color}44;font-family:'JetBrains Mono',monospace">${r.badge}</span>` : ''}
            <span style="font-size:11px;color:#7A8FA8;margin-left:auto;font-family:'JetBrains Mono',monospace">${r.date}</span>
          </div>
          ${r.items.map(i => `<div style="font-size:12px;color:#9AB0C8;padding:3px 0;padding-left:4px">${i}</div>`).join('')}
        </div>`).join('')}
    </div>`;
}

// ── Stories ───────────────────────────────────────────────────────
async function renderStories() {
  const stories = await DB.getStories();
  const strip = document.getElementById('stories-strip');
  if (!strip) return;
  strip.innerHTML = '';
  const cu = window._currentUser;
  const myColor = UI.avatarColor(cu.username);
  const myAv = cu.avatar_url
    ? `<img src="${cu.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
    : `<span style="font-weight:700;font-size:11px;color:#fff;font-family:Syne,sans-serif">${UI.initials(cu.display_name || cu.username)}</span>`;
  const myBtn = document.createElement('div');
  myBtn.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;flex-shrink:0';
  myBtn.innerHTML = `<div style="width:48px;height:48px;border-radius:50%;background:${myColor};display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden">${myAv}<div style="position:absolute;bottom:0;right:0;width:16px;height:16px;border-radius:50%;background:#00FFB3;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#062B1F;border:2px solid #06080F">+</div></div><span style="font-size:10px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">Sen</span>`;
  myBtn.onclick = addStory;
  strip.appendChild(myBtn);

  const byUser = {};
  stories.forEach(s => { if (!byUser[s.user_id]) byUser[s.user_id] = []; byUser[s.user_id].push(s); });
  Object.entries(byUser).forEach(([uid, sts]) => {
    const u = _allUsers[uid]; if (!u) return;
    const uc = UI.avatarColor(u.username);
    const seen = sts.every(s => s.seen_by?.includes(cu.username));
    const uAv = u.avatar_url
      ? `<img src="${u.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
      : `<span style="font-weight:700;font-size:11px;color:#fff;font-family:Syne,sans-serif">${UI.initials(u.display_name || u.username)}</span>`;
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;flex-shrink:0';
    div.innerHTML = `<div class="${seen ? 'story-ring-seen' : 'story-ring'}" style="width:52px;height:52px;border-radius:50%"><div style="width:100%;height:100%;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:${uc}22">${uAv}</div></div><span style="font-size:10px;color:${seen ? '#7A8FA8' : '#DDE8F8'};max-width:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:'JetBrains Mono',monospace">${(u.display_name || u.username).split(' ')[0]}</span>`;
    div.onclick = () => UI.showStory(sts[0], u);
    strip.appendChild(div);
  });
}

async function addStory() {
  const text = prompt('Hikayeni yaz (maks 200 karakter):');
  if (!text?.trim()) return;
  await DB.createStory({ user_id: window._currentUser.username, text: text.trim().slice(0, 200), seen_by: [] });
  await renderStories();
  UI.toast('Hikaye paylaşıldı! 📖', 'success');
}

// ── New DM ────────────────────────────────────────────────────────
function openNewChat() {
  const list = document.getElementById('contacts-list');
  if (!list) return;
  list.innerHTML = '';
  Object.values(_allUsers)
    .filter(u => u.username !== window._currentUser.username)
    .sort((a, b) => (a.display_name || a.username).localeCompare(b.display_name || b.username, 'tr'))
    .forEach(u => {
      const c = UI.avatarColor(u.username);
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:12px;cursor:pointer;transition:background .15s';
      div.onmouseenter = () => div.style.background = '#131D30';
      div.onmouseleave = () => div.style.background = 'transparent';
      const av = u.avatar_url
        ? `<img src="${u.avatar_url}" style="width:36px;height:36px;min-width:36px;border-radius:50%;object-fit:cover">`
        : `<div style="width:36px;height:36px;min-width:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;background:${c}22;color:${c};font-family:Syne,sans-serif">${UI.initials(u.display_name || u.username)}</div>`;
      div.innerHTML = `${av}<div style="min-width:0"><div style="font-size:13px;font-weight:500;color:#DDE8F8">${u.display_name || u.username}</div><div style="font-size:11px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">@${u.username}</div></div>`;
      div.onclick = async () => { UI.closeModal('new-chat-modal'); await startDM(u.username); };
      list.appendChild(div);
    });
  UI.openModal('new-chat-modal');
}

async function startDM(userId) {
  const ids = [window._currentUser.username, userId].sort();
  const convId = ids.join('_');
  let conv = await DB.getConversation(convId);
  if (!conv) {
    conv = await DB.createConversation({ id: convId, type: 'direct', participants: ids, last_msg: '', last_time: Date.now(), unread_for: {} });
  }
  if (!_convs.find(c => c.id === convId)) _convs.push(conv);
  if (_activeTab !== 'messages') setTab('messages');
  renderChatList();
  await openConv(convId);
}

// ── Group create ──────────────────────────────────────────────────
function openGroupCreate() {
  const gc = document.getElementById('group-contacts');
  if (!gc) return;
  gc.innerHTML = '';
  // Only show users we have DMs with
  const chattedUsernames = _convs
    .filter(c => c.type === 'direct')
    .map(c => c.participants.find(p => p !== window._currentUser.username))
    .filter(Boolean);
  if (!chattedUsernames.length) {
    gc.innerHTML = '<div style="text-align:center;padding:20px;font-size:12px;color:#7A8FA8">Önce biriyle mesajlaşın.</div>';
    UI.openModal('group-modal'); return;
  }
  chattedUsernames.map(un => _allUsers[un]).filter(Boolean)
    .sort((a, b) => (a.display_name || a.username).localeCompare(b.display_name || b.username, 'tr'))
    .forEach(u => {
      const c = UI.avatarColor(u.username);
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;cursor:pointer;transition:background .15s';
      div.onmouseenter = () => div.style.background = '#131D30';
      div.onmouseleave = () => div.style.background = 'transparent';
      div.innerHTML = `<input type="checkbox" value="${u.username}" style="width:16px;height:16px;accent-color:#00FFB3;flex-shrink:0">
        <div style="width:32px;height:32px;min-width:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:${c}22;color:${c};font-family:Syne,sans-serif">${UI.initials(u.display_name || u.username)}</div>
        <span style="font-size:13px;color:#DDE8F8">${u.display_name || u.username}</span>`;
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
  const convId = 'group_' + Date.now();
  const colors = ['#0A2818', '#1A0A28', '#0A1628', '#281A0A', '#0A1A28'];
  const conv = await DB.createConversation({
    id: convId, type: 'group', name,
    participants: [window._currentUser.username, ...selected],
    avatar: UI.initials(name),
    banner_color: colors[Math.floor(Math.random() * 5)],
    last_msg: '', last_time: Date.now(), unread_for: {}, admin: window._currentUser.username
  });
  _convs.push(conv);
  document.getElementById('group-name').value = '';
  UI.closeModal('group-modal');
  renderChatList();
  await openConv(convId);
  UI.toast(`"${name}" grubu oluşturuldu 🎉`, 'success');
}

// ── Info panel ────────────────────────────────────────────────────
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
  if (conv.type === 'direct') {
    const other = _allUsers[conv.participants.find(p => p !== window._currentUser.username)] || {};
    const c = UI.avatarColor(other.username || '');
    // Info panel = we ARE chatting → show avatar
    el.innerHTML = '';
    const top = document.createElement('div');
    top.style.cssText = 'text-align:center';
    const avEl = document.createElement(other.avatar_url ? 'img' : 'div');
    if (other.avatar_url) {
      avEl.src = other.avatar_url;
      avEl.style.cssText = 'width:60px;height:60px;border-radius:50%;object-fit:cover;margin:0 auto 12px;display:block;cursor:pointer';
    } else {
      avEl.style.cssText = `width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;margin:0 auto 12px;cursor:pointer;background:${c}22;color:${c};font-family:Syne,sans-serif`;
      avEl.textContent = UI.initials(other.display_name || other.username);
    }
    avEl.onclick = () => { if (_allUsers[other.username]) openUserProfile(_allUsers[other.username]); };
    top.appendChild(avEl);
    top.innerHTML += `<div style="font-weight:700;font-family:Syne,sans-serif;color:#DDE8F8">${other.display_name || other.username}</div><div style="font-size:11px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">@${other.username}</div>${other.status ? `<div style="font-size:12px;margin-top:4px;color:#9AB0C8">${other.status_emoji || ''} ${other.status}</div>` : ''}`;
    el.appendChild(top);
    el.innerHTML += '<div style="border-top:1px solid #1E2D45;padding-top:12px;margin-top:12px"><div style="font-size:10px;font-weight:600;color:#7A8FA8;font-family:\'JetBrains Mono\',monospace;margin-bottom:8px">GÜVENLİK</div><div style="font-size:11px;color:#DDE8F8;display:flex;flex-direction:column;gap:5px"><div>🔒 AES-256-GCM</div><div>🛡 SHA-256</div><div>🚫 Sıfır Kayıt</div></div></div>';
  } else {
    el.innerHTML = '';
    // Header
    const header = document.createElement('div');
    header.style.cssText = 'text-align:center;cursor:pointer';
    header.onclick = () => { const c = _convs.find(cv => cv.id === conv.id); if (c) openGroupPanel(c); };
    header.innerHTML = `<div style="width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;margin:0 auto 12px;background:${getConvColor(conv)}22;color:${getConvColor(conv)};font-family:Syne,sans-serif">${conv.avatar || UI.initials(conv.name)}</div><div style="font-weight:700;font-family:Syne,sans-serif;color:#DDE8F8">${conv.name}</div><div style="font-size:12px;color:#7A8FA8">${conv.participants.length} üye</div>`;
    el.appendChild(header);
    // Members
    const sec = document.createElement('div');
    sec.style.cssText = 'border-top:1px solid #1E2D45;padding-top:12px;margin-top:12px';
    sec.innerHTML = '<div style="font-size:10px;font-weight:600;color:#7A8FA8;font-family:\'JetBrains Mono\',monospace;margin-bottom:8px">ÜYELER</div>';
    conv.participants.forEach(uid => {
      const u = _allUsers[uid] || { username: uid, display_name: uid };
      const c = UI.avatarColor(u.username);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer';
      row.innerHTML = `<div style="width:28px;height:28px;min-width:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:${c}22;color:${c};font-family:Syne,sans-serif">${UI.initials(u.display_name || u.username)}</div><div><div style="font-size:12px;font-weight:500;color:#DDE8F8">${u.display_name || u.username}</div>${conv.admin === uid ? '<div style="font-size:10px;color:#FFD700">Yönetici</div>' : ''}</div>`;
      row.onclick = () => { const cv = _convs.find(c => c.id === conv.id); if (cv) openGroupPanel(cv); };
      sec.appendChild(row);
    });
    el.appendChild(sec);
  }
}


// ── Search ────────────────────────────────────────────────────────
function handleSidebarSearch(q) { _searchQuery = q; document.getElementById('search-clear')?.classList.toggle('hidden', !q); renderChatList(); }
function clearSidebarSearch() { _searchQuery = ''; const i = document.getElementById('search-input'); if (i) i.value = ''; document.getElementById('search-clear')?.classList.add('hidden'); renderChatList(); }
function toggleMsgSearch() { const b = document.getElementById('chat-search-bar'); b?.classList.toggle('hidden'); if (!b?.classList.contains('hidden')) document.getElementById('msg-search')?.focus(); }
async function searchInMessages(q) {
  const ce = document.getElementById('search-count');
  if (!q) { if (ce) ce.textContent = ''; await renderMessages(); return; }
  const msgs = await DB.getMessages(window._currentConvId);
  const hits = msgs.filter(m => (m.text || '').toLowerCase().includes(q.toLowerCase()));
  if (ce) ce.textContent = hits.length + ' sonuç';
  await renderMessages(q);
  if (hits.length) document.getElementById('msg-' + hits[0].id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Filter ────────────────────────────────────────────────────────
function setFilter(f) {
  _chatFilter = f;
  ['all', 'unread', 'groups'].forEach(id => {
    const btn = document.getElementById('filter-' + id);
    if (!btn) return;
    btn.style.background = f === id ? '#131D30' : 'transparent';
    btn.style.color = f === id ? '#DDE8F8' : '#7A8FA8';
  });
  renderChatList();
}

// ── Settings ──────────────────────────────────────────────────────
let _settings = { dark: true, lowData: false, notifs: true };
function loadSettings() {
  try { _settings = { dark: true, lowData: false, notifs: true, ...JSON.parse(localStorage.getItem('cipher_settings') || '{}') }; } catch {}
  applyDark(_settings.dark); applyLowData(_settings.lowData);
}
function saveSettings() { localStorage.setItem('cipher_settings', JSON.stringify(_settings)); }
function applyDark(on) { document.documentElement.classList.toggle('light-mode', !on); updateToggle('dark-toggle', on); }
function applyLowData(on) { document.documentElement.classList.toggle('low-data', on); updateToggle('lowdata-toggle', on); }
function updateToggle(id, on) { const e = document.getElementById(id); if (e) e.className = 'toggle-track ' + (on ? 'on' : 'off'); }
function toggleDark() { _settings.dark = !_settings.dark; saveSettings(); applyDark(_settings.dark); }
function toggleLowData() { _settings.lowData = !_settings.lowData; saveSettings(); applyLowData(_settings.lowData); UI.toast(_settings.lowData ? 'Düşük veri modu' : 'Normal mod', 'info'); }
function toggleNotifs() { _settings.notifs = !_settings.notifs; saveSettings(); updateToggle('notif-toggle', _settings.notifs); if (_settings.notifs && 'Notification' in window) Notification.requestPermission(); }

// ── Profile edit ──────────────────────────────────────────────────
function openProfileEdit() {
  const cu = window._currentUser;
  document.getElementById('pe-displayname').value = cu.display_name || '';
  document.getElementById('pe-bio').value = cu.bio || '';
  document.getElementById('pe-status').value = cu.status || '';
  document.getElementById('pe-statusemoji').value = cu.status_emoji || '';
  const bp = document.getElementById('banner-colors');
  if (bp) {
    bp.innerHTML = '';
    CONFIG.BANNER_COLORS.forEach(col => {
      const btn = document.createElement('button');
      btn.style.cssText = `width:28px;height:28px;border-radius:50%;background:${col};border:2.5px solid ${cu.banner_color === col ? '#00FFB3' : 'transparent'};cursor:pointer`;
      btn.onclick = () => { document.querySelectorAll('#banner-colors button').forEach(b => b.style.borderColor = 'transparent'); btn.style.borderColor = '#00FFB3'; window._selectedBannerColor = col; };
      bp.appendChild(btn);
    });
  }
  window._selectedBannerColor = cu.banner_color;
  const prev = document.getElementById('avatar-preview');
  if (prev) {
    if (cu.avatar_url) { prev.innerHTML = `<img src="${cu.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`; }
    else { const c = UI.avatarColor(cu.username); prev.style.background = `linear-gradient(135deg,${c},${c}99)`; prev.style.color = '#fff'; prev.textContent = UI.initials(cu.display_name || cu.username); }
  }
  UI.openModal('profile-edit-modal');
}

async function saveProfile() {
  const cu = window._currentUser;
  const d = { display_name: document.getElementById('pe-displayname').value.trim() || cu.display_name, bio: document.getElementById('pe-bio').value.trim(), status: document.getElementById('pe-status').value.trim(), status_emoji: document.getElementById('pe-statusemoji').value.trim(), banner_color: window._selectedBannerColor || cu.banner_color };
  await DB.updateUser(cu.username, d);
  window._currentUser = { ...cu, ...d }; _allUsers[cu.username] = window._currentUser;
  UI.closeModal('profile-edit-modal'); renderMyAvatar(); UI.toast('Profil güncellendi ✓', 'success');
}

async function uploadAvatar(input) {
  const file = input.files[0]; if (!file) return;
  if (file.size > CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024) { UI.toast(`Maks. ${CONFIG.MAX_FILE_SIZE_MB}MB`, 'error'); return; }
  const r = new FileReader(); r.readAsDataURL(file);
  r.onload = async () => {
    await DB.updateUser(window._currentUser.username, { avatar_url: r.result });
    window._currentUser.avatar_url = r.result; _allUsers[window._currentUser.username].avatar_url = r.result;
    renderMyAvatar();
    const prev = document.getElementById('avatar-preview');
    if (prev) prev.innerHTML = `<img src="${r.result}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    UI.toast('Profil fotoğrafı güncellendi ✓', 'success');
  };
}

// ── Block / Report ────────────────────────────────────────────────
function openBlockReport() {
  const conv = _convs.find(c => c.id === window._currentConvId);
  if (!conv || conv.type !== 'direct') return;
  const otherU = conv.participants.find(p => p !== window._currentUser.username);
  const u = _allUsers[otherU]; if (!u) return;
  window._brTarget = u.username;
  const blocked = getBlockedList();
  const isBlocked = blocked.includes(u.username);
  const color = UI.avatarColor(u.username);
  const av = u.avatar_url ? `<img src="${u.avatar_url}" style="width:36px;height:36px;border-radius:50%;object-fit:cover">` : `<div style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;background:${color}22;color:${color};font-family:Syne,sans-serif">${UI.initials(u.display_name || u.username)}</div>`;
  document.getElementById('br-user-info').innerHTML = `${av}<div><div style="font-size:13px;font-weight:600;color:#DDE8F8">${u.display_name || u.username}</div><div style="font-size:11px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">@${u.username}</div></div>`;
  const blockBtn = document.getElementById('br-block-btn');
  if (isBlocked) { blockBtn.innerHTML = `<span style="font-size:18px">✅</span><div><div style="font-size:13px;font-weight:600">Engeli Kaldır</div></div>`; }
  else { blockBtn.innerHTML = `<span style="font-size:18px">🚫</span><div><div style="font-size:13px;font-weight:600">Engelle</div></div>`; }
  UI.openModal('block-report-modal');
}
function getBlockedList() { try { return JSON.parse(localStorage.getItem('cipher_blocked_' + window._currentUser.username) || '[]'); } catch { return []; } }
function saveBlockedList(list) { localStorage.setItem('cipher_blocked_' + window._currentUser.username, JSON.stringify(list)); }
function blockUser() { const target = window._brTarget; if (!target) return; const blocked = getBlockedList(); const idx = blocked.indexOf(target); if (idx >= 0) { blocked.splice(idx, 1); saveBlockedList(blocked); UI.toast(`@${target} engeli kaldırıldı`, 'info'); } else { blocked.push(target); saveBlockedList(blocked); UI.toast(`@${target} engellendi 🚫`, 'warn'); } UI.closeModal('block-report-modal'); }
function reportUser() { const target = window._brTarget; if (!target) return; const reports = JSON.parse(localStorage.getItem('cipher_admin_reports') || '[]'); reports.push({ type: 'user', target, from: window._currentUser.username, time: Date.now(), note: 'Kullanıcı şikayeti' }); localStorage.setItem('cipher_admin_reports', JSON.stringify(reports)); UI.closeModal('block-report-modal'); UI.toast('Şikayet iletildi 🚨', 'success'); }
function openReportModal() { UI.openModal('report-modal'); }
function submitReport() { const type = document.getElementById('report-type').value; const text = document.getElementById('report-text').value.trim(); if (!text) { UI.toast('Açıklama girin', 'error'); return; } const reports = JSON.parse(localStorage.getItem('cipher_admin_reports') || '[]'); reports.push({ type, from: window._currentUser.username, text, time: Date.now() }); localStorage.setItem('cipher_admin_reports', JSON.stringify(reports)); document.getElementById('report-text').value = ''; UI.closeModal('report-modal'); UI.toast('Sorun bildirildi ✓', 'success'); }
function openLockAccount() { document.getElementById('lock-pwd').value = ''; document.getElementById('lock-err').style.display = 'none'; UI.openModal('lock-modal'); }
async function confirmLock() { const pwd = document.getElementById('lock-pwd').value; if (!pwd) return; const hash = await DB.hashPassword(pwd); const cu = window._currentUser; if (hash !== cu.password_hash) { const e = document.getElementById('lock-err'); e.textContent = 'Şifre yanlış.'; e.style.display = ''; return; } UI.closeModal('lock-modal'); Auth.logout(); }
function openDeleteAccount() { document.getElementById('delete-confirm').value = ''; document.getElementById('delete-pwd').value = ''; document.getElementById('del-err').style.display = 'none'; UI.openModal('delete-account-modal'); }
async function confirmDeleteAccount() { const confirm = document.getElementById('delete-confirm').value.trim(); const pwd = document.getElementById('delete-pwd').value; const errEl = document.getElementById('del-err'); const showErr = msg => { errEl.textContent = msg; errEl.style.display = ''; }; if (confirm !== 'SİL') { showErr('"SİL" yazın.'); return; } if (!pwd) { showErr('Şifre girin.'); return; } const hash = await DB.hashPassword(pwd); const cu = window._currentUser; if (hash !== cu.password_hash) { showErr('Şifre yanlış.'); return; } await DB.deleteUser(cu.username); UI.closeModal('delete-account-modal'); setTimeout(() => Auth.logout(), 1500); UI.toast('Hesap silindi 👋', 'info'); }
function shareApp() { const url = window.location.origin + window.location.pathname.replace('app.html', ''); if (navigator.share) { navigator.share({ title: 'CIPHER Messenger', url }).catch(() => {}); } else { navigator.clipboard.writeText(url); UI.toast('Uygulama linki kopyalandı 🔗', 'success'); } }

// ── Notifications ─────────────────────────────────────────────────
let _notifs = [];
function addNotif(msg, from, convId) {
  _notifs.unshift({ msg, from, convId, time: Date.now(), read: false });
  if (_notifs.length > 50) _notifs = _notifs.slice(0, 50);
  updateNotifBadge();
  if (Notification.permission === 'granted' && document.hidden) {
    const u = _allUsers[from];
    new Notification(u?.display_name || from, { body: msg, icon: 'icons/icon-192.png' });
  }
}
function updateNotifBadge() { const unread = _notifs.filter(n => !n.read).length; let badge = document.getElementById('notif-badge'); if (!badge) { const btn = document.getElementById('notif-btn'); if (!btn) return; badge = document.createElement('span'); badge.id = 'notif-badge'; badge.style.cssText = 'position:absolute;top:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:#FF3D6B;color:#fff;font-size:9px;display:flex;align-items:center;justify-content:center;font-family:\'JetBrains Mono\',monospace;border:2px solid #06080F'; btn.style.position = 'relative'; btn.appendChild(badge); } badge.textContent = unread > 9 ? '9+' : unread; badge.style.display = unread > 0 ? 'flex' : 'none'; }
function openNotifs() { _notifs.forEach(n => n.read = true); updateNotifBadge(); const list = document.getElementById('notif-list'); if (!list) return; if (!_notifs.length) { list.innerHTML = '<div style="text-align:center;padding:24px;color:#7A8FA8;font-size:13px">Henüz bildirim yok</div>'; } else { list.innerHTML = _notifs.map(n => { const u = _allUsers[n.from] || { username: n.from, display_name: n.from }; const c = UI.avatarColor(u.username); return `<div onclick="UI.closeModal('notif-modal');openConv('${n.convId}')" style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;cursor:pointer;background:#06080F;border:1px solid #1E2D45;transition:background .15s" onmouseenter="this.style.background='#0C1220'" onmouseleave="this.style.background='#06080F'"><div style="width:32px;height:32px;min-width:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:${c}22;color:${c};font-family:Syne,sans-serif">${UI.initials(u.display_name || u.username)}</div><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;color:#DDE8F8">${u.display_name || u.username}</div><div style="font-size:11px;color:#7A8FA8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.msg}</div></div><span style="font-size:10px;color:#7A8FA8;flex-shrink:0">${UI.fmtTime(n.time)}</span></div>`; }).join(''); } UI.openModal('notif-modal'); }
function clearAllNotifs() { _notifs = []; updateNotifBadge(); UI.closeModal('notif-modal'); }

// ── Bot ───────────────────────────────────────────────────────────
async function ensureBotConversation() {
  const BOT = 'cipher_bot';
  const bot = await DB.getUser(BOT); if (!bot) return;
  const ids = [BOT, window._currentUser.username].sort();
  const convId = ids.join('_');
  const existing = await DB.getConversation(convId); if (existing) return;
  const now = Date.now();
  const welcome = `👋 Merhaba ${window._currentUser.display_name || window._currentUser.username}! Ben CIPHER Bot. Sistem bildirimleri buradan gelir. 🔐`;
  await DB.createConversation({ id: convId, type: 'direct', participants: ids, last_msg: welcome, last_time: now, unread_for: { [window._currentUser.username]: 1 } });
  await DB.createMessage({ conv_id: convId, from: BOT, type: 'text', text: welcome, status: 'sent', created_at: now });
}

// ── Forward ───────────────────────────────────────────────────────
function openForwardModal(msgId) {
  window._forwardMsgId = msgId;
  let html = '<div style="display:flex;flex-direction:column;gap:4px;padding:8px">';
  const sorted = [..._convs].sort((a, b) => (b.last_time || 0) - (a.last_time || 0));
  for (const conv of sorted) {
    if (conv.id === window._currentConvId) continue;
    const name = getConvName(conv); const color = getConvColor(conv);
    const other = conv.type === 'direct' ? _allUsers[conv.participants.find(p => p !== window._currentUser.username)] : null;
    const av = other?.avatar_url ? `<img src="${other.avatar_url}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0">` : `<div style="width:32px;height:32px;min-width:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:${color}22;color:${color};font-family:Syne,sans-serif;flex-shrink:0">${UI.initials(name)}</div>`;
    html += `<div onclick="forwardTo('${conv.id}')" style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;cursor:pointer;transition:background .15s" onmouseenter="this.style.background='#131D30'" onmouseleave="this.style.background='transparent'">${av}<span style="font-size:13px;color:#DDE8F8">${name}</span></div>`;
  }
  html += '</div>';
  let modal = document.getElementById('forward-modal');
  if (!modal) { modal = document.createElement('div'); modal.id = 'forward-modal'; modal.className = 'fixed inset-0 z-50 hidden items-center justify-center'; modal.style.background = 'rgba(6,8,15,.92)'; document.body.appendChild(modal); }
  modal.innerHTML = `<div style="width:100%;max-width:320px;margin:0 12px;background:#0C1220;border:1px solid #1E2D45;border-radius:20px;max-height:70vh;display:flex;flex-direction:column;overflow:hidden;animation:slideUp .2s ease-out"><div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #1E2D45;flex-shrink:0"><span style="font-family:Syne,sans-serif;font-weight:700;color:#DDE8F8">↪ Mesajı İlet</span><button onclick="UI.closeModal('forward-modal')" style="color:#7A8FA8;background:none;border:none;cursor:pointer">✕</button></div><div style="overflow-y:auto">${html}</div></div>`;
  UI.openModal('forward-modal');
}
async function forwardTo(convId) { UI.closeModal('forward-modal'); const msgId = window._forwardMsgId; if (!msgId) return; const msgs = await DB.getMessages(window._currentConvId); const orig = msgs.find(m => m.id === msgId); if (!orig) return; const cu = window._currentUser; const now = Date.now(); const fwdText = orig.text ? `↪ İletildi:\n${orig.text}` : '↪ İletildi'; await DB.createMessage({ conv_id: convId, from: cu.username, type: 'text', text: fwdText, status: 'sent', created_at: now }); await DB.updateConversation(convId, { last_msg: fwdText.slice(0, 40), last_time: now }); await loadConversations(); UI.toast('Mesaj iletildi ↪', 'success'); }

// ── Screenshot ────────────────────────────────────────────────────
function setupScreenshotDetection() { document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'p') && window._currentConvId) { e.preventDefault(); document.getElementById('ss-overlay')?.classList.add('show'); UI.toast('⚠️ Ekran görüntüsü engellendi', 'warn'); } }); }
function startVoiceCall() { UI.toast('📞 Sesli arama başlatılıyor… (Demo)', 'info'); setTimeout(() => UI.toast('Karşı taraf yanıt vermiyor.', 'warn'), 2500); }

// ── Change display name ───────────────────────────────────────────
function openChangeName() {
  const cu = window._currentUser;
  document.getElementById('cn-input').value = cu.display_name || '';
  document.getElementById('cn-err').style.display = 'none';
  UI.openModal('change-name-modal');
}
async function submitChangeName() {
  const val = document.getElementById('cn-input').value.trim();
  const errEl = document.getElementById('cn-err');
  errEl.style.display = 'none';
  try {
    await Auth.changeDisplayName(window._currentUser.username, val);
    window._currentUser.display_name = val;
    _allUsers[window._currentUser.username].display_name = val;
    renderMyAvatar();
    UI.closeModal('change-name-modal');
    UI.closeModal('settings-modal');
    UI.toast('Ad güncellendi ✓', 'success');
  } catch(e) { errEl.textContent = e.message; errEl.style.display = ''; }
}

// ── Change password ────────────────────────────────────────────────
function openChangePassword() {
  ['cp-old','cp-new','cp-new2'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('cp-err').style.display = 'none';
  UI.openModal('change-password-modal');
}
async function submitChangePassword() {
  const old = document.getElementById('cp-old').value;
  const nw  = document.getElementById('cp-new').value;
  const nw2 = document.getElementById('cp-new2').value;
  const errEl = document.getElementById('cp-err');
  errEl.style.display = 'none';
  if (nw !== nw2) { errEl.textContent = 'Şifreler eşleşmiyor.'; errEl.style.display = ''; return; }
  try {
    await Auth.changePassword(window._currentUser.username, old, nw);
    // Update session hash
    const u = await DB.getUser(window._currentUser.username);
    window._currentUser = u;
    UI.closeModal('change-password-modal');
    UI.toast('Şifre güncellendi ✓', 'success');
  } catch(e) { errEl.textContent = e.message; errEl.style.display = ''; }
}

// ── Forgot password (reset with admin code) ────────────────────────
function openForgotPassword() {
  ['fp-user','fp-code','fp-new','fp-new2'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  document.getElementById('fp-err').style.display = 'none';
  UI.openModal('forgot-password-modal');
}
async function submitForgotPassword() {
  const user = document.getElementById('fp-user').value.trim();
  const code = document.getElementById('fp-code').value.trim();
  const nw   = document.getElementById('fp-new').value;
  const nw2  = document.getElementById('fp-new2').value;
  const errEl = document.getElementById('fp-err');
  errEl.style.display = 'none';
  if (nw !== nw2) { errEl.textContent = 'Şifreler eşleşmiyor.'; errEl.style.display = ''; return; }
  try {
    await Auth.resetPasswordWithCode(user, code, nw);
    UI.closeModal('forgot-password-modal');
    UI.toast('Şifre sıfırlandı! Giriş yapabilirsiniz.', 'success');
  } catch(e) { errEl.textContent = e.message; errEl.style.display = ''; }
}

// ── Create conv in specific server ────────────────────────────────
async function startDMInServer(userId, serverId) {
  const server = serverId || _activeServer || 'public';
  const ids = [window._currentUser.username, userId].sort();
  const convId = ids.join('_') + (server !== 'public' ? '_' + server : '');
  let conv = await DB.getConversation(convId);
  if (!conv) {
    conv = await DB.createConversation({ id: convId, type: 'direct', participants: ids, last_msg: '', last_time: Date.now(), unread_for: {}, server });
  }
  if (!_convs.find(c => c.id === convId)) _convs.push(conv);
  setServer(server);
  renderChatList();
  await openConv(convId);
}

// ── Boot ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await DB.init();
  await bootApp();
  Messages.initEvents();

  document.addEventListener('click', e => {
    if (!e.target.closest('#gif-picker') && !e.target.closest('[onclick*="toggleGif"]') && !e.target.closest('[onclick*="Messages.toggleGif"]')) { document.getElementById('gif-picker')?.classList.remove('open'); Messages._gifOpen = false; }
    if (!e.target.closest('#sticker-picker') && !e.target.closest('[onclick*="toggleSticker"]') && !e.target.closest('[onclick*="Messages.toggleSticker"]')) { document.getElementById('sticker-picker')?.classList.remove('open'); Messages._stickerOpen = false; }
    if (!e.target.closest('#reaction-picker') && !e.target.closest('.reaction-pill')) UI.hideReactionPicker();
    if (!e.target.closest('#profile-card') && !e.target.closest('[onclick*="showProfile"]')) document.getElementById('profile-card')?.classList.add('hidden');
    if (!e.target.closest('#ctx-menu')) document.getElementById('ctx-menu')?.classList.add('hidden');
  });
});

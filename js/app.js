/**
 * CIPHER — Main App v3
 * Gerçek çok kullanıcı: localStorage + BroadcastChannel
 * Simülasyon yok. Her sekme/pencere = farklı kullanıcı, gerçek zamanlı.
 */

let _allUsers = {}, _convs = [], _chatFilter = 'all', _searchQuery = '';

// ── Boot ──────────────────────────────────────────────────────────
async function bootApp() {
  if (!Auth.requireAuth()) return;

  window._currentUser = await Auth.currentUser();
  if (!window._currentUser) { Auth.logout(); return; }

  // Tüm kullanıcıları belleğe al
  const users = await DB.getAllUsers();
  users.forEach(u => { _allUsers[u.username] = u; });

  renderMyAvatar();
  await ensureBotConversation();
  await loadConversations();
  await renderStories();
  loadSettings();
  PWA.init();
  setupScreenshotDetection();
  buildStickerTabs();

  // Supabase config check
  if (window._supabaseNotConfigured || CONFIG.SUPABASE_URL.includes('YOUR_PROJECT')) {
    UI.toast('⚠️ Supabase ayarlanmamış — tek cihaz modu', 'warn', 8000);
  }

  // Request notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Mesaj gönderim sonrası güncelle
  window._onNewMessage = async () => {
    await loadConversations();
    if (window._currentConvId) await renderMessages();
  };

  // localStorage/BroadcastChannel sync (local mode)
  window._onStorageSync = async (key) => {
    if (!key) return;
    if (key === 'convs') await loadConversations();
    if (key.startsWith('msgs_')) {
      const convId = key.slice(5);
      if (convId !== window._currentConvId || document.hidden) {
        const msgs = await DB.getMessages(convId);
        const last = msgs[msgs.length - 1];
        if (last && last.from !== window._currentUser.username) {
          addNotif(last.text || (last.type === 'gif' ? '🎬 GIF' : last.sticker || '📎'), last.from, convId);
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

  // Supabase real-time: conversations (yeni sohbet, okundu sayısı)
  if (CONFIG.USE_SUPABASE && !window._supabaseNotConfigured) {
    DB.subscribeConversations?.(window._currentUser.username, async () => {
      await loadConversations();
    });
  }
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
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    items = items.filter(c => getConvName(c).toLowerCase().includes(q) || (c.last_msg || '').toLowerCase().includes(q));
  }
  items.sort((a, b) => (b.last_time || 0) - (a.last_time || 0));
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div style="text-align:center;padding:32px 16px;font-size:13px;color:#7A8FA8;font-family:\'JetBrains Mono\',monospace">Sohbet yok</div>';
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

    const lastMsg = (conv.last_msg || '').substring(0, 38);
    div.innerHTML = `${avHtml}
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
          <span style="font-weight:600;font-size:13px;font-family:'Syne',sans-serif;color:#DDE8F8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:148px">${name}</span>
          <span style="font-size:10px;color:#7A8FA8;font-family:'JetBrains Mono',monospace;flex-shrink:0;margin-left:4px">${conv.last_time ? UI.fmtTime(conv.last_time) : ''}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:12px;color:#7A8FA8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px">${lastMsg}</span>
          ${unread > 0 ? `<span style="min-width:20px;height:20px;padding:0 5px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;background:#00FFB3;color:#062B1F;flex-shrink:0;margin-left:4px;font-family:'JetBrains Mono',monospace">${unread > 99 ? '99+' : unread}</span>` : ''}
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

  // Okunmadı sıfırla
  if ((conv.unread_for?.[window._currentUser.username] || 0) > 0) {
    if (!conv.unread_for) conv.unread_for = {};
    conv.unread_for[window._currentUser.username] = 0;
    await DB.updateConversation(convId, { unread_for: conv.unread_for });
  }

  window._isGroup = conv.type === 'group';
  const name = getConvName(conv);
  const color = getConvColor(conv);
  const other = conv.type === 'direct' ? _allUsers[conv.participants.find(p => p !== window._currentUser.username)] : null;

  // Header
  const avEl = document.getElementById('chat-avatar');
  if (other?.avatar_url) {
    avEl.innerHTML = `<img src="${other.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
  } else {
    avEl.style.background = `${color}22`;
    avEl.style.color = color;
    avEl.textContent = conv.type === 'group' ? (conv.avatar || UI.initials(name)) : UI.initials(name);
  }
  document.getElementById('chat-name').textContent = name;
  document.getElementById('chat-status').textContent = conv.type === 'group'
    ? `${conv.participants.length} üye · Grup`
    : (other?.status ? `${other.status_emoji || ''} ${other.status}` : '🟢 Çevrimiçi');

  avEl.onclick = other ? () => UI.showProfileCard(other, avEl) : null;
  avEl.style.cursor = other ? 'pointer' : 'default';

  // Engelle/bildir butonu sadece DM'de göster
  const brBtn = document.getElementById('block-report-btn');
  if (brBtn) brBtn.style.display = (conv.type === 'direct') ? 'flex' : 'none';

  // Chat view
  document.getElementById('empty-state').style.display = 'none';
  const cv = document.getElementById('chat-view');
  cv.style.display = 'flex';
  cv.style.flexDirection = 'column';

  // Mobile
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

// ── Mobile back ───────────────────────────────────────────────────
function backToSidebar() {
  document.getElementById('sidebar').classList.remove('slide-out');
  document.getElementById('chat-area').classList.remove('slide-in');
  document.getElementById('back-btn').style.display = 'none';
  Messages.closeAllPickers();
}

// ── Send message ──────────────────────────────────────────────────
async function sendMessage() {
  if (!window._currentConvId) return;
  await Messages.send(window._currentConvId);
}

function handleMsgKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  if (e.key === 'Escape') Messages.closeAllPickers();
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
    : `<span style="font-weight:700;font-size:11px;color:#fff;font-family:'Syne',sans-serif">${UI.initials(cu.display_name || cu.username)}</span>`;

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
      : `<span style="font-weight:700;font-size:11px;color:#fff;font-family:'Syne',sans-serif">${UI.initials(u.display_name || u.username)}</span>`;
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
        : `<div style="width:36px;height:36px;min-width:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;background:${c}22;color:${c};font-family:'Syne',sans-serif">${UI.initials(u.display_name || u.username)}</div>`;
      div.innerHTML = `${av}<div style="min-width:0"><div style="font-size:13px;font-weight:500;color:#DDE8F8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${u.display_name || u.username}</div><div style="font-size:11px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">@${u.username}</div></div>`;
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
  // Ensure it's in local list
  if (!_convs.find(c => c.id === convId)) _convs.push(conv);
  renderChatList();
  await openConv(convId);
}

// ── Group ─────────────────────────────────────────────────────────
function openGroupCreate() {
  const gc = document.getElementById('group-contacts');
  if (!gc) return;
  gc.innerHTML = '';

  // Sadece daha önce DM kurulmuş kişiler
  const chattedUsernames = _convs
    .filter(c => c.type === 'direct')
    .map(c => c.participants.find(p => p !== window._currentUser.username))
    .filter(Boolean);

  if (!chattedUsernames.length) {
    gc.innerHTML = '<div style="text-align:center;padding:20px;font-size:12px;color:#7A8FA8">Önce biriyle mesajlaşın.</div>';
    UI.openModal('group-modal');
    return;
  }

  chattedUsernames
    .map(un => _allUsers[un])
    .filter(Boolean)
    .sort((a, b) => (a.display_name || a.username).localeCompare(b.display_name || b.username, 'tr'))
    .forEach(u => {
      const c = UI.avatarColor(u.username);
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;cursor:pointer;transition:background .15s';
      div.onmouseenter = () => div.style.background = '#131D30';
      div.onmouseleave = () => div.style.background = 'transparent';
      div.innerHTML = `<input type="checkbox" value="${u.username}" style="width:16px;height:16px;accent-color:#00FFB3;flex-shrink:0;cursor:pointer">
        <div style="width:32px;height:32px;min-width:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:${c}22;color:${c};font-family:'Syne',sans-serif">${UI.initials(u.display_name || u.username)}</div>
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
    last_msg: '', last_time: Date.now(),
    unread_for: {}, admin: window._currentUser.username
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
  const isOpen = panel.style.display === 'flex' || panel.classList.contains('open');
  panel.style.display = isOpen ? 'none' : 'flex';
  if (!isOpen && window._currentConvId) updateInfoPanel(_convs.find(c => c.id === window._currentConvId));
}

function updateInfoPanel(conv) {
  const el = document.getElementById('info-panel-content');
  if (!el || !conv) return;
  if (conv.type === 'direct') {
    const other = _allUsers[conv.participants.find(p => p !== window._currentUser.username)] || {};
    const c = UI.avatarColor(other.username || '');
    const av = other.avatar_url
      ? `<img src="${other.avatar_url}" style="width:60px;height:60px;border-radius:50%;object-fit:cover;margin:0 auto 12px;display:block;cursor:pointer" onclick="showProfile('${other.username}')">`
      : `<div onclick="showProfile('${other.username}')" style="width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;margin:0 auto 12px;cursor:pointer;background:${c}22;color:${c};font-family:Syne,sans-serif">${UI.initials(other.display_name || other.username)}</div>`;
    el.innerHTML = `<div style="text-align:center">${av}<div style="font-weight:700;font-family:'Syne',sans-serif;color:#DDE8F8">${other.display_name || other.username}</div><div style="font-size:11px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">@${other.username}</div>${other.status ? `<div style="font-size:12px;margin-top:4px;color:#9AB0C8">${other.status_emoji || ''} ${other.status}</div>` : ''}</div>
    <div style="border-top:1px solid #1E2D45;padding-top:12px;margin-top:12px"><div style="font-size:10px;font-weight:600;color:#7A8FA8;font-family:'JetBrains Mono',monospace;margin-bottom:8px">GÜVENLİK</div><div style="font-size:11px;color:#DDE8F8;display:flex;flex-direction:column;gap:5px"><div>🔒 AES-256-GCM</div><div>🛡 PBKDF2 100k</div><div>🚫 Sıfır Kayıt</div></div></div>`;
  } else {
    const members = conv.participants.map(uid => {
      const u = _allUsers[uid] || { username: uid, display_name: uid };
      const c = UI.avatarColor(u.username);
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0"><div style="width:28px;height:28px;min-width:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:${c}22;color:${c};font-family:Syne,sans-serif">${UI.initials(u.display_name || u.username)}</div><div><div style="font-size:12px;font-weight:500;color:#DDE8F8">${u.display_name || u.username}</div>${conv.admin === uid ? '<div style="font-size:10px;color:#FFD700">Yönetici</div>' : ''}</div></div>`;
    }).join('');
    el.innerHTML = `<div style="text-align:center"><div style="width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;margin:0 auto 12px;background:${getConvColor(conv)}22;color:${getConvColor(conv)};font-family:Syne,sans-serif">${conv.avatar || UI.initials(conv.name)}</div><div style="font-weight:700;font-family:'Syne',sans-serif;color:#DDE8F8">${conv.name}</div><div style="font-size:12px;color:#7A8FA8">${conv.participants.length} üye</div></div><div style="border-top:1px solid #1E2D45;padding-top:12px;margin-top:12px"><div style="font-size:10px;font-weight:600;color:#7A8FA8;font-family:'JetBrains Mono',monospace;margin-bottom:8px">ÜYELER</div>${members}</div>`;
  }
}

// ── Search ─────────────────────────────────────────────────────────
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

// ── Filter ─────────────────────────────────────────────────────────
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
  applyDark(_settings.dark);
  applyLowData(_settings.lowData);
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
      btn.style.cssText = `width:28px;height:28px;border-radius:50%;background:${col};border:2px solid ${cu.banner_color === col ? '#00FFB3' : 'transparent'};cursor:pointer;transition:border-color .15s`;
      btn.onclick = () => { document.querySelectorAll('#banner-colors button').forEach(b => b.style.borderColor = 'transparent'); btn.style.borderColor = '#00FFB3'; window._selectedBannerColor = col; };
      bp.appendChild(btn);
    });
  }
  window._selectedBannerColor = cu.banner_color;
  const prev = document.getElementById('avatar-preview');
  if (prev) {
    if (cu.avatar_url) {
      prev.innerHTML = `<img src="${cu.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    } else {
      const c = UI.avatarColor(cu.username);
      prev.style.background = `linear-gradient(135deg,${c},${c}99)`;
      prev.style.color = '#fff';
      prev.textContent = UI.initials(cu.display_name || cu.username);
    }
  }
  UI.openModal('profile-edit-modal');
}

async function saveProfile() {
  const cu = window._currentUser;
  const d = {
    display_name: document.getElementById('pe-displayname').value.trim() || cu.display_name,
    bio: document.getElementById('pe-bio').value.trim(),
    status: document.getElementById('pe-status').value.trim(),
    status_emoji: document.getElementById('pe-statusemoji').value.trim(),
    banner_color: window._selectedBannerColor || cu.banner_color
  };
  await DB.updateUser(cu.username, d);
  window._currentUser = { ...cu, ...d };
  _allUsers[cu.username] = window._currentUser;
  UI.closeModal('profile-edit-modal');
  renderMyAvatar();
  UI.toast('Profil güncellendi ✓', 'success');
}

async function uploadAvatar(input) {
  const file = input.files[0]; if (!file) return;
  if (file.size > CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024) { UI.toast(`Maks. ${CONFIG.MAX_FILE_SIZE_MB}MB`, 'error'); return; }
  const r = new FileReader(); r.readAsDataURL(file);
  r.onload = async () => {
    await DB.updateUser(window._currentUser.username, { avatar_url: r.result });
    window._currentUser.avatar_url = r.result;
    _allUsers[window._currentUser.username].avatar_url = r.result;
    renderMyAvatar();
    const prev = document.getElementById('avatar-preview');
    if (prev) prev.innerHTML = `<img src="${r.result}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    UI.toast('Profil fotoğrafı güncellendi ✓', 'success');
  };
}

// ── Screenshot protection ─────────────────────────────────────────
function setupScreenshotDetection() {
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'p') && window._currentConvId) {
      e.preventDefault();
      document.getElementById('ss-overlay')?.classList.add('show');
      UI.toast('⚠️ Ekran görüntüsü engellendi', 'warn');
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && window._currentConvId) {
      document.getElementById('ss-overlay')?.classList.add('show');
    }
  });
}

// ── Profile card helper ───────────────────────────────────────────
window.showProfile = (username) => {
  const u = _allUsers[username];
  if (u) UI.showProfileCard(u);
};

// ── Voice call stub ───────────────────────────────────────────────
function startVoiceCall() {
  UI.toast('📞 Sesli arama başlatılıyor… (Demo)', 'info');
  setTimeout(() => UI.toast('Karşı taraf yanıt vermiyor.', 'warn'), 2500);
}

// ── Boot ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await DB.init();
  await bootApp();

  Messages.initEvents();

  // Close pickers on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('#gif-picker') && !e.target.closest('[onclick*="toggleGif"]') && !e.target.closest('[onclick*="Messages.toggleGif"]')) {
      document.getElementById('gif-picker')?.classList.remove('open');
      Messages._gifOpen = false;
    }
    if (!e.target.closest('#sticker-picker') && !e.target.closest('[onclick*="toggleSticker"]') && !e.target.closest('[onclick*="Messages.toggleSticker"]')) {
      document.getElementById('sticker-picker')?.classList.remove('open');
      Messages._stickerOpen = false;
    }
    if (!e.target.closest('#reaction-picker') && !e.target.closest('.reaction-pill'))
      UI.hideReactionPicker();
    if (!e.target.closest('#profile-card') && !e.target.closest('[onclick*="showProfile"]'))
      document.getElementById('profile-card')?.classList.add('hidden');
    if (!e.target.closest('#ctx-menu'))
      document.getElementById('ctx-menu')?.classList.add('hidden');
  });
});

// ── Mesaj İletme ──────────────────────────────────────────────────
function openForwardModal(msgId) {
  window._forwardMsgId = msgId;
  // Sohbet seçim listesi oluştur
  let html = '<div style="display:flex;flex-direction:column;gap:4px;padding:8px">';
  const sorted = [..._convs].sort((a,b) => (b.last_time||0)-(a.last_time||0));
  for (const conv of sorted) {
    if (conv.id === window._currentConvId) continue;
    const name = getConvName(conv);
    const color = getConvColor(conv);
    const other = conv.type === 'direct' ? _allUsers[conv.participants.find(p=>p!==window._currentUser.username)] : null;
    const av = other?.avatar_url
      ? `<img src="${other.avatar_url}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0">`
      : `<div style="width:32px;height:32px;min-width:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:${color}22;color:${color};font-family:Syne,sans-serif;flex-shrink:0">${UI.initials(name)}</div>`;
    html += `<div onclick="forwardTo('${conv.id}')" style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;cursor:pointer;transition:background .15s" onmouseenter="this.style.background='#131D30'" onmouseleave="this.style.background='transparent'">${av}<span style="font-size:13px;color:#DDE8F8">${name}</span></div>`;
  }
  html += '</div>';

  let modal = document.getElementById('forward-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'forward-modal';
    modal.className = 'fixed inset-0 z-50 hidden items-center justify-center';
    modal.style.background = 'rgba(6,8,15,.92)';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div style="width:100%;max-width:320px;margin:0 12px;background:#0C1220;border:1px solid #1E2D45;border-radius:20px;max-height:70vh;display:flex;flex-direction:column;overflow:hidden;animation:slideUp .2s ease-out">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #1E2D45;flex-shrink:0">
      <span style="font-family:Syne,sans-serif;font-weight:700;color:#DDE8F8">↪ Mesajı İlet</span>
      <button onclick="UI.closeModal('forward-modal')" style="color:#7A8FA8;background:none;border:none;cursor:pointer">✕</button>
    </div>
    <div style="overflow-y:auto">${html}</div>
  </div>`;
  UI.openModal('forward-modal');
}

async function forwardTo(convId) {
  UI.closeModal('forward-modal');
  const msgId = window._forwardMsgId; if (!msgId) return;
  const msgs = await DB.getMessages(window._currentConvId);
  const orig = msgs.find(m => m.id === msgId); if (!orig) return;
  const cu = window._currentUser; const now = Date.now();
  const fwdText = orig.text ? `↪ İletildi:\n${orig.text}` : '↪ İletildi';
  await DB.createMessage({ conv_id: convId, from: cu.username, type: 'text', text: fwdText, status: 'sent', created_at: now });
  await DB.updateConversation(convId, { last_msg: fwdText.slice(0,40), last_time: now });
  await loadConversations();
  UI.toast('Mesaj iletildi ↪', 'success');
}

// ── Uygulama Paylaşma ─────────────────────────────────────────────
function shareApp() {
  const url = window.location.origin + window.location.pathname.replace('app.html','');
  const text = 'CIPHER — Uçtan uca şifreli, gizli mesajlaşma uygulaması. Hemen dene:';
  if (navigator.share) {
    navigator.share({ title: 'CIPHER Messenger', text, url }).catch(()=>{});
  } else {
    navigator.clipboard.writeText(url);
    UI.toast('Uygulama linki kopyalandı 🔗', 'success');
  }
}

// ── Bot sohbeti oluştur (ilk girişte) ─────────────────────────────
async function ensureBotConversation() {
  const BOT = 'cipher_bot';
  const bot = await DB.getUser(BOT);
  if (!bot) return; // Bot yoksa (admin mesaj atmadıysa) gösterme
  const ids = [BOT, window._currentUser.username].sort();
  const convId = ids.join('_');
  const existing = await DB.getConversation(convId);
  if (existing) return; // Zaten var
  // Bot konuşması oluştur + hoş geldin mesajı
  const now = Date.now();
  const welcome = `👋 Merhaba ${window._currentUser.display_name || window._currentUser.username}! Ben CIPHER Bot. Sistem bildirimleri ve duyuruları buradan iletiyorum. Güvenli mesajlaşmalar! 🔐`;
  await DB.createConversation({ id: convId, type: 'direct', participants: ids, last_msg: welcome, last_time: now, unread_for: { [window._currentUser.username]: 1 } });
  await DB.createMessage({ conv_id: convId, from: BOT, type: 'text', text: welcome, status: 'sent', created_at: now });
}

function openBlockReport() {
  const conv = _convs.find(c => c.id === window._currentConvId);
  if (!conv || conv.type !== 'direct') return;
  const otherU = conv.participants.find(p => p !== window._currentUser.username);
  const u = _allUsers[otherU];
  if (!u) return;
  window._brTarget = u.username;

  const blocked = getBlockedList();
  const isBlocked = blocked.includes(u.username);
  const color = UI.avatarColor(u.username);
  const av = u.avatar_url
    ? `<img src="${u.avatar_url}" style="width:36px;height:36px;border-radius:50%;object-fit:cover">`
    : `<div style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;background:${color}22;color:${color};font-family:Syne,sans-serif">${UI.initials(u.display_name || u.username)}</div>`;
  document.getElementById('br-user-info').innerHTML = `${av}<div><div style="font-size:13px;font-weight:600;color:#DDE8F8">${u.display_name || u.username}</div><div style="font-size:11px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">@${u.username}</div></div>`;

  const blockBtn = document.getElementById('br-block-btn');
  if (isBlocked) {
    blockBtn.innerHTML = `<span style="font-size:18px">✅</span><div><div style="font-size:13px;font-weight:600">Engeli Kaldır</div><div style="font-size:11px;opacity:.7">Mesaj alabilirsin</div></div>`;
  } else {
    blockBtn.innerHTML = `<span style="font-size:18px">🚫</span><div><div style="font-size:13px;font-weight:600">Engelle</div><div style="font-size:11px;opacity:.7">Bu kullanıcıdan mesaj alamazsın</div></div>`;
  }
  UI.openModal('block-report-modal');
}

function getBlockedList() {
  try { return JSON.parse(localStorage.getItem('cipher_blocked_' + window._currentUser.username) || '[]'); } catch { return []; }
}
function saveBlockedList(list) {
  localStorage.setItem('cipher_blocked_' + window._currentUser.username, JSON.stringify(list));
}

function blockUser() {
  const target = window._brTarget; if (!target) return;
  const blocked = getBlockedList();
  const idx = blocked.indexOf(target);
  if (idx >= 0) {
    blocked.splice(idx, 1);
    saveBlockedList(blocked);
    UI.toast(`@${target} engeli kaldırıldı`, 'info');
  } else {
    blocked.push(target);
    saveBlockedList(blocked);
    UI.toast(`@${target} engellendi 🚫`, 'warn');
  }
  UI.closeModal('block-report-modal');
}

function reportUser() {
  const target = window._brTarget; if (!target) return;
  // Log to admin reports
  const reports = JSON.parse(localStorage.getItem('cipher_admin_reports') || '[]');
  reports.push({ type: 'user', target, from: window._currentUser.username, time: Date.now(), note: 'Kullanıcı şikayeti' });
  localStorage.setItem('cipher_admin_reports', JSON.stringify(reports));
  UI.closeModal('block-report-modal');
  UI.toast('Şikayet iletildi. Teşekkürler 🚨', 'success');
}

// ── Report form ───────────────────────────────────────────────────
function openReportModal() { UI.openModal('report-modal'); }
function submitReport() {
  const type = document.getElementById('report-type').value;
  const text = document.getElementById('report-text').value.trim();
  if (!text) { UI.toast('Açıklama girin', 'error'); return; }
  const reports = JSON.parse(localStorage.getItem('cipher_admin_reports') || '[]');
  reports.push({ type, from: window._currentUser.username, text, time: Date.now() });
  localStorage.setItem('cipher_admin_reports', JSON.stringify(reports));
  document.getElementById('report-text').value = '';
  UI.closeModal('report-modal');
  UI.toast('Sorun bildirildi ✓', 'success');
}

// ── Lock account ──────────────────────────────────────────────────
function openLockAccount() { document.getElementById('lock-pwd').value = ''; document.getElementById('lock-err').style.display = 'none'; UI.openModal('lock-modal'); }
async function confirmLock() {
  const pwd = document.getElementById('lock-pwd').value;
  if (!pwd) return;
  const hash = await DB.hashPassword(pwd);
  const cu = window._currentUser;
  if (hash !== cu.password_hash) {
    const e = document.getElementById('lock-err'); e.textContent = 'Şifre yanlış.'; e.style.display = '';
    return;
  }
  UI.closeModal('lock-modal');
  Auth.logout();
  UI.toast('Hesap kilitlendi', 'info');
}

// ── Delete account ────────────────────────────────────────────────
function openDeleteAccount() {
  document.getElementById('delete-confirm').value = '';
  document.getElementById('delete-pwd').value = '';
  document.getElementById('del-err').style.display = 'none';
  UI.openModal('delete-account-modal');
}
async function confirmDeleteAccount() {
  const confirm = document.getElementById('delete-confirm').value.trim();
  const pwd = document.getElementById('delete-pwd').value;
  const errEl = document.getElementById('del-err');
  const showErr = msg => { errEl.textContent = msg; errEl.style.display = ''; };

  if (confirm !== 'SİL') { showErr('"SİL" yazmanız gerekiyor.'); return; }
  if (!pwd) { showErr('Şifre girin.'); return; }

  const hash = await DB.hashPassword(pwd);
  const cu = window._currentUser;
  if (hash !== cu.password_hash) { showErr('Şifre yanlış.'); return; }

  await DB.deleteUser(cu.username);
  UI.closeModal('delete-account-modal');
  UI.toast('Hesap silindi. Güle güle 👋', 'info');
  setTimeout(() => Auth.logout(), 1500);
}

// ── Notifications ─────────────────────────────────────────────────
let _notifs = [];
function addNotif(msg, from, convId) {
  _notifs.unshift({ msg, from, convId, time: Date.now(), read: false });
  if (_notifs.length > 50) _notifs = _notifs.slice(0, 50);
  updateNotifBadge();
  // Browser notification
  if (Notification.permission === 'granted' && document.hidden) {
    const u = _allUsers[from];
    new Notification(u?.display_name || from, { body: msg, icon: 'icons/icon-192.png' });
  }
}

function updateNotifBadge() {
  const unread = _notifs.filter(n => !n.read).length;
  let badge = document.getElementById('notif-badge');
  if (!badge) {
    const btn = document.getElementById('notif-btn');
    if (!btn) return;
    badge = document.createElement('span');
    badge.id = 'notif-badge';
    badge.style.cssText = 'position:absolute;top:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:#FF3D6B;color:#fff;font-size:9px;display:flex;align-items:center;justify-content:center;font-family:\'JetBrains Mono\',monospace;border:2px solid #06080F';
    btn.style.position = 'relative';
    btn.appendChild(badge);
  }
  badge.textContent = unread > 9 ? '9+' : unread;
  badge.style.display = unread > 0 ? 'flex' : 'none';
}

function openNotifs() {
  _notifs.forEach(n => n.read = true);
  updateNotifBadge();
  const list = document.getElementById('notif-list');
  if (!list) return;
  if (!_notifs.length) { list.innerHTML = '<div style="text-align:center;padding:24px;color:#7A8FA8;font-size:13px">Henüz bildirim yok</div>'; }
  else {
    list.innerHTML = _notifs.map(n => {
      const u = _allUsers[n.from] || { username: n.from, display_name: n.from };
      const c = UI.avatarColor(u.username);
      return `<div onclick="UI.closeModal('notif-modal');openConv('${n.convId}')" style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;cursor:pointer;background:#06080F;border:1px solid #1E2D45;transition:background .15s" onmouseenter="this.style.background='#0C1220'" onmouseleave="this.style.background='#06080F'">
        <div style="width:32px;height:32px;min-width:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:${c}22;color:${c};font-family:Syne,sans-serif">${UI.initials(u.display_name || u.username)}</div>
        <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;color:#DDE8F8">${u.display_name || u.username}</div><div style="font-size:11px;color:#7A8FA8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.msg}</div></div>
        <span style="font-size:10px;color:#7A8FA8;font-family:'JetBrains Mono',monospace;flex-shrink:0">${UI.fmtTime(n.time)}</span>
      </div>`;
    }).join('');
  }
  UI.openModal('notif-modal');
}

function clearAllNotifs() { _notifs = []; updateNotifBadge(); UI.closeModal('notif-modal'); }

// Inject notification on incoming message
const _origStorageSync = null;


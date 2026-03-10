/**
 * CIPHER — Main App
 * Runs on app.html after auth.
 */

// Global state
let _allUsers     = {};
let _convs        = [];
let _chatFilter   = 'all';
let _searchQuery  = '';
let _infoPanelOpen = false;

// ── Boot ──────────────────────────────────────────────────────────
async function bootApp() {
  if (!Auth.requireAuth()) return;
  window._currentUser = await Auth.currentUser();
  if (!window._currentUser) { Auth.logout(); return; }

  // Load users map
  const users = await DB.getAllUsers();
  users.forEach(u => { _allUsers[u.username] = u; });

  // Init UI
  renderMyAvatar();
  await loadConversations();
  await renderStories();

  // Hook new-message callback
  window._onNewMessage = async (msg) => {
    await loadConversations();
    if (window._currentConvId) await renderCurrentChat();
  };

  // Screenshot detection
  setupScreenshotDetection();

  // Load settings state
  loadSettings();

  // PWA
  PWA.init();
}

// ── My avatar in header ────────────────────────────────────────────
function renderMyAvatar() {
  const cu = window._currentUser;
  const el = document.getElementById('my-avatar');
  if (!el) return;
  if (cu.avatar_url) {
    el.innerHTML = `<img src="${cu.avatar_url}" class="w-full h-full rounded-full object-cover">`;
  } else {
    const color = UI.avatarColor(cu.username);
    el.style.background = `linear-gradient(135deg,${color},${color}99)`;
    el.style.color = '#fff';
    el.textContent = UI.initials(cu.display_name || cu.username);
  }
  document.getElementById('my-name').textContent = cu.display_name || cu.username;
}

// ── Load & render conversation list ───────────────────────────────
async function loadConversations() {
  _convs = await DB.getConversations(window._currentUser.username);
  renderChatList();
}

function renderChatList() {
  const list = document.getElementById('chat-list');
  if (!list) return;
  let items = [..._convs];

  if (_chatFilter === 'unread') items = items.filter(c => (c.unread_for?.[window._currentUser.username] || 0) > 0);
  if (_chatFilter === 'groups') items = items.filter(c => c.type === 'group');
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    items = items.filter(c => getConvName(c).toLowerCase().includes(q) || (c.last_msg||'').toLowerCase().includes(q));
  }
  items.sort((a, b) => (b.last_time||0) - (a.last_time||0));

  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="text-center py-8 text-xs" style="color:#7A8FA8">Sohbet bulunamadı</div>';
    return;
  }

  items.forEach(conv => {
    const name   = getConvName(conv);
    const avatar = getConvAvatar(conv);
    const color  = getConvColor(conv);
    const unread = conv.unread_for?.[window._currentUser.username] || 0;
    const isActive = conv.id === window._currentConvId;

    const div = document.createElement('div');
    div.className = `flex items-center gap-3 px-3 py-3 cursor-pointer rounded-xl mx-2 my-0.5 transition-all`;
    div.style.background = isActive ? '#151E30' : '';
    div.onmouseenter = () => { if (!isActive) div.style.background = '#0C1220'; };
    div.onmouseleave = () => { if (!isActive) div.style.background = ''; };

    div.innerHTML = `
      <div class="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 overflow-hidden" style="background:${color}22;color:${color}">
        ${_allUsers[conv.type==='direct'?conv.participants.find(p=>p!==window._currentUser.username):null]?.avatar_url
          ? `<img src="${_allUsers[conv.participants.find(p=>p!==window._currentUser.username)]?.avatar_url}" class="w-full h-full object-cover">`
          : UI.initials(name)}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between mb-0.5">
          <span class="font-semibold text-sm truncate" style="font-family:Syne,sans-serif;color:#DDE8F8">${name}</span>
          <span class="text-xs flex-shrink-0 ml-2" style="color:#7A8FA8;font-family:'JetBrains Mono',monospace;font-size:10px">${conv.last_time ? UI.fmtTime(conv.last_time) : ''}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-xs truncate" style="color:#7A8FA8;max-width:160px">${conv.last_msg||''}</span>
          ${unread > 0 ? `<span class="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ml-1" style="background:#00FFB3;color:#062B1F;font-size:10px">${unread}</span>` : ''}
        </div>
      </div>`;
    div.onclick = () => openConv(conv.id);
    list.appendChild(div);
  });
}

// ── Open conversation ──────────────────────────────────────────────
async function openConv(convId) {
  window._currentConvId = convId;
  const conv = _convs.find(c => c.id === convId);
  if (!conv) return;

  // Mark read
  const unreadFor = { ...(conv.unread_for || {}), [window._currentUser.username]: 0 };
  await DB.updateConversation(convId, { unread_for: unreadFor });
  conv.unread_for = unreadFor;

  // Update UI elements
  window._isGroup = conv.type === 'group';
  const name  = getConvName(conv);
  const color = getConvColor(conv);
  const otherUser = conv.type === 'direct' ? _allUsers[conv.participants.find(p => p !== window._currentUser.username)] : null;

  // Header
  const avatarEl = document.getElementById('chat-avatar');
  if (otherUser?.avatar_url) {
    avatarEl.innerHTML = `<img src="${otherUser.avatar_url}" class="w-full h-full rounded-full object-cover">`;
  } else {
    avatarEl.style.background = `${color}22`;
    avatarEl.style.color = color;
    avatarEl.textContent = conv.type === 'group' ? (conv.avatar || UI.initials(name)) : UI.initials(name);
  }
  document.getElementById('chat-name').textContent = name;
  document.getElementById('chat-status').textContent = conv.type === 'group'
    ? `${conv.participants.length} üye · Grup`
    : (otherUser?.status || '🟢 Çevrimiçi');

  // Show/hide panes
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('chat-view').classList.remove('hidden');

  // Avatar click → profile card
  avatarEl.onclick = otherUser ? () => UI.showProfileCard(otherUser, avatarEl) : null;
  avatarEl.style.cursor = otherUser ? 'pointer' : 'default';

  // Real-time subscription (Supabase)
  Messages.subscribe(convId, () => window._onNewMessage?.());

  await renderCurrentChat();
  renderChatList();
  if (_infoPanelOpen) updateInfoPanel(conv);
}

async function renderCurrentChat(highlight = '') {
  if (!window._currentConvId) return;
  await Messages.renderAll(window._currentConvId, _allUsers, highlight);
}

// ── Show profile card (global, called from messages.js) ────────────
window.showProfile = (username) => {
  const user = _allUsers[username];
  if (user) UI.showProfileCard(user);
};

// ── Stories ────────────────────────────────────────────────────────
async function renderStories() {
  const stories = await DB.getStories();
  const strip   = document.getElementById('stories-strip');
  if (!strip) return;
  strip.innerHTML = '';

  // My story button
  const myBtn = document.createElement('div');
  myBtn.className = 'flex flex-col items-center gap-1 cursor-pointer flex-shrink-0';
  const cu = window._currentUser;
  const myColor = UI.avatarColor(cu.username);
  const myAvatar = cu.avatar_url
    ? `<img src="${cu.avatar_url}" class="w-full h-full rounded-full object-cover">`
    : `<span class="font-bold text-xs" style="color:#fff">${UI.initials(cu.display_name||cu.username)}</span>`;
  myBtn.innerHTML = `
    <div class="w-12 h-12 rounded-full flex items-center justify-center relative" style="background:${myColor}">
      ${myAvatar}
      <div class="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold" style="background:#00FFB3;color:#062B1F">+</div>
    </div>
    <span class="text-xs" style="color:#7A8FA8;font-size:10px;font-family:JetBrains Mono,monospace">Hikaye</span>`;
  myBtn.onclick = addStory;
  strip.appendChild(myBtn);

  // Others' stories
  stories.forEach(story => {
    const u = _allUsers[story.user_id || story.userId];
    if (!u) return;
    const uc = UI.avatarColor(u.username);
    const seen = story.seen_by?.includes(window._currentUser.username);
    const div = document.createElement('div');
    div.className = 'flex flex-col items-center gap-1 cursor-pointer flex-shrink-0';
    const ringClass = seen ? 'story-ring-seen' : 'story-ring';
    const uAvatar = u.avatar_url
      ? `<img src="${u.avatar_url}" class="w-full h-full rounded-full object-cover" style="border:2px solid #06080F">`
      : `<span class="font-bold text-xs" style="color:#fff;font-family:Syne,sans-serif">${UI.initials(u.display_name)}</span>`;
    div.innerHTML = `
      <div class="${ringClass} w-12 h-12 rounded-full">
        <div class="w-full h-full rounded-full flex items-center justify-center overflow-hidden" style="background:${uc}22;border:2px solid #06080F">${uAvatar}</div>
      </div>
      <span class="text-xs truncate w-12 text-center" style="color:${seen?'#7A8FA8':'#DDE8F8'};font-size:10px">${(u.display_name||u.username).split(' ')[0]}</span>`;
    div.onclick = () => { UI.showStory(story, u); };
    strip.appendChild(div);
  });
}

async function addStory() {
  const text = prompt('Hikayenizi yazın (maks 200 karakter):');
  if (!text?.trim()) return;
  await DB.createStory({ user_id: window._currentUser.username, text: text.trim(), seen_by: [] });
  await renderStories();
  UI.toast('Hikaye paylaşıldı! 📖', 'success');
}

// ── Send message ───────────────────────────────────────────────────
async function sendMessage() {
  if (!window._currentConvId) return;
  await Messages.send(window._currentConvId);
  await renderCurrentChat();
  await loadConversations();
  simulateReply();
}

// ── Handle keyboard in message input ──────────────────────────────
function handleMsgKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

// ── Simulate reply (demo mode) ─────────────────────────────────────
const _demoBots = ['alice', 'marcus'];
const _demoReplies = ['Anladım 👍','Harika!','Teşekkürler 🙏','Tamam!','Şifreli kanal açık 🔒','İyi fikir!','Evet, onu biliyorum.','👀','🔥','Kesinlikle!'];
function simulateReply() {
  if (!window._currentConvId) return;
  const conv = _convs.find(c => c.id === window._currentConvId);
  if (!conv || conv.type !== 'direct') return;
  const other = conv.participants.find(p => p !== window._currentUser.username);
  if (!_demoBots.includes(other)) return;

  const delay = 1500 + Math.random() * 3000;
  // Show typing indicator
  setTimeout(() => {
    const ind = document.getElementById('typing-indicator');
    const av  = document.getElementById('typing-avatar');
    if (ind && av) {
      const u = _allUsers[other];
      if (u?.avatar_url) { av.innerHTML = `<img src="${u.avatar_url}" class="w-full h-full rounded-full object-cover">`; }
      else { av.style.background = UI.avatarColor(other); av.textContent = UI.initials(u?.display_name||other); }
      ind.classList.remove('hidden');
      setTimeout(async () => {
        ind.classList.add('hidden');
        if (Math.random() < 0.75) {
          const text = _demoReplies[Math.floor(Math.random() * _demoReplies.length)];
          const msg = await DB.createMessage({ conv_id: window._currentConvId, from: other, text, type: 'text', status: 'read', created_at: Date.now() });
          await DB.updateConversation(window._currentConvId, { last_msg: text, last_time: Date.now() });
          await renderCurrentChat(); await loadConversations();
        }
      }, 1500);
    }
  }, delay);
}

// ── Search ─────────────────────────────────────────────────────────
function handleSidebarSearch(q) {
  _searchQuery = q;
  document.getElementById('search-clear')?.classList.toggle('hidden', !q);
  renderChatList();
}
function clearSidebarSearch() {
  _searchQuery = '';
  const inp = document.getElementById('search-input');
  if (inp) inp.value = '';
  document.getElementById('search-clear')?.classList.add('hidden');
  renderChatList();
}
function toggleMsgSearch() {
  const bar = document.getElementById('chat-search-bar');
  bar?.classList.toggle('hidden');
  if (!bar?.classList.contains('hidden')) document.getElementById('msg-search')?.focus();
}
async function searchInMessages(q) {
  const countEl = document.getElementById('search-count');
  if (!q) { if (countEl) countEl.textContent = ''; await renderCurrentChat(); return; }
  const msgs = await DB.getMessages(window._currentConvId);
  const hits  = msgs.filter(m => m.text?.toLowerCase().includes(q.toLowerCase()));
  if (countEl) countEl.textContent = hits.length + ' sonuç';
  await renderCurrentChat(q);
  if (hits.length) document.getElementById('msg-' + hits[0].id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Filter tabs ────────────────────────────────────────────────────
function setFilter(f) {
  _chatFilter = f;
  ['all','unread','groups'].forEach(id => {
    const btn = document.getElementById('filter-' + id);
    if (!btn) return;
    btn.style.background = f === id ? '#131D30' : 'transparent';
    btn.style.color      = f === id ? '#DDE8F8' : '#7A8FA8';
  });
  renderChatList();
}

// ── Info panel ─────────────────────────────────────────────────────
function toggleInfoPanel() {
  _infoPanelOpen = !_infoPanelOpen;
  const panel = document.getElementById('info-panel');
  panel?.classList.toggle('hidden', !_infoPanelOpen);
  panel?.classList.toggle('flex', _infoPanelOpen);
  if (_infoPanelOpen && window._currentConvId) {
    updateInfoPanel(_convs.find(c => c.id === window._currentConvId));
  }
}

function updateInfoPanel(conv) {
  const el = document.getElementById('info-panel-content');
  if (!el || !conv) return;
  if (conv.type === 'direct') {
    const other = _allUsers[conv.participants.find(p => p !== window._currentUser.username)] || {};
    const color = UI.avatarColor(other.username || '');
    const av = other.avatar_url
      ? `<img src="${other.avatar_url}" class="w-16 h-16 rounded-full object-cover mx-auto mb-3 cursor-pointer" onclick="showProfile('${other.username}')">`
      : `<div class="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-3 cursor-pointer" style="background:${color}22;color:${color}" onclick="showProfile('${other.username}')">${UI.initials(other.display_name||other.username)}</div>`;
    el.innerHTML = `
      <div class="text-center">${av}
        <div class="font-bold" style="font-family:Syne,sans-serif;color:#DDE8F8">${other.display_name||other.username}</div>
        <div class="text-xs font-mono" style="color:#7A8FA8">@${other.username}</div>
        ${other.status ? `<div class="text-xs mt-1" style="color:#9AB0C8">${other.status}</div>` : ''}
      </div>
      <div class="border-t pt-3" style="border-color:#1E2D45">
        <div class="text-xs font-semibold mb-2" style="color:#7A8FA8;font-family:'JetBrains Mono',monospace;font-size:10px">GÜVENLİK</div>
        <div class="space-y-2 text-xs" style="color:#DDE8F8">
          <div class="flex items-center gap-2"><span style="color:#00FFB3">🔒</span> AES-256-GCM Şifreleme</div>
          <div class="flex items-center gap-2"><span style="color:#00FFB3">🛡</span> PBKDF2 Anahtar Türetme</div>
          <div class="flex items-center gap-2"><span style="color:#00FFB3">🚫</span> Sıfır Sunucu Kaydı</div>
        </div>
      </div>`;
  } else {
    const members = conv.participants.map(uid => {
      const u = _allUsers[uid] || { username: uid, display_name: uid };
      const c = UI.avatarColor(u.username);
      const av = u.avatar_url
        ? `<img src="${u.avatar_url}" class="w-7 h-7 rounded-full object-cover cursor-pointer" onclick="showProfile('${u.username}')">`
        : `<div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold cursor-pointer" style="background:${c}22;color:${c}" onclick="showProfile('${u.username}')">${UI.initials(u.display_name||u.username)}</div>`;
      return `<div class="flex items-center gap-2 py-1.5">${av}<div><div class="text-xs font-medium" style="color:#DDE8F8">${u.display_name||u.username}</div>${conv.admin===uid?'<div class="text-xs" style="color:#FFD700">Yönetici</div>':''}</div></div>`;
    }).join('');
    el.innerHTML = `
      <div class="text-center">
        <div class="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-3" style="background:${getConvColor(conv)}22;color:${getConvColor(conv)}">${conv.avatar||UI.initials(conv.name)}</div>
        <div class="font-bold" style="font-family:Syne,sans-serif;color:#DDE8F8">${conv.name}</div>
        <div class="text-xs" style="color:#7A8FA8">${conv.participants.length} üye</div>
      </div>
      <div class="border-t pt-3" style="border-color:#1E2D45">
        <div class="text-xs font-semibold mb-2" style="color:#7A8FA8;font-family:'JetBrains Mono',monospace;font-size:10px">ÜYELER</div>
        ${members}
      </div>`;
  }
}

// ── New chat / group ───────────────────────────────────────────────
function openNewChat() {
  const list = document.getElementById('contacts-list');
  if (!list) return;
  list.innerHTML = '';
  Object.values(_allUsers).filter(u => u.username !== window._currentUser.username).forEach(u => {
    const c = UI.avatarColor(u.username);
    const av = u.avatar_url
      ? `<img src="${u.avatar_url}" class="w-9 h-9 rounded-full object-cover">`
      : `<div class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold" style="background:${c}22;color:${c}">${UI.initials(u.display_name||u.username)}</div>`;
    const div = document.createElement('div');
    div.className = 'flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all hover:bg-c-elev';
    div.innerHTML = `${av}<div><div class="text-sm font-medium" style="color:#DDE8F8">${u.display_name||u.username}</div><div class="text-xs font-mono" style="color:#7A8FA8">@${u.username}</div></div>`;
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
    _convs.push(conv);
  }
  renderChatList();
  await openConv(convId);
}

function openGroupCreate() {
  const gc = document.getElementById('group-contacts');
  if (!gc) return;
  gc.innerHTML = '';
  Object.values(_allUsers).filter(u => u.username !== window._currentUser.username).forEach(u => {
    const c = UI.avatarColor(u.username);
    const div = document.createElement('div');
    div.className = 'flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-all hover:bg-c-elev';
    div.innerHTML = `<input type="checkbox" value="${u.username}" class="w-4 h-4 rounded" style="accent-color:#00FFB3"><div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style="background:${c}22;color:${c}">${UI.initials(u.display_name||u.username)}</div><span class="text-sm" style="color:#DDE8F8">${u.display_name||u.username}</span>`;
    div.onclick = e => { if (e.target.tagName !== 'INPUT') div.querySelector('input').click(); };
    gc.appendChild(div);
  });
  UI.openModal('group-modal');
}

async function createGroup() {
  const name     = document.getElementById('group-name')?.value.trim();
  if (!name) { UI.toast('Grup adı girin', 'error'); return; }
  const selected = Array.from(document.querySelectorAll('#group-contacts input:checked')).map(i => i.value);
  if (!selected.length) { UI.toast('En az 1 üye seçin', 'error'); return; }
  const colors = ['#9333EA','#0EA5E9','#F59E0B','#10B981','#EF4444'];
  const convId = 'group_' + Date.now();
  const conv = await DB.createConversation({
    id: convId, type: 'group', name,
    participants: [window._currentUser.username, ...selected],
    avatar: UI.initials(name), banner_color: colors[Math.floor(Math.random()*colors.length)],
    last_msg: '', last_time: Date.now(), unread_for: {}, admin: window._currentUser.username
  });
  _convs.push(conv);
  UI.closeModal('group-modal');
  renderChatList();
  await openConv(convId);
  UI.toast(`"${name}" grubu oluşturuldu! 🎉`, 'success');
}

// ── Settings ───────────────────────────────────────────────────────
let _settings = { dark: true, lowData: false, notifs: true };

function loadSettings() {
  try { _settings = JSON.parse(localStorage.getItem('cipher_settings') || '{"dark":true,"lowData":false,"notifs":true}'); } catch {}
  applyDark(_settings.dark);
  applyLowData(_settings.lowData);
}
function saveSettings() { localStorage.setItem('cipher_settings', JSON.stringify(_settings)); }

function applyDark(on) {
  document.documentElement.classList.toggle('light-mode', !on);
  updateToggle('dark-toggle', on);
}
function applyLowData(on) {
  document.documentElement.classList.toggle('low-data', on);
  updateToggle('lowdata-toggle', on);
}
function updateToggle(id, on) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `toggle-track ${on ? 'on' : 'off'}`;
  const knob = el.querySelector('.toggle-knob');
  if (knob) { /* CSS handles position via on/off class */ }
}

function toggleDark()    { _settings.dark    = !_settings.dark;    saveSettings(); applyDark(_settings.dark);    }
function toggleLowData() { _settings.lowData = !_settings.lowData; saveSettings(); applyLowData(_settings.lowData); UI.toast(_settings.lowData ? 'Düşük veri modu aktif' : 'Normal mod', 'info'); }
function toggleNotifs()  { _settings.notifs  = !_settings.notifs;  saveSettings(); updateToggle('notif-toggle', _settings.notifs); if (_settings.notifs && 'Notification' in window) Notification.requestPermission(); }

// ── Profile editing ────────────────────────────────────────────────
function openProfileEdit() {
  const cu = window._currentUser;
  document.getElementById('pe-displayname').value = cu.display_name || '';
  document.getElementById('pe-bio').value         = cu.bio || '';
  document.getElementById('pe-status').value      = cu.status || '';
  document.getElementById('pe-statusemoji').value = cu.status_emoji || '';
  // Banner color picker
  const bp = document.getElementById('banner-colors');
  if (bp) {
    bp.innerHTML = '';
    CONFIG.BANNER_COLORS.forEach(col => {
      const btn = document.createElement('button');
      btn.className = 'w-8 h-8 rounded-full border-2 transition-all';
      btn.style.background = col;
      btn.style.borderColor = cu.banner_color === col ? '#00FFB3' : 'transparent';
      btn.onclick = () => {
        document.querySelectorAll('#banner-colors button').forEach(b => b.style.borderColor = 'transparent');
        btn.style.borderColor = '#00FFB3';
        window._selectedBannerColor = col;
      };
      bp.appendChild(btn);
    });
  }
  window._selectedBannerColor = cu.banner_color;
  UI.openModal('profile-edit-modal');
}

async function saveProfile() {
  const cu = window._currentUser;
  const data = {
    display_name: document.getElementById('pe-displayname').value.trim() || cu.display_name,
    bio:          document.getElementById('pe-bio').value.trim(),
    status:       document.getElementById('pe-status').value.trim(),
    status_emoji: document.getElementById('pe-statusemoji').value.trim(),
    banner_color: window._selectedBannerColor || cu.banner_color,
  };
  const updated = await DB.updateUser(cu.username, data);
  window._currentUser = { ...cu, ...data };
  _allUsers[cu.username] = window._currentUser;
  UI.closeModal('profile-edit-modal');
  renderMyAvatar();
  UI.toast('Profil güncellendi ✓', 'success');
}

async function uploadAvatar(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024) { UI.toast(`Maks. ${CONFIG.MAX_FILE_SIZE_MB}MB`, 'error'); return; }
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = async () => {
    const cu = window._currentUser;
    await DB.updateUser(cu.username, { avatar_url: reader.result });
    window._currentUser.avatar_url = reader.result;
    _allUsers[cu.username].avatar_url = reader.result;
    renderMyAvatar();
    // Update preview in modal
    const prev = document.getElementById('avatar-preview');
    if (prev) prev.innerHTML = `<img src="${reader.result}" class="w-full h-full rounded-full object-cover">`;
    UI.toast('Profil fotoğrafı güncellendi ✓', 'success');
  };
}

// ── Screenshot detection ───────────────────────────────────────────
function setupScreenshotDetection() {
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'p') && window._currentConvId) {
      e.preventDefault();
      document.getElementById('screenshot-overlay')?.classList.add('show');
      UI.toast('⚠️ Ekran görüntüsü engellendi', 'warn');
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && window._currentConvId && Math.random() < 0.15) {
      document.getElementById('screenshot-overlay')?.classList.add('show');
    }
  });
}

// ── Voice call stub ────────────────────────────────────────────────
function startVoiceCall() {
  UI.toast('📞 Şifreli sesli arama başlatılıyor…', 'info');
  setTimeout(() => UI.toast('Karşı taraf yanıt vermiyor. (Demo)', 'warn'), 2500);
}

// ── Helpers ────────────────────────────────────────────────────────
function getConvName(conv) {
  if (conv.type === 'group') return conv.name;
  const other = conv.participants.find(p => p !== window._currentUser?.username);
  return _allUsers[other]?.display_name || _allUsers[other]?.username || other;
}
function getConvAvatar(conv) {
  if (conv.type === 'group') return conv.avatar || UI.initials(conv.name);
  const other = conv.participants.find(p => p !== window._currentUser?.username);
  return UI.initials(_allUsers[other]?.display_name || other);
}
function getConvColor(conv) {
  if (conv.type === 'group') return conv.banner_color || '#7A8FA8';
  const other = conv.participants.find(p => p !== window._currentUser?.username);
  return UI.avatarColor(_allUsers[other]?.username || other);
}

// ── Boot ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', bootApp);

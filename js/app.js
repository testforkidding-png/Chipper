/**
 * CIPHER App.js — Main orchestration
 * Real messaging via localStorage + BroadcastChannel cross-tab sync
 */

let _allUsers = {}, _convs = [], _chatFilter = 'all', _search = '', _infoPanelOpen = false;
let _giphyPage = 0, _giphyQuery = '', _giphyLoading = false;

// ── Boot ──────────────────────────────────────────────────────────
async function bootApp() {
  if (!Auth.requireAuth()) return;
  window._currentUser = await Auth.currentUser();
  if (!window._currentUser) { Auth.logout(); return; }

  const users = await DB.getAllUsers();
  users.forEach(u => { _allUsers[u.username] = u; });

  renderMyAvatar();
  await loadConversations();
  await renderStories();
  loadSettings();
  PWA.init();

  // Real-time sync
  window._onNewMessage = async (key) => {
    if (key?.startsWith('msgs_') || !key) {
      if (window._currentConvId) await renderCurrentChat();
    }
    await loadConversations();
  };

  window._onStorageSync = async (key) => {
    if (key === 'convs' || key?.startsWith('msgs_')) {
      await loadConversations();
      if (window._currentConvId && key === 'msgs_' + window._currentConvId) {
        await renderCurrentChat();
      }
    }
  };

  setupScreenshotDetection();
}

// ── Render my header avatar ───────────────────────────────────────
function renderMyAvatar() {
  const cu = window._currentUser;
  const el = document.getElementById('my-avatar');
  if (!el) return;
  const color = UI.avatarColor(cu.username);
  if (cu.avatar_url) {
    el.innerHTML = `<img src="${cu.avatar_url}" class="w-full h-full rounded-full object-cover">`;
  } else {
    el.style.background = `linear-gradient(135deg,${color},${color}99)`;
    el.style.color = '#fff';
    el.textContent = UI.initials(cu.display_name || cu.username);
  }
  document.getElementById('my-name').textContent = cu.display_name || cu.username;
}

// ── Load & render chat list ───────────────────────────────────────
async function loadConversations() {
  _convs = await DB.getUserConversations(window._currentUser.username);
  renderChatList();
}

function renderChatList() {
  const list = document.getElementById('chat-list');
  if (!list) return;
  let items = [..._convs];
  if (_chatFilter === 'unread') items = items.filter(c => (c.unread_for?.[window._currentUser.username]||0) > 0);
  if (_chatFilter === 'groups') items = items.filter(c => c.type === 'group');
  if (_search) {
    const q = _search.toLowerCase();
    items = items.filter(c => getConvName(c).toLowerCase().includes(q) || (c.last_msg||'').toLowerCase().includes(q));
  }
  items.sort((a,b) => (b.last_time||0) - (a.last_time||0));
  list.innerHTML = '';
  if (!items.length) { list.innerHTML = '<div style="text-align:center;padding:32px 16px;color:#7A8FA8;font-size:13px">Sohbet bulunamadı</div>'; return; }
  items.forEach(conv => {
    const name = getConvName(conv), color = getConvColor(conv);
    const otherId = conv.type==='direct' ? conv.participants.find(p=>p!==window._currentUser.username) : null;
    const otherUser = otherId ? _allUsers[otherId] : null;
    const unread = conv.unread_for?.[window._currentUser.username] || 0;
    const isActive = conv.id === window._currentConvId;
    const div = document.createElement('div');
    div.className = 'chat-item flex items-center gap-3 px-3 py-3 cursor-pointer rounded-xl mx-2 my-0.5 transition-all';
    if (isActive) div.style.background = '#151E30';
    const av = otherUser?.avatar_url
      ? `<img src="${otherUser.avatar_url}" class="w-10 h-10 rounded-full object-cover flex-shrink-0">`
      : `<div class="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0" style="background:${color}22;color:${color}">${conv.type==='group'?(conv.avatar||UI.initials(name)):UI.initials(name)}</div>`;
    div.innerHTML = `${av}<div class="flex-1 min-w-0"><div class="flex items-center justify-between mb-0.5"><span class="font-semibold text-sm truncate" style="font-family:Syne,sans-serif;color:#DDE8F8">${name}</span><span style="color:#7A8FA8;font-size:10px;font-family:'JetBrains Mono',monospace;flex-shrink:0;margin-left:6px">${conv.last_time?UI.fmtTime(conv.last_time):''}</span></div><div class="flex items-center justify-between"><span class="text-xs truncate" style="color:#7A8FA8;max-width:160px">${conv.last_msg||''}</span>${unread>0?`<span style="width:18px;height:18px;border-radius:50%;background:#00FFB3;color:#062B1F;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-left:4px">${unread}</span>`:''}</div></div>`;
    div.onclick = () => openConv(conv.id);
    list.appendChild(div);
  });
}

// ── Open conversation ─────────────────────────────────────────────
async function openConv(convId) {
  window._currentConvId = convId;
  const conv = _convs.find(c=>c.id===convId); if(!conv)return;
  window._isGroup = conv.type==='group';

  await DB.updateConversation(convId, { unread_for: {...(conv.unread_for||{}), [window._currentUser.username]:0} });
  conv.unread_for = {...(conv.unread_for||{}), [window._currentUser.username]:0};

  const name = getConvName(conv), color = getConvColor(conv);
  const otherId = conv.type==='direct' ? conv.participants.find(p=>p!==window._currentUser.username) : null;
  const otherUser = otherId ? _allUsers[otherId] : null;

  const avatarEl = document.getElementById('chat-avatar');
  if (otherUser?.avatar_url) {
    avatarEl.innerHTML = `<img src="${otherUser.avatar_url}" class="w-full h-full rounded-full object-cover">`;
  } else {
    avatarEl.innerHTML = conv.type==='group' ? (conv.avatar||UI.initials(name)) : UI.initials(name);
    avatarEl.style.background = `${color}22`;
    avatarEl.style.color = color;
  }
  avatarEl.onclick = otherUser ? ()=>UI.showProfileCard(otherUser,avatarEl) : null;
  avatarEl.style.cursor = otherUser ? 'pointer' : 'default';

  document.getElementById('chat-name').textContent = name;
  document.getElementById('chat-status').textContent = conv.type==='group'
    ? `${conv.participants.length} üye · Şifreli Grup`
    : (otherUser?.status ? `${otherUser.status_emoji||''} ${otherUser.status}` : '🟢 Çevrimiçi');

  // Mobile: hide sidebar, show chat
  document.getElementById('sidebar').classList.add('mobile-hidden');
  document.getElementById('chat-area').classList.add('mobile-visible');
  document.getElementById('mobile-back').classList.remove('hidden');

  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('chat-view').classList.remove('hidden');

  await renderCurrentChat();
  renderChatList();
  if (_infoPanelOpen) updateInfoPanel(conv);
}

async function renderCurrentChat(highlight='') {
  if (!window._currentConvId) return;
  await Messages.renderAll(window._currentConvId, _allUsers, highlight);
}

// ── Mobile back button ────────────────────────────────────────────
function mobileBack() {
  document.getElementById('sidebar').classList.remove('mobile-hidden');
  document.getElementById('chat-area').classList.remove('mobile-visible');
  document.getElementById('mobile-back').classList.add('hidden');
  window._currentConvId = null;
}

// ── Profile ───────────────────────────────────────────────────────
window.App = {
  showProfile(username) {
    const u = _allUsers[username];
    if (u) UI.showProfileCard(u);
  }
};

// ── Stories ───────────────────────────────────────────────────────
async function renderStories() {
  const stories = DB.getStories();
  const strip = document.getElementById('stories-strip');
  if (!strip) return;
  strip.innerHTML='';
  // My story add button
  const cu = window._currentUser;
  const col = UI.avatarColor(cu.username);
  const myDiv = document.createElement('div');
  myDiv.className='flex flex-col items-center gap-1 cursor-pointer flex-shrink-0';
  const myAv = cu.avatar_url ? `<img src="${cu.avatar_url}" class="w-full h-full rounded-full object-cover">` : `<span style="font-weight:700;font-size:12px;color:#fff">${UI.initials(cu.display_name||cu.username)}</span>`;
  myDiv.innerHTML=`<div style="width:46px;height:46px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;position:relative">${myAv}<div style="position:absolute;bottom:-1px;right:-1px;width:16px;height:16px;background:#00FFB3;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #06080F;font-size:10px;font-weight:700;color:#062B1F">+</div></div><span style="font-size:9px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">Hikaye</span>`;
  myDiv.onclick=()=>addStory();
  strip.appendChild(myDiv);
  stories.forEach(story=>{
    const u=_allUsers[story.user_id||story.userId]; if(!u)return;
    const uc=UI.avatarColor(u.username);
    const seen=story.seen_by?.includes(cu.username);
    const div=document.createElement('div');
    div.className='flex flex-col items-center gap-1 cursor-pointer flex-shrink-0';
    const ring=seen?'conic-gradient(#2A3D55,#1E2D45,#2A3D55)':'conic-gradient(#00FFB3,#00C48A,#00FFB3)';
    const uAv=u.avatar_url?`<img src="${u.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`:
      `<span style="font-weight:700;font-size:11px;color:#fff">${UI.initials(u.display_name||u.username)}</span>`;
    div.innerHTML=`<div style="width:46px;height:46px;border-radius:50%;background:${ring};padding:2px"><div style="width:100%;height:100%;border-radius:50%;background:${uc}22;display:flex;align-items:center;justify-content:center;border:2px solid #06080F;overflow:hidden">${uAv}</div></div><span style="font-size:9px;color:${seen?'#7A8FA8':'#DDE8F8'};max-width:44px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px">${(u.display_name||u.username).split(' ')[0]}</span>`;
    div.onclick=()=>UI.showStory(story,u);
    strip.appendChild(div);
  });
}

async function addStory() {
  const text=prompt('Hikayenizi yazın (maks 200 karakter):'); if(!text?.trim())return;
  await DB.createStory({user_id:window._currentUser.username,text:text.trim(),seen_by:[]});
  await renderStories(); UI.toast('Hikaye paylaşıldı 📖','success');
}

// ── Send message ──────────────────────────────────────────────────
async function sendMessage() {
  if (!window._currentConvId) return;
  const msg = await Messages.send(window._currentConvId);
  if (!msg) return;
  await renderCurrentChat();
  await loadConversations();
  simulateReply();
}

function handleMsgKey(e) { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();} }

// ── GIF Picker ────────────────────────────────────────────────────
async function openGifPicker() {
  UI.openModal('gif-modal');
  _giphyQuery=''; _giphyPage=0;
  document.getElementById('gif-search').value='';
  await loadGifs('trending');
}

async function searchGifs() {
  const q = document.getElementById('gif-search').value.trim();
  _giphyQuery=q; _giphyPage=0;
  await loadGifs(q||'trending');
}

async function loadGifs(query, append=false) {
  if (_giphyLoading) return;
  _giphyLoading=true;
  const grid=document.getElementById('gif-grid');
  if (!append) { grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:20px;color:#7A8FA8;font-size:13px">Yükleniyor…</div>'; }
  try {
    const offset = _giphyPage * CONFIG.GIPHY_LIMIT;
    const url = query==='trending'
      ? `https://api.giphy.com/v1/gifs/trending?api_key=${CONFIG.GIPHY_API_KEY}&limit=${CONFIG.GIPHY_LIMIT}&rating=g`
      : `https://api.giphy.com/v1/gifs/search?api_key=${CONFIG.GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=${CONFIG.GIPHY_LIMIT}&offset=${offset}&rating=g`;
    const res = await fetch(url);
    const data = await res.json();
    if (!append) grid.innerHTML='';
    if (!data.data?.length) {
      if (!append) grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:20px;color:#7A8FA8;font-size:13px">Sonuç bulunamadı</div>';
      _giphyLoading=false; return;
    }
    data.data.forEach(gif=>{
      const img=document.createElement('div');
      img.className='gif-item cursor-pointer rounded-xl overflow-hidden';
      img.style.cssText='aspect-ratio:1;background:#131D30;position:relative';
      img.innerHTML=`<img src="${gif.images.fixed_height_small.url}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block"><div class="gif-overlay" style="position:absolute;inset:0;background:rgba(0,255,179,.15);opacity:0;transition:opacity .15s;display:flex;align-items:center;justify-content:center"><span style="color:#00FFB3;font-size:11px;font-weight:600;font-family:'JetBrains Mono',monospace">GIF</span></div>`;
      img.addEventListener('mouseenter',()=>img.querySelector('.gif-overlay').style.opacity='1');
      img.addEventListener('mouseleave',()=>img.querySelector('.gif-overlay').style.opacity='0');
      img.onclick=()=>{ pickedGif(gif.images.original.url, gif.title); };
      grid.appendChild(img);
    });
    _giphyPage++;
  } catch(e) {
    grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:20px;color:#FF3D6B;font-size:13px">Yüklenemedi. API key\'i kontrol edin.</div>';
  }
  _giphyLoading=false;
}

async function pickedGif(url, title) {
  UI.closeModal('gif-modal');
  if (!window._currentConvId) return;
  await Messages.sendGif(window._currentConvId, url, title);
  await renderCurrentChat();
  await loadConversations();
}

// ── Sticker Picker ────────────────────────────────────────────────
function openStickerPicker() {
  const modal = document.getElementById('sticker-modal');
  if (!modal) return;
  // Build sticker tabs
  const tabsEl = document.getElementById('sticker-tabs');
  const gridEl = document.getElementById('sticker-grid');
  tabsEl.innerHTML='';
  CONFIG.STICKER_PACKS.forEach((pack,i)=>{
    const btn=document.createElement('button');
    btn.className='sticker-tab'; btn.textContent=pack.icon; btn.title=pack.name;
    btn.style.cssText=`padding:6px 10px;border-radius:8px;font-size:18px;transition:all .15s;cursor:pointer;${i===0?'background:#131D30;':'background:transparent;'}`;
    btn.onclick=()=>{
      document.querySelectorAll('.sticker-tab').forEach(b=>b.style.background='transparent');
      btn.style.background='#131D30';
      loadStickerPack(pack);
    };
    tabsEl.appendChild(btn);
  });
  loadStickerPack(CONFIG.STICKER_PACKS[0]);
  UI.openModal('sticker-modal');
}

function loadStickerPack(pack) {
  const grid=document.getElementById('sticker-grid');
  grid.innerHTML='';
  pack.stickers.forEach(stk=>{
    const btn=document.createElement('button');
    btn.textContent=stk;
    btn.style.cssText='font-size:30px;width:52px;height:52px;border-radius:10px;cursor:pointer;transition:all .12s;display:flex;align-items:center;justify-content:center;';
    btn.addEventListener('mouseenter',()=>btn.style.background='#131D30');
    btn.addEventListener('mouseleave',()=>btn.style.background='transparent');
    btn.onclick=()=>{ UI.closeModal('sticker-modal'); pickedSticker(stk); };
    grid.appendChild(btn);
  });
}

async function pickedSticker(sticker) {
  if (!window._currentConvId) return;
  await Messages.sendSticker(window._currentConvId, sticker);
  await renderCurrentChat();
  await loadConversations();
}

// ── Simulate reply (makes messaging feel alive) ───────────────────
const _bots = ['alice','marcus'];
const _replies = ['Anladım 👍','Harika!','Teşekkürler 🙏','Tamam!','🔒 Güvenli kanal aktif','İyi fikir!','Evet doğru.','👀','🔥','Kesinlikle!','Ok 👌','💯'];
function simulateReply() {
  if (!window._currentConvId) return;
  const conv=_convs.find(c=>c.id===window._currentConvId);
  if (!conv||conv.type!=='direct') return;
  const other=conv.participants.find(p=>p!==window._currentUser.username);
  if (!_bots.includes(other)) return;
  const delay=1500+Math.random()*3000;
  setTimeout(()=>{
    const ind=document.getElementById('typing-indicator'), av=document.getElementById('typing-avatar');
    if(ind&&av){
      const u=_allUsers[other];
      if(u?.avatar_url){av.innerHTML=`<img src="${u.avatar_url}" class="w-full h-full rounded-full object-cover">`;}
      else{av.style.background=UI.avatarColor(other);av.textContent=UI.initials(u?.display_name||other);}
      ind.classList.remove('hidden');
      setTimeout(async()=>{
        ind.classList.add('hidden');
        if(Math.random()<0.75){
          const text=_replies[Math.floor(Math.random()*_replies.length)];
          await DB.createMessage({conv_id:window._currentConvId,from:other,text,type:'text',status:'read',created_at:Date.now()});
          await DB.updateConversation(window._currentConvId,{last_msg:text,last_time:Date.now()});
          await renderCurrentChat(); await loadConversations();
        }
      },1500);
    }
  },delay);
}

// ── New chat / group ──────────────────────────────────────────────
function openNewChat() {
  const list=document.getElementById('contacts-list'); if(!list)return;
  list.innerHTML='';
  Object.values(_allUsers).filter(u=>u.username!==window._currentUser.username).forEach(u=>{
    const c=UI.avatarColor(u.username);
    const div=document.createElement('div');
    div.className='flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all';
    div.addEventListener('mouseenter',()=>div.style.background='#131D30');
    div.addEventListener('mouseleave',()=>div.style.background='');
    const av=u.avatar_url?`<img src="${u.avatar_url}" class="w-9 h-9 rounded-full object-cover">`:`<div class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold" style="background:${c}22;color:${c}">${UI.initials(u.display_name||u.username)}</div>`;
    div.innerHTML=`${av}<div><div class="text-sm font-medium" style="color:#DDE8F8">${u.display_name||u.username}</div><div class="text-xs font-mono" style="color:#7A8FA8">@${u.username}</div></div>`;
    div.onclick=async()=>{ UI.closeModal('new-chat-modal'); await startDM(u.username); };
    list.appendChild(div);
  });
  UI.openModal('new-chat-modal');
}

async function startDM(userId) {
  const ids=[window._currentUser.username,userId].sort();
  const convId=ids.join('_');
  let conv=await DB.getConversation(convId);
  if(!conv){ conv=await DB.createConversation({id:convId,type:'direct',participants:ids,last_msg:'',last_time:Date.now(),unread_for:{}}); _convs.push(conv); }
  renderChatList(); await openConv(convId);
}

function openGroupCreate() {
  const gc=document.getElementById('group-contacts'); if(!gc)return;
  gc.innerHTML='';
  Object.values(_allUsers).filter(u=>u.username!==window._currentUser.username).forEach(u=>{
    const c=UI.avatarColor(u.username);
    const div=document.createElement('div');
    div.className='flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer';
    div.addEventListener('mouseenter',()=>div.style.background='#131D30');
    div.addEventListener('mouseleave',()=>div.style.background='');
    div.innerHTML=`<input type="checkbox" value="${u.username}" style="width:16px;height:16px;accent-color:#00FFB3"><div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style="background:${c}22;color:${c}">${UI.initials(u.display_name||u.username)}</div><span class="text-sm" style="color:#DDE8F8">${u.display_name||u.username}</span>`;
    div.onclick=e=>{ if(e.target.tagName!=='INPUT')div.querySelector('input').click(); };
    gc.appendChild(div);
  });
  UI.openModal('group-modal');
}

async function createGroup() {
  const name=document.getElementById('group-name')?.value.trim();
  if(!name){UI.toast('Grup adı girin','error');return;}
  const selected=Array.from(document.querySelectorAll('#group-contacts input:checked')).map(i=>i.value);
  if(!selected.length){UI.toast('En az 1 üye seçin','error');return;}
  const colors=['#9333EA','#0EA5E9','#F59E0B','#10B981','#EF4444'];
  const convId='group_'+Date.now();
  const conv=await DB.createConversation({id:convId,type:'group',name,participants:[window._currentUser.username,...selected],avatar:UI.initials(name),banner_color:colors[Math.floor(Math.random()*colors.length)],last_msg:'',last_time:Date.now(),unread_for:{},admin:window._currentUser.username});
  _convs.push(conv); UI.closeModal('group-modal'); renderChatList(); await openConv(convId);
  UI.toast(`"${name}" grubu oluşturuldu! 🎉`,'success');
}

// ── Info panel ────────────────────────────────────────────────────
function toggleInfoPanel() {
  _infoPanelOpen=!_infoPanelOpen;
  const p=document.getElementById('info-panel');
  p?.classList.toggle('hidden',!_infoPanelOpen); p?.classList.toggle('flex',_infoPanelOpen);
  if (_infoPanelOpen&&window._currentConvId) updateInfoPanel(_convs.find(c=>c.id===window._currentConvId));
}

function updateInfoPanel(conv) {
  const el=document.getElementById('info-panel-content'); if(!el||!conv)return;
  if(conv.type==='direct'){
    const other=_allUsers[conv.participants.find(p=>p!==window._currentUser.username)]||{};
    const color=UI.avatarColor(other.username||'');
    const av=other.avatar_url?`<img src="${other.avatar_url}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;cursor:pointer" onclick="App.showProfile('${other.username}')">`:`<div style="width:64px;height:64px;border-radius:50%;background:${color}22;color:${color};display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;cursor:pointer" onclick="App.showProfile('${other.username}')">${UI.initials(other.display_name||other.username)}</div>`;
    el.innerHTML=`<div style="text-align:center">${av}<div style="font-family:Syne,sans-serif;font-weight:700;color:#DDE8F8;margin-top:8px">${other.display_name||other.username}</div><div style="color:#7A8FA8;font-size:11px;font-family:'JetBrains Mono',monospace">@${other.username}</div>${other.status?`<div style="color:#9AB0C8;font-size:12px;margin-top:4px">${other.status_emoji||''} ${other.status}</div>`:''}</div><div style="border-top:1px solid #1E2D45;padding-top:12px"><div style="font-size:10px;color:#7A8FA8;font-family:'JetBrains Mono',monospace;margin-bottom:8px">GÜVENLİK</div><div style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#DDE8F8"><div>🔒 AES-256-GCM</div><div>🛡 PBKDF2 Anahtar</div><div>🚫 Sıfır Kayıt</div></div></div>`;
  } else {
    const mems=conv.participants.map(uid=>{
      const u=_allUsers[uid]||{username:uid,display_name:uid};
      const c=UI.avatarColor(u.username);
      const av=u.avatar_url?`<img src="${u.avatar_url}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;cursor:pointer" onclick="App.showProfile('${u.username}')">`:`<div style="width:28px;height:28px;border-radius:50%;background:${c}22;color:${c};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;cursor:pointer" onclick="App.showProfile('${u.username}')">${UI.initials(u.display_name||u.username)}</div>`;
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0">${av}<div><div style="color:#DDE8F8;font-size:12px">${u.display_name||u.username}</div>${conv.admin===uid?'<div style="color:#FFD700;font-size:10px">Yönetici</div>':''}</div></div>`;
    }).join('');
    el.innerHTML=`<div style="text-align:center"><div style="width:56px;height:56px;border-radius:50%;background:${getConvColor(conv)}22;color:${getConvColor(conv)};display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;margin:0 auto 8px">${conv.avatar||UI.initials(conv.name)}</div><div style="font-family:Syne,sans-serif;font-weight:700;color:#DDE8F8">${conv.name}</div><div style="color:#7A8FA8;font-size:12px">${conv.participants.length} üye</div></div><div style="border-top:1px solid #1E2D45;padding-top:12px"><div style="font-size:10px;color:#7A8FA8;font-family:'JetBrains Mono',monospace;margin-bottom:8px">ÜYELER</div>${mems}</div>`;
  }
}

// ── Search ────────────────────────────────────────────────────────
function handleSidebarSearch(q) { _search=q; document.getElementById('search-clear')?.classList.toggle('hidden',!q); renderChatList(); }
function clearSidebarSearch() { _search=''; const inp=document.getElementById('search-input'); if(inp)inp.value=''; document.getElementById('search-clear')?.classList.add('hidden'); renderChatList(); }
function toggleMsgSearch() { const b=document.getElementById('chat-search-bar'); b?.classList.toggle('hidden'); if(!b?.classList.contains('hidden'))document.getElementById('msg-search')?.focus(); }
async function searchInMessages(q) {
  const c=document.getElementById('search-count'); if(!q){if(c)c.textContent=''; await renderCurrentChat();return;}
  const msgs=await DB.getMessages(window._currentConvId);
  const hits=msgs.filter(m=>m.text?.toLowerCase().includes(q.toLowerCase()));
  if(c)c.textContent=hits.length+' sonuç';
  await renderCurrentChat(q);
  if(hits.length)document.getElementById('msg-'+hits[0].id)?.scrollIntoView({behavior:'smooth',block:'center'});
}

// ── Filter ────────────────────────────────────────────────────────
function setFilter(f) {
  _chatFilter=f;
  ['all','unread','groups'].forEach(id=>{
    const btn=document.getElementById('filter-'+id);
    if(!btn)return;
    btn.style.background=f===id?'#131D30':'transparent';
    btn.style.color=f===id?'#DDE8F8':'#7A8FA8';
  });
  renderChatList();
}

// ── Settings ──────────────────────────────────────────────────────
let _settings={dark:true,lowData:false,notifs:true};
function loadSettings() {
  try{_settings=JSON.parse(localStorage.getItem('cipher_settings')||'{"dark":true,"lowData":false,"notifs":true}');}catch{}
  applyDark(_settings.dark); applyLowData(_settings.lowData);
  updateToggle('dark-toggle',_settings.dark); updateToggle('lowdata-toggle',_settings.lowData); updateToggle('notif-toggle',_settings.notifs);
}
function saveSettings(){localStorage.setItem('cipher_settings',JSON.stringify(_settings));}
function applyDark(on){document.documentElement.classList.toggle('light-mode',!on);}
function applyLowData(on){document.documentElement.classList.toggle('low-data',on);}
function updateToggle(id,on){const el=document.getElementById(id);if(!el)return;el.className=`toggle-track ${on?'on':'off'}`;}
function toggleDark(){_settings.dark=!_settings.dark;saveSettings();applyDark(_settings.dark);updateToggle('dark-toggle',_settings.dark);}
function toggleLowData(){_settings.lowData=!_settings.lowData;saveSettings();applyLowData(_settings.lowData);updateToggle('lowdata-toggle',_settings.lowData);UI.toast(_settings.lowData?'Düşük veri modu aktif':'Normal mod','info');}
function toggleNotifs(){_settings.notifs=!_settings.notifs;saveSettings();updateToggle('notif-toggle',_settings.notifs);if(_settings.notifs&&'Notification'in window)Notification.requestPermission();}

// ── Profile edit ──────────────────────────────────────────────────
function openProfileEdit() {
  const cu=window._currentUser;
  document.getElementById('pe-displayname').value=cu.display_name||'';
  document.getElementById('pe-bio').value=cu.bio||'';
  document.getElementById('pe-status').value=cu.status||'';
  document.getElementById('pe-statusemoji').value=cu.status_emoji||'';
  window._selectedBanner=cu.banner_color||'#0A1628';
  const bp=document.getElementById('banner-colors');
  if(bp){bp.innerHTML='';CONFIG.BANNER_COLORS.forEach(col=>{const btn=document.createElement('button');btn.style.cssText=`width:28px;height:28px;border-radius:50%;background:${col};border:2px solid ${cu.banner_color===col?'#00FFB3':'transparent'};cursor:pointer;transition:.15s`;btn.onclick=()=>{document.querySelectorAll('#banner-colors button').forEach(b=>b.style.borderColor='transparent');btn.style.borderColor='#00FFB3';window._selectedBanner=col;};bp.appendChild(btn);});}
  // Avatar preview
  const prev=document.getElementById('avatar-preview');
  if(prev){if(cu.avatar_url){prev.innerHTML=`<img src="${cu.avatar_url}" class="w-full h-full rounded-full object-cover">`;}else{const c=UI.avatarColor(cu.username);prev.style.background=`linear-gradient(135deg,${c},${c}99)`;prev.textContent=UI.initials(cu.display_name||cu.username);}}
  UI.openModal('profile-edit-modal');
}

async function saveProfile() {
  const cu=window._currentUser;
  const data={display_name:document.getElementById('pe-displayname').value.trim()||cu.display_name,bio:document.getElementById('pe-bio').value.trim(),status:document.getElementById('pe-status').value.trim(),status_emoji:document.getElementById('pe-statusemoji').value.trim(),banner_color:window._selectedBanner||cu.banner_color};
  const updated=await DB.updateUserOverride(cu.username,data);
  window._currentUser={...cu,...data};
  _allUsers[cu.username]=window._currentUser;
  UI.closeModal('profile-edit-modal'); renderMyAvatar(); UI.toast('Profil güncellendi ✓','success');
}

async function uploadAvatar(input) {
  const file=input.files[0]; if(!file)return;
  if(file.size>CONFIG.MAX_FILE_SIZE_MB*1024*1024){UI.toast(`Maks. ${CONFIG.MAX_FILE_SIZE_MB}MB`,'error');return;}
  const r=new FileReader(); r.readAsDataURL(file);
  r.onload=async()=>{
    await DB.updateUserOverride(window._currentUser.username,{avatar_url:r.result});
    window._currentUser.avatar_url=r.result; _allUsers[window._currentUser.username].avatar_url=r.result;
    renderMyAvatar();
    const prev=document.getElementById('avatar-preview');
    if(prev)prev.innerHTML=`<img src="${r.result}" class="w-full h-full rounded-full object-cover">`;
    UI.toast('Profil fotoğrafı güncellendi ✓','success');
  };
}

// ── Screenshot detection ──────────────────────────────────────────
function setupScreenshotDetection() {
  document.addEventListener('keydown',e=>{
    if((e.metaKey||e.ctrlKey)&&(e.key==='s'||e.key==='p')&&window._currentConvId){
      e.preventDefault(); document.getElementById('screenshot-overlay')?.classList.add('show'); UI.toast('⚠️ Ekran görüntüsü engellendi','warn');
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────────
function getConvName(conv) {
  if(conv.type==='group')return conv.name;
  const other=conv.participants.find(p=>p!==window._currentUser?.username);
  return _allUsers[other]?.display_name||_allUsers[other]?.username||other;
}
function getConvColor(conv) {
  if(conv.type==='group')return conv.banner_color||'#7A8FA8';
  const other=conv.participants.find(p=>p!==window._currentUser?.username);
  return UI.avatarColor(_allUsers[other]?.username||other);
}

function startVoiceCall(){UI.toast('📞 Şifreli sesli arama başlatılıyor…','info');setTimeout(()=>UI.toast('Karşı taraf yanıt vermiyor. (Demo)','warn'),2500);}

document.addEventListener('DOMContentLoaded', bootApp);

/**
 * CIPHER Messages v6 — Speed & debug
 * Key fixes:
 *  - Shared in-memory message store (_store)
 *  - Optimistic send: show message immediately, DB in background
 *  - Incremental DOM append: only add new messages, don't rebuild
 *  - Single getMessages source for reply/copy/reaction
 *  - Parallel createMessage + updateConversation
 */
const Messages = (() => {
  // ── In-memory message store ───────────────────────────────────
  // convId → { msgs: [], lastRenderedCount: 0 }
  const _store = {};

  function _getStore(convId) {
    if (!_store[convId]) _store[convId] = { msgs: [], lastRenderedCount: 0 };
    return _store[convId];
  }

  function _getMsgs(convId) {
    return _store[convId]?.msgs || [];
  }

  function _findMsg(convId, msgId) {
    return _store[convId]?.msgs.find(m => m.id === msgId);
  }

  // ── State ─────────────────────────────────────────────────────
  let _replyTo = null, _destruct = false, _destructSecs = 30;
  let _files = [], _recMR = null, _recInt = null, _recSecs = 0;
  let _gifOpen = false, _stickerOpen = false;
  let _activePack = null;
  let _gifCache = null, _gifLoading = false, _gifResults = [];

  // ── Subscribe ─────────────────────────────────────────────────
  // messages.js içine eklenecek yardımcı fonksiyon
function _parseMarkdown(text) {
  if (!text) return '';
  return text
    // Güvenlik için HTML etiketlerini temizle (XSS önlemi)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    // Kod Bloğu: `kod` -> <code>kod</code>
    .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.3);padding:2px 4px;border-radius:4px;font-family:monospace;font-size:0.9em">$1</code>')
    // Kalın: **metin** -> <b>metin</b>
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    // İtalik: *metin* -> <i>metin</i>
    .replace(/\*([^*]+)\*/g, '<i>$1</i>')
    // Üstü Çizili: ~~metin~~ -> <strike>metin</strike>
    .replace(/~~([^~]+)~~/g, '<strike>$1</strike>');
}
  function subscribeConv(convId) {
    if (window._realtimeSub) { try { DB.unsubscribe(window._realtimeSub); } catch {} window._realtimeSub = null; }
    if (window._pollInterval)  { clearInterval(window._pollInterval); window._pollInterval = null; }

    if (CONFIG.USE_SUPABASE && !window._supabaseNotConfigured) {
      try {
        window._realtimeSub = DB.subscribeMessages(convId, async (payload) => {
          // Realtime: fetch only new messages since last known
          await _refreshMessages(convId);
          window._onNewMessage?.();
        });
      } catch(e) { console.warn('subscribeMessages:', e); }
    } else {
      window._pollInterval = setInterval(async () => {
        if (window._currentConvId === convId && !document.hidden) {
          await _refreshMessages(convId);
          window._onNewMessage?.();
        }
      }, 3000);
    }
  }

  // ── Fetch + update store, return only new messages ─────────────
  async function _refreshMessages(convId) {
    const fresh = await DB.getMessages(convId);
    const store = _getStore(convId);
    const oldCount = store.msgs.length;
    store.msgs = fresh;
    return fresh.slice(oldCount); // new messages only
  }

  // ── Render all ─────────────────────────────────────────────────
  async function renderAll(convId, users, highlight = '') {
    const container = document.getElementById('messages');
    if (!container) return;

    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 100;
    const prevScrollHeight = container.scrollHeight;

    // Fetch and store
    const msgs = await DB.getMessages(convId);
    const store = _getStore(convId);
    store.msgs = msgs;

    // Full rebuild
    const frag = document.createDocumentFragment();
    let lastDate = '';
    for (const msg of msgs) {
      const ds = _dateStr(msg.created_at);
      if (ds !== lastDate) {
        lastDate = ds;
        frag.appendChild(_dateSep(ds));
      }
      frag.appendChild(buildEl(msg, users, highlight));
      if (msg.destruct_at && msg.destruct_at > Date.now()) startDestructTimer(msg, convId);
    }

    container.innerHTML = '';
    container.appendChild(frag);
    store.lastRenderedCount = msgs.length;

    // Scroll
    if (atBottom || msgs.length <= 5) {
      container.scrollTop = container.scrollHeight;
    } else {
      container.scrollTop = container.scrollHeight - prevScrollHeight + container.scrollTop;
    }
  }

  // Append only new messages (no full rebuild)
  function _appendNewMessages(newMsgs, users, convId) {
    if (!newMsgs.length) return;
    const container = document.getElementById('messages');
    if (!container) return;
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 120;

    const frag = document.createDocumentFragment();
    // Check last date separator
    const lastSep = container.querySelector('[data-date-sep]:last-of-type');
    let lastDate = lastSep?.dataset.dateSep || '';

    for (const msg of newMsgs) {
      const ds = _dateStr(msg.created_at);
      if (ds !== lastDate) { lastDate = ds; frag.appendChild(_dateSep(ds)); }
      frag.appendChild(buildEl(msg, users));
      if (msg.destruct_at && msg.destruct_at > Date.now()) startDestructTimer(msg, convId);
    }
    container.appendChild(frag);
    if (atBottom) container.scrollTop = container.scrollHeight;
  }

  function _dateStr(ts) {
    const d = _normTs(ts);
    return new Date(d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
  }

  function _dateSep(ds) {
    const sep = document.createElement('div');
    sep.dataset.dateSep = ds;
    sep.style.cssText = 'display:flex;align-items:center;gap:10px;margin:14px 0 10px;user-select:none;flex-shrink:0';
    sep.innerHTML = `<div style="flex:1;height:1px;background:#1E2D45"></div><span style="font-size:10px;padding:2px 12px;color:#7A8FA8;font-family:'JetBrains Mono',monospace;white-space:nowrap;background:#06080F;border-radius:20px;border:1px solid #1E2D45">${ds}</span><div style="flex:1;height:1px;background:#1E2D45"></div>`;
    return sep;
  }

  function _normTs(ts) {
    if (!ts) return Date.now();
    if (typeof ts === 'string') { const n = new Date(ts).getTime(); return isNaN(n) ? Date.now() : n; }
    return ts < 1e12 ? ts * 1000 : ts;
  }

  // ── Build message element ─────────────────────────────────────
  function buildEl(msg, users, highlight = '') {
    const cu = window._currentUser;
    const isMine = msg.from === cu?.username;
    const sender = (users || _allUsersRef())[msg.from] || { username: msg.from, display_name: msg.from };
    const color = UI.avatarColor(sender.username);
    const recalled = !!msg.recalled;

    let text = recalled ? '↩ Bu mesaj geri çekildi.' : (msg.text || '');
    if (highlight && text && !recalled) {
      const re = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
      text = text.replace(re, '<mark style="background:rgba(0,255,179,.3);border-radius:2px;padding:0 1px">$1</mark>');
      
    }
// messages.js -> buildEl fonksiyonu içinde sticker kontrolü ekle
if (m.type === 'sticker' || (m.text && m.text.startsWith('http') && m.text.includes('sticker'))) {
    const img = document.createElement('img');
    img.src = m.text;
    img.style.cssText = 'width:140px; height:140px; object-fit:contain; display:block; margin:5px 0;';
    bubble.style.background = 'transparent'; // Sticker arkası boş olsun
    bubble.style.border = 'none';
    bubble.appendChild(img);
}
    
    const avatarHtml = !isMine
      ? (sender.avatar_url
          ? `<img src="${sender.avatar_url}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;cursor:pointer;flex-shrink:0;align-self:flex-end" onclick="window.showProfile?.('${sender.username}')">`
          : `<div onclick="window.showProfile?.('${sender.username}')" style="width:28px;height:28px;min-width:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;align-self:flex-end;cursor:pointer;background:${color}22;color:${color};font-family:Syne,sans-serif">${UI.initials(sender.display_name || sender.username)}</div>`)
      : '';

    let contentHtml = '';
    if (!recalled) {
      if (msg.type === 'gif' && msg.gif_url) {
        contentHtml = `<img src="${msg.gif_url}" alt="GIF" style="max-width:220px;max-height:180px;border-radius:10px;display:block;margin-top:4px;cursor:pointer" onclick="Messages._lightbox('${msg.gif_url}')">`;
      } else if (msg.type === 'sticker' && msg.sticker) {
        contentHtml = `<div style="font-size:52px;line-height:1;padding:4px 0">${msg.sticker}</div>`;
      } else if (msg.type === 'file' && msg.file_data) {
        if (msg.file_type?.startsWith('image/')) {
          contentHtml = `<img src="${msg.file_data}" style="max-width:220px;max-height:180px;border-radius:10px;display:block;margin-top:4px;cursor:pointer" onclick="Messages._lightbox('${msg.file_data}')">`;
        } else {
          contentHtml = `<div style="display:flex;align-items:center;gap:8px;margin-top:6px;padding:8px 12px;border-radius:10px;background:rgba(0,0,0,.25);border:1px solid #1E2D45"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00FFB3" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span style="font-size:12px;color:#DDE8F8;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${msg.file_name||'Dosya'}</span><a href="${msg.file_data}" download="${msg.file_name||'file'}" style="font-size:12px;color:#00FFB3;text-decoration:none;flex-shrink:0">↓</a></div>`;
        }
      } else if (msg.type === 'voice' && msg.audio_data) {
        contentHtml = `<div style="display:flex;align-items:center;gap:8px;margin-top:4px;padding:8px 12px;border-radius:10px;background:rgba(0,255,179,.07);border:1px solid rgba(0,255,179,.18)"><span style="color:#00FFB3;font-size:16px">🎙</span><audio controls src="${msg.audio_data}" style="height:28px;flex:1;min-width:100px;accent-color:#00FFB3"></audio><span style="font-size:10px;color:#00FFB3;font-family:'JetBrains Mono',monospace">${msg.duration||'0:00'}</span></div>`;
      }
    }

    const textHtml = text ? `<div style="font-size:14px;line-height:1.55;color:${recalled?'#7A8FA8':'#DDE8F8'};word-break:break-word${recalled?';font-style:italic':''}">${text}</div>` : '';
    const replyHtml = msg.reply_to_text ? `<div style="margin-bottom:5px;padding:4px 8px;border-radius:7px;border-left:2px solid #00FFB3;background:rgba(0,0,0,.22);font-size:11px;color:#7A8FA8;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${msg.reply_to_text}</div>` : '';

    let reactHtml = '';
    if (msg.reactions && Object.keys(msg.reactions).length) {
      reactHtml = '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:5px">';
      for (const [emoji, uids] of Object.entries(msg.reactions)) {
        if (!uids?.length) continue;
        const active = uids.includes(cu?.username);
        reactHtml += `<button class="reaction-pill${active?' active':''}" data-msgid="${msg.id}" data-emoji="${emoji}">${emoji} ${uids.length}</button>`;
      }
      reactHtml += '</div>';
    }

    const timeStr = UI.fmtTime(msg.created_at);
    const metaHtml = `<div style="display:flex;align-items:center;gap:1px;margin-top:4px;${isMine?'justify-content:flex-end':''}"><span style="font-size:9px;color:#3A4A5A">🔒</span><span style="font-size:10px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">${timeStr}</span>${msg.edited?'<span style="font-size:9px;color:#7A8FA8"> (düz)</span>':''}${msg.destruct_at&&msg.destruct_at>Date.now()?`<span id="dtimer-${msg.id}" style="font-size:10px;color:#FF3D6B;font-family:'JetBrains Mono',monospace"> ⏱</span>`:''}${isMine?`<span style="font-size:10px;color:${msg.status==='read'?'#00FFB3':'#7A8FA8'}">${msg.status==='read'?' ✓✓':' ✓'}</span>`:''}</div>`;

    const noBubble = msg.type === 'sticker' && !recalled;
    const bubStyle = noBubble ? 'background:transparent;border:none;padding:4px 8px' : `padding:9px 13px;border-radius:${isMine?'18px 18px 4px 18px':'18px 18px 18px 4px'}`;
    const senderName = !isMine && window._isGroup ? `<div style="font-size:11px;font-weight:600;color:${color};margin-bottom:2px;cursor:pointer;font-family:'Syne',sans-serif" onclick="window.showProfile?.('${sender.username}')">${sender.display_name||sender.username}</div>` : '';

    const w = document.createElement('div');
    w.id = 'msg-' + msg.id;
    w.dataset.msgId = msg.id;
    w.dataset.isMine = isMine ? '1' : '0';
    w.style.cssText = `display:flex;${isMine?'justify-content:flex-end':'justify-content:flex-start'};margin-bottom:3px;flex-shrink:0`;
    w.innerHTML = `<div style="display:flex;align-items:flex-end;gap:6px;max-width:78%;${isMine?'flex-direction:row-reverse':''}">
      ${!isMine?avatarHtml:''}
      <div style="min-width:0">
        ${senderName}
        <div class="${noBubble?'':'msg-bubble '+(isMine?'sent':'recv')}" style="${bubStyle};cursor:pointer" data-msgid="${msg.id}" data-ismine="${isMine?'1':'0'}">
          ${replyHtml}${textHtml}${contentHtml}${metaHtml}
        </div>
        ${reactHtml}
      </div>
    </div>`;
    return w;
  }

  function _allUsersRef() { return window._allUsers || {}; }

  // ── Lightbox ──────────────────────────────────────────────────
  function _lightbox(src) {
    document.getElementById('cipher-lightbox')?.remove();
    const lb = document.createElement('div');
    lb.id = 'cipher-lightbox';
    lb.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(6,8,15,.96);display:flex;align-items:center;justify-content:center;cursor:zoom-out';
    lb.onclick = e => { if (e.target === lb) lb.remove(); };
    lb.innerHTML = `<img src="${src}" style="max-width:92vw;max-height:92vh;border-radius:12px;object-fit:contain"><button style="position:fixed;top:16px;right:16px;width:36px;height:36px;border-radius:50%;background:#1E2D45;color:#DDE8F8;border:none;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center" onclick="document.getElementById('cipher-lightbox')?.remove()">✕</button>`;
    document.body.appendChild(lb);
  }

  // ── Send (optimistic) ─────────────────────────────────────────
  async function send(convId) {
    const input = document.getElementById('msg-input');
    const text = (input?.value || '').trim();
    if (!text && !_files.length) return;
    if (input) { input.value = ''; autoResize(input); }
    closeAllPickers();

    const cu = window._currentUser;
    const now = Date.now();
    const tempId = 'tmp_' + now;
    const base = { id: tempId, conv_id: convId, from: cu.username, status: 'sent', created_at: now };
    if (_replyTo) { base.reply_to = _replyTo.id; base.reply_to_text = _replyTo.text || '📎'; clearReply(); }
    if (_destruct) base.destruct_at = now + _destructSecs * 1000;

    // Optimistic: add to store + DOM immediately
    const optMsg = { ...base, type: _files.length ? 'file' : 'text', text: _files.length ? (_files[0].name) : text };
    _getStore(convId).msgs.push(optMsg);
    const container = document.getElementById('messages');
    if (container && window._currentConvId === convId) {
      container.appendChild(buildEl(optMsg, _allUsersRef()));
      container.scrollTop = container.scrollHeight;
    }

    try {
      let dbMsg;
      const msgData = { ...base };
      delete msgData.id; // let DB generate id
      const convUpdate = { last_msg: text || '📎', last_time: now, last_from: cu.username };

      if (_files.length) {
        const f = _files[0];
        [dbMsg] = await Promise.all([
          DB.createMessage({ ...msgData, type:'file', text:text||'', file_name:f.name, file_type:f.type, file_data:f.data }),
          DB.updateConversation(convId, convUpdate),
        ]);
        clearFiles();
      } else {
        [dbMsg] = await Promise.all([
          DB.createMessage({ ...msgData, type:'text', text }),
          DB.updateConversation(convId, convUpdate),
        ]);
      }

      // Replace temp message with real one
      const store = _getStore(convId);
      const idx = store.msgs.findIndex(m => m.id === tempId);
      if (idx >= 0) { store.msgs[idx] = dbMsg; }

      // Update temp DOM element
      const tempEl = document.getElementById('msg-' + tempId);
      if (tempEl && dbMsg) {
        const realEl = buildEl(dbMsg, _allUsersRef());
        tempEl.replaceWith(realEl);
      }

      // Update conv in memory
      if (window._convs) {
        const ci = window._convs.findIndex(c => c.id === convId);
        if (ci >= 0) Object.assign(window._convs[ci], convUpdate);
        window._renderChatListTimer ? null : renderChatList?.();
      }
    } catch(e) {
      console.error('send() error:', e);
      UI.toast('Gönderilemedi: ' + (e.message || String(e)), 'error');
      // Remove optimistic message
      const store = _getStore(convId);
      store.msgs = store.msgs.filter(m => m.id !== tempId);
      document.getElementById('msg-' + tempId)?.remove();
      if (input && text) { input.value = text; autoResize(input); }
    }
  }

  async function sendGif(convId, gifUrl, gifTitle) {
    const cu = window._currentUser; const now = Date.now();
    try {
      const [msg] = await Promise.all([
        DB.createMessage({ conv_id:convId, from:cu.username, type:'gif', text:'', gif_url:gifUrl, gif_title:gifTitle||'GIF', status:'sent', created_at:now }),
        DB.updateConversation(convId, { last_msg:'🎬 GIF', last_time:now, last_from:cu.username }),
      ]);
      const store = _getStore(convId); store.msgs.push(msg);
      closeAllPickers();
      window._onNewMessage?.();
    } catch(e) { UI.toast('GIF gönderilemedi', 'error'); }
  }

  async function sendSticker(convId, sticker) {
    const cu = window._currentUser; const now = Date.now();
    try {
      const [msg] = await Promise.all([
        DB.createMessage({ conv_id:convId, from:cu.username, type:'sticker', text:'', sticker, status:'sent', created_at:now }),
        DB.updateConversation(convId, { last_msg:sticker+' Sticker', last_time:now, last_from:cu.username }),
      ]);
      const store = _getStore(convId); store.msgs.push(msg);
      closeAllPickers();
      window._onNewMessage?.();
    } catch(e) { UI.toast('Sticker gönderilemedi', 'error'); }
  }

  // ── GIF Picker ────────────────────────────────────────────────
  function toggleGif() {
    _gifOpen = !_gifOpen; _stickerOpen = false;
    document.getElementById('gif-picker')?.classList.toggle('open', _gifOpen);
    document.getElementById('sticker-picker')?.classList.remove('open');
    if (_gifOpen) { if (_gifCache) { _gifResults = _gifCache; renderGifs(); } else searchGifs(''); }
  }

  async function searchGifs(q = '') {
    if (_gifLoading) return;
    _gifLoading = true;
    const grid = document.getElementById('gif-grid');
    if (!grid) { _gifLoading = false; return; }
    grid.innerHTML = Array(6).fill(0).map(() =>
      `<div style="border-radius:10px;aspect-ratio:1;background:linear-gradient(90deg,#0C1220 0%,#1A2535 50%,#0C1220 100%);background-size:200% 100%;animation:shimmer 1.4s ease-in-out infinite"></div>`
    ).join('');
    try {
      const url = q
        ? `https://api.giphy.com/v1/gifs/search?api_key=${CONFIG.GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=18&rating=pg`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${CONFIG.GIPHY_API_KEY}&limit=18&rating=pg`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      _gifResults = json.data || [];
      if (!q) _gifCache = _gifResults;
      renderGifs();
    } catch(err) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:24px;color:#FF3D6B;font-size:12px"><div style="font-size:28px;margin-bottom:8px">😵</div>GIF yüklenemedi</div>`;
    }
    _gifLoading = false;
  }

// messages.js dosyasındaki renderGifs fonksiyonunu bul ve bununla değiştir:
function renderGifs() {
  const grid = document.getElementById('gif-grid');
  if (!grid) return;
  if (!_gifResults.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#7A8FA8;font-size:13px">Sonuç bulunamadı</div>';
    return;
  }
  
  const frag = document.createDocumentFragment();
  
  _gifResults.forEach(g => {
    // En uygun GIF URL'sini seç (hareketli ve çok büyük olmayan)
    const url = g.images?.fixed_height?.url || g.images?.downsized?.url || g.images?.original?.url;
    if (!url) return;

    // Ana konteyner (GIF kartı)
    const div = document.createElement('div');
    div.className = 'gif-item';
    // Burası Kritik: GIF'lerin iç içe girmesini engelleyen stil.
    // Sabit kare en boy oranı (1/1) ve yükseklik ayarı.
    div.style.cssText = `
      position: relative;
      width: 100%;
      height: 0;
      padding-bottom: 100%; /* Kare en-boy oranı (1:1) */
      border-radius: 12px;
      overflow: hidden;
      background-color: #0C1220; /* GIF yüklenirken arka plan */
      border: 1px solid #1E2D45;
      cursor: pointer;
      transition: transform 0.1s ease, border-color 0.1s ease;
    `;
    
    // Hover efekti (JS ile ekliyoruz çünkü CSS sınıfı bazen Tailwind ile çakışıyor)
    div.onmouseenter = () => { div.style.transform = 'scale(1.03)'; div.style.borderColor = '#00FFB3'; };
    div.onmouseleave = () => { div.style.transform = 'scale(1)'; div.style.borderColor = '#1E2D45'; };

    // GIF Resim Etiketi
    const img = document.createElement('img');
    img.src = url;
    img.alt = (g.title || 'GIF').replace(/"/g, '');
    img.loading = 'lazy'; // Performans için önemli
    
    // Resmin kartın içine sığmasını sağlayan stil
    img.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: cover; /* Resmi en-boy oranını bozmadan sığdır */
      display: block;
    `;
    
    div.appendChild(img);
    div.onclick = () => { if (!window._currentConvId) return; sendGif(window._currentConvId, url, g.title); };
    
    frag.appendChild(div);
  });
  
  grid.innerHTML = ''; // Önceki sonuçları temizle
  grid.appendChild(frag);
}
  // ── Sticker Picker ────────────────────────────────────────────
  function toggleSticker() {
    _stickerOpen = !_stickerOpen; _gifOpen = false;
    document.getElementById('sticker-picker')?.classList.toggle('open', _stickerOpen);
    document.getElementById('gif-picker')?.classList.remove('open');
    if (_stickerOpen) { if (!_activePack) _activePack = Object.keys(CONFIG.STICKER_PACKS)[0]; renderStickerPack(_activePack); }
  }

  // messages.js içindeki renderStickerPack fonksiyonunu bul ve değiştir
function renderStickerPack(packId) {
  const grid = document.getElementById('sticker-grid');
  if (!grid) return;
  
  // Paket verisini bul
  const pack = STICKER_PACKS.find(p => p.id === packId);
  if (!pack) return;

  grid.innerHTML = '';
  grid.style.cssText = 'display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; padding:15px;';

  pack.stickers.forEach(url => {
    const img = document.createElement('img');
    img.src = url;
    img.style.cssText = `
      width: 100%;
      aspect-ratio: 1/1;
      object-fit: contain;
      cursor: pointer;
      transition: transform 0.2s;
      filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));
    `;
    
    img.onmouseenter = () => img.style.transform = 'scale(1.15) rotate(3deg)';
    img.onmouseleave = () => img.style.transform = 'scale(1) rotate(0deg)';
    
    img.onclick = () => {
      if (window._currentConvId) {
        Messages.sendSticker(window._currentConvId, url);
        Messages.closeAllPickers();
      }
    };
    
    grid.appendChild(img);
  });
}

  function closeAllPickers() {
    _gifOpen = false; _stickerOpen = false;
    document.getElementById('gif-picker')?.classList.remove('open');
    document.getElementById('sticker-picker')?.classList.remove('open');
  }

  // ── Voice ─────────────────────────────────────────────────────
  async function startVoice() {
    if (_recMR) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      _recMR = new MediaRecorder(stream);
      const chunks = [];
      _recMR.ondataavailable = e => chunks.push(e.data);
      _recMR.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const reader = new FileReader(); reader.readAsDataURL(blob);
        reader.onload = async () => {
          const convId = window._currentConvId; if (!convId) return;
          const dur = `0:${String(_recSecs).padStart(2,'0')}`;
          const cu = window._currentUser; const now = Date.now();
          try {
            const [msg] = await Promise.all([
              DB.createMessage({ conv_id:convId, from:cu.username, type:'voice', text:'', duration:dur, audio_data:reader.result, status:'sent', created_at:now }),
              DB.updateConversation(convId, { last_msg:`🎙 ${dur}`, last_time:now, last_from:cu.username }),
            ]);
            _getStore(convId).msgs.push(msg);
            window._onNewMessage?.();
          } catch(e) { UI.toast('Ses gönderilemedi', 'error'); }
        };
      };
      _recMR.start(); _recSecs = 0;
      const vi = document.getElementById('voice-indicator'); if (vi) vi.style.display = 'flex';
      const vb = document.getElementById('voice-btn'); if (vb) vb.style.color = '#FF3D6B';
      _recInt = setInterval(() => { _recSecs++; const e=document.getElementById('rec-timer'); if(e) e.textContent=`0:${String(_recSecs).padStart(2,'0')}`; }, 1000);
    } catch { UI.toast('Mikrofon erişimi reddedildi', 'error'); }
  }

  function stopVoice() {
    if (_recMR?.state !== 'inactive') _recMR?.stop();
    _recMR = null; clearInterval(_recInt); _recInt = null;
    const vi = document.getElementById('voice-indicator'); if (vi) vi.style.display = 'none';
    const vb = document.getElementById('voice-btn'); if (vb) vb.style.color = '#7A8FA8';
  }

  function toggleDestruct() {
    _destruct = !_destruct;
    const bar = document.getElementById('destruct-bar'); if (bar) bar.style.display = _destruct ? 'flex' : 'none';
    const btn = document.getElementById('destruct-btn'); if (btn) btn.style.color = _destruct ? '#FF3D6B' : '#7A8FA8';
    if (_destruct) UI.toast('İmha modu aktif 💣', 'warn');
  }

  function startDestructTimer(msg, convId) {
    const iv = setInterval(async () => {
      const rem = Math.max(0, Math.floor((msg.destruct_at - Date.now()) / 1000));
      const el = document.getElementById('dtimer-' + msg.id); if (el) el.textContent = ` ⏱${rem}s`;
      if (rem <= 0) {
        clearInterval(iv);
        const me = document.getElementById('msg-' + msg.id);
        if (me) { me.style.opacity='0'; me.style.transition='opacity .4s'; setTimeout(()=>{ me.remove(); DB.deleteMessage(convId,msg.id).catch(()=>{}); },400); }
      }
    }, 1000);
  }

  // ── Reactions (use in-memory store) ──────────────────────────
  async function _toggleReaction(msgId, emoji) {
    UI.hideReactionPicker();
    const convId = window._currentConvId; if (!convId) return;
    // Use store instead of DB.getMessages
    const msg = _findMsg(convId, msgId);
    if (!msg) return;
    const reactions = { ...(msg.reactions || {}) };
    if (!reactions[emoji]) reactions[emoji] = [];
    const idx = reactions[emoji].indexOf(window._currentUser.username);
    if (idx >= 0) reactions[emoji].splice(idx, 1); else reactions[emoji].push(window._currentUser.username);
    if (!reactions[emoji].length) delete reactions[emoji];
    // Optimistic update DOM
    msg.reactions = reactions;
    try {
      await DB.updateMessage(convId, msgId, { reactions });
      window._onNewMessage?.();
    } catch(e) { console.warn('reaction:', e); }
  }

  // ── Context menu ──────────────────────────────────────────────
  function _ctxMenu(e, msgId, isMine) {
    e.preventDefault();
    const items = [
      { icon:'↩', label:'Yanıtla',   action:`Messages._setReply('${msgId}')` },
      { icon:'📋', label:'Kopyala',   action:`Messages._copy('${msgId}')` },
      { icon:'↪', label:'İlet',       action:`openForwardModal('${msgId}')` },
      { icon:'😊', label:'Reaksiyon', action:`UI.showReactionPicker(${e.clientX},${e.clientY},em=>Messages._toggleReaction('${msgId}',em))` },
    ];
    if (isMine) {
      items.push('divider');
      items.push({ icon:'✏️', label:'Düzenle',  action:`Messages._openEdit('${msgId}')` });
      items.push({ icon:'↩', label:'Geri Çek', action:`Messages._recall('${msgId}')`, danger:true });
      items.push({ icon:'🗑', label:'Sil',      action:`Messages._delete('${msgId}')`, danger:true });
    }
    UI.showCtxMenu(e.clientX, e.clientY, items);
  }

  // Use in-memory store for reply/copy
  async function _setReply(msgId) {
    _replyTo = _findMsg(window._currentConvId, msgId);
    if (!_replyTo) { const msgs = await DB.getMessages(window._currentConvId); _replyTo = msgs.find(m=>m.id===msgId); }
    if (!_replyTo) return;
    const bar = document.getElementById('reply-preview'); if (bar) bar.style.display = 'flex';
    const rt = document.getElementById('reply-text'); if (rt) rt.textContent = _replyTo.text || (_replyTo.type==='gif'?'🎬 GIF':_replyTo.sticker||'📎');
    document.getElementById('msg-input')?.focus();
  }

  function clearReply() { _replyTo = null; const bar=document.getElementById('reply-preview'); if(bar)bar.style.display='none'; }

  async function _copy(msgId) {
    const msg = _findMsg(window._currentConvId, msgId) || (await DB.getMessages(window._currentConvId)).find(m=>m.id===msgId);
    if (msg?.text) { navigator.clipboard.writeText(msg.text).catch(()=>{}); UI.toast('Kopyalandı ✓','success'); }
  }

  function _openEdit(msgId) {
    const msg = _findMsg(window._currentConvId, msgId);
    if (msg) { window._editingMsgId = msgId; const i=document.getElementById('edit-input'); if(i)i.value=msg.text||''; UI.openModal('edit-modal'); return; }
    DB.getMessages(window._currentConvId).then(msgs => {
      const m = msgs.find(x=>x.id===msgId); if(!m)return;
      window._editingMsgId=msgId; const i=document.getElementById('edit-input'); if(i)i.value=m.text||''; UI.openModal('edit-modal');
    });
  }

  async function saveEdit() {
    const mid=window._editingMsgId, cid=window._currentConvId;
    if (!mid||!cid) return;
    const t = document.getElementById('edit-input')?.value.trim(); if (!t) return;
    try {
      await DB.updateMessage(cid, mid, { text:t, edited:true });
      const msg = _findMsg(cid, mid); if (msg) msg.text = t;
      UI.closeModal('edit-modal'); window._onNewMessage?.();
    } catch(e) { UI.toast('Düzenlenemedi','error'); }
  }

  async function _recall(msgId) {
    try {
      await DB.updateMessage(window._currentConvId, msgId, { recalled:true });
      const msg = _findMsg(window._currentConvId, msgId); if (msg) msg.recalled = true;
      window._onNewMessage?.(); UI.toast('Geri çekildi','info');
    } catch(e) { UI.toast('Geri çekilemedi','error'); }
  }

  async function _delete(msgId) {
    try {
      await DB.deleteMessage(window._currentConvId, msgId);
      const store = _getStore(window._currentConvId);
      store.msgs = store.msgs.filter(m=>m.id!==msgId);
      document.getElementById('msg-'+msgId)?.remove();
      UI.toast('Silindi','info');
    } catch(e) { UI.toast('Silinemedi','error'); }
  }

  // ── Files ─────────────────────────────────────────────────────
  function handleFiles(fileList) {
    _files = [];
    const bar = document.getElementById('file-preview-bar'); if (!bar) return;
    bar.innerHTML = ''; bar.style.display = 'block';
    Array.from(fileList).forEach(file => {
      if (file.size > CONFIG.MAX_FILE_SIZE_MB*1024*1024) { UI.toast(`Maks. ${CONFIG.MAX_FILE_SIZE_MB}MB`,'error'); return; }
      const r = new FileReader(); r.readAsDataURL(file);
      r.onload = () => {
        _files.push({ name:file.name, type:file.type, data:r.result });
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:10px;background:#0A1018;border:1px solid #1E2D45;margin-bottom:4px';
        div.innerHTML = `${file.type.startsWith('image/')?`<img src="${r.result}" style="width:32px;height:32px;border-radius:6px;object-fit:cover">`:'<span style="font-size:20px">📄</span>'}<span style="font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#DDE8F8">${file.name}</span><button onclick="Messages.clearFiles()" style="color:#7A8FA8;background:none;border:none;cursor:pointer;font-size:14px">✕</button>`;
        bar.appendChild(div);
      };
    });
  }

  function clearFiles() {
    _files = [];
    const b=document.getElementById('file-preview-bar'); if(b){b.innerHTML='';b.style.display='none';}
    const fi=document.getElementById('file-input'); if(fi)fi.value='';
  }

  function autoResize(el) { el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,120)+'px'; }

  // ── Event delegation ──────────────────────────────────────────
  function initEvents() {
    document.addEventListener('click', e => {
      const pill = e.target.closest('.reaction-pill');
      if (pill) { _toggleReaction(pill.dataset.msgid, pill.dataset.emoji); return; }
    });
    const msgArea = document.getElementById('messages');
    if (msgArea) {
      msgArea.addEventListener('contextmenu', e => {
        const bubble = e.target.closest('[data-msgid]'); if (!bubble) return;
        e.preventDefault(); _ctxMenu(e, bubble.dataset.msgid, bubble.dataset.ismine==='1');
      });
      msgArea.addEventListener('dblclick', e => {
        const bubble = e.target.closest('[data-msgid]'); if (!bubble) return;
        UI.showReactionPicker(e.clientX, e.clientY, em => _toggleReaction(bubble.dataset.msgid, em));
      });
    }
  }

  return {
    subscribeConv, renderAll,
    buildEl, send, sendGif, sendSticker,
    toggleGif, toggleGifPicker: ()=>toggleGif(),
    searchGifs, renderGifs,
    toggleSticker, toggleStickerPicker: ()=>toggleSticker(),
    renderStickerPack, closeAllPickers,
    startVoice, stopVoice, toggleDestruct, startDestructTimer,
    handleFiles, clearFiles, clearReply, saveEdit, initEvents,
    _toggleReaction, _ctxMenu, _setReply, _copy, _openEdit, _recall, _delete,
    _lightbox, autoResize,
    getMsgs: convId => _getMsgs(convId),
    hasFiles: () => _files.length > 0,
    _setDestructSecs: v => { _destructSecs = v; },
    get _gifOpen()    { return _gifOpen; },    set _gifOpen(v)    { _gifOpen = v; },
    get _stickerOpen(){ return _stickerOpen; }, set _stickerOpen(v){ _stickerOpen = v; },
  };
})();

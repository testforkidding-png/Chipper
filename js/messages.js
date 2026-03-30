/**
 * CIPHER — Messages v4
 * Bugfix: reply/destruct/voice visibility, reactions, gif/emoji, delete permission, image lightbox
 */
const Messages = (() => {
  let _replyTo = null, _destruct = false, _destructSecs = 30;
  let _files = [], _recMR = null, _recInt = null, _recSecs = 0;
  let _gifOpen = false, _stickerOpen = false;
  let _activePack = null;

  // ── Helpers ───────────────────────────────────────────────────
  function show(id) { const e = document.getElementById(id); if (e) e.style.display = ''; }
  function hide(id) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }

  // ── Subscribe ─────────────────────────────────────────────────
  function subscribeConv(convId) {
    // Clear previous subscription/polling
    if (window._realtimeSub) { try { DB.unsubscribe(window._realtimeSub); } catch {} window._realtimeSub = null; }
    if (window._pollInterval) { clearInterval(window._pollInterval); window._pollInterval = null; }

    if (CONFIG.USE_SUPABASE && !window._supabaseNotConfigured) {
      try {
        window._realtimeSub = DB.subscribeMessages(convId, () => window._onNewMessage?.());
      } catch(e) { console.warn('subscribeMessages failed:', e); }
    } else {
      // Polling fallback for localStorage mode (cross-tab via BroadcastChannel is instant,
      // but polling ensures consistency)
      window._pollInterval = setInterval(async () => {
        if (window._currentConvId === convId && !document.hidden) {
          await window._onNewMessage?.();
        }
      }, 3000);
    }
  }

  // ── Render all ────────────────────────────────────────────────
  async function renderAll(convId, users, highlight = '') {
    const msgs = await DB.getMessages(convId);
    const container = document.getElementById('messages');
    if (!container) return;
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 80;
    container.innerHTML = '';
    let lastDate = '';
    for (const msg of msgs) {
      const ts = msg.created_at || Date.now();
      const ds = new Date(ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
      if (ds !== lastDate) {
        lastDate = ds;
        const sep = document.createElement('div');
        sep.style.cssText = 'display:flex;align-items:center;gap:10px;margin:14px 0 10px;user-select:none;flex-shrink:0';
        sep.innerHTML = `<div style="flex:1;height:1px;background:#1E2D45"></div><span style="font-size:10px;padding:2px 12px;color:#7A8FA8;font-family:'JetBrains Mono',monospace;white-space:nowrap;background:#06080F;border-radius:20px;border:1px solid #1E2D45">${ds}</span><div style="flex:1;height:1px;background:#1E2D45"></div>`;
        container.appendChild(sep);
      }
      container.appendChild(buildEl(msg, users, highlight));
      if (msg.destruct_at && msg.destruct_at > Date.now()) startDestructTimer(msg, convId);
    }
    if (atBottom || msgs.length <= 5) container.scrollTop = container.scrollHeight;
  }

  // ── Build message element ─────────────────────────────────────
  function buildEl(msg, users, highlight = '') {
    const cu = window._currentUser;
    const isMine = msg.from === cu?.username;
    const sender = users[msg.from] || { username: msg.from, display_name: msg.from };
    const color = UI.avatarColor(sender.username);
    const ts = msg.created_at || Date.now();
    const recalled = !!msg.recalled;

    // Highlight
    let text = recalled ? '↩ Bu mesaj geri çekildi.' : (msg.text || '');
    if (highlight && text && !recalled) {
      const re = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      text = text.replace(re, '<mark style="background:rgba(0,255,179,.3);border-radius:2px;padding:0 1px">$1</mark>');
    }

    // Avatar
    const avatarHtml = !isMine
      ? (sender.avatar_url
        ? `<img src="${sender.avatar_url}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;cursor:pointer;flex-shrink:0;align-self:flex-end" onclick="window.showProfile?.('${sender.username}')">`
        : `<div onclick="window.showProfile?.('${sender.username}')" style="width:28px;height:28px;min-width:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;align-self:flex-end;cursor:pointer;background:${color}22;color:${color};font-family:Syne,sans-serif">${UI.initials(sender.display_name || sender.username)}</div>`)
      : '';

    // Content
    let contentHtml = '';
    if (!recalled) {
      if (msg.type === 'gif' && msg.gif_url) {
        contentHtml = `<img src="${msg.gif_url}" alt="GIF" style="max-width:220px;max-height:180px;border-radius:10px;display:block;margin-top:4px;cursor:pointer" onclick="Messages._lightbox('${msg.gif_url}')">`;
      } else if (msg.type === 'sticker' && msg.sticker) {
        contentHtml = `<div style="font-size:52px;line-height:1;padding:4px 0">${msg.sticker}</div>`;
      } else if (msg.type === 'file' && msg.file_data) {
        if (msg.file_type?.startsWith('image/')) {
          // FIX #4: lightbox instead of new tab
          contentHtml = `<img src="${msg.file_data}" style="max-width:220px;max-height:180px;border-radius:10px;display:block;margin-top:4px;cursor:pointer" onclick="Messages._lightbox('${msg.file_data}')">`;
        } else {
          contentHtml = `<div style="display:flex;align-items:center;gap:8px;margin-top:6px;padding:8px 12px;border-radius:10px;background:rgba(0,0,0,.25);border:1px solid #1E2D45">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00FFB3" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span style="font-size:12px;color:#DDE8F8;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${msg.file_name || 'Dosya'}</span>
            <a href="${msg.file_data}" download="${msg.file_name || 'file'}" style="font-size:12px;color:#00FFB3;text-decoration:none;flex-shrink:0">↓ İndir</a>
          </div>`;
        }
      } else if (msg.type === 'voice' && msg.audio_data) {
        contentHtml = `<div style="display:flex;align-items:center;gap:8px;margin-top:4px;padding:8px 12px;border-radius:10px;background:rgba(0,255,179,.07);border:1px solid rgba(0,255,179,.18)">
          <span style="color:#00FFB3;font-size:16px">🎙</span>
          <audio controls src="${msg.audio_data}" style="height:28px;flex:1;min-width:100px;accent-color:#00FFB3"></audio>
          <span style="font-size:10px;color:#00FFB3;font-family:'JetBrains Mono',monospace">${msg.duration || '0:00'}</span>
        </div>`;
      }
    }

    const textHtml = text ? `<div style="font-size:14px;line-height:1.55;color:${recalled ? '#7A8FA8' : '#DDE8F8'};word-break:break-word${recalled ? ';font-style:italic' : ''}">${text}</div>` : '';

    const replyHtml = msg.reply_to_text
      ? `<div style="margin-bottom:5px;padding:4px 8px;border-radius:7px;border-left:2px solid #00FFB3;background:rgba(0,0,0,.22);font-size:11px;color:#7A8FA8;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${msg.reply_to_text}</div>` : '';

    // Reactions — FIX #3: use data-msgid to avoid inline JS with special chars
    let reactHtml = '';
    if (msg.reactions && Object.keys(msg.reactions).length) {
      reactHtml = '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:5px">';
      for (const [emoji, uids] of Object.entries(msg.reactions)) {
        if (!uids.length) continue;
        const active = uids.includes(cu?.username);
        // Escape emoji for data attribute
        reactHtml += `<button class="reaction-pill${active ? ' active' : ''}" data-msgid="${msg.id}" data-emoji="${emoji}">${emoji} ${uids.length}</button>`;
      }
      reactHtml += '</div>';
    }

    const timeStr = UI.fmtTime(ts);
    const editMark = msg.edited ? `<span style="font-size:9px;color:#7A8FA8;font-family:'JetBrains Mono',monospace"> (düz)</span>` : '';
    const destructMark = msg.destruct_at && msg.destruct_at > Date.now() ? `<span id="dtimer-${msg.id}" style="font-size:10px;color:#FF3D6B;font-family:'JetBrains Mono',monospace"> ⏱</span>` : '';
    const statusMark = isMine ? `<span style="font-size:10px;color:${msg.status === 'read' ? '#00FFB3' : '#7A8FA8'}">${msg.status === 'read' ? ' ✓✓' : ' ✓'}</span>` : '';
    const metaHtml = `<div style="display:flex;align-items:center;gap:1px;margin-top:4px;${isMine ? 'justify-content:flex-end' : ''}">
      <span style="font-size:9px;color:#3A4A5A">🔒</span>
      <span style="font-size:10px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">${timeStr}</span>
      ${editMark}${destructMark}${statusMark}
    </div>`;

    const noBubble = msg.type === 'sticker' && !recalled;
    const bubbleStyle = noBubble
      ? 'background:transparent;border:none;padding:4px 8px'
      : `padding:9px 13px;border-radius:${isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px'}`;

    const senderName = !isMine && window._isGroup
      ? `<div style="font-size:11px;font-weight:600;color:${color};margin-bottom:2px;cursor:pointer;font-family:'Syne',sans-serif" onclick="window.showProfile?.('${sender.username}')">${sender.display_name || sender.username}</div>` : '';

    const w = document.createElement('div');
    w.id = 'msg-' + msg.id;
    w.dataset.msgId = msg.id;
    w.dataset.isMine = isMine ? '1' : '0';
    w.className = 'animate-msg-in';
    w.style.cssText = `display:flex;${isMine ? 'justify-content:flex-end' : 'justify-content:flex-start'};margin-bottom:3px;flex-shrink:0`;
    w.innerHTML = `<div style="display:flex;align-items:flex-end;gap:6px;max-width:78%;${isMine ? 'flex-direction:row-reverse' : ''}">
      ${!isMine ? avatarHtml : ''}
      <div style="min-width:0">
        ${senderName}
        <div class="${noBubble ? '' : 'msg-bubble ' + (isMine ? 'sent' : 'recv')}" style="${bubbleStyle};cursor:pointer"
          data-msgid="${msg.id}" data-ismine="${isMine ? '1' : '0'}">
          ${replyHtml}${textHtml}${contentHtml}${metaHtml}
        </div>
        ${reactHtml}
      </div>
    </div>`;
    return w;
  }

  // ── Lightbox (FIX #4) ─────────────────────────────────────────
  function _lightbox(src) {
    let lb = document.getElementById('cipher-lightbox');
    if (!lb) {
      lb = document.createElement('div');
      lb.id = 'cipher-lightbox';
      lb.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(6,8,15,.96);display:flex;align-items:center;justify-content:center;cursor:zoom-out';
      lb.onclick = () => lb.remove();
      document.body.appendChild(lb);
    }
    lb.innerHTML = `<img src="${src}" style="max-width:92vw;max-height:92vh;border-radius:12px;object-fit:contain;box-shadow:0 0 80px rgba(0,0,0,.8)">
      <button style="position:fixed;top:16px;right:16px;width:36px;height:36px;border-radius:50%;background:#1E2D45;color:#DDE8F8;border:none;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center" onclick="document.getElementById('cipher-lightbox')?.remove()">✕</button>`;
    lb.style.display = 'flex';
  }

  // ── Send ──────────────────────────────────────────────────────
  async function send(convId) {
    const input = document.getElementById('msg-input');
    const text = (input?.value || '').trim();
    if (!text && !_files.length) return;
    if (input) { input.value = ''; autoResize(input); }
    closeAllPickers();

    const cu = window._currentUser;
    const now = Date.now();
    const base = { conv_id: convId, from: cu.username, status: 'sent', created_at: now };
    if (_replyTo) {
      base.reply_to = _replyTo.id;
      base.reply_to_text = _replyTo.text || (_replyTo.type === 'gif' ? '🎬 GIF' : _replyTo.sticker || '📎');
      clearReply();
    }
    if (_destruct) base.destruct_at = now + _destructSecs * 1000;

    if (_files.length) {
      const f = _files[0];
      await DB.createMessage({ ...base, type: 'file', text: text || '', file_name: f.name, file_type: f.type, file_data: f.data });
      clearFiles();
    } else {
      await DB.createMessage({ ...base, type: 'text', text });
    }
    await DB.updateConversation(convId, { last_msg: text || '📎', last_time: now, last_from: cu.username });
    window._onNewMessage?.();
  }

  async function sendGif(convId, gifUrl, gifTitle) {
    const cu = window._currentUser; const now = Date.now();
    await DB.createMessage({ conv_id: convId, from: cu.username, type: 'gif', text: '', gif_url: gifUrl, gif_title: gifTitle || 'GIF', status: 'sent', created_at: now });
    await DB.updateConversation(convId, { last_msg: '🎬 GIF', last_time: now, last_from: cu.username });
    closeAllPickers();
    window._onNewMessage?.();
  }

  async function sendSticker(convId, sticker) {
    const cu = window._currentUser; const now = Date.now();
    await DB.createMessage({ conv_id: convId, from: cu.username, type: 'sticker', text: '', sticker, status: 'sent', created_at: now });
    await DB.updateConversation(convId, { last_msg: sticker + ' Sticker', last_time: now, last_from: cu.username });
    closeAllPickers();
    window._onNewMessage?.();
  }

  // ── GIF Picker ────────────────────────────────────────────────
  let _gifResults = [], _gifLoading = false, _gifCache = null;
  function toggleGif() {
    _gifOpen = !_gifOpen; _stickerOpen = false;
    const gp = document.getElementById('gif-picker');
    const sp = document.getElementById('sticker-picker');
    if (gp) gp.classList.toggle('open', _gifOpen);
    if (sp) sp.classList.remove('open');
    if (_gifOpen) {
      if (_gifCache) { _gifResults = _gifCache; renderGifs(); } // instant from cache
      else searchGifs('');
    }
  }

  async function searchGifs(q = '') {
    if (_gifLoading) return;
    _gifLoading = true;
    const grid = document.getElementById('gif-grid');
    if (!grid) { _gifLoading = false; return; }
    // Show skeleton placeholders instead of spinner
    grid.innerHTML = Array(6).fill(0).map(() =>
      `<div style="border-radius:8px;background:linear-gradient(90deg,#0C1220 25%,#131D30 50%,#0C1220 75%);background-size:200% 100%;animation:shimmer 1.2s infinite;aspect-ratio:1"></div>`
    ).join('');
    try {
      const url = q
        ? `https://api.giphy.com/v1/gifs/search?api_key=${CONFIG.GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=18&rating=pg`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${CONFIG.GIPHY_API_KEY}&limit=18&rating=pg`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      _gifResults = json.data || [];
      if (!q) _gifCache = _gifResults; // cache trending
      renderGifs();
    } catch(err) {
      grid.innerHTML = `<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;color:#FF3D6B;font-size:12px;text-align:center;gap:8px"><span style="font-size:24px">😵</span>GIF yüklenemedi<small style="color:#7A8FA8">Bağlantı kontrolü yapın</small></div>`;
    }
    _gifLoading = false;
  }

  function renderGifs() {
    const grid = document.getElementById('gif-grid');
    if (!grid) return;
    grid.innerHTML = '';
    if (!_gifResults.length) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#7A8FA8">Sonuç bulunamadı</div>'; return; }
    _gifResults.forEach(g => {
      const url = g.images?.fixed_height_small?.url || g.images?.downsized?.url || g.images?.original?.url;
      if (!url) return;
      const div = document.createElement('div');
      div.className = 'gif-item';
      div.innerHTML = `<img src="${url}" alt="${(g.title || 'GIF').replace(/"/g, '')}" loading="lazy">`;
      div.onclick = () => { if (!window._currentConvId) return; sendGif(window._currentConvId, url, g.title); };
      grid.appendChild(div);
    });
  }

  // ── Sticker Picker ────────────────────────────────────────────
  function toggleSticker() {
    _stickerOpen = !_stickerOpen; _gifOpen = false;
    const sp = document.getElementById('sticker-picker');
    const gp = document.getElementById('gif-picker');
    if (sp) sp.classList.toggle('open', _stickerOpen);
    if (gp) gp.classList.remove('open');
    if (_stickerOpen) {
      if (!_activePack) _activePack = Object.keys(CONFIG.STICKER_PACKS)[0];
      renderStickerPack(_activePack);
    }
  }

  function renderStickerPack(pack) {
    _activePack = pack;
    document.querySelectorAll('.sticker-pack-tab').forEach(t => t.classList.toggle('active', t.dataset.pack === pack));
    const grid = document.getElementById('sticker-grid');
    if (!grid) return;
    grid.innerHTML = '';
    (CONFIG.STICKER_PACKS[pack] || []).forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'sticker-btn';
      btn.textContent = s;
      btn.onclick = () => { if (!window._currentConvId) return; sendSticker(window._currentConvId, s); };
      grid.appendChild(btn);
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
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onload = async () => {
          const convId = window._currentConvId; if (!convId) return;
          const dur = `0:${String(_recSecs).padStart(2, '0')}`;
          const cu = window._currentUser; const now = Date.now();
          await DB.createMessage({ conv_id: convId, from: cu.username, type: 'voice', text: '', duration: dur, audio_data: reader.result, status: 'sent', created_at: now });
          await DB.updateConversation(convId, { last_msg: `🎙 ${dur}`, last_time: now, last_from: cu.username });
          window._onNewMessage?.();
        };
      };
      _recMR.start(); _recSecs = 0;
      const vi = document.getElementById('voice-indicator');
      if (vi) vi.style.display = 'flex';
      const vb = document.getElementById('voice-btn');
      if (vb) vb.style.color = '#FF3D6B';
      _recInt = setInterval(() => {
        _recSecs++;
        const e = document.getElementById('rec-timer');
        if (e) e.textContent = `0:${String(_recSecs).padStart(2, '0')}`;
      }, 1000);
    } catch { UI.toast('Mikrofon erişimi reddedildi', 'error'); }
  }

  function stopVoice() {
    if (_recMR?.state !== 'inactive') _recMR?.stop();
    _recMR = null; clearInterval(_recInt); _recInt = null;
    const vi = document.getElementById('voice-indicator');
    if (vi) vi.style.display = 'none';
    const vb = document.getElementById('voice-btn');
    if (vb) vb.style.color = '#7A8FA8';
  }

  // ── Destruct ──────────────────────────────────────────────────
  function toggleDestruct() {
    _destruct = !_destruct;
    const bar = document.getElementById('destruct-bar');
    if (bar) bar.style.display = _destruct ? 'flex' : 'none';
    const btn = document.getElementById('destruct-btn');
    if (btn) btn.style.color = _destruct ? '#FF3D6B' : '#7A8FA8';
    if (_destruct) UI.toast('İmha modu aktif 💣', 'warn');
  }

  function startDestructTimer(msg, convId) {
    const iv = setInterval(async () => {
      const rem = Math.max(0, Math.floor((msg.destruct_at - Date.now()) / 1000));
      const el = document.getElementById('dtimer-' + msg.id);
      if (el) el.textContent = ` ⏱${rem}s`;
      if (rem <= 0) {
        clearInterval(iv);
        const me = document.getElementById('msg-' + msg.id);
        if (me) { me.style.animation = 'destruct 0.8s ease-in forwards'; setTimeout(() => { me.remove(); DB.deleteMessage(convId, msg.id); }, 800); }
      }
    }, 1000);
  }

  // ── Reactions (FIX #3) ────────────────────────────────────────
  async function _toggleReaction(msgId, emoji) {
    UI.hideReactionPicker();
    const convId = window._currentConvId; if (!convId) return;
    const msgs = await DB.getMessages(convId);
    const msg = msgs.find(m => m.id === msgId); if (!msg) return;
    const reactions = msg.reactions || {};
    if (!reactions[emoji]) reactions[emoji] = [];
    const idx = reactions[emoji].indexOf(window._currentUser.username);
    if (idx >= 0) reactions[emoji].splice(idx, 1);
    else reactions[emoji].push(window._currentUser.username);
    if (!reactions[emoji].length) delete reactions[emoji];
    await DB.updateMessage(convId, msgId, { reactions });
    window._onNewMessage?.();
  }

  // ── Context menu (FIX #2: only own messages deletable) ───────
  function _ctxMenu(e, msgId, isMine) {
    e.preventDefault();
    const items = [
      { icon: '↩', label: 'Yanıtla', action: `Messages._setReply('${msgId}')` },
      { icon: '📋', label: 'Kopyala', action: `Messages._copy('${msgId}')` },
      { icon: '↪', label: 'İlet', action: `openForwardModal('${msgId}')` },
      { icon: '😊', label: 'Reaksiyon', action: `UI.showReactionPicker(${e.clientX},${e.clientY},em=>Messages._toggleReaction('${msgId}',em))` },
    ];
    if (isMine) {
      items.push('divider');
      items.push({ icon: '✏️', label: 'Düzenle', action: `Messages._openEdit('${msgId}')` });
      items.push({ icon: '↩', label: 'Geri Çek', action: `Messages._recall('${msgId}')`, danger: true });
      items.push({ icon: '🗑', label: 'Sil', action: `Messages._delete('${msgId}')`, danger: true });
    }
    UI.showCtxMenu(e.clientX, e.clientY, items);
  }

  async function _setReply(msgId) {
    const msgs = await DB.getMessages(window._currentConvId);
    _replyTo = msgs.find(m => m.id === msgId); if (!_replyTo) return;
    const bar = document.getElementById('reply-preview');
    if (bar) bar.style.display = 'flex';
    const rt = document.getElementById('reply-text');
    if (rt) rt.textContent = _replyTo.text || (_replyTo.type === 'gif' ? '🎬 GIF' : _replyTo.sticker || '📎');
    document.getElementById('msg-input')?.focus();
  }

  function clearReply() {
    _replyTo = null;
    const bar = document.getElementById('reply-preview');
    if (bar) bar.style.display = 'none';
  }

  async function _copy(msgId) {
    const msgs = await DB.getMessages(window._currentConvId);
    const m = msgs.find(x => x.id === msgId);
    if (m?.text) { navigator.clipboard.writeText(m.text); UI.toast('Kopyalandı ✓', 'success'); }
  }

  function _openEdit(msgId) {
    DB.getMessages(window._currentConvId).then(msgs => {
      const m = msgs.find(x => x.id === msgId); if (!m) return;
      window._editingMsgId = msgId;
      const i = document.getElementById('edit-input');
      if (i) i.value = m.text || '';
      UI.openModal('edit-modal');
    });
  }

  async function saveEdit() {
    const mid = window._editingMsgId, cid = window._currentConvId;
    if (!mid || !cid) return;
    const t = document.getElementById('edit-input')?.value.trim();
    if (!t) return;
    await DB.updateMessage(cid, mid, { text: t, edited: true });
    UI.closeModal('edit-modal');
    window._onNewMessage?.();
  }

  async function _recall(msgId) {
    await DB.updateMessage(window._currentConvId, msgId, { recalled: true });
    window._onNewMessage?.();
    UI.toast('Mesaj geri çekildi', 'info');
  }

  async function _delete(msgId) {
    await DB.deleteMessage(window._currentConvId, msgId);
    document.getElementById('msg-' + msgId)?.remove();
    UI.toast('Silindi', 'info');
  }

  // ── Files ─────────────────────────────────────────────────────
  function handleFiles(fileList) {
    _files = [];
    const bar = document.getElementById('file-preview-bar');
    if (!bar) return;
    bar.innerHTML = ''; bar.style.display = 'block';
    Array.from(fileList).forEach(file => {
      if (file.size > CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024) { UI.toast(`Maks. ${CONFIG.MAX_FILE_SIZE_MB}MB`, 'error'); return; }
      const r = new FileReader(); r.readAsDataURL(file);
      r.onload = () => {
        _files.push({ name: file.name, type: file.type, data: r.result });
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:10px;background:#0A1018;border:1px solid #1E2D45;margin-bottom:4px';
        const isImg = file.type.startsWith('image/');
        div.innerHTML = `${isImg ? `<img src="${r.result}" style="width:32px;height:32px;border-radius:6px;object-fit:cover">` : '<span style="font-size:20px">📄</span>'}
          <span style="font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#DDE8F8">${file.name}</span>
          <button onclick="Messages.clearFiles()" style="color:#7A8FA8;background:none;border:none;cursor:pointer;font-size:14px">✕</button>`;
        bar.appendChild(div);
      };
    });
  }

  function clearFiles() {
    _files = [];
    const b = document.getElementById('file-preview-bar');
    if (b) { b.innerHTML = ''; b.style.display = 'none'; }
    const fi = document.getElementById('file-input'); if (fi) fi.value = '';
  }

  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  // ── Event delegation for reactions & context menu ─────────────
  // Called from app.js after DOM ready
  function initEvents() {
    // Reaction pills — data-msgid + data-emoji
    document.addEventListener('click', e => {
      const pill = e.target.closest('.reaction-pill');
      if (pill) {
        const msgId = pill.dataset.msgid;
        const emoji = pill.dataset.emoji;
        if (msgId && emoji) _toggleReaction(msgId, emoji);
        return;
      }
      // Bubble context menu via right-click handled by oncontextmenu in HTML
      // Bubble double-click for reaction picker
    });

    // Context menu on message bubbles via event delegation
    document.getElementById('messages')?.addEventListener('contextmenu', e => {
      const bubble = e.target.closest('[data-msgid]');
      if (!bubble) return;
      e.preventDefault();
      const msgId = bubble.dataset.msgid;
      const isMine = bubble.dataset.ismine === '1';
      _ctxMenu(e, msgId, isMine);
    });

    document.getElementById('messages')?.addEventListener('dblclick', e => {
      const bubble = e.target.closest('[data-msgid]');
      if (!bubble) return;
      const msgId = bubble.dataset.msgid;
      UI.showReactionPicker(e.clientX, e.clientY, em => _toggleReaction(msgId, em));
    });
  }

  return {
    subscribeConv, renderAll, buildEl, send, sendGif, sendSticker,
    toggleGif, searchGifs, renderGifs,
    toggleGifPicker: toggleGif,         // alias — app.html calls this
    toggleStickerPicker: toggleSticker, // alias — app.html calls this
    toggleSticker, renderStickerPack, closeAllPickers,
    startVoice, stopVoice, toggleDestruct, startDestructTimer,
    handleFiles, clearFiles, clearReply, saveEdit, initEvents,
    _toggleReaction, _ctxMenu, _setReply, _copy, _openEdit, _recall, _delete,
    _lightbox, autoResize,
    hasFiles: () => _files.length > 0,
    _setDestructSecs: (v) => { _destructSecs = v; },
    get _gifOpen() { return _gifOpen; },
    set _gifOpen(v) { _gifOpen = v; },
    get _stickerOpen() { return _stickerOpen; },
    set _stickerOpen(v) { _stickerOpen = v; },
  };
})();

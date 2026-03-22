/**
 * CIPHER — Messages v3
 * Gerçek mesajlaşma, GIF, Sticker, Voice, File, Self-destruct, Reactions
 */
const Messages = (() => {
  let _replyTo = null, _destruct = false, _destructSecs = 30;
  let _files = [], _recMR = null, _recInt = null, _recSecs = 0;
  let _gifOpen = false, _stickerOpen = false;
  let _activePack = null;

  // ── Subscribe (Supabase realtime) ──────────────────────────────
  function subscribeConv(convId) {
    // localStorage: cross-tab sync via BroadcastChannel is handled in db.js
    // Supabase: subscribe to real-time changes
    if (CONFIG.USE_SUPABASE) {
      if (window._realtimeSub) DB.unsubscribe(window._realtimeSub);
      window._realtimeSub = DB.subscribeMessages(convId, () => window._onNewMessage?.());
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
      if (msg.recalled) {
        msg.text = '↩ Bu mesaj geri çekildi.';
        msg.type = 'text';
        delete msg.gif_url; delete msg.sticker; delete msg.file_data; delete msg.audio_data;
      }
      const ts = msg.created_at || Date.now();
      const ds = new Date(ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
      if (ds !== lastDate) {
        lastDate = ds;
        const sep = document.createElement('div');
        sep.style.cssText = 'display:flex;align-items:center;gap:10px;margin:14px 0 10px;user-select:none;flex-shrink:0';
        sep.innerHTML = `<div style="flex:1;height:1px;background:#1E2D45"></div><span style="font-size:10px;padding:2px 12px;color:#7A8FA8;font-family:'JetBrains Mono',monospace;white-space:nowrap;background:#06080F;border-radius:20px;border:1px solid #1E2D45">${ds}</span><div style="flex:1;height:1px;background:#1E2D45"></div>`;
        container.appendChild(sep);
      }
      container.appendChild(await buildEl(msg, users, highlight));
      if (msg.destruct_at && msg.destruct_at > Date.now()) startDestructTimer(msg, convId);
    }
    if (atBottom || msgs.length <= 5) container.scrollTop = container.scrollHeight;
  }

  // ── Build message element ─────────────────────────────────────
  async function buildEl(msg, users, highlight = '') {
    const cu = window._currentUser;
    const isMine = msg.from === cu?.username;
    const sender = users[msg.from] || { username: msg.from, display_name: msg.from };
    const color = UI.avatarColor(sender.username);
    const ts = msg.created_at || Date.now();

    // Text with search highlight
    let text = msg.text || '';
    if (highlight && text) {
      const re = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      text = text.replace(re, '<mark style="background:rgba(0,255,179,.3);border-radius:2px;padding:0 1px">$1</mark>');
    }

    // Avatar (only for received)
    const avatarHtml = !isMine
      ? (sender.avatar_url
        ? `<img src="${sender.avatar_url}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;cursor:pointer;flex-shrink:0;align-self:flex-end" onclick="window.showProfile?.('${sender.username}')">`
        : `<div onclick="window.showProfile?.('${sender.username}')" style="width:28px;height:28px;min-width:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;align-self:flex-end;cursor:pointer;background:${color}22;color:${color};font-family:Syne,sans-serif">${UI.initials(sender.display_name || sender.username)}</div>`)
      : '';

    // Content by type
    let contentHtml = '';
    const recalled = msg.recalled;
    if (!recalled) {
      if (msg.type === 'gif' && msg.gif_url) {
        contentHtml = `<img src="${msg.gif_url}" alt="GIF" style="max-width:220px;max-height:180px;border-radius:10px;display:block;margin-top:4px">`;
      } else if (msg.type === 'sticker' && msg.sticker) {
        contentHtml = `<div style="font-size:52px;line-height:1;padding:4px 0">${msg.sticker}</div>`;
      } else if (msg.type === 'file' && msg.file_data) {
        if (msg.file_type?.startsWith('image/')) {
          contentHtml = `<img src="${msg.file_data}" style="max-width:220px;max-height:180px;border-radius:10px;display:block;margin-top:4px;cursor:pointer" onclick="window.open('${msg.file_data}','_blank')">`;
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

    // Reactions
    let reactHtml = '';
    if (msg.reactions && Object.keys(msg.reactions).length) {
      reactHtml = '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:5px">';
      for (const [e, uids] of Object.entries(msg.reactions)) {
        if (!uids.length) continue;
        const active = uids.includes(cu?.username);
        reactHtml += `<button class="reaction-pill${active ? ' active' : ''}" onclick="Messages._toggleReaction('${msg.id}','${e}')">${e} ${uids.length}</button>`;
      }
      reactHtml += '</div>';
    }

    // Meta
    const timeStr = UI.fmtTime(ts);
    const editMark = msg.edited ? `<span style="font-size:9px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">(düz)</span>` : '';
    const destructMark = msg.destruct_at && msg.destruct_at > Date.now() ? `<span id="dtimer-${msg.id}" style="font-size:10px;color:#FF3D6B;font-family:'JetBrains Mono',monospace">⏱</span>` : '';
    const statusMark = isMine ? `<span style="font-size:10px;color:${msg.status === 'read' ? '#00FFB3' : '#7A8FA8'}">${msg.status === 'read' ? '✓✓' : '✓'}</span>` : '';
    const metaHtml = `<div style="display:flex;align-items:center;gap:3px;margin-top:4px;${isMine ? 'justify-content:flex-end' : ''}">
      <span style="font-size:9px;color:#7A8FA8">🔒</span>
      <span style="font-size:10px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">${timeStr}</span>
      ${editMark}${destructMark}${statusMark}
    </div>`;

    const noBubble = msg.type === 'sticker' && !recalled;
    const bubbleStyle = noBubble
      ? 'background:transparent;border:none;padding:4px 8px'
      : `padding:9px 13px;border-radius:${isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px'}`;

    const w = document.createElement('div');
    w.id = 'msg-' + msg.id;
    w.className = 'animate-msg-in';
    w.style.cssText = `display:flex;${isMine ? 'justify-content:flex-end' : 'justify-content:flex-start'};margin-bottom:3px;flex-shrink:0`;

    const senderName = !isMine && window._isGroup
      ? `<div style="font-size:11px;font-weight:600;color:${color};margin-bottom:2px;cursor:pointer;font-family:'Syne',sans-serif" onclick="window.showProfile?.('${sender.username}')">${sender.display_name || sender.username}</div>` : '';

    w.innerHTML = `<div style="display:flex;align-items:flex-end;gap:6px;max-width:78%;${isMine ? 'flex-direction:row-reverse' : ''}">
      ${!isMine ? avatarHtml : ''}
      <div style="min-width:0">
        ${senderName}
        <div class="${noBubble ? '' : 'msg-bubble ' + (isMine ? 'sent' : 'recv')}" style="${bubbleStyle};cursor:pointer"
          oncontextmenu="Messages._ctxMenu(event,'${msg.id}',${isMine})"
          ondblclick="UI.showReactionPicker(event.clientX,event.clientY,em=>Messages._toggleReaction('${msg.id}',em))">
          ${replyHtml}${textHtml}${contentHtml}${metaHtml}
        </div>
        ${reactHtml}
      </div>
    </div>`;
    return w;
  }

  // ── Send text / file ──────────────────────────────────────────
  async function send(convId) {
    const input = document.getElementById('msg-input');
    const text = (input?.value || '').trim();
    if (!text && !_files.length) return;

    if (input) { input.value = ''; autoResize(input); }
    closeAllPickers();

    const cu = window._currentUser;
    const now = Date.now();
    const base = {
      conv_id: convId, from: cu.username,
      status: 'sent', created_at: now,
    };
    if (_replyTo) {
      base.reply_to = _replyTo.id;
      base.reply_to_text = _replyTo.text || (_replyTo.type === 'gif' ? '🎬 GIF' : _replyTo.sticker || '📎');
      clearReply();
    }
    if (_destruct) {
      base.destruct_at = now + _destructSecs * 1000;
    }

    let msg;
    if (_files.length) {
      const f = _files[0];
      msg = await DB.createMessage({ ...base, type: 'file', text: text || '', file_name: f.name, file_type: f.type, file_data: f.data });
      clearFiles();
    } else {
      msg = await DB.createMessage({ ...base, type: 'text', text });
    }

    // Update conversation last_msg
    const preview = text || (_files.length ? '📎 Dosya' : '');
    await DB.updateConversation(convId, { last_msg: preview, last_time: now });

    // Refresh this tab
    window._onNewMessage?.();
    return msg;
  }

  async function sendGif(convId, gifUrl, gifTitle) {
    const cu = window._currentUser;
    const now = Date.now();
    await DB.createMessage({ conv_id: convId, from: cu.username, type: 'gif', text: '', gif_url: gifUrl, gif_title: gifTitle || 'GIF', status: 'sent', created_at: now });
    await DB.updateConversation(convId, { last_msg: '🎬 GIF', last_time: now });
    closeAllPickers();
    window._onNewMessage?.();
  }

  async function sendSticker(convId, sticker) {
    const cu = window._currentUser;
    const now = Date.now();
    await DB.createMessage({ conv_id: convId, from: cu.username, type: 'sticker', text: '', sticker, status: 'sent', created_at: now });
    await DB.updateConversation(convId, { last_msg: sticker + ' Sticker', last_time: now });
    closeAllPickers();
    window._onNewMessage?.();
  }

  // ── GIF Picker ────────────────────────────────────────────────
  let _gifResults = [], _gifLoading = false, _gifQuery = '';
  function toggleGif() {
    _gifOpen = !_gifOpen; _stickerOpen = false;
    const gp = document.getElementById('gif-picker');
    const sp = document.getElementById('sticker-picker');
    if (gp) gp.style.display = _gifOpen ? 'flex' : 'none';
    if (sp) sp.style.display = 'none';
    if (_gifOpen && !_gifResults.length) searchGifs('');
  }

  async function searchGifs(q = '') {
    if (_gifLoading) return;
    _gifQuery = q;
    _gifLoading = true;
    const grid = document.getElementById('gif-grid');
    if (!grid) { _gifLoading = false; return; }
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:#7A8FA8">
      <div style="display:inline-block;width:18px;height:18px;border:2px solid #1E2D45;border-top-color:#00FFB3;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:6px"></div><br>Yükleniyor…</div>`;
    try {
      const url = q
        ? `https://api.giphy.com/v1/gifs/search?api_key=${CONFIG.GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=18&rating=pg`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${CONFIG.GIPHY_API_KEY}&limit=18&rating=pg`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Giphy API hatası');
      const json = await res.json();
      _gifResults = json.data || [];
      renderGifs();
    } catch {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:#FF3D6B;font-size:12px">GIF yüklenemedi.<br><small style="color:#7A8FA8">Demo API key. developers.giphy.com'dan ücretsiz key alın.</small></div>`;
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
      div.innerHTML = `<img src="${url}" alt="${g.title || 'GIF'}" loading="lazy">`;
      div.onclick = () => {
        if (!window._currentConvId) return;
        sendGif(window._currentConvId, url, g.title);
      };
      grid.appendChild(div);
    });
  }

  // ── Sticker Picker ────────────────────────────────────────────
  function toggleSticker() {
    _stickerOpen = !_stickerOpen; _gifOpen = false;
    const sp = document.getElementById('sticker-picker');
    const gp = document.getElementById('gif-picker');
    if (sp) sp.style.display = _stickerOpen ? 'flex' : 'none';
    if (gp) gp.style.display = 'none';
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
      btn.onclick = () => {
        if (!window._currentConvId) return;
        sendSticker(window._currentConvId, s);
      };
      grid.appendChild(btn);
    });
  }

  function closeAllPickers() {
    _gifOpen = false; _stickerOpen = false;
    const gp = document.getElementById('gif-picker');
    const sp = document.getElementById('sticker-picker');
    if (gp) gp.style.display = 'none';
    if (sp) sp.style.display = 'none';
  }

  // ── Voice recording ────────────────────────────────────────────
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
          const convId = window._currentConvId;
          if (!convId) return;
          const dur = `0:${String(_recSecs).padStart(2, '0')}`;
          const cu = window._currentUser;
          const now = Date.now();
          await DB.createMessage({ conv_id: convId, from: cu.username, type: 'voice', text: '', duration: dur, audio_data: reader.result, status: 'sent', created_at: now });
          await DB.updateConversation(convId, { last_msg: `🎙 ${dur}`, last_time: now });
          window._onNewMessage?.();
        };
      };
      _recMR.start();
      _recSecs = 0;
      document.getElementById('voice-indicator')?.classList.remove('hidden');
      document.getElementById('voice-btn').style.color = '#FF3D6B';
      _recInt = setInterval(() => {
        _recSecs++;
        const e = document.getElementById('rec-timer');
        if (e) e.textContent = `0:${String(_recSecs).padStart(2, '0')}`;
      }, 1000);
    } catch {
      UI.toast('Mikrofon erişimi reddedildi', 'error');
    }
  }

  function stopVoice() {
    if (_recMR?.state !== 'inactive') _recMR?.stop();
    _recMR = null;
    clearInterval(_recInt); _recInt = null;
    document.getElementById('voice-indicator')?.classList.add('hidden');
    const vb = document.getElementById('voice-btn');
    if (vb) vb.style.color = '#7A8FA8';
  }

  // ── Self-destruct ─────────────────────────────────────────────
  function toggleDestruct() {
    _destruct = !_destruct;
    document.getElementById('destruct-bar')?.classList.toggle('hidden', !_destruct);
    const btn = document.getElementById('destruct-btn');
    if (btn) btn.style.color = _destruct ? '#FF3D6B' : '#7A8FA8';
    if (_destruct) UI.toast('İmha modu aktif 💣', 'warn');
  }

  function startDestructTimer(msg, convId) {
    const iv = setInterval(async () => {
      const rem = Math.max(0, Math.floor((msg.destruct_at - Date.now()) / 1000));
      const el = document.getElementById('dtimer-' + msg.id);
      if (el) el.textContent = `⏱${rem}s`;
      if (rem <= 0) {
        clearInterval(iv);
        const me = document.getElementById('msg-' + msg.id);
        if (me) { me.style.animation = 'destruct 0.8s ease-in forwards'; setTimeout(() => { me.remove(); DB.deleteMessage(convId, msg.id); }, 800); }
      }
    }, 1000);
  }

  // ── Reactions ─────────────────────────────────────────────────
  async function _toggleReaction(msgId, emoji) {
    UI.hideReactionPicker();
    const convId = window._currentConvId;
    if (!convId) return;
    const msgs = await DB.getMessages(convId);
    const msg = msgs.find(m => m.id === msgId);
    if (!msg) return;
    if (!msg.reactions) msg.reactions = {};
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
    const idx = msg.reactions[emoji].indexOf(window._currentUser.username);
    if (idx >= 0) msg.reactions[emoji].splice(idx, 1);
    else msg.reactions[emoji].push(window._currentUser.username);
    if (!msg.reactions[emoji].length) delete msg.reactions[emoji];
    await DB.updateMessage(convId, msgId, { reactions: msg.reactions });
    window._onNewMessage?.();
  }

  // ── Context menu ──────────────────────────────────────────────
  function _ctxMenu(e, msgId, isMine) {
    e.preventDefault();
    const items = [
      { icon: '↩', label: 'Yanıtla', action: `Messages._setReply('${msgId}')` },
      { icon: '📋', label: 'Kopyala', action: `Messages._copy('${msgId}')` },
      { icon: '😊', label: 'Reaksiyon', action: `UI.showReactionPicker(${e.clientX},${e.clientY},em=>Messages._toggleReaction('${msgId}',em))` },
      'divider',
    ];
    if (isMine) {
      items.push({ icon: '✏️', label: 'Düzenle', action: `Messages._openEdit('${msgId}')` });
      items.push({ icon: '↩', label: 'Geri Çek', action: `Messages._recall('${msgId}')`, danger: true });
    }
    items.push({ icon: '🗑', label: 'Sil', action: `Messages._delete('${msgId}')`, danger: true });
    UI.showCtxMenu(e.clientX, e.clientY, items);
  }

  async function _setReply(msgId) {
    const msgs = await DB.getMessages(window._currentConvId);
    _replyTo = msgs.find(m => m.id === msgId);
    if (!_replyTo) return;
    const bar = document.getElementById('reply-preview');
    if (bar) { bar.classList.remove('hidden'); }
    const rt = document.getElementById('reply-text');
    if (rt) rt.textContent = _replyTo.text || (_replyTo.type === 'gif' ? '🎬 GIF' : _replyTo.sticker || '📎');
    document.getElementById('msg-input')?.focus();
  }

  function clearReply() {
    _replyTo = null;
    document.getElementById('reply-preview')?.classList.add('hidden');
  }

  async function _copy(msgId) {
    const msgs = await DB.getMessages(window._currentConvId);
    const m = msgs.find(x => x.id === msgId);
    if (m?.text) { navigator.clipboard.writeText(m.text); UI.toast('Kopyalandı ✓', 'success'); }
  }

  function _openEdit(msgId) {
    DB.getMessages(window._currentConvId).then(msgs => {
      const m = msgs.find(x => x.id === msgId);
      if (!m) return;
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
    await DB.updateMessage(window._currentConvId, msgId, { recalled: true, text: '↩ Bu mesaj geri çekildi.', type: 'text', file_data: null, gif_url: null, sticker: null, audio_data: null });
    window._onNewMessage?.();
    UI.toast('Mesaj geri çekildi', 'info');
  }

  async function _delete(msgId) {
    await DB.deleteMessage(window._currentConvId, msgId);
    document.getElementById('msg-' + msgId)?.remove();
    UI.toast('Silindi', 'info');
  }

  // ── File handling ─────────────────────────────────────────────
  function handleFiles(fileList) {
    _files = [];
    const bar = document.getElementById('file-preview-bar');
    if (!bar) return;
    bar.innerHTML = ''; bar.classList.remove('hidden');
    Array.from(fileList).forEach(file => {
      if (file.size > CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024) {
        UI.toast(`Maks. ${CONFIG.MAX_FILE_SIZE_MB}MB`, 'error'); return;
      }
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
    if (b) { b.innerHTML = ''; b.classList.add('hidden'); }
    const fi = document.getElementById('file-input');
    if (fi) fi.value = '';
  }

  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  return {
    subscribeConv, renderAll, buildEl, send, sendGif, sendSticker,
    toggleGif, searchGifs, renderGifs,
    toggleSticker, renderStickerPack, closeAllPickers,
    startVoice, stopVoice, toggleDestruct, startDestructTimer,
    handleFiles, clearFiles, clearReply, saveEdit,
    _toggleReaction, _ctxMenu, _setReply, _copy, _openEdit, _recall, _delete,
    autoResize,
    hasFiles: () => _files.length > 0,
    get _gifOpen() { return _gifOpen; },
    set _gifOpen(v) { _gifOpen = v; },
    get _stickerOpen() { return _stickerOpen; },
    set _stickerOpen(v) { _stickerOpen = v; },
  };
})();

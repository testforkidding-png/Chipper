/**
 * CIPHER — Messages Module
 */

const Messages = (() => {
  let _replyTo   = null;
  let _destruct  = false;
  let _files     = [];
  let _recMR     = null;
  let _recInt    = null;
  let _recSecs   = 0;
  let _subCh     = null;

  // ── Subscribe to real-time updates (Supabase) ──────────────────
  function subscribe(convId, cb) {
    if (_subCh) DB.unsubscribe(_subCh);
    _subCh = DB.subscribeMessages(convId, cb);
  }

  // ── Render message list ────────────────────────────────────────
  async function renderAll(convId, users, highlight = '') {
    const msgs = await DB.getMessages(convId);
    const container = document.getElementById('messages');
    if (!container) return;
    container.innerHTML = '';
    let lastDate = '';
    for (const msg of msgs) {
      const d = new Date(msg.created_at || msg.time || Date.now());
      const ds = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
      if (ds !== lastDate) {
        lastDate = ds;
        const sep = document.createElement('div');
        sep.className = 'flex items-center gap-3 my-3 select-none';
        sep.innerHTML = `<div class="flex-1 h-px" style="background:#1E2D45"></div><span class="text-xs px-2" style="color:#7A8FA8;font-family:'JetBrains Mono',monospace;font-size:10px">${ds}</span><div class="flex-1 h-px" style="background:#1E2D45"></div>`;
        container.appendChild(sep);
      }
      const el = await buildEl(msg, users, highlight);
      container.appendChild(el);
      if (msg.destruct_at) startDestructTimer(msg, convId);
    }
    container.scrollTop = container.scrollHeight;
    return msgs;
  }

  // ── Build single message element ───────────────────────────────
  async function buildEl(msg, users, highlight = '') {
    const currentUser = window._currentUser;
    const isMine   = msg.from === currentUser?.username;
    const sender   = users[msg.from] || { username: msg.from, display_name: msg.from };
    const color    = UI.avatarColor(sender.username);
    const timeStr  = UI.fmtTime(msg.created_at || msg.time || Date.now());

    let text = msg.text || '';
    if (highlight && text) {
      const re = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
      text = text.replace(re, '<mark style="background:rgba(0,255,179,.3);border-radius:2px">$1</mark>');
    }

    // Avatar HTML
    let avatarHtml = '';
    if (!isMine) {
      avatarHtml = sender.avatar_url
        ? `<img src="${sender.avatar_url}" class="w-7 h-7 rounded-full object-cover flex-shrink-0 cursor-pointer mb-0.5" onclick="showProfile('${sender.username}')">`
        : `<div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 cursor-pointer mb-0.5" style="background:${color}22;color:${color}" onclick="showProfile('${sender.username}')">${UI.initials(sender.display_name||sender.username)}</div>`;
    }

    // File/Voice attachment
    let attachHtml = '';
    if (msg.type === 'file' && msg.file_data) {
      if (msg.file_type?.startsWith('image/')) {
        attachHtml = `<img src="${msg.file_data}" class="rounded-xl mt-1.5" style="max-width:240px;max-height:200px;object-fit:cover" alt="${msg.file_name||'img'}">`;
      } else {
        attachHtml = `<div class="flex items-center gap-2 mt-1.5 px-3 py-2 rounded-xl" style="background:rgba(0,0,0,.3);border:1px solid #1E2D45">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00FFB3" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span class="text-xs" style="color:#DDE8F8">${msg.file_name||'Dosya'}</span>
          <a href="${msg.file_data}" download="${msg.file_name||'file'}" class="text-xs ml-auto" style="color:#00FFB3">↓</a>
        </div>`;
      }
    } else if (msg.type === 'voice') {
      attachHtml = `<div class="flex items-center gap-2 mt-1.5 px-3 py-2 rounded-xl" style="background:rgba(0,255,179,.08);border:1px solid rgba(0,255,179,.2)">
        <span style="color:#00FFB3">🎙</span>
        <span class="text-xs font-mono" style="color:#00FFB3">${msg.duration||'0:00'}</span>
        ${msg.audio_data ? `<audio controls src="${msg.audio_data}" style="height:28px;width:120px;filter:invert(1) hue-rotate(120deg)"></audio>` : ''}
      </div>
      ${msg.transcript ? `<div class="text-xs mt-1 italic" style="color:#7A8FA8">"${msg.transcript}"</div>` : ''}`;
    }

    // Reactions
    let reactHtml = '';
    if (msg.reactions && Object.keys(msg.reactions).length) {
      reactHtml = '<div class="flex flex-wrap gap-1 mt-1.5">';
      for (const [emoji, uids] of Object.entries(msg.reactions)) {
        const active = uids.includes(currentUser?.username);
        reactHtml += `<button class="reaction-pill${active?' active':''}" onclick="Messages._toggleReaction('${msg.id}','${emoji}')">${emoji} ${uids.length}</button>`;
      }
      reactHtml += '</div>';
    }

    // Reply preview
    let replyHtml = '';
    if (msg.reply_to_text) {
      replyHtml = `<div class="text-xs mb-1 px-2 py-1 rounded-lg border-l-2 opacity-70" style="background:rgba(0,0,0,.2);border-color:#00FFB3;color:#7A8FA8">${msg.reply_to_text}</div>`;
    }

    // Destruct timer
    let destructHtml = msg.destruct_at
      ? `<span class="text-xs ml-1 font-mono" style="color:#FF3D6B" id="dtimer-${msg.id}">●</span>` : '';

    const editHtml = msg.edited ? `<span class="text-xs" style="color:#7A8FA8;font-size:9px">(düz.)</span>` : '';

    const w = document.createElement('div');
    w.id = 'msg-' + msg.id;
    w.className = `flex ${isMine ? 'justify-end' : 'justify-start'} group`;
    w.style.marginBottom = '2px';
    w.dataset.convId = msg.conv_id;
    w.innerHTML = `
      <div class="flex items-end gap-2 ${isMine?'flex-row-reverse':''}" style="max-width:72%">
        ${!isMine ? `<div class="self-end">${avatarHtml}</div>` : ''}
        <div>
          ${!isMine && window._isGroup ? `<div class="text-xs mb-0.5 ml-1 font-semibold cursor-pointer" style="color:${color}" onclick="showProfile('${sender.username}')">${sender.display_name||sender.username}</div>` : ''}
          <div class="msg-bubble px-3 py-2 rounded-2xl ${isMine?'sent rounded-br-sm':'recv rounded-bl-sm'} cursor-pointer"
            oncontextmenu="Messages._ctxMenu(event,'${msg.id}',${isMine})"
            ondblclick="UI.showReactionPicker(event.clientX,event.clientY,emoji=>Messages._toggleReaction('${msg.id}',emoji))">
            ${replyHtml}
            ${text ? `<div class="text-sm leading-relaxed" style="color:#DDE8F8">${text}</div>` : ''}
            ${attachHtml}
            <div class="flex items-center gap-1 mt-1 ${isMine?'justify-end':''}">
              <span style="color:#7A8FA8;font-size:9px">🔒</span>
              <span class="text-xs font-mono" style="color:#7A8FA8;font-size:9px">${timeStr}</span>
              ${editHtml}
              ${destructHtml}
              ${isMine ? `<span style="color:${msg.status==='read'?'#00FFB3':'#7A8FA8'};font-size:10px">${msg.status==='read'?'✓✓':'✓'}</span>` : ''}
            </div>
          </div>
          ${reactHtml}
        </div>
        ${isMine ? `<div class="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity pb-1 self-end">
          <button onclick="UI.showReactionPicker(event.clientX,event.clientY,emoji=>Messages._toggleReaction('${msg.id}',emoji))" class="w-6 h-6 rounded-lg flex items-center justify-center text-xs hover:bg-c-elev" style="color:#7A8FA8">😊</button>
          <button onclick="Messages._setReply('${msg.id}')" class="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-c-elev" style="color:#7A8FA8">↩</button>
        </div>` : ''}
      </div>`;
    return w;
  }

  // ── Send ───────────────────────────────────────────────────────
  async function send(convId) {
    const input  = document.getElementById('msg-input');
    const text   = input?.value.trim();
    if (!text && !_files.length) return;
    if (input) { input.value = ''; autoResize(input); }

    const cu = window._currentUser;
    const now = Date.now();
    const msgData = {
      conv_id:    convId,
      from:       cu.username,
      text:       text || '',
      type:       _files.length ? 'file' : 'text',
      status:     'sent',
      created_at: now,
    };
    if (_replyTo) { msgData.reply_to = _replyTo.id; msgData.reply_to_text = _replyTo.text; clearReply(); }
    if (_destruct) { msgData.destruct_at = now + parseInt(document.getElementById('destruct-time')?.value||'30') * 1000; }
    if (_files.length) {
      const f = _files[0];
      msgData.file_name = f.name; msgData.file_type = f.type; msgData.file_data = f.data;
      clearFiles();
    }

    const msg = await DB.createMessage(msgData);
    await DB.updateConversation(convId, { last_msg: text||'📎 Dosya', last_time: now });
    return msg;
  }

  // ── Voice recording ────────────────────────────────────────────
  async function startVoice() {
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
          const msg = await DB.createMessage({
            conv_id: convId, from: window._currentUser.username,
            type: 'voice', text: '', duration: dur,
            audio_data: reader.result,
            transcript: '', status: 'sent', created_at: Date.now()
          });
          await DB.updateConversation(convId, { last_msg: `🎙 ${dur}`, last_time: Date.now() });
          window._onNewMessage?.(msg);
        };
      };
      _recMR.start();
      _recSecs = 0;
      document.getElementById('voice-indicator')?.classList.remove('hidden');
      document.getElementById('voice-btn').style.color = '#FF3D6B';
      _recInt = setInterval(() => {
        _recSecs++;
        const el = document.getElementById('rec-timer');
        if (el) el.textContent = `0:${String(_recSecs).padStart(2,'0')}`;
      }, 1000);
    } catch { UI.toast('Mikrofon erişimi reddedildi', 'error'); }
  }

  function stopVoice() {
    if (_recMR?.state !== 'inactive') { _recMR?.stop(); }
    clearInterval(_recInt);
    document.getElementById('voice-indicator')?.classList.add('hidden');
    const btn = document.getElementById('voice-btn');
    if (btn) btn.style.color = '#7A8FA8';
  }

  // ── Self-destruct timer ────────────────────────────────────────
  function startDestructTimer(msg, convId) {
    const iv = setInterval(async () => {
      const rem = Math.max(0, Math.floor((msg.destruct_at - Date.now()) / 1000));
      const el = document.getElementById('dtimer-' + msg.id);
      if (el) el.textContent = rem + 's';
      if (rem <= 0) {
        clearInterval(iv);
        const msgEl = document.getElementById('msg-' + msg.id);
        if (msgEl) { msgEl.style.animation = 'destruct 1s ease-in forwards'; setTimeout(() => { msgEl.remove(); DB.deleteMessage(convId, msg.id); }, 1000); }
      }
    }, 1000);
  }

  // ── Reactions ──────────────────────────────────────────────────
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
    if (idx >= 0) msg.reactions[emoji].splice(idx, 1); else msg.reactions[emoji].push(window._currentUser.username);
    if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
    await DB.updateMessage(convId, msgId, { reactions: msg.reactions });
    window._onNewMessage?.();
  }

  // ── Context menu ───────────────────────────────────────────────
  function _ctxMenu(e, msgId, isMine) {
    e.preventDefault();
    const items = [
      { icon: '↩', label: 'Yanıtla',    action: `Messages._setReply('${msgId}')` },
      { icon: '📋', label: 'Kopyala',    action: `Messages._copy('${msgId}')` },
      { icon: '😊', label: 'Reaksiyon', action: `UI.showReactionPicker(${e.clientX},${e.clientY},emoji=>Messages._toggleReaction('${msgId}',emoji))` },
      'divider',
    ];
    if (isMine) {
      items.push({ icon: '✏️', label: 'Düzenle',   action: `Messages._openEdit('${msgId}')` });
      items.push({ icon: '↩', label: 'Geri Çek',  action: `Messages._recall('${msgId}')`, danger: true });
    }
    items.push({ icon: '🗑', label: 'Sil', action: `Messages._delete('${msgId}')`, danger: true });
    UI.showCtxMenu(e.clientX, e.clientY, items);
  }

  async function _setReply(msgId) {
    const convId = window._currentConvId;
    const msgs = await DB.getMessages(convId);
    _replyTo = msgs.find(m => m.id === msgId);
    if (!_replyTo) return;
    const bar = document.getElementById('reply-preview');
    if (bar) { bar.classList.remove('hidden'); bar.querySelector('#reply-text').textContent = _replyTo.text || '📎'; }
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
      const inp = document.getElementById('edit-input');
      if (inp) inp.value = m.text || '';
      UI.openModal('edit-modal');
    });
  }

  async function saveEdit() {
    const msgId = window._editingMsgId;
    const convId = window._currentConvId;
    if (!msgId || !convId) return;
    const text = document.getElementById('edit-input')?.value.trim();
    await DB.updateMessage(convId, msgId, { text, edited: true });
    UI.closeModal('edit-modal');
    window._onNewMessage?.();
  }

  async function _recall(msgId) {
    await DB.updateMessage(window._currentConvId, msgId, { text: '↩ Bu mesaj geri çekildi.', recalled: true, file_data: null });
    window._onNewMessage?.();
    UI.toast('Mesaj geri çekildi', 'info');
  }

  async function _delete(msgId) {
    await DB.deleteMessage(window._currentConvId, msgId);
    document.getElementById('msg-' + msgId)?.remove();
  }

  // ── File handling ──────────────────────────────────────────────
  function handleFiles(fileList) {
    _files = [];
    const bar = document.getElementById('file-preview-bar');
    if (!bar) return;
    bar.innerHTML = ''; bar.classList.remove('hidden');
    Array.from(fileList).forEach(file => {
      const r = new FileReader();
      r.readAsDataURL(file);
      r.onload = () => {
        _files.push({ name: file.name, type: file.type, data: r.result });
        const isImg = file.type.startsWith('image/');
        const div = document.createElement('div');
        div.className = 'flex items-center gap-2 px-3 py-2 rounded-xl mb-1';
        div.style.cssText = 'background:#0A1018;border:1px solid #1E2D45';
        div.innerHTML = `${isImg ? `<img src="${r.result}" class="w-8 h-8 rounded object-cover">` : '📄'}
          <span class="text-xs flex-1 truncate" style="color:#DDE8F8">${file.name}</span>
          <button onclick="Messages.clearFiles()" style="color:#7A8FA8">✕</button>`;
        bar.appendChild(div);
      };
    });
  }

  function clearFiles() {
    _files = [];
    const bar = document.getElementById('file-preview-bar');
    if (bar) { bar.innerHTML = ''; bar.classList.add('hidden'); }
    const fi = document.getElementById('file-input');
    if (fi) fi.value = '';
  }

  function toggleDestruct() {
    _destruct = !_destruct;
    document.getElementById('destruct-bar')?.classList.toggle('hidden', !_destruct);
    const btn = document.getElementById('destruct-btn');
    if (btn) btn.style.color = _destruct ? '#FF3D6B' : '#7A8FA8';
    if (_destruct) UI.toast('İmha modu aktif 💣', 'warn');
  }

  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  return {
    subscribe, renderAll, buildEl, send,
    startVoice, stopVoice, startDestructTimer, toggleDestruct,
    handleFiles, clearFiles, clearReply, saveEdit,
    _toggleReaction, _ctxMenu, _setReply, _copy, _openEdit, _recall, _delete,
    autoResize,
    getReplyTo: () => _replyTo,
    hasFiles:   () => _files.length > 0,
  };
})();

const Messages = (() => {
  let _replyTo=null, _destruct=false, _files=[], _recMR=null, _recInt=null, _recSecs=0;

  // ── Render all messages ─────────────────────────────────────────
  async function renderAll(convId, users, highlight='') {
    const msgs = await DB.getMessages(convId);
    const container = document.getElementById('messages');
    if (!container) return;
    const wasBottom = container.scrollHeight-container.scrollTop-container.clientHeight < 60;
    container.innerHTML='';
    let lastDate='';
    for (const msg of msgs) {
      const ds = new Date(msg.created_at).toLocaleDateString('tr-TR',{day:'numeric',month:'long'});
      if (ds!==lastDate) {
        lastDate=ds;
        const sep=document.createElement('div');
        sep.className='flex items-center gap-3 my-3';
        sep.innerHTML=`<div class="flex-1 h-px" style="background:#1E2D45"></div><span style="color:#7A8FA8;font-size:10px;font-family:'JetBrains Mono',monospace;white-space:nowrap">${ds}</span><div class="flex-1 h-px" style="background:#1E2D45"></div>`;
        container.appendChild(sep);
      }
      container.appendChild(buildEl(msg, users, highlight));
      if (msg.destruct_at) scheduleDestruct(msg, convId);
    }
    if (wasBottom || msgs.length < 5) container.scrollTop = container.scrollHeight;
    return msgs;
  }

  // ── Build single message bubble ─────────────────────────────────
  function buildEl(msg, users, highlight='') {
    const cu = window._currentUser;
    const isMine = msg.from === cu?.username;
    const sender = users[msg.from] || { username:msg.from, display_name:msg.from };
    const color = UI.avatarColor(sender.username);
    const timeStr = UI.fmtTime(msg.created_at);

    // Text with highlight
    let text = msg.text||'';
    if (highlight && text) {
      const re = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
      text = text.replace(re,'<mark style="background:rgba(0,255,179,.3);border-radius:2px;padding:0 1px">$1</mark>');
    }

    // Content by type
    let content = '';
    if (msg.recalled) {
      content = `<div style="color:#7A8FA8;font-style:italic;font-size:13px">↩ Bu mesaj geri çekildi</div>`;
    } else if (msg.type==='gif' && msg.gif_url) {
      content = `<div style="max-width:220px;border-radius:12px;overflow:hidden;margin-top:${text?'6px':'0'}">${text?`<div style="color:#DDE8F8;font-size:14px;margin-bottom:6px">${text}</div>`:''}<img src="${msg.gif_url}" alt="${msg.gif_title||'GIF'}" style="width:100%;border-radius:10px;display:block" loading="lazy"><div style="font-size:9px;color:#7A8FA8;margin-top:3px;font-family:'JetBrains Mono',monospace">GIF via GIPHY</div></div>`;
    } else if (msg.type==='sticker') {
      content = `<div style="font-size:56px;line-height:1;padding:4px 0">${msg.sticker||'😀'}</div>`;
    } else if (msg.type==='file' && msg.file_data) {
      if (msg.file_type?.startsWith('image/')) {
        content = `${text?`<div style="color:#DDE8F8;font-size:14px;margin-bottom:6px">${text}</div>`:''}<img src="${msg.file_data}" style="max-width:240px;max-height:200px;border-radius:10px;object-fit:cover;display:block" alt="${msg.file_name||''}">`;
      } else {
        content = `${text?`<div style="color:#DDE8F8;font-size:14px;margin-bottom:6px">${text}</div>`:''}<div style="display:flex;align-items:center;gap:8px;background:rgba(0,0,0,.3);border:1px solid #1E2D45;border-radius:10px;padding:8px 12px;margin-top:4px"><span style="font-size:20px">📄</span><div style="flex:1;min-width:0"><div style="color:#DDE8F8;font-size:12px;truncate">${msg.file_name||'Dosya'}</div></div><a href="${msg.file_data}" download="${msg.file_name||'file'}" style="color:#00FFB3;font-size:12px;white-space:nowrap">↓ İndir</a></div>`;
      }
    } else if (msg.type==='voice') {
      content = `<div style="display:flex;align-items:center;gap:8px;background:rgba(0,255,179,.08);border:1px solid rgba(0,255,179,.2);border-radius:10px;padding:8px 12px"><span style="color:#00FFB3">🎙</span><span style="color:#00FFB3;font-size:11px;font-family:'JetBrains Mono',monospace">${msg.duration||'0:00'}</span>${msg.audio_data?`<audio controls src="${msg.audio_data}" style="height:28px"></audio>`:''}</div>${msg.transcript?`<div style="color:#7A8FA8;font-size:11px;font-style:italic;margin-top:4px">"${msg.transcript}"</div>`:''}`;
    } else {
      content = text ? `<div style="color:#DDE8F8;font-size:14px;line-height:1.55">${text}</div>` : '';
    }

    // Reply preview
    const replyHtml = msg.reply_to_text
      ? `<div style="border-left:2px solid #00FFB3;padding:3px 8px;margin-bottom:6px;background:rgba(0,0,0,.2);border-radius:4px"><div style="color:#7A8FA8;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${msg.reply_to_text}</div></div>` : '';

    // Reactions
    let reactHtml='';
    if (msg.reactions && Object.keys(msg.reactions).length) {
      reactHtml='<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">';
      for (const [emoji,uids] of Object.entries(msg.reactions)) {
        const active=uids.includes(cu?.username);
        reactHtml+=`<button class="reaction-pill${active?' active':''}" onclick="Messages._toggleReaction('${msg.id}')" data-emoji="${emoji}">${emoji} ${uids.length}</button>`;
      }
      reactHtml+='</div>';
    }

    // Destruct timer display
    const destructHtml = msg.destruct_at ? `<span id="dtimer-${msg.id}" style="color:#FF3D6B;font-size:9px;font-family:'JetBrains Mono',monospace;margin-left:4px">●</span>` : '';
    const editedHtml = msg.edited ? `<span style="color:#7A8FA8;font-size:9px"> (düz.)</span>` : '';

    // Sticker/GIF gets no bubble background
    const isNoBubble = (msg.type==='sticker' || msg.type==='gif') && !msg.recalled;

    const w = document.createElement('div');
    w.id = 'msg-'+msg.id;
    w.className = `msg-row flex ${isMine?'justify-end':'justify-start'} group`;
    w.style.marginBottom = '3px';
    w.dataset.convId = msg.conv_id;

    const bubbleClass = isNoBubble ? '' : (isMine ? 'msg-bubble sent' : 'msg-bubble recv');
    const bubbleStyle = isNoBubble ? 'padding:4px 0' : '';

    w.innerHTML = `
      <div class="flex items-end gap-2 ${isMine?'flex-row-reverse':''}" style="max-width:min(72%,500px)">
        ${!isMine ? `<div class="self-end flex-shrink-0">
          ${sender.avatar_url
            ? `<img src="${sender.avatar_url}" class="w-7 h-7 rounded-full object-cover cursor-pointer" onclick="App.showProfile('${sender.username}')" style="margin-bottom:2px">`
            : `<div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold cursor-pointer" style="background:${color}22;color:${color};margin-bottom:2px" onclick="App.showProfile('${sender.username}')">${UI.initials(sender.display_name||sender.username)}</div>`}
        </div>` : ''}
        <div style="display:flex;flex-direction:column;${isMine?'align-items:flex-end':''}">
          ${!isMine && window._isGroup ? `<div style="color:${color};font-size:11px;font-weight:600;margin-bottom:2px;margin-left:4px;cursor:pointer" onclick="App.showProfile('${sender.username}')">${sender.display_name||sender.username}</div>` : ''}
          <div class="${bubbleClass}" style="${bubbleStyle}" oncontextmenu="Messages._ctx(event,'${msg.id}',${isMine})" ondblclick="UI.showReactionPicker(event.clientX,event.clientY,e=>Messages._toggleReaction('${msg.id}',e))">
            ${replyHtml}${content}
            ${!isNoBubble ? `<div style="display:flex;align-items:center;gap:3px;margin-top:5px;justify-content:${isMine?'flex-end':'flex-start'}">
              <span style="font-size:8px;color:#7A8FA8">🔒</span>
              <span style="color:#7A8FA8;font-size:9px;font-family:'JetBrains Mono',monospace">${timeStr}</span>
              ${editedHtml}${destructHtml}
              ${isMine?`<span style="color:${msg.status==='read'?'#00FFB3':'#7A8FA8'};font-size:10px">${msg.status==='read'?'✓✓':'✓'}</span>`:''}
            </div>` : `<div style="text-align:${isMine?'right':'left'};margin-top:2px"><span style="color:#7A8FA8;font-size:9px;font-family:'JetBrains Mono',monospace">${timeStr}</span></div>`}
          </div>
          ${reactHtml}
        </div>
        ${isMine ? `<div style="display:flex;flex-direction:column;gap:3px;opacity:0;padding-bottom:4px;align-self:flex-end" class="group-hover-btns">
          <button onclick="UI.showReactionPicker(event.clientX,event.clientY,e=>Messages._toggleReaction('${msg.id}',e))" style="width:22px;height:22px;border-radius:6px;background:#131D30;color:#7A8FA8;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center">😊</button>
          <button onclick="Messages._setReply('${msg.id}')" style="width:22px;height:22px;border-radius:6px;background:#131D30;color:#7A8FA8;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center">↩</button>
        </div>` : ''}
      </div>`;

    // Show hover buttons on hover
    w.addEventListener('mouseenter', () => { w.querySelector('.group-hover-btns')?.style.setProperty('opacity','1'); });
    w.addEventListener('mouseleave', () => { w.querySelector('.group-hover-btns')?.style.setProperty('opacity','0'); });

    return w;
  }

  // ── Send text/file ──────────────────────────────────────────────
  async function send(convId) {
    const input = document.getElementById('msg-input');
    const text = input?.value.trim();
    if (!text && !_files.length) return;
    if (input) { input.value=''; autoResize(input); }

    const cu = window._currentUser;
    const now = Date.now();
    const data = { conv_id:convId, from:cu.username, text, type:'text', status:'sent', created_at:now };
    if (_replyTo) { data.reply_to=_replyTo.id; data.reply_to_text=_replyTo.text||'📎'; clearReply(); }
    if (_destruct) data.destruct_at = now + parseInt(document.getElementById('destruct-time')?.value||'30')*1000;
    if (_files.length) {
      const f=_files[0]; data.type='file'; data.file_name=f.name; data.file_type=f.type; data.file_data=f.data; clearFiles();
    }

    const msg = await DB.createMessage(data);
    await DB.updateConversation(convId, { last_msg:text||'📎 Dosya', last_time:now });
    return msg;
  }

  // ── Send GIF ────────────────────────────────────────────────────
  async function sendGif(convId, gifUrl, gifTitle) {
    const cu = window._currentUser;
    const msg = await DB.createMessage({ conv_id:convId, from:cu.username, text:'', type:'gif', gif_url:gifUrl, gif_title:gifTitle, status:'sent', created_at:Date.now() });
    await DB.updateConversation(convId, { last_msg:'GIF 🎬', last_time:Date.now() });
    return msg;
  }

  // ── Send Sticker ────────────────────────────────────────────────
  async function sendSticker(convId, sticker) {
    const cu = window._currentUser;
    const msg = await DB.createMessage({ conv_id:convId, from:cu.username, text:'', type:'sticker', sticker, status:'sent', created_at:Date.now() });
    await DB.updateConversation(convId, { last_msg:`Sticker ${sticker}`, last_time:Date.now() });
    return msg;
  }

  // ── Voice ───────────────────────────────────────────────────────
  async function startVoice() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:true});
      _recMR = new MediaRecorder(stream); const chunks=[];
      _recMR.ondataavailable = e => chunks.push(e.data);
      _recMR.onstop = async () => {
        stream.getTracks().forEach(t=>t.stop());
        const blob = new Blob(chunks,{type:'audio/webm'});
        const r = new FileReader(); r.readAsDataURL(blob);
        r.onload = async () => {
          const convId = window._currentConvId;
          if (!convId) return;
          const dur = `0:${String(_recSecs).padStart(2,'0')}`;
          await DB.createMessage({ conv_id:convId, from:window._currentUser.username, type:'voice', text:'', duration:dur, audio_data:r.result, transcript:'', status:'sent', created_at:Date.now() });
          await DB.updateConversation(convId, { last_msg:`🎙 ${dur}`, last_time:Date.now() });
          window._onNewMessage?.();
        };
      };
      _recMR.start(); _recSecs=0;
      document.getElementById('voice-indicator')?.classList.remove('hidden');
      document.getElementById('voice-btn').style.color='#FF3D6B';
      _recInt = setInterval(()=>{ _recSecs++; const el=document.getElementById('rec-timer'); if(el)el.textContent=`0:${String(_recSecs).padStart(2,'0')}`; },1000);
    } catch { UI.toast('Mikrofon erişimi reddedildi','error'); }
  }

  function stopVoice() {
    if (_recMR?.state!=='inactive') _recMR?.stop();
    clearInterval(_recInt);
    document.getElementById('voice-indicator')?.classList.add('hidden');
    const btn=document.getElementById('voice-btn'); if(btn)btn.style.color='#7A8FA8';
  }

  // ── Self-destruct ───────────────────────────────────────────────
  function scheduleDestruct(msg, convId) {
    const iv = setInterval(async()=>{
      const rem = Math.max(0,Math.floor((msg.destruct_at-Date.now())/1000));
      const el = document.getElementById('dtimer-'+msg.id);
      if(el) el.textContent=rem+'s';
      if(rem<=0){
        clearInterval(iv);
        const msgEl=document.getElementById('msg-'+msg.id);
        if(msgEl){ msgEl.style.animation='destruct 1s ease-in forwards'; setTimeout(()=>{ msgEl.remove(); DB.deleteMessage(convId,msg.id); },1000); }
      }
    },1000);
  }

  // ── Reactions ───────────────────────────────────────────────────
  async function _toggleReaction(msgId, emoji) {
    UI.hideReactionPicker();
    const convId=window._currentConvId; if(!convId)return;
    const msgs=await DB.getMessages(convId);
    const msg=msgs.find(m=>m.id===msgId); if(!msg)return;
    if(!msg.reactions)msg.reactions={};
    if(!msg.reactions[emoji])msg.reactions[emoji]=[];
    const idx=msg.reactions[emoji].indexOf(window._currentUser.username);
    if(idx>=0)msg.reactions[emoji].splice(idx,1); else msg.reactions[emoji].push(window._currentUser.username);
    if(!msg.reactions[emoji].length)delete msg.reactions[emoji];
    await DB.updateMessage(convId,msgId,{reactions:msg.reactions});
    window._onNewMessage?.();
  }

  // ── Context menu ────────────────────────────────────────────────
  function _ctx(e,msgId,isMine){
    e.preventDefault();
    const items=[
      {icon:'↩',label:'Yanıtla',action:`Messages._setReply('${msgId}')`},
      {icon:'📋',label:'Kopyala',action:`Messages._copy('${msgId}')`},
      {icon:'😊',label:'Reaksiyon',action:`UI.showReactionPicker(${e.clientX},${e.clientY},em=>Messages._toggleReaction('${msgId}',em))`},
      'divider',
    ];
    if(isMine){
      items.push({icon:'✏️',label:'Düzenle',action:`Messages._openEdit('${msgId}')`});
      items.push({icon:'↩',label:'Geri Çek',action:`Messages._recall('${msgId}')`,danger:true});
    }
    items.push({icon:'🗑',label:'Sil',action:`Messages._delete('${msgId}')`,danger:true});
    UI.showCtxMenu(e.clientX,e.clientY,items);
  }

  async function _setReply(msgId){
    const msgs=await DB.getMessages(window._currentConvId);
    _replyTo=msgs.find(m=>m.id===msgId); if(!_replyTo)return;
    const bar=document.getElementById('reply-preview');
    if(bar){bar.classList.remove('hidden');document.getElementById('reply-text').textContent=_replyTo.text||'📎';}
    document.getElementById('msg-input')?.focus();
  }
  function clearReply(){ _replyTo=null; document.getElementById('reply-preview')?.classList.add('hidden'); }

  async function _copy(msgId){
    const msgs=await DB.getMessages(window._currentConvId);
    const m=msgs.find(x=>x.id===msgId);
    if(m?.text)navigator.clipboard.writeText(m.text).then(()=>UI.toast('Kopyalandı ✓','success'));
  }
  function _openEdit(msgId){
    DB.getMessages(window._currentConvId).then(msgs=>{
      const m=msgs.find(x=>x.id===msgId); if(!m)return;
      window._editingMsgId=msgId;
      const inp=document.getElementById('edit-input'); if(inp)inp.value=m.text||'';
      UI.openModal('edit-modal');
    });
  }
  async function saveEdit(){
    const msgId=window._editingMsgId, convId=window._currentConvId;
    if(!msgId||!convId)return;
    const text=document.getElementById('edit-input')?.value.trim();
    await DB.updateMessage(convId,msgId,{text,edited:true});
    UI.closeModal('edit-modal'); window._onNewMessage?.();
  }
  async function _recall(msgId){
    await DB.updateMessage(window._currentConvId,msgId,{text:'',recalled:true,type:'text',file_data:null,gif_url:null,sticker:null});
    window._onNewMessage?.(); UI.toast('Mesaj geri çekildi','info');
  }
  async function _delete(msgId){
    await DB.deleteMessage(window._currentConvId,msgId);
    document.getElementById('msg-'+msgId)?.remove();
  }

  // ── File ────────────────────────────────────────────────────────
  function handleFiles(fl){
    _files=[];
    const bar=document.getElementById('file-preview-bar');
    if(!bar)return;
    bar.innerHTML=''; bar.classList.remove('hidden');
    Array.from(fl).forEach(file=>{
      const r=new FileReader(); r.readAsDataURL(file);
      r.onload=()=>{
        _files.push({name:file.name,type:file.type,data:r.result});
        const isImg=file.type.startsWith('image/');
        const div=document.createElement('div');
        div.className='flex items-center gap-2 px-3 py-2 rounded-xl mb-1';
        div.style.cssText='background:#0A1018;border:1px solid #1E2D45';
        div.innerHTML=`${isImg?`<img src="${r.result}" class="w-8 h-8 rounded object-cover">`:'<span style="font-size:20px">📄</span>'}<span class="text-xs flex-1 truncate" style="color:#DDE8F8">${file.name}</span><button onclick="Messages.clearFiles()" style="color:#7A8FA8">✕</button>`;
        bar.appendChild(div);
      };
    });
  }
  function clearFiles(){
    _files=[]; const bar=document.getElementById('file-preview-bar');
    if(bar){bar.innerHTML='';bar.classList.add('hidden');}
    const fi=document.getElementById('file-input'); if(fi)fi.value='';
  }

  function toggleDestruct(){
    _destruct=!_destruct;
    document.getElementById('destruct-bar')?.classList.toggle('hidden',!_destruct);
    const btn=document.getElementById('destruct-btn');
    if(btn)btn.style.color=_destruct?'#FF3D6B':'#7A8FA8';
    if(_destruct)UI.toast('İmha modu aktif 💣','warn');
  }

  function autoResize(el){
    el.style.height='auto';
    el.style.height=Math.min(el.scrollHeight,120)+'px';
  }

  return {
    renderAll, buildEl, send, sendGif, sendSticker, startVoice, stopVoice,
    scheduleDestruct, toggleDestruct, handleFiles, clearFiles, clearReply, saveEdit,
    _toggleReaction, _ctx, _setReply, _copy, _openEdit, _recall, _delete, autoResize,
    getReplyTo:()=>_replyTo, hasFiles:()=>_files.length>0,
  };
})();

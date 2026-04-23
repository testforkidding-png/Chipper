/**
 * CIPHER Messages v7 — Clean rewrite
 */
const Messages = (() => {
  // ── State ─────────────────────────────────────────────────────
  const _store = {}; // convId → {msgs:[]}
  let _replyTo=null, _destruct=false, _destructSecs=30;
  let _files=[], _rec=null, _recInt=null, _recSecs=0;
  let _gifOpen=false, _stickerOpen=false, _activePack=null;
  let _gifCache=null, _gifLoading=false, _gifResults=[];

  const _getStore = id => { if(!_store[id])_store[id]={msgs:[]}; return _store[id]; };
  const _findMsg  = (cid,mid) => _store[cid]?.msgs.find(m=>m.id===mid);

  // ── Subscribe ─────────────────────────────────────────────────
  function subscribeConv(convId) {
    if (window._realtimeSub) { try{DB.unsubscribe(window._realtimeSub);}catch{} window._realtimeSub=null; }
    if (window._pollInterval)  { clearInterval(window._pollInterval); window._pollInterval=null; }
    if (CONFIG.USE_SUPABASE && !window._supabaseNotConfigured) {
      try { window._realtimeSub = DB.subscribeMessages(convId, () => window._onNewMessage?.()); }
      catch(e) { console.warn('subscribe:', e); }
    } else {
      window._pollInterval = setInterval(() => { if(window._currentConvId===convId&&!document.hidden) window._onNewMessage?.(); }, 3000);
    }
  }

  // ── Render ────────────────────────────────────────────────────
  async function renderAll(convId, users, highlight='') {
    const msgs = await DB.getMessages(convId);
    const store = _getStore(convId);
    // Skip re-render if messages unchanged (count + last id + reactions + edits)
    const lastMsgNew = msgs[msgs.length-1];
    const newHashKey = msgs.length + '_' + (lastMsgNew?.id||'') + '_' + (lastMsgNew?.reactions?JSON.stringify(lastMsgNew.reactions):'') + (lastMsgNew?.recalled?'r':'') + (lastMsgNew?.edited?'e':'');
    if (!highlight && store._lastHash === newHashKey) return;
    store.msgs = msgs;
    store._lastHash = newHashKey;
    const container = document.getElementById('messages'); if(!container) return;
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 100;
    const prevH = container.scrollHeight;

    const frag = document.createDocumentFragment();
    let lastDate='';
    for (const msg of msgs) {
      const ds = _ds(msg.created_at);
      if (ds !== lastDate) { lastDate=ds; frag.appendChild(_dateSep(ds)); }
      frag.appendChild(buildEl(msg, users, highlight));
      if (msg.destruct_at && msg.destruct_at > Date.now()) _startDestruct(msg, convId);
    }
    container.innerHTML = ''; container.appendChild(frag);
    if (atBottom || msgs.length <= 5) {
      if (msgs.length > 5 && atBottom) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      else container.scrollTop = container.scrollHeight;
    }
    else container.scrollTop = container.scrollHeight - prevH + container.scrollTop;

    // Pin banner
    _renderPinBanner(convId);
  }

  function _ds(ts) { return new Date(UI._ms(ts)).toLocaleDateString('tr-TR',{day:'numeric',month:'long'}); }
  function _dateSep(ds) {
    const d=document.createElement('div'); d.dataset.dateSep=ds;
    d.style.cssText='display:flex;align-items:center;gap:10px;margin:14px 0 10px;user-select:none;flex-shrink:0';
    d.innerHTML=`<div style="flex:1;height:1px;background:#1E2D45"></div><span style="font-size:10px;padding:2px 12px;color:#7A8FA8;font-family:'JetBrains Mono',monospace;white-space:nowrap;background:#06080F;border-radius:20px;border:1px solid #1E2D45">${ds}</span><div style="flex:1;height:1px;background:#1E2D45"></div>`;
    return d;
  }

  // ── Build element ─────────────────────────────────────────────
  function buildEl(msg, users, highlight='') {
    const cu = window._currentUser;
    const isMine = msg.from === cu?.username;
    const sender = (users||window._allUsers||{})[msg.from] || { username:msg.from, display_name:msg.from };
    const color = UI.avatarColor(sender.username);
    const recalled = !!msg.recalled;

    // HTML escape for untrusted user content in innerHTML
    const _e = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    // Markdown render
    function _md(t) {
      return String(t)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/```([\s\S]*?)```/g,'<code style="display:block;background:#06080F;border:1px solid #1E2D45;border-radius:8px;padding:8px 12px;font-family:\'JetBrains Mono\',monospace;font-size:12px;white-space:pre-wrap;margin:4px 0">$1</code>')
        .replace(/`([^`]+)`/g,'<code style="background:#06080F;border:1px solid #1E2D45;border-radius:4px;padding:1px 5px;font-family:\'JetBrains Mono\',monospace;font-size:12px">$1</code>')
        .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g,'<em>$1</em>')
        .replace(/~~([^~]+)~~/g,'<s>$1</s>')
        .replace(/\n/g,'<br>')
        // 4. Linkify — must run after HTML escape
        .replace(/(https?:\/\/[^\s<>"]+)/g, function(url) {
          var clean = url.replace(/[.,;:!?\)\]]+$/, '');
          var trail = url.slice(clean.length);
          var short = clean.length > 45 ? clean.slice(0,45) + '\u2026' : clean;
          return '<a href="' + clean + '" target="_blank" rel="noopener noreferrer" style="color:#00FFB3;text-decoration:underline;word-break:break-all">' + short + '</a>' + trail;
        });
    }

    let text = recalled ? '↩ Bu mesaj geri çekildi.' : (msg.text||'');
    if (highlight && text && !recalled) {
      const re=new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
      text = text.replace(re,'<mark style="background:rgba(0,255,179,.3);border-radius:2px;padding:0 1px">$1</mark>');
    }

    // Content
    let contentHtml = '';
    if (!recalled) {
      if (msg.type==='poll' && msg.poll_data) {
        try {
          const poll = JSON.parse(msg.poll_data);
          const total = Object.values(poll.votes||{}).reduce((s,v)=>s+v.length,0);
          const myVote = Object.entries(poll.votes||{}).find(([,v])=>v.includes(cu?.username))?.[0];
          contentHtml = `<div style="margin-top:4px">
            <div style="font-size:13px;font-weight:600;color:#DDE8F8;margin-bottom:8px">${poll.question}</div>
            ${(poll.options||[]).map(opt=>{
              const cnt=(poll.votes?.[opt]||[]).length;
              const pct=total?Math.round(cnt/total*100):0;
              const active=myVote===opt;
              return `<button onclick="votePoll('${msg.id}','${opt.replace(/'/g,"&#39;")}')" style="width:100%;margin-bottom:5px;padding:8px 12px;border-radius:8px;border:1.5px solid ${active?'var(--accent,#00FFB3)':'#1E2D45'};background:${active?'rgba(0,255,179,.08)':'transparent'};cursor:pointer;text-align:left;position:relative;overflow:hidden">
                <div style="position:absolute;left:0;top:0;bottom:0;width:${pct}%;background:rgba(0,255,179,.07);pointer-events:none"></div>
                <div style="position:relative;display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;color:${active?'var(--accent,#00FFB3)':'#DDE8F8'}">${_e(opt)}</span><span style="font-size:11px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">${pct}%</span></div>
              </button>`;
            }).join('')}
            <div style="font-size:10px;color:#5A6E88;font-family:'JetBrains Mono',monospace">${total} oy</div>
          </div>`;
        } catch{ contentHtml='<div style="color:#FF3D6B;font-size:12px">Anket yüklenemedi</div>'; }
      } else if (msg.type==='gif' && msg.gif_url) {
        contentHtml = '<img src="' + (msg.gif_url||'') + '" data-lightbox="1" style="max-width:220px;max-height:180px;border-radius:10px;display:block;margin-top:4px;cursor:pointer;object-fit:cover" loading="lazy">';
      } else if (msg.type==='sticker' && msg.sticker) {
        contentHtml=`<div style="font-size:52px;line-height:1;padding:4px 0">${msg.sticker}</div>`;
      } else if (msg.type==='file' && msg.file_data) {
        if (msg.file_type?.startsWith('image/')) {
          contentHtml=`<img src="${msg.file_data}" style="max-width:220px;max-height:180px;border-radius:10px;display:block;margin-top:4px;cursor:pointer" onclick="Messages._lightbox('${msg.file_data}')">`;
        } else {
          contentHtml=`<div style="display:flex;align-items:center;gap:8px;margin-top:6px;padding:8px 12px;border-radius:10px;background:rgba(0,0,0,.25);border:1px solid #1E2D45"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00FFB3" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span style="font-size:12px;color:#DDE8F8;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${msg.file_name||'Dosya'}</span><a href="${msg.file_data}" download="${msg.file_name||'file'}" style="font-size:12px;color:#00FFB3;text-decoration:none">↓</a></div>`;
        }
      } else if (msg.type==='voice' && msg.audio_data) {
        contentHtml=`<div style="display:flex;align-items:center;gap:8px;margin-top:4px;padding:8px 12px;border-radius:10px;background:rgba(0,255,179,.07);border:1px solid rgba(0,255,179,.18)"><span style="color:#00FFB3;font-size:16px">🎙</span><audio controls src="${msg.audio_data}" style="height:28px;flex:1;min-width:100px;accent-color:#00FFB3"></audio><span style="font-size:10px;color:#00FFB3;font-family:'JetBrains Mono',monospace">${msg.duration||'0:00'}</span></div>`;
      }
    }

    const safeText = recalled ? text : (text ? _md(text) : '');
    const textHtml = safeText ? `<div style="font-size:14px;line-height:1.55;color:${recalled?'#7A8FA8':'#DDE8F8'};word-break:break-word${recalled?';font-style:italic':''}">${safeText}</div>` : '';
    const replyHtml = msg.reply_to_text ? `<div style="margin-bottom:5px;padding:4px 8px;border-radius:7px;border-left:2px solid #00FFB3;background:rgba(0,0,0,.22);font-size:11px;color:#7A8FA8;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${msg.reply_to_text}</div>` : '';

    let reactHtml = '';
    if (msg.reactions && Object.keys(msg.reactions).length) {
      reactHtml = '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:5px">';
      for (const [emoji,uids] of Object.entries(msg.reactions)) {
        if (!uids?.length) continue;
        const active = uids.includes(cu?.username);
        reactHtml += `<button class="reaction-pill${active?' active':''}" data-msgid="${msg.id}" data-emoji="${emoji}">${emoji} ${uids.length}</button>`;
      }
      reactHtml += '</div>';
    }

    const timeStr = UI.fmtTime(msg.created_at);
    const metaHtml = `<div style="display:flex;align-items:center;gap:1px;margin-top:4px;${isMine?'justify-content:flex-end':''}">
      <span style="font-size:9px;color:#3A4A5A">🔒</span>
      <span style="font-size:10px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">${timeStr}</span>
      ${msg.edited?'<span style="font-size:9px;color:#7A8FA8"> (düz)</span>':''}
      ${isMine?`<span style="font-size:10px;color:${msg.status==='read'?'#00FFB3':'#7A8FA8'}">${msg.status==='read'?' ✓✓':' ✓'}</span>`:''}
    </div>`;

    const noBubble = msg.type==='sticker' && !recalled;
    const bubStyle = noBubble ? 'background:transparent;border:none;padding:4px 8px' : `padding:9px 13px;border-radius:${isMine?'18px 18px 4px 18px':'18px 18px 18px 4px'}`;
    const senderName = (!isMine && window._isGroup) ? `<div style="font-size:11px;font-weight:600;color:${color};margin-bottom:2px;cursor:pointer;font-family:Syne,sans-serif" onclick="window.showProfile?.('${_e(sender.username)}')">${_e(sender.display_name||sender.username)}</div>` : '';
    const avatarHtml = !isMine ? (sender.avatar_url ? `<img src="${sender.avatar_url}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;cursor:pointer;flex-shrink:0;align-self:flex-end" onclick="window.showProfile?.('${sender.username}')" loading="lazy">` : `<div onclick="window.showProfile?.('${sender.username}')" style="width:28px;height:28px;min-width:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;align-self:flex-end;cursor:pointer;background:${color}22;color:${color};font-family:Syne,sans-serif">${UI.initials(sender.display_name||sender.username)}</div>`) : '';

    const w = document.createElement('div');
    w.id='msg-'+msg.id; w.dataset.msgId=msg.id; w.dataset.isMine=isMine?'1':'0';
    w.style.cssText=`display:flex;${isMine?'justify-content:flex-end':'justify-content:flex-start'};margin-bottom:3px;flex-shrink:0`;
    // Hassas içerik
    const isSensitive = !!msg.sensitive;
    const bubbleInner = `${replyHtml}${textHtml}${contentHtml}${metaHtml}`;
    const bubbleContent = isSensitive
      ? `<div style="position:relative"><div class="sensitive-overlay" style="position:absolute;inset:0;border-radius:10px;background:rgba(10,16,24,.88);backdrop-filter:blur(4px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;z-index:2" onclick="this.remove()"><span style="font-size:14px">⚠️</span><span style="font-size:11px;color:#FFA535;font-weight:600;font-family:'JetBrains Mono',monospace">Hassas içerik</span><span style="font-size:10px;color:#7A8FA8">Görmek için tıkla</span></div>${bubbleInner}</div>`
      : bubbleInner;
    w.innerHTML=`<div style="display:flex;align-items:flex-end;gap:6px;max-width:78%;${isMine?'flex-direction:row-reverse':''}">
      ${!isMine?avatarHtml:''}
      <div style="min-width:0">${senderName}
        <div class="${noBubble?'':'msg-bubble '+(isMine?'sent':'recv')}" style="${bubStyle};cursor:pointer" data-msgid="${msg.id}" data-ismine="${isMine?'1':'0'}">
          ${bubbleContent}
        </div>${reactHtml}
      </div>
    </div>`;
    return w;
  }

  // ── Lightbox ──────────────────────────────────────────────────
  function _lightbox(src) {
    // Validate src is a safe URL (data: or https:)
    if (!src || (!src.startsWith('data:') && !src.startsWith('https://') && !src.startsWith('http://'))) return;
    document.getElementById('cipher-lb')?.remove();
    const lb=document.createElement('div'); lb.id='cipher-lb';
    lb.style.cssText='position:fixed;inset:0;z-index:9000;background:rgba(6,8,15,.96);display:flex;align-items:center;justify-content:center;cursor:zoom-out';
    lb.onclick=e=>{if(e.target===lb)lb.remove();};
    const img=document.createElement('img');
    img.src=src; img.style.cssText='max-width:92vw;max-height:92vh;border-radius:12px;object-fit:contain';
    const closeBtn=document.createElement('button');
    closeBtn.style.cssText='position:fixed;top:16px;right:16px;width:36px;height:36px;border-radius:50%;background:#1E2D45;color:#DDE8F8;border:none;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center';
    closeBtn.textContent='✕'; closeBtn.onclick=()=>lb.remove();
    lb.appendChild(img); lb.appendChild(closeBtn);
    document.body.appendChild(lb);
  }

  // ── Send (optimistic) ─────────────────────────────────────────
  async function send(convId) {
    const input = document.getElementById('msg-input');
    const text = (input?.value||'').trim();
    if ((!text || text.length > 4000) && !_files.length) return; // max 4000 chars
    if (input){input.value='';autoResize(input);}
    closeAllPickers();

    const cu=window._currentUser, now=Date.now(), tmpId='tmp_'+now;
    const base={id:tmpId,conv_id:convId,from:cu.username,status:'sent',created_at:now};
    if(_replyTo){base.reply_to=_replyTo.id;base.reply_to_text=_replyTo.text||'📎';clearReply();}
    if(_destruct)base.destruct_at=now+_destructSecs*1000;

    // Optimistic DOM
    const optMsg={...base,type:_files.length?'file':'text',text:_files.length?(_files[0].name):text};
    _getStore(convId).msgs.push(optMsg);
    const container=document.getElementById('messages');
    if(container&&window._currentConvId===convId){container.appendChild(buildEl(optMsg,window._allUsers||{}));container.scrollTop=container.scrollHeight;}

    try {
      const payload={...base}; delete payload.id;
      const convUpd={last_msg:text||'📎',last_time:now,last_from:cu.username};
      let dbMsg;
      if (_files.length) {
        const f=_files[0];
        [dbMsg]=await Promise.all([DB.createMessage({...payload,type:'file',text:text||'',file_name:f.name,file_type:f.type,file_data:f.data}),DB.updateConversation(convId,convUpd)]);
        clearFiles();
      } else {
        [dbMsg]=await Promise.all([DB.createMessage({...payload,type:'text',text}),DB.updateConversation(convId,convUpd)]);
      }
      // Replace temp
      const store=_getStore(convId), idx=store.msgs.findIndex(m=>m.id===tmpId);
      if(idx>=0)store.msgs[idx]=dbMsg;
      document.getElementById('msg-'+tmpId)?.replaceWith(buildEl(dbMsg,window._allUsers||{}));
      // Update conv memory
      if(window._convs){const ci=window._convs.findIndex(c=>c.id===convId);if(ci>=0)Object.assign(window._convs[ci],convUpd);}
      if(typeof renderChatList==='function')renderChatList();
    } catch(e) {
      console.error('send:', e);
      UI.toast('Gönderilemedi: '+(e.message||e),'error');
      _getStore(convId).msgs=_getStore(convId).msgs.filter(m=>m.id!==tmpId);
      document.getElementById('msg-'+tmpId)?.remove();
      if(input&&text){input.value=text;autoResize(input);}
    }
  }

  async function sendGif(convId,gifUrl,gifTitle){
    const cu=window._currentUser,now=Date.now();
    try{const[m]=await Promise.all([DB.createMessage({conv_id:convId,from:cu.username,type:'gif',text:'',gif_url:gifUrl,gif_title:gifTitle||'GIF',status:'sent',created_at:now}),DB.updateConversation(convId,{last_msg:'🎬 GIF',last_time:now,last_from:cu.username})]);_getStore(convId).msgs.push(m);closeAllPickers();window._onNewMessage?.();}catch(e){UI.toast('GIF gönderilemedi','error');}
  }
  async function sendSticker(convId,sticker){
    const cu=window._currentUser,now=Date.now();
    try{const[m]=await Promise.all([DB.createMessage({conv_id:convId,from:cu.username,type:'sticker',text:'',sticker,status:'sent',created_at:now}),DB.updateConversation(convId,{last_msg:sticker+' Sticker',last_time:now,last_from:cu.username})]);_getStore(convId).msgs.push(m);closeAllPickers();window._onNewMessage?.();}catch(e){UI.toast('Sticker gönderilemedi','error');}
  }

  // ── GIF ───────────────────────────────────────────────────────
  function toggleGif(){_gifOpen=!_gifOpen;_stickerOpen=false;document.getElementById('gif-picker')?.classList.toggle('open',_gifOpen);document.getElementById('sticker-picker')?.classList.remove('open');if(_gifOpen){const cacheAge=Date.now()-(_gifCacheTs||0);if(_gifCache&&cacheAge<300000){_gifResults=_gifCache;renderGifs();}else searchGifs('');}}
  // Tenor API helper (free, no quota issues)
  async function _fetchTenor(q) {
    const key = CONFIG.TENOR_KEY || 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCyk';
    // Tenor API v2 — mediafilter (no comma, use 'gif' only for stability)
    const base = q
      ? 'https://tenor.googleapis.com/v2/search?q=' + encodeURIComponent(q) + '&key=' + key + '&limit=20&mediafilter=gif&locale=tr_TR&contentfilter=medium'
      : 'https://tenor.googleapis.com/v2/featured?key=' + key + '&limit=20&mediafilter=gif&locale=tr_TR&contentfilter=medium';
    const res = await fetch(base);
    if (!res.ok) throw new Error('Tenor HTTP ' + res.status);
    const json = await res.json();
    return (json.results || []).map(r => {
      const gifUrl = r.media_formats?.gif?.url || r.media_formats?.tinygif?.url || '';
      const smallUrl = r.media_formats?.tinygif?.url || gifUrl;
      return {
        id: r.id,
        title: r.content_description || r.title || '',
        images: {
          fixed_height_small: { url: smallUrl },
          fixed_height:        { url: gifUrl },
          original:            { url: gifUrl },
        }
      };
    });
  }

  async function searchGifs(q=''){
    if(_gifLoading)return; _gifLoading=true;
    const grid=document.getElementById('gif-grid');if(!grid){_gifLoading=false;return;}
    _gifResults=[];
    // Skeleton loading
    grid.innerHTML=Array(6).fill('<div style="border-radius:10px;aspect-ratio:1;background:linear-gradient(90deg,#0C1220 0%,#1A2535 50%,#0C1220 100%);background-size:200% 100%;animation:shimmer 1.4s ease-in-out infinite"></div>').join('');
    try{
      _gifResults = await _fetchTenor(q);
      if(!q){_gifCache=_gifResults;_gifCacheTs=Date.now();}
      renderGifs();
    }catch(e1){
      console.warn('[GIF] Tenor failed:', e1.message);
      // Fallback: Giphy
      try{
        const qs=q
          ?`search?api_key=${CONFIG.GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=18&rating=pg`
          :`trending?api_key=${CONFIG.GIPHY_API_KEY}&limit=18&rating=pg`;
        const res=await fetch('https://api.giphy.com/v1/gifs/'+qs);
        if(!res.ok)throw new Error('Giphy HTTP '+res.status);
        const json=await res.json();
        _gifResults=(json.data||[]).map(g=>({
          id:g.id, title:g.title||'',
          images:{
            fixed_height_small:{url:g.images?.fixed_height_small?.url||g.images?.downsized?.url||''},
            fixed_height:{url:g.images?.fixed_height?.url||g.images?.original?.url||''},
            original:{url:g.images?.original?.url||''},
          }
        }));
        if(!q){_gifCache=_gifResults;_gifCacheTs=Date.now();}
        renderGifs();
      }catch(e2){
        console.warn('[GIF] Giphy also failed:', e2.message);
        if(grid)grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:24px;color:#FF3D6B;font-size:12px;font-family:\'JetBrains Mono\',monospace">⚠️ GIF yüklenemedi<br><span style="color:#7A8FA8;font-size:11px">İnternet bağlantısını kontrol et</span></div>';
      }
    }
    _gifLoading=false;
  }
  function renderGifs(){
    const grid=document.getElementById('gif-grid');if(!grid)return;
    if(!_gifResults.length){grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:20px;color:#7A8FA8;font-size:13px">Sonuç bulunamadı</div>';return;}
    const frag=document.createDocumentFragment();
    _gifResults.forEach(g=>{
      const url=g.images?.fixed_height_small?.url||g.images?.fixed_height?.url||g.images?.downsized?.url||g.images?.original?.url;
      if(!url||url.trim()==='')return; // skip empty URLs
      const previewUrl=g.images?.fixed_height_still?.url||url; // static preview while loading
      const div=document.createElement('div');
      div.className='gif-item';
      div.style.cssText='position:relative;border-radius:12px;overflow:hidden;background:#0C1220;border:1px solid #1E2D45;cursor:pointer;transition:transform .1s,border-color .1s;aspect-ratio:1';
      div.onmouseenter=()=>{div.style.transform='scale(1.03)';div.style.borderColor='var(--accent,#00FFB3)';};
      div.onmouseleave=()=>{div.style.transform='scale(1)';div.style.borderColor='#1E2D45';};
      const img=document.createElement('img');
      // Use static preview first, swap to animated on load
      img.src=url;
      img.alt=(g.title||'GIF').slice(0,40);
      img.decoding='async';
      img.style.cssText='width:100%;height:100%;object-fit:cover;display:block';
      img.onerror=()=>{div.style.display='none';}; // hide broken GIFs
      div.appendChild(img);
      // Support both click and touch
      const send=()=>{if(window._currentConvId)sendGif(window._currentConvId,url,g.title);};
      div.onclick=send;
      frag.appendChild(div);
    });
    grid.innerHTML='';grid.appendChild(frag);
  }

  // ── Stickers ──────────────────────────────────────────────────
  function toggleSticker(){_stickerOpen=!_stickerOpen;_gifOpen=false;document.getElementById('sticker-picker')?.classList.toggle('open',_stickerOpen);document.getElementById('gif-picker')?.classList.remove('open');if(_stickerOpen){if(!_activePack)_activePack=Object.keys(CONFIG.STICKER_PACKS)[0];renderStickerPack(_activePack);}}
  function renderStickerPack(pack){_activePack=pack;document.querySelectorAll('.sticker-pack-tab').forEach(t=>t.classList.toggle('active',t.textContent.trim()===pack));const grid=document.getElementById('sticker-grid');if(!grid)return;const frag=document.createDocumentFragment();(CONFIG.STICKER_PACKS[pack]||[]).forEach(s=>{const btn=document.createElement('button');btn.className='sticker-btn';btn.textContent=s;btn.onclick=()=>{if(window._currentConvId)sendSticker(window._currentConvId,s);};frag.appendChild(btn);});grid.innerHTML='';grid.appendChild(frag);}
  function closeAllPickers(){_gifOpen=false;_stickerOpen=false;document.getElementById('gif-picker')?.classList.remove('open');document.getElementById('sticker-picker')?.classList.remove('open');}

  // ── Voice ─────────────────────────────────────────────────────
  async function startVoice(){
    if(_rec)return;
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      _rec=new MediaRecorder(stream);const chunks=[];
      _rec.ondataavailable=e=>chunks.push(e.data);
      _rec.onstop=async()=>{
        stream.getTracks().forEach(t=>t.stop());
        const blob=new Blob(chunks,{type:'audio/webm'});const r=new FileReader();r.readAsDataURL(blob);
        r.onload=async()=>{const convId=window._currentConvId;if(!convId||!r.result||r.result==='data:')return;const dur=`0:${String(_recSecs).padStart(2,'0')}`;const cu=window._currentUser,now=Date.now();try{const[m]=await Promise.all([DB.createMessage({conv_id:convId,from:cu.username,type:'voice',text:'',duration:dur,audio_data:r.result,status:'sent',created_at:now}),DB.updateConversation(convId,{last_msg:`🎙 ${dur}`,last_time:now,last_from:cu.username})]);_getStore(convId).msgs.push(m);window._onNewMessage?.();}catch(e){UI.toast('Ses gönderilemedi','error');}};
      };
      _rec.start();_recSecs=0;
      document.getElementById('voice-indicator')?.style.setProperty('display','flex');
      document.getElementById('voice-btn')?.style.setProperty('color','#FF3D6B');
      _recInt=setInterval(()=>{_recSecs++;const e=document.getElementById('rec-timer');if(e)e.textContent=`0:${String(_recSecs).padStart(2,'0')}`;},1000);
    }catch{UI.toast('Mikrofon erişimi reddedildi','error');}
  }
  function stopVoice(){if(_rec?.state!=='inactive')_rec?.stop();_rec=null;clearInterval(_recInt);_recInt=null;document.getElementById('voice-indicator')?.style.setProperty('display','none');document.getElementById('voice-btn')?.style.setProperty('color','#7A8FA8');}

  // ── Destruct ──────────────────────────────────────────────────
  function toggleDestruct(){_destruct=!_destruct;const bar=document.getElementById('destruct-bar');if(bar)bar.style.display=_destruct?'flex':'none';const btn=document.getElementById('destruct-btn');if(btn)btn.style.color=_destruct?'#FF3D6B':'#7A8FA8';if(_destruct)UI.toast('İmha modu aktif 💣','warn');}
  function _startDestruct(msg,convId){const iv=setInterval(async()=>{const rem=Math.max(0,Math.floor((msg.destruct_at-Date.now())/1000));const el=document.getElementById('dtimer-'+msg.id);if(el)el.textContent=` ⏱${rem}s`;if(rem<=0){clearInterval(iv);const me=document.getElementById('msg-'+msg.id);if(me){me.style.opacity='0';me.style.transition='opacity .4s';setTimeout(()=>{me.remove();DB.deleteMessage(convId,msg.id).catch(()=>{});},400);}}},1000);}

  // ── Pin ───────────────────────────────────────────────────────
  function _pinKey(convId){return'cipher_pins_'+convId;}
  function _pinMsg(msgId){
    const cid=window._currentConvId;if(!cid)return;
    const key=_pinKey(cid),pins=JSON.parse(localStorage.getItem(key)||'[]');
    const idx=pins.indexOf(msgId);
    if(idx>=0){pins.splice(idx,1);localStorage.setItem(key,JSON.stringify(pins));document.getElementById('msg-'+msgId)?.querySelector('.pin-badge')?.remove();UI.toast('Sabitleme kaldırıldı','info');}
    else{pins.push(msgId);localStorage.setItem(key,JSON.stringify(pins));const el=document.getElementById('msg-'+msgId);if(el&&!el.querySelector('.pin-badge')){const pb=document.createElement('div');pb.className='pin-badge';pb.style.cssText="font-size:10px;color:#FFB830;margin-bottom:2px;font-family:'JetBrains Mono',monospace";pb.textContent='📌';el.prepend(pb);}UI.toast('📌 Mesaj sabitlendi','success');}
    _renderPinBanner(cid);
  }
  function _renderPinBanner(cid){
    document.getElementById('pin-banner')?.remove();
    const pins=JSON.parse(localStorage.getItem(_pinKey(cid)||'cipher_pins_x')||'[]');
    if(!pins.length)return;
    const msgs=document.getElementById('messages');if(!msgs)return;
    const last=pins[pins.length-1];const msg=_findMsg(cid,last);
    const b=document.createElement('div');b.id='pin-banner';
    b.style.cssText='display:flex;align-items:center;gap:8px;padding:7px 14px;background:#1A1400;border-bottom:1px solid rgba(255,184,48,.2);cursor:pointer;flex-shrink:0;-webkit-tap-highlight-color:transparent;position:relative;z-index:2';
    b.innerHTML=`<span style="font-size:14px;flex-shrink:0">📌</span><div style="flex:1;min-width:0"><div style="font-size:10px;color:#FFB830;font-family:'JetBrains Mono',monospace">${pins.length} sabitlenmiş mesaj</div><div style="font-size:12px;color:#DDE8F8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${msg?.text?.slice(0,60)||'Sabitlenmiş mesaj'}</div></div><button onclick="event.stopPropagation();document.getElementById('pin-banner').remove()" style="color:#7A8FA8;background:none;border:none;cursor:pointer;padding:4px;font-size:14px">✕</button>`;
    b.onclick=e=>{if(e.target.tagName==='BUTTON')return;const el=document.getElementById('msg-'+last);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.style.background='rgba(255,184,48,.1)';setTimeout(()=>el.style.background='',1500);}};
    msgs.parentElement?.insertBefore(b,msgs);
  }

  // ── Translate ─────────────────────────────────────────────────
  async function _translate(msgId){
    const msg=_findMsg(window._currentConvId,msgId);
    if(!msg?.text){UI.toast('Çevrilecek metin yok','error');return;}
    const el=document.getElementById('msg-'+msgId);
    const ex=el?.querySelector('.msg-tr');if(ex){ex.remove();return;}
    UI.toast('Çevriliyor…','info',1500);
    try{
      // Google Translate API (ücretsiz endpoint)
      const url=`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=tr&dt=t&q=${encodeURIComponent(msg.text)}`;
      const res=await fetch(url);
      const data=await res.json();
      const tr=data[0]?.map(s=>s?.[0]||'').join('')||'';
      const detectedLang=data[2]||'auto';
      if(!tr||tr.toLowerCase()===msg.text.toLowerCase()){UI.toast('Zaten Türkçe','info');return;}
      const div=document.createElement('div');div.className='msg-tr';
      div.style.cssText='font-size:12px;color:#B0D4FF;margin-top:4px;padding:6px 10px;border-radius:8px;background:rgba(0,100,255,.1);border:1px solid rgba(0,100,255,.2);line-height:1.5';
      div.innerHTML=`<span style="font-size:10px;color:#5A7A9A;font-family:'JetBrains Mono',monospace;display:block;margin-bottom:2px">🌐 Çeviri (${detectedLang.toUpperCase()} → TR)</span>${tr}`;
      el?.querySelector('[data-msgid]')?.after(div);
    }catch(e){
      const gUrl=`https://translate.google.com/?sl=auto&tl=tr&text=${encodeURIComponent(msg.text)}&op=translate`;
      window.open(gUrl,'_blank');
    }
  }

  async function _saveMsg(msgId){
    const msg=_findMsg(window._currentConvId,msgId)||(await DB.getMessages(window._currentConvId).catch(()=>[])).find(m=>m.id===msgId);
    if(!msg){UI.toast('Mesaj bulunamadı','error');return;}
    if(typeof saveMessage==='function') saveMessage(msgId,msg.text);
    else UI.toast('📌 Kaydet özelliği yüklenmedi','error');
  }

  // ── Context menu ──────────────────────────────────────────────
  function _ctxMenu(e,msgId,isMine){
    e.preventDefault();
    const items=[
      {icon:'↩',label:'Yanıtla',   action:`Messages._setReply('${msgId}')`},
      {icon:'📋',label:'Kopyala',   action:`Messages._copy('${msgId}')`},
      {icon:'🌐',label:'Çevir',     action:`Messages._translate('${msgId}')`},
      {icon:'📌',label:'Kaydet',    action:`Messages._saveMsg('${msgId}')`},
      {icon:'📌',label:'Sabitle',   action:`Messages._pinMsg('${msgId}')`},
      {icon:'😊',label:'Reaksiyon', action:`UI.showReactionPicker(${e.clientX},${e.clientY},em=>Messages._toggleReaction('${msgId}',em))`},
    ];
    if(isMine){items.push('divider');items.push({icon:'✏️',label:'Düzenle',action:`Messages._openEdit('${msgId}')`});items.push({icon:'↩',label:'Geri Çek',action:`Messages._recall('${msgId}')`,danger:true});items.push({icon:'🗑',label:'Sil',action:`Messages._delete('${msgId}')`,danger:true});}
    UI.showCtxMenu(e.clientX,e.clientY,items);
  }

  // ── Actions (in-memory first) ─────────────────────────────────
  async function _setReply(msgId){_replyTo=_findMsg(window._currentConvId,msgId)||(await DB.getMessages(window._currentConvId)).find(m=>m.id===msgId);if(!_replyTo)return;const bar=document.getElementById('reply-preview');if(bar)bar.style.display='flex';const rt=document.getElementById('reply-text');if(rt)rt.textContent=_replyTo.text||'📎';document.getElementById('msg-input')?.focus();}
  function clearReply(){_replyTo=null;const bar=document.getElementById('reply-preview');if(bar)bar.style.display='none';}
  async function _copy(msgId){const msg=_findMsg(window._currentConvId,msgId)||(await DB.getMessages(window._currentConvId)).find(m=>m.id===msgId);if(msg?.text){navigator.clipboard.writeText(msg.text).catch(()=>{});UI.toast('Kopyalandı ✓','success');}}
  function _openEdit(msgId){const m=_findMsg(window._currentConvId,msgId);if(m){window._editingMsgId=msgId;const i=document.getElementById('edit-input');if(i)i.value=m.text||'';UI.openModal('edit-modal');}}
  async function saveEdit(){const mid=window._editingMsgId,cid=window._currentConvId;if(!mid||!cid)return;const t=document.getElementById('edit-input')?.value.trim();if(!t)return;try{await DB.updateMessage(cid,mid,{text:t,edited:true});const m=_findMsg(cid,mid);if(m)m.text=t;UI.closeModal('edit-modal');window._onNewMessage?.();}catch(e){UI.toast('Düzenlenemedi','error');}}
  async function _recall(msgId){try{await DB.updateMessage(window._currentConvId,msgId,{recalled:true});const m=_findMsg(window._currentConvId,msgId);if(m)m.recalled=true;window._onNewMessage?.();UI.toast('Geri çekildi','info');}catch(e){UI.toast('Geri çekilemedi','error');}}
  async function _delete(msgId){try{await DB.deleteMessage(window._currentConvId,msgId);const s=_getStore(window._currentConvId);s.msgs=s.msgs.filter(m=>m.id!==msgId);document.getElementById('msg-'+msgId)?.remove();UI.toast('Silindi','info');}catch(e){UI.toast('Silinemedi','error');}}
  async function _toggleReaction(msgId,emoji){
    UI.hideReactionPicker();
    const cid=window._currentConvId;if(!cid)return;
    const msg=_findMsg(cid,msgId);if(!msg)return;
    const reactions={...(msg.reactions||{})};if(!reactions[emoji])reactions[emoji]=[];
    const idx=reactions[emoji].indexOf(window._currentUser?.username);
    if(idx>=0)reactions[emoji].splice(idx,1);else reactions[emoji].push(window._currentUser?.username);
    if(!reactions[emoji].length)delete reactions[emoji];
    msg.reactions=reactions;
    try{await DB.updateMessage(cid,msgId,{reactions});window._onNewMessage?.();}catch(e){console.warn('reaction:',e);}
  }

  // ── Files ─────────────────────────────────────────────────────
  function handleFiles(files){_files=[];const bar=document.getElementById('file-preview-bar');if(!bar)return;bar.innerHTML='';bar.style.display='block';Array.from(files).forEach(f=>{if(f.size>CONFIG.MAX_FILE_MB*1024*1024){UI.toast(`Maks. ${CONFIG.MAX_FILE_MB}MB`,'error');return;}const r=new FileReader();r.readAsDataURL(f);r.onload=()=>{_files.push({name:f.name,type:f.type,data:r.result});const d=document.createElement('div');d.style.cssText='display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:10px;background:#0A1018;border:1px solid #1E2D45;margin-bottom:4px';const _esc=s=>String(s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));d.innerHTML=`${f.type.startsWith('image/')?`<img src="${r.result}" style="width:32px;height:32px;border-radius:6px;object-fit:cover" loading="lazy">`:'<span style="font-size:20px">📄</span>'}<span style="font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#DDE8F8">${_esc(f.name)}</span><button onclick="Messages.clearFiles()" style="color:#7A8FA8;background:none;border:none;cursor:pointer;font-size:14px">✕</button>`;bar.appendChild(d);};});}
  function clearFiles(){_files=[];const b=document.getElementById('file-preview-bar');if(b){b.innerHTML='';b.style.display='none';}const fi=document.getElementById('file-input');if(fi)fi.value='';}
  function autoResize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px';}

  // ── Events ────────────────────────────────────────────────────
  function initEvents(){
    document.addEventListener('click',e=>{
      const pill=e.target.closest('.reaction-pill');
      if(pill&&pill.dataset.msgid&&pill.dataset.emoji){
        _toggleReaction(pill.dataset.msgid,pill.dataset.emoji);
      }
      // GIF/image lightbox via data-lightbox
      const lb=e.target.closest('[data-lightbox]');
      if(lb&&lb.src) _lightbox(lb.src);
    });
    const area=document.getElementById('messages');
    if(area){
      area.addEventListener('contextmenu',e=>{const b=e.target.closest('[data-msgid]');if(!b)return;e.preventDefault();_ctxMenu(e,b.dataset.msgid,b.dataset.ismine==='1');});
      area.addEventListener('dblclick',e=>{const b=e.target.closest('[data-msgid]');if(!b)return;UI.showReactionPicker(e.clientX,e.clientY,em=>_toggleReaction(b.dataset.msgid,em));});
    }
  }

  return {
    subscribeConv, renderAll, buildEl, send, sendGif, sendSticker,
    toggleGif, toggleGifPicker:()=>toggleGif(), searchGifs, renderGifs,
    toggleSticker, toggleStickerPicker:()=>toggleSticker(), renderStickerPack, closeAllPickers,
    startVoice, stopVoice, toggleDestruct,
    handleFiles, clearFiles, clearReply, saveEdit, initEvents,
    _ctxMenu, _setReply, _copy, _openEdit, _recall, _delete, _toggleReaction,
    _pinMsg, _translate, _saveMsg, _lightbox, autoResize,
    getMsgs: cid => _getStore(cid).msgs,
    hasFiles: () => _files.length > 0,
    _setDestructSecs: v => { _destructSecs=v; },
    get _gifOpen(){return _gifOpen;}, set _gifOpen(v){_gifOpen=v;},
    get _stickerOpen(){return _stickerOpen;}, set _stickerOpen(v){_stickerOpen=v;},
  };
})();

const UI = (() => {
  // ── Toast ──────────────────────────────────────────────────────
  function toast(msg, type = 'info', ms = 3000) {
    const C = { success:'#00FFB3', error:'#FF3D6B', warn:'#FFA535', info:'#0EA5E9' };
    const I = { success:'✓', error:'✕', warn:'⚠', info:'ℹ' };
    const el = document.createElement('div');
    el.className = 'pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-xl border';
    el.style.cssText = `background:#0C1220;border-color:${C[type]}44;box-shadow:0 8px 30px rgba(0,0,0,.5);animation:slideUp .25s ease-out;max-width:300px`;
    el.innerHTML = `<span style="color:${C[type]}">${I[type]}</span><span class="text-sm" style="color:#DDE8F8">${msg}</span>`;
    document.getElementById('toast-container')?.appendChild(el);
    setTimeout(() => { el.style.cssText += ';opacity:0;transform:translateY(6px);transition:all .3s'; setTimeout(() => el.remove(), 300); }, ms);
  }

  // ── Helpers ────────────────────────────────────────────────────
  const PAL = ['#0066FF','#9333EA','#0EA5E9','#F59E0B','#10B981','#EF4444','#EC4899','#F97316','#6366F1','#14B8A6'];
  function avatarColor(seed) { let h=0; for (const c of (seed||'x')) h=(h*31+c.charCodeAt(0))&0xFFFFFF; return PAL[Math.abs(h)%PAL.length]; }
  function initials(name) { return (name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase(); }
  function fmtTime(ts) {
    const d=new Date(ts),now=new Date(),diff=now-d;
    if(diff<86400000) return d.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
    if(diff<604800000) return ['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'][d.getDay()];
    return d.toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit'});
  }
  function fmtDate(ts) { return new Date(ts).toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'}); }
  function fmtRelative(ts) {
    const d=Date.now()-ts;
    if(d<60000) return 'Az önce';
    if(d<3600000) return Math.floor(d/60000)+'d önce';
    if(d<86400000) return Math.floor(d/3600000)+'s önce';
    return Math.floor(d/86400000)+'gün önce';
  }

  // ── Modals ─────────────────────────────────────────────────────
  function openModal(id)  { const m=document.getElementById(id); m?.classList.remove('hidden'); m?.classList.add('flex'); }
  function closeModal(id) { const m=document.getElementById(id); m?.classList.add('hidden'); m?.classList.remove('flex'); }

  // ── Context Menu ───────────────────────────────────────────────
  function showCtxMenu(x, y, items) {
    let menu = document.getElementById('ctx-menu');
    if (!menu) { menu = document.createElement('div'); menu.id='ctx-menu'; document.body.appendChild(menu); }
    menu.className = 'fixed z-[999] rounded-xl overflow-hidden';
    menu.style.cssText = `background:#0C1220;border:1px solid #1E2D45;box-shadow:0 20px 60px rgba(0,0,0,.7);min-width:176px;top:${Math.min(y,window.innerHeight-280)}px;left:${Math.min(x,window.innerWidth-200)}px`;
    menu.innerHTML = items.map(it => it==='divider'
      ? `<div style="height:1px;background:#1E2D45;margin:3px 0"></div>`
      : `<button class="w-full text-left flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition-colors" style="color:${it.danger?'#FF3D6B':'#DDE8F8'}" onmouseenter="this.style.background='#131D30'" onmouseleave="this.style.background=''" onclick="${it.action}">${it.icon?`<span>${it.icon}</span>`:''}<span>${it.label}</span></button>`
    ).join('');
    menu.classList.remove('hidden');
    const hide = () => { menu.classList.add('hidden'); document.removeEventListener('click', hide); };
    setTimeout(() => document.addEventListener('click', hide), 10);
  }

  // ── Profile Card (Discord style) ───────────────────────────────
  function showProfileCard(user, anchorEl) {
    let card = document.getElementById('profile-card');
    if (!card) { card = document.createElement('div'); card.id='profile-card'; document.body.appendChild(card); }
    const color  = avatarColor(user.username);
    const banner = user.banner_color || '#0A1628';
    const badges = (user.badges||[]).map(b=>{
      const bd=CONFIG.BADGES[b];
      return bd?`<span title="${bd.label}" style="background:${bd.color}22;border:1px solid ${bd.color}44;color:${bd.color};padding:2px 8px;border-radius:8px;font-size:11px;display:inline-flex;align-items:center;gap:3px">${bd.icon} ${bd.label}</span>`:'';
    }).join('');

    const avHtml = user.avatar_url
      ? `<img src="${user.avatar_url}" class="w-16 h-16 rounded-full object-cover" style="border:3px solid #0C1220">`
      : `<div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,${color},${color}99);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;font-family:Syne,sans-serif;font-weight:700;border:3px solid #0C1220">${initials(user.display_name||user.username)}</div>`;

    card.className = 'fixed z-[998] rounded-2xl overflow-hidden border select-none';
    card.style.cssText = `width:280px;background:#0C1220;border-color:#1E2D45;box-shadow:0 25px 70px rgba(0,0,0,.8);animation:slideUp .2s ease-out`;
    card.innerHTML = `
      <div style="height:76px;background:${banner};position:relative">
        <div style="position:absolute;bottom:-32px;left:16px">${avHtml}</div>
        <div style="position:absolute;top:10px;right:12px;width:12px;height:12px;background:#00E676;border-radius:50%;border:2px solid #0C1220"></div>
      </div>
      <div style="padding:40px 16px 16px">
        <div style="display:flex;align-items:start;justify-content:space-between;margin-bottom:4px">
          <div>
            <div style="font-family:Syne,sans-serif;font-weight:700;font-size:17px;color:#DDE8F8">${user.display_name||user.username}</div>
            <div style="font-size:11px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">@${user.username}</div>
          </div>
          ${user.is_admin?`<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:#FFD70022;color:#FFD700;border:1px solid #FFD70044;font-family:'JetBrains Mono',monospace">ADMİN</span>`:''}
        </div>
        ${user.status?`<div style="font-size:13px;color:#B0C4D8;margin-bottom:8px">${user.status_emoji||''} ${user.status}</div>`:''}
        <div style="height:1px;background:#1E2D45;margin:10px 0"></div>
        ${user.bio?`<div style="font-size:12px;color:#9AB0C8;margin-bottom:10px;line-height:1.5">${user.bio}</div>`:''}
        <div style="margin-bottom:10px">
          <div style="font-size:10px;font-weight:600;color:#7A8FA8;font-family:'JetBrains Mono',monospace;margin-bottom:4px">CIPHER ÜYESİ</div>
          <div style="font-size:12px;color:#DDE8F8">${fmtDate(user.created_at||Date.now())}</div>
        </div>
        ${badges?`<div><div style="font-size:10px;font-weight:600;color:#7A8FA8;font-family:'JetBrains Mono',monospace;margin-bottom:6px">ROZETLER</div><div style="display:flex;flex-wrap:wrap;gap:6px">${badges}</div></div>`:''}
      </div>`;

    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      const top  = Math.min(r.top, window.innerHeight-460);
      const left = r.right+10 < window.innerWidth-290 ? r.right+10 : r.left-290;
      card.style.top = Math.max(8,top) + 'px';
      card.style.left = Math.max(8,left) + 'px';
    } else {
      card.style.top = '50%'; card.style.left = '50%'; card.style.transform = 'translate(-50%,-50%)';
    }
    card.classList.remove('hidden');
    const hide = e => { if (!card.contains(e.target) && e.target!==anchorEl) { card.classList.add('hidden'); document.removeEventListener('click',hide); } };
    setTimeout(() => document.addEventListener('click', hide), 50);
  }

  // ── Story Viewer ───────────────────────────────────────────────
  function showStory(story, user) {
    const color = avatarColor(user.username);
    const av = user.avatar_url
      ? `<img src="${user.avatar_url}" class="w-8 h-8 rounded-full object-cover">`
      : `<div style="width:32px;height:32px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700">${initials(user.display_name||user.username)}</div>`;
    document.getElementById('sv-avatar').innerHTML = av;
    document.getElementById('sv-name').textContent = user.display_name||user.username;
    document.getElementById('sv-time').textContent = fmtRelative(story.created_at||Date.now());
    document.getElementById('sv-content').textContent = story.text||'';
    document.getElementById('sv-progress').style.width = '0%';
    openModal('story-viewer');
    let pct=0;
    const iv = setInterval(() => {
      pct+=2; document.getElementById('sv-progress').style.width=pct+'%';
      if(pct>=100){clearInterval(iv);setTimeout(()=>closeModal('story-viewer'),300);}
    },100);
  }

  function hideReactionPicker() { document.getElementById('reaction-picker')?.classList.add('hidden'); }
  function showReactionPicker(x, y, onPick) {
    const p = document.getElementById('reaction-picker');
    if(!p) return;
    p.style.top=Math.min(y-180,window.innerHeight-220)+'px';
    p.style.left=Math.min(x-130,window.innerWidth-270)+'px';
    p.classList.remove('hidden');
    p._onPick = onPick;
  }

  return { toast, avatarColor, initials, fmtTime, fmtDate, fmtRelative, openModal, closeModal, showCtxMenu, showProfileCard, showStory, showReactionPicker, hideReactionPicker };
})();

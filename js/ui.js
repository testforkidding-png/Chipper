/**
 * CIPHER UI v3 — NaN fix, online status, toast, modals
 */
const UI = (() => {
  function toast(msg, type='info', ms=3000) {
    const C={success:'#00FFB3',error:'#FF3D6B',warn:'#FFA535',info:'#0EA5E9'};
    const I={success:'✓',error:'✕',warn:'⚠',info:'ℹ'};
    const el=document.createElement('div');
    el.style.cssText=`display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:12px;background:#0C1220;border:1px solid ${C[type]}44;box-shadow:0 8px 30px rgba(0,0,0,.5);animation:slideUp .25s ease-out;max-width:320px;pointer-events:auto`;
    el.innerHTML=`<span style="color:${C[type]};font-size:14px">${I[type]}</span><span style="font-size:13px;color:#DDE8F8;line-height:1.4">${msg}</span>`;
    document.getElementById('toast-container')?.appendChild(el);
    setTimeout(()=>{ el.style.cssText+=';opacity:0;transform:translateY(6px);transition:all .3s'; setTimeout(()=>el.remove(),300); },ms);
  }

  const PAL=['#0066FF','#9333EA','#0EA5E9','#F59E0B','#10B981','#EF4444','#EC4899','#F97316','#6366F1','#14B8A6'];
  function avatarColor(seed){ let h=0; for(const c of(seed||'x'))h=(h*31+c.charCodeAt(0))&0xFFFFFF; return PAL[Math.abs(h)%PAL.length]; }
  function initials(name){ return (name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase(); }

  // ── Convert any timestamp to milliseconds ────────────────────
  function _ms(ts) {
    if (!ts) return 0; // 0 means "never" not "now"
    if (typeof ts === 'string') {
      // ISO string from Supabase TIMESTAMPTZ
      const n = new Date(ts).getTime();
      return isNaN(n) ? 0 : n;
    }
    if (typeof ts === 'number') {
      // Could be seconds (Unix) or milliseconds
      // If < 10^12 it's likely seconds (before year 2001 in ms)
      return ts < 1e12 ? ts * 1000 : ts;
    }
    return 0;
  }

  function fmtTime(ts) {
    const d=new Date(_ms(ts)),now=new Date(),diff=now-d;
    if(diff<86400000) return d.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
    if(diff<604800000) return ['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'][d.getDay()];
    return d.toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit'});
  }
  function fmtDate(ts){ return new Date(_ms(ts)).toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'}); }
  function fmtRelative(ts) {
    const d = Date.now() - _ms(ts);
    if (d < 0 || isNaN(d)) return 'Az önce';
    if (d < 60000)    return 'Az önce';
    if (d < 3600000)  return Math.floor(d/60000) + ' dk önce';
    if (d < 86400000) return Math.floor(d/3600000) + ' sa önce';
    if (d < 604800000)return Math.floor(d/86400000) + ' gün önce';
    return Math.floor(d/604800000) + ' hafta önce';
  }

  // ── Online status with duration ──────────────────────────────
  function onlineStatus(user) {
    if (!user) return { text: 'Bilinmiyor', color: '#7A8FA8', dot: '#7A8FA8' };
    const lastSeen = _ms(user.last_seen);
    const now = Date.now();
    
    // No last_seen data at all
    if (!lastSeen) {
      if (user.online) return { text: '🟢 Çevrimiçi', color: '#00E676', dot: '#00E676' };
      return { text: '⚫ Bilinmiyor', color: '#7A8FA8', dot: '#7A8FA8' };
    }

    const diff = now - lastSeen;

    // Negative diff = clock skew, treat as online
    if (diff < 0) return { text: '🟢 Çevrimiçi', color: '#00E676', dot: '#00E676' };
    
    // Within 2 minutes + online flag = online
    if (diff < 120000) return { text: '🟢 Çevrimiçi', color: '#00E676', dot: '#00E676' };
    
    // 2-10 minutes = recently active
    if (diff < 600000) return { text: `🟡 ${Math.floor(diff/60000)} dk önce`, color: '#FFA535', dot: '#FFA535' };
    
    // Hours
    if (diff < 3600000) return { text: `⚫ ${Math.floor(diff/60000)} dk önce`, color: '#7A8FA8', dot: '#7A8FA8' };
    if (diff < 86400000) return { text: `⚫ ${Math.floor(diff/3600000)} sa önce`, color: '#7A8FA8', dot: '#7A8FA8' };
    
    // Days
    const days = Math.floor(diff/86400000);
    return { text: `⚫ ${days} gün önce`, color: '#7A8FA8', dot: '#7A8FA8' };
  }

  // ── Modals ────────────────────────────────────────────────────
  function openModal(id)  { const m=document.getElementById(id); if(m){m.classList.remove('hidden');m.classList.add('flex');} }
  function closeModal(id) { const m=document.getElementById(id); if(m){m.classList.add('hidden');m.classList.remove('flex');} }

  // ── Context menu ──────────────────────────────────────────────
  function showCtxMenu(x, y, items) {
    let menu=document.getElementById('ctx-menu');
    if(!menu){ menu=document.createElement('div'); menu.id='ctx-menu'; document.body.appendChild(menu); }
    const safeX=Math.min(x,window.innerWidth-200), safeY=Math.min(y,window.innerHeight-items.length*40-10);
    menu.style.cssText=`position:fixed;z-index:999;top:${safeY}px;left:${safeX}px;background:#0C1220;border:1px solid #1E2D45;border-radius:12px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.7);min-width:176px`;
    menu.innerHTML=items.map(it=>it==='divider'
      ?`<div style="height:1px;background:#1E2D45;margin:3px 0"></div>`
      :`<button style="width:100%;text-align:left;display:flex;align-items:center;gap:10px;padding:10px 14px;font-size:13px;color:${it.danger?'#FF3D6B':'#DDE8F8'};background:none;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent" onmouseenter="this.style.background='#131D30'" onmouseleave="this.style.background=''" onclick="${it.action}">${it.icon?`<span>${it.icon}</span>`:''}<span>${it.label}</span></button>`
    ).join('');
    menu.classList.remove('hidden');
    const hide=()=>{ menu.classList.add('hidden'); document.removeEventListener('click',hide); };
    setTimeout(()=>document.addEventListener('click',hide),10);
  }

  // ── Profile card ──────────────────────────────────────────────
  function showProfileCard(user, anchorEl) {
    let card=document.getElementById('profile-card');
    if(!card){ card=document.createElement('div'); card.id='profile-card'; document.body.appendChild(card); }
    const color=avatarColor(user.username);
    const banner=user.banner_color||'#0A1628';
    const st=onlineStatus(user);
    const badges=(user.badges||[]).map(b=>{ const bd=CONFIG.BADGES[b]; return bd?`<span style="background:${bd.color}22;border:1px solid ${bd.color}44;color:${bd.color};padding:2px 8px;border-radius:8px;font-size:11px">${bd.icon} ${bd.label}</span>`:''; }).join('');
    const avHtml=user.avatar_url?`<img src="${user.avatar_url}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:3px solid #0C1220">`:`<div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,${color},${color}99);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;font-family:Syne,sans-serif;font-weight:700;border:3px solid #0C1220">${initials(user.display_name||user.username)}</div>`;
    card.style.cssText='position:fixed;z-index:998;width:280px;background:#0C1220;border:1px solid #1E2D45;border-radius:16px;overflow:hidden;box-shadow:0 25px 70px rgba(0,0,0,.8);animation:slideUp .2s ease-out';
    card.innerHTML=`<div style="height:72px;background:${banner};position:relative"><div style="position:absolute;bottom:-32px;left:14px">${avHtml}</div><div style="position:absolute;top:8px;right:10px;width:11px;height:11px;background:${st.dot};border-radius:50%;border:2px solid #0C1220"></div></div>
    <div style="padding:38px 14px 14px">
      <div style="font-family:Syne,sans-serif;font-weight:700;font-size:16px;color:#DDE8F8">${user.display_name||user.username}</div>
      <div style="font-size:11px;color:#7A8FA8;font-family:'JetBrains Mono',monospace">@${user.username}</div>
      <div style="font-size:11px;color:${st.color};margin:4px 0">${st.text}</div>
      ${user.status?`<div style="font-size:12px;color:#B0C4D8;margin-bottom:6px">${user.status_emoji||''} ${user.status}</div>`:''}
      ${badges?`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">${badges}</div>`:''}
    </div>`;
    if(anchorEl){ const r=anchorEl.getBoundingClientRect(); card.style.top=Math.max(8,Math.min(r.top,window.innerHeight-400))+'px'; card.style.left=Math.max(8,(r.right+10<window.innerWidth-290?r.right+10:r.left-290))+'px'; }
    else { card.style.top='50%'; card.style.left='50%'; card.style.transform='translate(-50%,-50%)'; }
    card.classList.remove('hidden');
    const hide=e=>{ if(!card.contains(e.target)&&e.target!==anchorEl){card.classList.add('hidden');document.removeEventListener('click',hide);} };
    setTimeout(()=>document.addEventListener('click',hide),50);
  }

  function showStory(story,user) {
    const color=avatarColor(user.username);
    const av=user.avatar_url?`<img src="${user.avatar_url}" style="width:32px;height:32px;border-radius:50%;object-fit:cover">`:`<div style="width:32px;height:32px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700">${initials(user.display_name||user.username)}</div>`;
    document.getElementById('sv-avatar').innerHTML=av;
    document.getElementById('sv-name').textContent=user.display_name||user.username;
    document.getElementById('sv-time').textContent=fmtRelative(story.created_at||Date.now());
    document.getElementById('sv-content').textContent=story.text||'';
    document.getElementById('sv-progress').style.width='0%';
    openModal('story-viewer');
    let pct=0;
    const iv=setInterval(()=>{ pct+=2; document.getElementById('sv-progress').style.width=pct+'%'; if(pct>=100){clearInterval(iv);setTimeout(()=>closeModal('story-viewer'),300);} },100);
  }

  function hideReactionPicker(){ document.getElementById('reaction-picker')?.classList.add('hidden'); }
  function showReactionPicker(x,y,onPick) {
    const p=document.getElementById('reaction-picker'); if(!p)return;
    p.style.left=Math.max(4,Math.min(x-130,window.innerWidth-270))+'px';
    p.style.top=Math.max(4,Math.min(y-180,window.innerHeight-220))+'px';
    p.classList.remove('hidden'); p._onPick=onPick;
  }

  return { toast, avatarColor, initials, fmtTime, fmtDate, fmtRelative, onlineStatus, openModal, closeModal, showCtxMenu, showProfileCard, showStory, showReactionPicker, hideReactionPicker };
})();

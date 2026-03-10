/**
 * CIPHER — UI Components
 */

const UI = (() => {

  // ── Toast ──────────────────────────────────────────────────────
  function toast(msg, type = 'info', duration = 3000) {
    const colors = { success: '#00FFB3', error: '#FF3D6B', warn: '#FFA535', info: '#0EA5E9' };
    const icons  = { success: '✓', error: '✕', warn: '⚠', info: 'ℹ' };
    const el = document.createElement('div');
    el.className = 'pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-xl border';
    el.style.cssText = `background:#0C1220;border-color:${colors[type]}44;box-shadow:0 8px 30px rgba(0,0,0,.5);animation:slideUp .25s ease-out;max-width:300px`;
    el.innerHTML = `<span style="color:${colors[type]};font-size:14px">${icons[type]}</span><span class="text-sm" style="color:#DDE8F8">${msg}</span>`;
    document.getElementById('toast-container')?.appendChild(el);
    setTimeout(() => { el.style.cssText += ';opacity:0;transform:translateY(8px);transition:all .3s'; setTimeout(() => el.remove(), 300); }, duration);
  }

  // ── Avatar initials + color ────────────────────────────────────
  function initials(name) {
    return (name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }
  const PALETTE = ['#0066FF','#9333EA','#0EA5E9','#F59E0B','#10B981','#EF4444','#EC4899','#F97316','#6366F1','#14B8A6'];
  function avatarColor(seed) {
    let h = 0; for (const c of (seed || 'x')) h = (h * 31 + c.charCodeAt(0)) & 0xFFFFFF;
    return PALETTE[Math.abs(h) % PALETTE.length];
  }

  function avatarEl(user, size = 40, extraClass = '') {
    const div = document.createElement('div');
    div.className = `flex items-center justify-center font-bold rounded-full flex-shrink-0 ${extraClass}`;
    div.style.cssText = `width:${size}px;height:${size}px;font-size:${size*0.35}px;font-family:Syne,sans-serif`;
    if (user?.avatar_url) {
      div.innerHTML = `<img src="${user.avatar_url}" class="w-full h-full rounded-full object-cover" alt="${user.display_name}">`;
    } else {
      const color = avatarColor(user?.username || '');
      div.style.background = `linear-gradient(135deg,${color},${color}99)`;
      div.style.color = '#fff';
      div.textContent = initials(user?.display_name || user?.username || '?');
    }
    return div;
  }

  // ── Format timestamp ───────────────────────────────────────────
  function fmtTime(ts) {
    const d = new Date(ts), now = new Date(), diff = now - d;
    if (diff < 86400000) return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    if (diff < 604800000) return ['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'][d.getDay()];
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
  }
  function fmtDate(ts) {
    return new Date(ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function fmtRelative(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Az önce';
    if (diff < 3600000) return Math.floor(diff/60000) + 'd önce';
    if (diff < 86400000) return Math.floor(diff/3600000) + 's önce';
    return Math.floor(diff/86400000) + 'gün önce';
  }

  // ── Modal helpers ──────────────────────────────────────────────
  function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove('hidden');
    m.classList.add('flex');
    m.style.animation = 'fadeIn .2s ease-out';
  }
  function closeModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.add('hidden');
    m.classList.remove('flex');
  }

  // ── Context Menu ───────────────────────────────────────────────
  function showCtxMenu(x, y, items) {
    let menu = document.getElementById('ctx-menu');
    if (!menu) { menu = document.createElement('div'); menu.id = 'ctx-menu'; document.body.appendChild(menu); }
    menu.className = 'fixed z-[999] rounded-xl border overflow-hidden';
    menu.style.cssText = `background:#0C1220;border-color:#1E2D45;box-shadow:0 20px 60px rgba(0,0,0,.6);min-width:180px;top:${Math.min(y,window.innerHeight-300)}px;left:${Math.min(x,window.innerWidth-200)}px`;
    menu.innerHTML = items.map(item => item === 'divider'
      ? `<div style="height:1px;background:#1E2D45;margin:4px 0"></div>`
      : `<button class="w-full text-left flex items-center gap-2.5 px-3.5 py-2.5 text-sm hover:bg-c-elev transition-colors ${item.danger ? 'text-red-400' : ''}"
           style="color:${item.danger ? '#FF3D6B' : '#DDE8F8'};font-family:DM Sans,sans-serif"
           onclick="${item.action}">
           ${item.icon ? `<span style="width:16px;text-align:center">${item.icon}</span>` : ''}
           <span>${item.label}</span>
         </button>`
    ).join('');
    menu.classList.remove('hidden');
    const hide = () => { menu.classList.add('hidden'); document.removeEventListener('click', hide); };
    setTimeout(() => document.addEventListener('click', hide), 10);
  }

  // ── Discord-style Profile Card ─────────────────────────────────
  function showProfileCard(user, anchorEl) {
    let card = document.getElementById('profile-card');
    if (!card) {
      card = document.createElement('div');
      card.id = 'profile-card';
      document.body.appendChild(card);
    }

    const color  = avatarColor(user.username);
    const banner = user.banner_color || '#0A1628';
    const badges = (user.badges || []).map(b => {
      const bd = CONFIG.BADGES[b];
      return bd ? `<span class="flex items-center gap-1 px-2 py-1 rounded-lg text-xs tooltip" data-tip="${bd.label}" style="background:${bd.color}22;border:1px solid ${bd.color}44;color:${bd.color}">${bd.icon}</span>` : '';
    }).join('');

    const joinDate = fmtDate(user.created_at || Date.now());
    const avatarHtml = user.avatar_url
      ? `<img src="${user.avatar_url}" class="w-16 h-16 rounded-full object-cover" style="border:3px solid #0C1220">`
      : `<div class="w-16 h-16 rounded-full flex items-center justify-center font-bold text-xl" style="background:linear-gradient(135deg,${color},${color}99);color:#fff;border:3px solid #0C1220;font-family:Syne,sans-serif">${initials(user.display_name || user.username)}</div>`;

    card.className = 'fixed z-[998] rounded-2xl overflow-hidden border select-none';
    card.style.cssText = `width:280px;background:#0C1220;border-color:#1E2D45;box-shadow:0 25px 70px rgba(0,0,0,.7);animation:slideUp .2s ease-out`;

    card.innerHTML = `
      <!-- Banner -->
      <div class="relative" style="height:72px;background:${banner}">
        <div class="absolute inset-0" style="background:linear-gradient(135deg,${banner},${banner}cc)"></div>
        <!-- Online dot overlaid on avatar -->
        <div class="absolute bottom-0 left-4 translate-y-1/2 relative inline-block">
          ${avatarHtml}
          <div class="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full border-2" style="background:#00E676;border-color:#0C1220"></div>
        </div>
      </div>
      <!-- Body -->
      <div class="pt-10 px-4 pb-4">
        <!-- Name & badges -->
        <div class="flex items-start justify-between mb-1">
          <div>
            <div class="font-bold text-base" style="font-family:Syne,sans-serif;color:#DDE8F8">${user.display_name || user.username}</div>
            <div class="text-xs font-mono" style="color:#7A8FA8;font-family:'JetBrains Mono',monospace">@${user.username}</div>
          </div>
          ${user.is_admin ? `<span class="text-xs px-2 py-0.5 rounded-full font-mono" style="background:#FFD70022;color:#FFD700;border:1px solid #FFD70044">ADMİN</span>` : ''}
        </div>
        <!-- Custom status -->
        ${user.status ? `<div class="flex items-center gap-1.5 mb-3 text-sm" style="color:#DDE8F8">${user.status_emoji||''} <span style="color:#B0C4D8">${user.status}</span></div>` : ''}
        <!-- Divider -->
        <div class="h-px mb-3" style="background:#1E2D45"></div>
        <!-- Bio -->
        ${user.bio ? `<div class="text-xs mb-3 leading-relaxed" style="color:#9AB0C8">${user.bio}</div>` : ''}
        <!-- Member since -->
        <div class="mb-3">
          <div class="text-xs font-semibold mb-0.5" style="color:#7A8FA8;font-family:'JetBrains Mono',monospace;font-size:10px">CIPHER ÜYESİ</div>
          <div class="text-xs" style="color:#DDE8F8">${joinDate}</div>
        </div>
        <!-- Badges -->
        ${badges ? `<div>
          <div class="text-xs font-semibold mb-1.5" style="color:#7A8FA8;font-family:'JetBrains Mono',monospace;font-size:10px">ROZETLER</div>
          <div class="flex flex-wrap gap-1.5">${badges}</div>
        </div>` : ''}
      </div>`;

    // Position near anchor
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      const top  = Math.min(rect.top, window.innerHeight - 450);
      const left = Math.min(rect.right + 10, window.innerWidth - 300);
      card.style.top  = top + 'px';
      card.style.left = left + 'px';
    } else {
      card.style.top  = '50%';
      card.style.left = '50%';
      card.style.transform = 'translate(-50%,-50%)';
    }

    card.classList.remove('hidden');
    const hide = (e) => {
      if (!card.contains(e.target) && e.target !== anchorEl) {
        card.classList.add('hidden');
        document.removeEventListener('click', hide);
      }
    };
    setTimeout(() => document.addEventListener('click', hide), 50);
  }

  // ── Story viewer ───────────────────────────────────────────────
  function showStory(story, user) {
    let v = document.getElementById('story-viewer');
    if (!v) return;
    const color = avatarColor(user.username);
    const avatarHtml = user.avatar_url
      ? `<img src="${user.avatar_url}" class="w-8 h-8 rounded-full object-cover">`
      : `<div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold" style="background:${color};color:#fff">${initials(user.display_name)}</div>`;

    document.getElementById('sv-avatar').innerHTML = avatarHtml;
    document.getElementById('sv-name').textContent = user.display_name || user.username;
    document.getElementById('sv-time').textContent = fmtRelative(story.created_at || Date.now());
    document.getElementById('sv-content').textContent = story.text || '';
    document.getElementById('sv-progress').style.width = '0%';
    openModal('story-viewer');

    let pct = 0;
    const iv = setInterval(() => {
      pct += 2;
      document.getElementById('sv-progress').style.width = pct + '%';
      if (pct >= 100) { clearInterval(iv); setTimeout(() => closeModal('story-viewer'), 300); }
    }, 100);
  }

  // ── Reaction Picker ────────────────────────────────────────────
  function showReactionPicker(x, y, onPick) {
    let picker = document.getElementById('reaction-picker');
    if (!picker) return;
    picker.style.cssText = `top:${Math.min(y-170,window.innerHeight-200)}px;left:${Math.min(x-120,window.innerWidth-260)}px`;
    picker.classList.remove('hidden');
    picker._onPick = onPick;
  }
  function hideReactionPicker() {
    document.getElementById('reaction-picker')?.classList.add('hidden');
  }

  return {
    toast, initials, avatarColor, avatarEl,
    fmtTime, fmtDate, fmtRelative,
    openModal, closeModal, showCtxMenu,
    showProfileCard, showStory,
    showReactionPicker, hideReactionPicker
  };
})();

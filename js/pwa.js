/**
 * CIPHER — PWA Install Helper
 * "Uygulamayı Kur" butonu ve Google Shortcuts desteği
 */

const PWA = (() => {
  let _deferredPrompt = null;
  let _installed = false;

  // ── Service Worker registration ────────────────────────────────
  async function register() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      console.log('[CIPHER PWA] SW registered:', reg.scope);

      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            UI.toast('Yeni güncelleme mevcut. Sayfayı yenileyin.', 'info', 6000);
          }
        });
      });
    } catch (e) {
      console.warn('[CIPHER PWA] SW registration failed:', e);
    }
  }

  // ── beforeinstallprompt ────────────────────────────────────────
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _deferredPrompt = e;
    _installed = false;
    updateInstallUI();
  });

  window.addEventListener('appinstalled', () => {
    _installed = true;
    _deferredPrompt = null;
    updateInstallUI();
    UI.toast('CIPHER uygulaması kuruldu! 🎉', 'success');
  });

  // ── Trigger native install prompt ─────────────────────────────
  async function install() {
    if (_deferredPrompt) {
      _deferredPrompt.prompt();
      const { outcome } = await _deferredPrompt.userChoice;
      if (outcome === 'accepted') { UI.toast('Kurulum başladı…', 'info'); }
      _deferredPrompt = null;
    } else if (isIOS()) {
      UI.openModal('ios-install-modal');
    } else {
      UI.toast('Tarayıcı adres çubuğundan kurabilirsiniz.', 'info');
    }
  }

  // ── iOS detection ──────────────────────────────────────────────
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }

  // ── Update install button visibility ──────────────────────────
  function updateInstallUI() {
    const btn = document.getElementById('install-btn');
    if (!btn) return;
    if (_installed || isStandalone()) {
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Kuruldu`;
      btn.style.color = '#00FFB3';
      btn.disabled = true;
    } else if (_deferredPrompt || isIOS()) {
      btn.style.display = '';
    }
  }

  // ── Google Shortcut helper ─────────────────────────────────────
  // Adds CIPHER to Chrome's "Apps" / new tab shortcuts grid
  function addToGoogleChrome() {
    if ('chrome' in window && chrome.webstore) {
      // Legacy Chrome Web Store
      UI.toast('Chrome menüsü → "Sayfayı Uygulama Olarak Aç" seçeneğini kullanın.', 'info', 5000);
    } else {
      // Modern approach: guide user
      const isMac = navigator.platform.includes('Mac');
      const isAndroid = /android/i.test(navigator.userAgent);

      let msg = '';
      if (isAndroid) {
        msg = 'Chrome ⋮ menüsü → "Ana Ekrana Ekle" seçeneğine dokunun.';
      } else if (isMac) {
        msg = 'Chrome → Dosya → "Sayfayı Kısayol Olarak Kaydet…" seçeneğini kullanın.';
      } else {
        msg = 'Chrome ⋮ → Kaydet ve Paylaş → "Sayfayı Kısayol Olarak Kaydet…"';
      }
      UI.toast(msg, 'info', 7000);
    }
  }

  // ── Show full install guide ────────────────────────────────────
  function showGuide() {
    const isAndroid = /android/i.test(navigator.userAgent);
    const steps = isIOS() ? [
      'Safari\'de bu sayfayı açın',
      'Alt çubuktaki Paylaş butonuna dokunun (kare+ok simgesi)',
      '"Ana Ekrana Ekle" seçeneğini seçin',
      '"Ekle" butonuna dokunun'
    ] : isAndroid ? [
      'Chrome\'da bu sayfayı açın',
      'Sağ üst köşedeki ⋮ menüye dokunun',
      '"Ana Ekrana Ekle" seçeneğini seçin',
      'Onaylayın'
    ] : [
      'Chrome/Edge adres çubuğunda sağdaki ⊕ simgesine tıklayın',
      'veya: Tarayıcı menüsü → "Sayfayı Uygulama Olarak Yükle"',
      'Açılan diyalogda "Yükle" seçin',
      'Masaüstünde CIPHER simgesi belirecek'
    ];

    let guide = document.getElementById('pwa-guide');
    if (!guide) { guide = document.createElement('div'); guide.id = 'pwa-guide'; document.body.appendChild(guide); }
    guide.className = 'fixed inset-0 z-[60] flex items-center justify-center';
    guide.style.background = 'rgba(6,8,15,.95)';
    guide.innerHTML = `
      <div class="w-full max-w-sm mx-4 rounded-2xl border p-6" style="background:#0C1220;border-color:#1E2D45;animation:slideUp .3s ease-out">
        <div class="flex items-center gap-3 mb-5">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background:linear-gradient(135deg,#00FFB3,#00C48A)">📱</div>
          <div>
            <div class="font-bold text-base" style="font-family:Syne,sans-serif;color:#DDE8F8">Uygulamayı Kur</div>
            <div class="text-xs" style="color:#7A8FA8">Masaüstü/Telefon/Tablet</div>
          </div>
        </div>
        <ol class="space-y-3 mb-5">
          ${steps.map((s,i) => `
            <li class="flex items-start gap-3">
              <span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5" style="background:#00FFB3;color:#062B1F">${i+1}</span>
              <span class="text-sm" style="color:#DDE8F8">${s}</span>
            </li>`).join('')}
        </ol>
        <div class="flex gap-2">
          ${_deferredPrompt ? `<button onclick="PWA.install()" class="flex-1 py-2.5 rounded-xl text-sm font-semibold" style="background:linear-gradient(135deg,#00FFB3,#00C48A);color:#062B1F">Şimdi Kur</button>` : ''}
          <button onclick="document.getElementById('pwa-guide').remove()" class="flex-1 py-2.5 rounded-xl text-sm font-medium" style="background:#131D30;color:#7A8FA8;border:1px solid #1E2D45">Kapat</button>
        </div>
      </div>`;
  }

  // ── Init ───────────────────────────────────────────────────────
  function init() {
    register();
    // Check if already standalone
    if (isStandalone()) {
      _installed = true;
      document.documentElement.classList.add('pwa-mode');
    }
  }

  return { init, install, addToGoogleChrome, showGuide, isStandalone, isIOS, updateInstallUI };
})();

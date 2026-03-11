const PWA = (() => {
  let _prompt = null;

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); _prompt=e; });
  window.addEventListener('appinstalled', () => UI.toast('CIPHER kuruldu! 🎉','success'));

  async function install() {
    if (_prompt) { _prompt.prompt(); _prompt=null; }
    else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) showGuide();
    else UI.toast('Tarayıcı adres çubuğundan kurabilirsiniz.','info');
  }

  function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true; }
  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }

  function addToGoogleChrome() {
    const android=/android/i.test(navigator.userAgent);
    const mac=navigator.platform.includes('Mac');
    if(android) UI.toast('Chrome ⋮ menüsü → "Ana Ekrana Ekle"','info',6000);
    else if(mac) UI.toast('Chrome → Dosya → "Sayfayı Kısayol Olarak Kaydet…"','info',6000);
    else UI.toast('Chrome ⋮ → Kaydet ve Paylaş → "Sayfayı Kısayol Olarak Kaydet…"','info',6000);
  }

  function showGuide() {
    const steps = isIOS() ? [
      "Safari'de bu sayfayı açın",
      "Alt çubuktaki Paylaş butonuna dokunun",
      '"Ana Ekrana Ekle" seçin',
      '"Ekle" butonuna dokunun'
    ] : /android/i.test(navigator.userAgent) ? [
      "Chrome'da bu sayfayı açın",
      "Sağ üstteki ⋮ menüye dokunun",
      '"Ana Ekrana Ekle" seçin',
      "Onaylayın"
    ] : [
      "Chrome/Edge adres çubuğunda ⊕ simgesine tıklayın",
      "veya: Tarayıcı menüsü → Uygulama Olarak Yükle",
      '"Yükle" seçin',
      "Masaüstünde CIPHER simgesi belirecek"
    ];
    const g=document.createElement('div');
    g.id='pwa-guide-overlay';
    g.style.cssText='position:fixed;inset:0;z-index:200;background:rgba(6,8,15,.95);display:flex;align-items:center;justify-content:center';
    g.innerHTML=`<div style="width:100%;max-width:360px;margin:0 16px;background:#0C1220;border:1px solid #1E2D45;border-radius:20px;padding:24px">
      <div style="text-align:center;margin-bottom:20px"><div style="font-size:40px">📱</div><div style="font-family:Syne,sans-serif;font-weight:700;font-size:18px;color:#DDE8F8;margin-top:8px">Uygulamayı Kur</div></div>
      <ol style="list-style:none;display:flex;flex-direction:column;gap:12px;margin-bottom:20px">
        ${steps.map((s,i)=>`<li style="display:flex;align-items:start;gap:10px"><span style="width:24px;height:24px;min-width:24px;background:#00FFB3;color:#062B1F;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${i+1}</span><span style="color:#DDE8F8;font-size:13px;line-height:1.5">${s}</span></li>`).join('')}
      </ol>
      <div style="display:flex;gap:8px">
        ${_prompt?`<button onclick="PWA.install();document.getElementById('pwa-guide-overlay')?.remove()" style="flex:1;padding:10px;background:linear-gradient(135deg,#00FFB3,#00C48A);color:#062B1F;border-radius:10px;font-weight:700;font-size:13px">Şimdi Kur</button>`:''}
        <button onclick="document.getElementById('pwa-guide-overlay')?.remove()" style="flex:1;padding:10px;background:#131D30;color:#7A8FA8;border:1px solid #1E2D45;border-radius:10px;font-size:13px">Kapat</button>
      </div>
    </div>`;
    document.body.appendChild(g);
  }

  async function register() {
    if (!('serviceWorker' in navigator)) return;
    try { await navigator.serviceWorker.register('/sw.js'); } catch {}
  }

  function init() {
    register();
    if (isStandalone()) document.documentElement.classList.add('pwa-mode');
  }

  return { init, install, addToGoogleChrome, showGuide, isStandalone };
})();

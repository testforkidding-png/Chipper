const PWA = (() => {
  let _prompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); _prompt=e; });
  window.addEventListener('appinstalled', () => { try{UI.toast('CIPHER kuruldu! 🎉','success');}catch{} });
  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
  function isStandalone() { return window.matchMedia('(display-mode:standalone)').matches || navigator.standalone===true; }
  async function install() {
    if (_prompt) { _prompt.prompt(); _prompt=null; }
    else if (isIOS()) showGuide();
    else { try{UI.toast('Tarayıcı menüsünden "Ana Ekrana Ekle" seçin','info',6000);}catch{} }
  }
  function addToGoogleChrome() {
    const a=/android/i.test(navigator.userAgent);
    const m=navigator.platform?.includes('Mac');
    try {
      if(a) UI.toast('Chrome ⋮ → Ana Ekrana Ekle','info',6000);
      else if(m) UI.toast('Chrome → Dosya → Kısayol Olarak Kaydet','info',6000);
      else UI.toast('Chrome ⋮ → Kısayol Olarak Kaydet','info',6000);
    } catch {}
  }
  function showGuide() {
    const steps = isIOS()
      ? ["Safari'de açın","Alt çubuktaki Paylaş'a dokunun",'"Ana Ekrana Ekle" seçin',"Ekle'ye dokunun"]
      : /android/i.test(navigator.userAgent)
        ? ['Chrome\'da açın','⋮ menüsüne dokunun','"Ana Ekrana Ekle" seçin','Onaylayın']
        : ['Chrome/Edge adres çubuğunda ⊕ simgesine tıklayın','Uygulama Olarak Yükle','Yükle\'yi seçin','Masaüstünde simge belirecek'];
    const g=document.createElement('div');
    g.id='pwa-guide';
    g.style.cssText='position:fixed;inset:0;z-index:9000;background:rgba(6,8,15,.96);display:flex;align-items:center;justify-content:center';
    g.innerHTML=`<div style="width:100%;max-width:340px;margin:0 16px;background:#0C1220;border:1px solid #1E2D45;border-radius:20px;padding:22px">
      <div style="text-align:center;margin-bottom:18px"><div style="font-size:36px">📱</div><div style="font-family:Syne,sans-serif;font-weight:700;font-size:16px;color:#DDE8F8;margin-top:8px">Uygulamayı Kur</div></div>
      <ol style="list-style:none;display:flex;flex-direction:column;gap:10px;margin-bottom:18px">
        ${steps.map((s,i)=>`<li style="display:flex;align-items:start;gap:10px"><span style="width:22px;height:22px;min-width:22px;background:#00FFB3;color:#062B1F;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${i+1}</span><span style="color:#DDE8F8;font-size:13px;line-height:1.5">${s}</span></li>`).join('')}
      </ol>
      <button onclick="document.getElementById('pwa-guide')?.remove()" style="width:100%;padding:11px;background:#131D30;color:#7A8FA8;border:1px solid #1E2D45;border-radius:10px;font-size:13px;cursor:pointer">Kapat</button>
    </div>`;
    document.body.appendChild(g);
  }
  async function register() {
    if(!('serviceWorker' in navigator)) return;
    try { await navigator.serviceWorker.register('sw.js'); } catch {}
  }
  function init() {
    register();
    if(isStandalone()) document.documentElement.classList.add('pwa-mode');
  }
  return { init, install, addToGoogleChrome, showGuide, isStandalone };
})();

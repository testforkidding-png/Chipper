const PWA = {
  _prompt: null,
  init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); this._prompt = e; });
  },
  install() {
    if (this._prompt) { this._prompt.prompt(); this._prompt.userChoice.then(() => { this._prompt = null; }); }
    else { UI.toast('Tarayıcı menüsünden "Ana ekrana ekle" seçin', 'info', 4000); }
  }
};

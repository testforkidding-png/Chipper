// CIPHER Service Worker v6 — cache-busted on every deploy
const CACHE = 'cipher-v6';
const ASSETS = [
  'index.html', 'app.html', 'admin.html', 'cipherapp.html', 'gizlilik.html', 'yardim.html', 'hakkinda.html',
  'css/style.css',
  'js/config.js', 'js/db.js', 'js/auth.js',
  'js/ui.js', 'js/messages.js', 'js/app.js', 'js/pwa.js',
  'manifest.json', 'customize/config.json'
];

self.addEventListener('install', e => {
  // Skip waiting immediately — new SW takes over right away
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c =>
      c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))
    ).catch(() => {})
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // JS and HTML files: network-first (never serve stale logic files)
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Everything else: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

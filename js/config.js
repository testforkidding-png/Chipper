/**
 * CIPHER Config v6
 * USE_SUPABASE: true → Supabase (çok cihaz)
 * USE_SUPABASE: false → localStorage (tek cihaz)
 */
const CONFIG = {
  // ─── BACKEND — Supabase bilgilerini buraya girin ───────────────
  USE_SUPABASE: true,
  SUPABASE_URL:      'https://cdsauotkjmpslzecborj.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkc2F1b3Rram1wc2x6ZWNib3JqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NDI1NDIsImV4cCI6MjA5MDAxODU0Mn0.OdEO73kPiF0S2bBIbrT1WricScSFhEri1iMPnwSCCME',

  // ─── Uygulama ──────────────────────────────────────────────────
  APP_NAME: 'CIPHER',
  APP_VERSION: '6.0.0',
  ADMIN_KEY: 'cipher-admin-2024',
  SESSION_TIMEOUT_HOURS: 168,
  MAX_FILE_SIZE_MB: 5,
  ALLOW_REGISTER: true,

  // ─── 4 Sunucu ──────────────────────────────────────────────────
  SERVERS: {
    friends: { id:'friends', label:'Arkadaşlar', icon:'👫', desc:'Arkadaşlarıma özel',  color:'#0066FF' },
    private: { id:'private', label:'Bana Özel',  icon:'🔒', desc:'Sadece ben görürüm', color:'#9333EA' },
    public:  { id:'public',  label:'Herkese Açık',icon:'🌐',desc:'Halka açık',          color:'#10B981' },
    family:  { id:'family',  label:'Aile',        icon:'🏠', desc:'Akrabalarıma özel',  color:'#F59E0B' },
  },

  // ─── Giphy ─────────────────────────────────────────────────────
  GIPHY_API_KEY: 'MyUO0T9onUDn5nmCE15L2daCuRYitSzl',
  GIPHY_LIMIT: 18,

  // ─── Sticker pakları ───────────────────────────────────────────
  STICKER_PACKS: {
    'Duygular': ['😂','😍','🥺','😎','🤔','😴','🥳','😤','😭','🤩','😇','🤗','😬','🙄','😏','🤯','🥴','😵','😆','🤪'],
    'Tepkiler': ['👍','👎','❤️','🔥','⚡','✅','❌','🎉','💯','🚀','👀','💀','🙏','👏','🤝','💪','🫡','🫠','💅','🤌'],
    'Hayvanlar':['🐶','🐱','🦊','🐺','🐻','🐼','🐨','🦁','🐯','🦅','🦋','🐙','🦑','🐠','🦈','🐸','🦎','🐍','🦄','🐉'],
    'Yemek':    ['🍕','🍔','🌮','🍜','🍣','🍩','🎂','🍰','☕','🧋','🍺','🥤','🍎','🍓','🥑','🌶️','🍦','🧁','🥞','🍟'],
    'CIPHER':   ['🔐','🔒','🔓','🛡️','⚔️','🗝️','💻','📱','👁️','🕵️','🌐','📡','🔭','⚙️','🔬','💡','🎯','🎰','🃏','🎭'],
  },

  BANNER_COLORS:['#0A1628','#1A0A28','#0A2818','#281A0A','#1A0A1A','#0A1A28','#280A0A','#0A2828'],

  BADGES: {
    admin:    { icon:'⚡', label:'Yönetici',        color:'#FFD700' },
    early:    { icon:'🌟', label:'Erken Kullanıcı', color:'#00FFB3' },
    verified: { icon:'✅', label:'Doğrulanmış',     color:'#0EA5E9' },
    secure:   { icon:'🔒', label:'Güvenli',         color:'#9333EA' },
  },
};
Object.freeze(CONFIG);
// Tüm sayfalara otomatik olarak ikon ekleyen kod
(function() {
    const iconUrl = 'icon-512.png'; // Logonun adı ve yolu

    // 1. Standart Favicon ekle
    let link = document.createElement('link');
    link.rel = 'icon';
    link.href = iconUrl;
    document.head.appendChild(link);

    // 2. Apple cihazlar için dokunmatik ikon ekle
    let appleLink = document.createElement('link');
    appleLink.rel = 'apple-touch-icon';
    appleLink.href = iconUrl;
    document.head.appendChild(appleLink);
})();

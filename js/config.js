/**
 * CIPHER — Config v4
 * USE_SUPABASE: true → tüm cihazlar aynı veriye erişir
 * Supabase kurulumu: admin.html → SQL sekmesi
 */
const CONFIG = {
  // ─── SUPABASE (zorunlu — çok cihaz desteği için) ───────────────
  USE_SUPABASE: true,
  SUPABASE_URL: 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_ANON_KEY',

  // ─── Uygulama ───────────────────────────────────────────────────
  APP_NAME: 'CIPHER',
  APP_VERSION: '4.0.0',
  ADMIN_KEY: 'cipher-admin-2024',         // Admin paneli şifresi — değiştirin!
  SESSION_TIMEOUT_HOURS: 168,             // 7 gün
  MAX_FILE_SIZE_MB: 5,

  // ─── Kayıt ──────────────────────────────────────────────────────
  ALLOW_REGISTER: true,                   // false → sadece admin ekleyebilir
  REQUIRE_INVITE: false,                  // true → davet kodu gerekli

  // ─── Giphy ──────────────────────────────────────────────────────
  GIPHY_API_KEY: 'dc6zaTOxFJmzC',        // developers.giphy.com → ücretsiz key
  GIPHY_LIMIT: 18,

  // ─── Sticker pakları ────────────────────────────────────────────
  STICKER_PACKS: {
    'Duygular': ['😂','😍','🥺','😎','🤔','😴','🥳','😤','😭','🤩','😇','🤗','😬','🙄','😏','🤯','🥴','😵','😆','🤪'],
    'Tepkiler': ['👍','👎','❤️','🔥','⚡','✅','❌','🎉','💯','🚀','👀','💀','🙏','👏','🤝','💪','🫡','🫠','💅','🤌'],
    'Hayvanlar': ['🐶','🐱','🦊','🐺','🐻','🐼','🐨','🦁','🐯','🦅','🦋','🐙','🦑','🐠','🦈','🐸','🦎','🐍','🦄','🐉'],
    'Yemek':    ['🍕','🍔','🌮','🍜','🍣','🍩','🎂','🍰','☕','🧋','🍺','🥤','🍎','🍓','🥑','🌶️','🍦','🧁','🥞','🍟'],
    'CIPHER':   ['🔐','🔒','🔓','🛡️','⚔️','🗝️','💻','📱','👁️','🕵️','🌐','📡','🔭','⚙️','🔬','💡','🎯','🎰','🃏','🎭']
  },

  BANNER_COLORS: ['#0A1628','#1A0A28','#0A2818','#281A0A','#1A0A1A','#0A1A28','#280A0A','#0A2828'],

  BADGES: {
    admin:    { icon:'⚡', label:'Yönetici',        color:'#FFD700' },
    early:    { icon:'🌟', label:'Erken Kullanıcı', color:'#00FFB3' },
    verified: { icon:'✅', label:'Doğrulanmış',     color:'#0EA5E9' },
    secure:   { icon:'🔒', label:'Güvenli',         color:'#9333EA' },
  }
};
Object.freeze(CONFIG);

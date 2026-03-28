/**
 * CIPHER Config v5
 * localStorage tabanlı — Supabase yok
 * 4 sunucu sistemi
 */
const CONFIG = {
  // ─── Backend ─────────────────────────────────────────────────
  USE_SUPABASE: false,

  // ─── Uygulama ────────────────────────────────────────────────
  APP_NAME: 'CIPHER',
  APP_VERSION: '5.0.0',
  ADMIN_KEY: 'cipher-admin-2024',
  SESSION_TIMEOUT_HOURS: 168,
  MAX_FILE_SIZE_MB: 5,
  ALLOW_REGISTER: true,

  // ─── 4 Sunucu / Space ────────────────────────────────────────
  SERVERS: {
    friends: {
      id: 'friends',
      label: 'Arkadaşlar',
      icon: '👫',
      desc: 'Arkadaşlarıma özel',
      color: '#0066FF',
    },
    private: {
      id: 'private',
      label: 'Bana Özel',
      icon: '🔒',
      desc: 'Sadece benim görebileceğim',
      color: '#9333EA',
    },
    public: {
      id: 'public',
      label: 'Herkese Açık',
      icon: '🌐',
      desc: 'Halka açık alan',
      color: '#10B981',
    },
    family: {
      id: 'family',
      label: 'Aile',
      icon: '🏠',
      desc: 'Akrabalarıma özel',
      color: '#F59E0B',
    },
  },

  // ─── Giphy ───────────────────────────────────────────────────
  GIPHY_API_KEY: 'dc6zaTOxFJmzC',
  GIPHY_LIMIT: 18,

  // ─── Sticker pakları ─────────────────────────────────────────
  STICKER_PACKS: {
    'Duygular': ['😂','😍','🥺','😎','🤔','😴','🥳','😤','😭','🤩','😇','🤗','😬','🙄','😏','🤯','🥴','😵','😆','🤪'],
    'Tepkiler': ['👍','👎','❤️','🔥','⚡','✅','❌','🎉','💯','🚀','👀','💀','🙏','👏','🤝','💪','🫡','🫠','💅','🤌'],
    'Hayvanlar': ['🐶','🐱','🦊','🐺','🐻','🐼','🐨','🦁','🐯','🦅','🦋','🐙','🦑','🐠','🦈','🐸','🦎','🐍','🦄','🐉'],
    'Yemek': ['🍕','🍔','🌮','🍜','🍣','🍩','🎂','🍰','☕','🧋','🍺','🥤','🍎','🍓','🥑','🌶️','🍦','🧁','🥞','🍟'],
    'CIPHER': ['🔐','🔒','🔓','🛡️','⚔️','🗝️','💻','📱','👁️','🕵️','🌐','📡','🔭','⚙️','🔬','💡','🎯','🎰','🃏','🎭'],
  },

  BANNER_COLORS: ['#0A1628','#1A0A28','#0A2818','#281A0A','#1A0A1A','#0A1A28','#280A0A','#0A2828'],

  BADGES: {
    admin:    { icon:'⚡', label:'Yönetici',        color:'#FFD700' },
    early:    { icon:'🌟', label:'Erken Kullanıcı', color:'#00FFB3' },
    verified: { icon:'✅', label:'Doğrulanmış',     color:'#0EA5E9' },
    secure:   { icon:'🔒', label:'Güvenli',         color:'#9333EA' },
  },
};
Object.freeze(CONFIG);

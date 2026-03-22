/**
 * CIPHER — Configuration
 */
const CONFIG = {
  USE_SUPABASE: false,
  SUPABASE_URL: 'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ...',

  // Giphy: https://developers.giphy.com → ücretsiz key al
  GIPHY_API_KEY: 'dc6zaTOxFJmzC',
  GIPHY_LIMIT: 20,

  APP_NAME: 'CIPHER',
  APP_VERSION: '2.0.0',
  ADMIN_KEY: 'cipher-admin-2024',
  SESSION_TIMEOUT_HOURS: 24,
  MAX_FILE_SIZE_MB: 10,

  STICKER_PACKS: {
    'Duygular': ['😂','😍','🥺','😎','🤔','😴','🥳','😤','😭','🤩','😇','🤗','😬','🙄','😏','🤯','🥴','😵','😆','🤪'],
    'Tepkiler': ['👍','👎','❤️','🔥','⚡','✅','❌','🎉','💯','🚀','👀','💀','🙏','👏','🤝','💪','🫡','🫠','💅','🤌'],
    'Hayvanlar': ['🐶','🐱','🦊','🐺','🐻','🐼','🐨','🦁','🐯','🦅','🦋','🐙','🦑','🐠','🦈','🐸','🦎','🐍','🦄','🐉'],
    'Yemek': ['🍕','🍔','🌮','🍜','🍣','🍩','🎂','🍰','☕','🧋','🍺','🥤','🍎','🍓','🥑','🌶️','🍦','🧁','🥞','🍟'],
    'CIPHER': ['🔐','🔒','🔓','🛡️','⚔️','🗝️','💻','📱','👁️','🕵️','🌐','📡','🔭','⚙️','🔬','💡','🎯','🎰','🃏','🎭']
  },

  BANNER_COLORS: ['#0A1628','#1A0A28','#0A2818','#281A0A','#1A0A1A','#0A1A28','#280A0A','#0A2828'],

  BADGES: {
    admin:    { icon: '⚡', label: 'Yönetici',        color: '#FFD700' },
    early:    { icon: '🌟', label: 'Erken Kullanıcı', color: '#00FFB3' },
    verified: { icon: '✅', label: 'Doğrulanmış',      color: '#0EA5E9' },
    secure:   { icon: '🔒', label: 'Güvenli',          color: '#9333EA' },
  }
};
Object.freeze(CONFIG);

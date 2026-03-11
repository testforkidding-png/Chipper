const CONFIG = {
  USERS_JSON_PATH: 'users.json',
  USE_SUPABASE: false,
  SUPABASE_URL: 'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ...',
  APP_NAME: 'CIPHER',
  APP_VERSION: '2.0.0',
  ADMIN_KEY: 'cipher-admin-2024',
  GIPHY_API_KEY: 'dc6zaTOxFJmzC',
  GIPHY_LIMIT: 24,
  SESSION_TIMEOUT_HOURS: 24,
  MAX_FILE_SIZE_MB: 10,
  STICKER_PACKS: [
    { id:'faces', name:'Yüzler', icon:'😄', stickers:['😀','😂','🥹','😍','🤩','😎','🥳','😤','😭','🤯','😱','🥺','😈','👻','💀','🎃','🤖','👽','💩','🤡'] },
    { id:'hands', name:'Jestler', icon:'👋', stickers:['👋','🤝','👍','👎','👏','🙌','🤜','🤛','✊','🤞','✌️','🤟','🤙','💪','🫂','🙏','🤲','👐','🤌','🫶'] },
    { id:'animals', name:'Hayvanlar', icon:'🐶', stickers:['🐶','🐱','🐭','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🦆','🐧','🦅','🦉','🦋','🐝'] },
    { id:'food', name:'Yemek', icon:'🍕', stickers:['🍕','🍔','🌮','🍜','🍣','🍦','☕','🧋','🍺','🎂','🍰','🧁','🍩','🍪','🍫','🥐','🍎','🍓','🍇','🥑'] },
    { id:'symbols', name:'Semboller', icon:'🔒', stickers:['🔒','🛡️','⚔️','🔑','💣','🔥','💯','✨','💎','🎉','⭐','🌟','💫','⚡','🌈','🎯','🚀','💡','🏆','👑'] },
  ],
  BADGES: {
    admin:    { icon:'⚡', label:'Yönetici',        color:'#FFD700' },
    early:    { icon:'🌟', label:'Erken Kullanıcı', color:'#00FFB3' },
    verified: { icon:'✅', label:'Doğrulanmış',     color:'#0EA5E9' },
    secure:   { icon:'🔒', label:'Güvenli',         color:'#9333EA' },
  },
  BANNER_COLORS: ['#0A1628','#1A0A28','#0A2818','#281A0A','#1A0A1A','#0A1A28','#1A2828','#281428'],
};
Object.freeze(CONFIG);

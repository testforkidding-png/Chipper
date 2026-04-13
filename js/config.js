const CONFIG = {
  USE_SUPABASE: true,
  SUPABASE_URL:      'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_ANON_KEY',

  APP_NAME: 'CIPHER',
  ADMIN_KEY: '1453fatih',
  SESSION_HOURS: 168,
  MAX_FILE_MB: 5,
  ALLOW_REGISTER: true,
  GIPHY_API_KEY: 'dc6zaTOxFJmzC',

  SERVERS: {
    friends: { id:'friends', label:'Arkadaşlar', icon:'👫', color:'#0066FF' },
    private: { id:'private', label:'Bana Özel',  icon:'🔒', color:'#9333EA' },
    public:  { id:'public',  label:'Herkese Açık',icon:'🌐',color:'#10B981' },
    family:  { id:'family',  label:'Aile',        icon:'🏠', color:'#F59E0B' },
  },

  STICKER_PACKS: {
    'Duygular': ['😂','😍','🥺','😎','🤔','😴','🥳','😤','😭','🤩','😇','🤗','😬','🙄','😏','🤯','🥴','😵','😆','🤪'],
    'Tepkiler': ['👍','👎','❤️','🔥','⚡','✅','❌','🎉','💯','🚀','👀','💀','🙏','👏','🤝','💪','🫡','🫠','💅','🤌'],
    'Hayvanlar':['🐶','🐱','🦊','🐺','🐻','🐼','🐨','🦁','🐯','🦅','🦋','🐙','🦑','🐠','🦈','🐸','🦎','🐍','🦄','🐉'],
    'Yemek':    ['🍕','🍔','🌮','🍜','🍣','🍩','🎂','🍰','☕','🧋','🍺','🥤','🍎','🍓','🥑','🌶️','🍦','🧁','🥞','🍟'],
    'CIPHER':   ['🔐','🔒','🔓','🛡️','⚔️','🗝️','💻','📱','👁️','🕵️','🌐','📡','🔭','⚙️','🔬','💡','🎯','🎰','🃏','🎭'],
  },

  BADGES: {
    admin:    { icon:'⚡', label:'Yönetici',        color:'#FFD700' },
    early:    { icon:'🌟', label:'Erken Kullanıcı', color:'#00FFB3' },
    verified: { icon:'✅', label:'Doğrulanmış',     color:'#0EA5E9' },
  },

  BANNER_COLORS: ['#0A1628','#1A0A28','#0A2818','#281A0A','#1A0A1A'],
  APP_VERSION: '6.1.0',
};
Object.freeze(CONFIG);

/**
 * CIPHER — Configuration
 */
const CONFIG = {
  // Eğer tüm cihazların aynı veritabanını görmesini istiyorsan bunu true yapmalısın.
  // False olduğunda veriler sadece o anki tarayıcıda (localStorage) saklanır.
  USE_SUPABASE: false, 
  
  // Supabase panelinden (Project Settings > API) alacağın bilgiler:
  SUPABASE_URL: 'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_uwjGrX_zGcsGaZ8I4dZXoA_KSKaZ6lT',

  // Giphy: https://developers.giphy.com → Ücretsiz bir API key alarak GIF özelliğini aktif edebilirsin.
  GIPHY_API_KEY: 'dc6zaTOxFJmzC',
  GIPHY_LIMIT: 20,

  APP_NAME: 'CIPHER',
  APP_VERSION: '2.0.0',
  
  // Admin paneline giriş için gereken anahtar
  ADMIN_KEY: 'cipher-admin-2024',
  
  SESSION_TIMEOUT_HOURS: 24,
  MAX_FILE_SIZE_MB: 10,

  // Uygulama içindeki çıkartma paketleri
  STICKER_PACKS: {
    'Duygular': ['😂','😍','🥺','😎','🤔','😴','🥳','😤','😭','🤩','😇','🤗','😬','🙄','😏','🤯','🥴','😵','😆','🤪'],
    'Tepkiler': ['👍','👎','❤️','🔥','⚡','✅','❌','🎉','💯','🚀','👀','💀','🙏','👏','🤝','💪','🫡','🫠','💅','🤌'],
    'Hayvanlar': ['🐶','🐱','FOX','🐺','🐻','🐼','🐨','🦁','🐯','🦅','🦋','🐙','🦑','🐠',' shark','🐸','🦎','🐍','🦄','🐉'],
    'Yemek': ['🍕','🍔','🌮','🍜','🍣','🍩','🎂','🍰','☕','🧋','🍺','🥤','🍎','🍓','🥑','🌶️','🍦','🧁','🥞','🍟'],
    'CIPHER': ['🔐','🔑','💾','🌐','🚀','🛰️','👾','🤖','📡','📱']
  }
};

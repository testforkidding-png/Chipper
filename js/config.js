/**
 * CIPHER — Configuration
 * 
 * Supabase kurulumu için:
 * 1. https://supabase.com → New Project oluştur
 * 2. Project Settings → API bölümünden URL ve anon key'i kopyala
 * 3. SQL Editor'da setup.sql dosyasını çalıştır
 * 4. USE_SUPABASE = true yap
 * 
 * Supabase yoksa USE_SUPABASE = false bırak → localStorage kullanır
 */

const CONFIG = {
  // ─── DATABASE ───────────────────────────────────────────────────
  USE_SUPABASE: false,                          // true → Supabase, false → localStorage
  SUPABASE_URL: 'https://xxxx.supabase.co',    // Supabase proje URL'i
  SUPABASE_ANON_KEY: 'eyJ...',                  // Supabase anon/public key

  // ─── APP ────────────────────────────────────────────────────────
  APP_NAME: 'CIPHER',
  APP_VERSION: '1.0.0',
  APP_URL: window.location.origin,

  // ─── ADMIN ──────────────────────────────────────────────────────
  // Admin paneline erişim şifresi: /admin.html?key=ADMIN_KEY
  ADMIN_KEY: 'cipher-admin-secret-2024',       // DEĞİŞTİR!

  // ─── SECURITY ───────────────────────────────────────────────────
  SESSION_TIMEOUT_HOURS: 24,
  MAX_FILE_SIZE_MB: 10,
  ALLOWED_FILE_TYPES: ['image/*', 'video/*', 'audio/*', '.pdf', '.txt', '.zip', '.doc', '.docx'],

  // ─── FEATURES ───────────────────────────────────────────────────
  ENABLE_VOICE_MESSAGES: true,
  ENABLE_STORIES: true,
  ENABLE_GROUP_CHATS: true,
  DEFAULT_DESTRUCT_SECONDS: 30,

  // ─── COLORS (profile banner paleti) ─────────────────────────────
  BANNER_COLORS: [
    '#0A1628', '#1A0A28', '#0A2818', '#281A0A',
    '#1A0A1A', '#0A1A28', '#280A0A', '#0A2828',
  ],

  // ─── BADGES ─────────────────────────────────────────────────────
  BADGES: {
    admin:    { icon: '⚡', label: 'Yönetici',       color: '#FFD700' },
    early:    { icon: '🌟', label: 'Erken Kullanıcı', color: '#00FFB3' },
    verified: { icon: '✅', label: 'Doğrulanmış',     color: '#0EA5E9' },
    secure:   { icon: '🔒', label: 'Güvenli',         color: '#9333EA' },
  }
};

// Freeze to prevent accidental mutation
Object.freeze(CONFIG);

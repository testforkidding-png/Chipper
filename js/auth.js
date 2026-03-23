/**
 * CIPHER — Authentication v2.5 (Mobil Uyumlu & Güvenli)
 */
const Auth = (() => {
  const SK = 'cipher_session';
  let _encKey = null;

  // Yardımcı: Metni temizle (Mobil klavye hataları için)
  const clean = (str) => (str || '').toString().trim();

  async function hashPassword(pass) {
    // Şifreyi asla küçük harfe çevirme (Case-sensitive olmalı), sadece boşlukları temizle
    const p = clean(pass);
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p + '_cipher_salt'));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function deriveEncKey(pass, uid) {
    const p = clean(pass);
    const u = clean(uid).toLowerCase();
    
    try {
      const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(p), 'PBKDF2', false, ['deriveKey']);
      _encKey = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: new TextEncoder().encode('cipher_' + u), iterations: 100000, hash: 'SHA-256' },
        km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
      );
    } catch (e) {
      console.error("Şifreleme anahtarı oluşturulamadı (HTTPS gerekiyor olabilir):", e);
    }
  }

  // --- Session Yönetimi (Mobile uyumlu: localStorage kullanıyoruz) ---
  function saveSession(user) {
    const data = {
      username: user.username.toLowerCase(),
      expires: Date.now() + (CONFIG.SESSION_TIMEOUT_HOURS || 24) * 3600000
    };
    // sessionStorage yerine localStorage: Mobil tarayıcılar sekme kapanınca silmesin diye.
    localStorage.setItem(SK, JSON.stringify(data));
  }

  function getSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SK));
      if (!s || s.expires < Date.now()) {
        clearSession();
        return null;
      }
      return s;
    } catch { return null; }
  }

  function clearSession() {
    localStorage.removeItem(SK);
    _encKey = null;
  }

  // --- Ana Fonksiyonlar ---
  async function login(username, password) {
    // Kullanıcı adını küçük harfe zorla (Mobil klavye düzeltmesi)
    const uname = clean(username).toLowerCase();
    const pass = clean(password);

    if (!uname || !pass) throw new Error('Eksik bilgi girdiniz.');

    const user = await DB.getUser(uname);
    if (!user) throw new Error('Kullanıcı bulunamadı.');

    const hash = await hashPassword(pass);
    if (user.password_hash !== hash) throw new Error('Şifre yanlış.');

    // AES anahtarını türet
    await deriveEncKey(pass, user.username);
    
    saveSession(user);
    return user;
  }

  async function currentUser() {
    const s = getSession();
    if (!s) return null;
    return await DB.getUser(s.username);
  }

  function logout() {
    clearSession();
    window.location.href = 'index.html';
  }

  function requireAuth() {
    if (!getSession()) {
      window.location.href = 'index.html';
      return false;
    }
    return true;
  }

  // --- Mesaj Şifreleme (Mevcut mantık korundu) ---
  async function encryptMsg(text) {
    if (!_encKey) return text;
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, _encKey, new TextEncoder().encode(text));
      const buf = new Uint8Array(12 + ct.byteLength);
      buf.set(iv); buf.set(new Uint8Array(ct), 12);
      return btoa(String.fromCharCode(...buf));
    } catch { return text; }
  }

  async function decryptMsg(data) {
    if (!_encKey) return data;
    try {
      const buf = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, _encKey, buf.slice(12));
      return new TextDecoder().decode(pt);
    } catch { return data; }
  }

  return { login, logout, currentUser, requireAuth, encryptMsg, decryptMsg, hashPassword, getSession };
})();

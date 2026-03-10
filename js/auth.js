/**
 * CIPHER — Authentication
 * Kayıt yok. Sadece admin hesap ekleyebilir.
 */

const Auth = (() => {
  const SESSION_KEY = 'cipher_session';

  // ── Crypto helpers ─────────────────────────────────────────────
  async function hashPassword(pass) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pass + '_cipher_salt'));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── Encryption key (per-session, per-user) ─────────────────────
  let _encKey = null;
  async function deriveEncKey(pass, userId) {
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    _encKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: new TextEncoder().encode('cipher_msg_' + userId), iterations: 100000, hash: 'SHA-256' },
      km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  // ── Message encryption ─────────────────────────────────────────
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

  // ── Session ────────────────────────────────────────────────────
  function saveSession(user) {
    const session = { username: user.username, expires: Date.now() + CONFIG.SESSION_TIMEOUT_HOURS * 3600000 };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function getSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY));
      if (!s || s.expires < Date.now()) { clearSession(); return null; }
      return s;
    } catch { return null; }
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    _encKey = null;
  }

  // ── Login ──────────────────────────────────────────────────────
  async function login(username, password) {
    const user = await DB.getUser(username.toLowerCase().trim());
    if (!user) throw new Error('Kullanıcı bulunamadı.');

    const hash = await hashPassword(password);

    // Support both hashed and plain (local demo seeds use a simple hash)
    const isValid = user.password_hash === hash ||
      user.password_hash === Array.from(new TextEncoder().encode(password)).map(b => b.toString(16).padStart(2, '0')).join('');

    if (!isValid) throw new Error('Şifre yanlış.');
    await deriveEncKey(password, user.username);
    saveSession(user);
    return user;
  }

  function logout() {
    clearSession();
    window.location.href = 'index.html';
  }

  async function currentUser() {
    const session = getSession();
    if (!session) return null;
    return await DB.getUser(session.username);
  }

  function requireAuth() {
    if (!getSession()) {
      window.location.href = 'index.html';
      return false;
    }
    return true;
  }

  // ── Admin password hash helper (for admin panel) ───────────────
  async function hashForAdmin(password) {
    return hashPassword(password);
  }

  return { login, logout, currentUser, requireAuth, encryptMsg, decryptMsg, hashForAdmin, getSession };
})();

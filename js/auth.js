/**
 * CIPHER — Auth v2
 * - localStorage instead of sessionStorage (mobile Safari fix)
 * - crypto.subtle fallback for HTTP
 * - Encryption optional (degrades gracefully on HTTP)
 */
const Auth = (() => {
  const SK = 'cipher_session_v2';
  let _encKey = null;

  // ── Hash (same fallback as db.js) ────────────────────────────────
  function _sha256Pure(str) {
    const msg = str + '_cipher_salt';
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < msg.length; i++) {
      const c = msg.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909);
    h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909);
    const base = (4294967296+h1).toString(16).padStart(8,'0') + (4294967296+h2).toString(16).padStart(8,'0');
    let result = '';
    for (let i = 0; i < 4; i++) {
      let hx = 0x811c9dc5;
      for (let j = 0; j < base.length; j++) hx ^= (base.charCodeAt(j) + i * 31);
      hx = (Math.imul(hx, 0x01000193) >>> 0);
      result += (4294967296+hx).toString(16).padStart(8,'0');
    }
    return result.slice(0, 64);
  }

  async function hashPassword(pass) {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      try {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pass + '_cipher_salt'));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
      } catch {}
    }
    return _sha256Pure(pass);
  }

  // ── Encryption (optional, HTTPS only) ────────────────────────────
  async function deriveEncKey(pass, uid) {
    if (typeof crypto === 'undefined' || !crypto.subtle) return;
    try {
      const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
      _encKey = await crypto.subtle.deriveKey(
        { name:'PBKDF2', salt:new TextEncoder().encode('cipher_'+uid), iterations:100000, hash:'SHA-256' },
        km, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']
      );
    } catch { _encKey = null; }
  }

  async function encryptMsg(text) {
    if (!_encKey) return text;
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({name:'AES-GCM',iv}, _encKey, new TextEncoder().encode(text));
      const buf = new Uint8Array(12 + ct.byteLength);
      buf.set(iv); buf.set(new Uint8Array(ct), 12);
      return btoa(String.fromCharCode(...buf));
    } catch { return text; }
  }

  async function decryptMsg(data) {
    if (!_encKey) return data;
    try {
      const buf = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      const pt = await crypto.subtle.decrypt({name:'AES-GCM',iv:buf.slice(0,12)}, _encKey, buf.slice(12));
      return new TextDecoder().decode(pt);
    } catch { return data; }
  }

  // ── Session — use localStorage (not sessionStorage) ──────────────
  // sessionStorage is wiped on iOS when tab is backgrounded
  function saveSession(user) {
    localStorage.setItem(SK, JSON.stringify({
      username: user.username,
      expires: Date.now() + CONFIG.SESSION_TIMEOUT_HOURS * 3600000
    }));
  }

  function getSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SK));
      if (!s) return null;
      if (s.expires < Date.now()) { clearSession(); return null; }
      return s;
    } catch { return null; }
  }

  function clearSession() {
    localStorage.removeItem(SK);
    // Also clear old sessionStorage key
    try { sessionStorage.removeItem('cipher_session'); } catch {}
    _encKey = null;
  }

  // ── Login ────────────────────────────────────────────────────────
  async function login(username, password) {
    const uname = username.toLowerCase().trim();
    if (!uname || !password) throw new Error('Kullanıcı adı ve şifre girin.');

    const user = await DB.getUser(uname);
    if (!user) throw new Error('Kullanıcı bulunamadı.');

    const hash = await hashPassword(password);
    if (user.password_hash !== hash) throw new Error('Şifre yanlış.');

    // Check if locked
    if (user.locked) throw new Error('Hesap kilitli. Lütfen yöneticiye başvurun.');

    await deriveEncKey(password, user.username);
    saveSession(user);
    return user;
  }

  function logout() {
    clearSession();
    // Small delay to ensure storage is written before redirect
    setTimeout(() => { window.location.href = 'index.html'; }, 50);
  }

  async function currentUser() {
    const s = getSession();
    if (!s) return null;
    return await DB.getUser(s.username);
  }

  function requireAuth() {
    if (!getSession()) {
      window.location.href = 'index.html';
      return false;
    }
    return true;
  }

  return { login, logout, currentUser, requireAuth, encryptMsg, decryptMsg, hashPassword, getSession };
})();

const Auth = (() => {
  const KEY = 'cipher2_session';

  function save(username) {
    sessionStorage.setItem(KEY, JSON.stringify({ username, expires: Date.now() + CONFIG.SESSION_TIMEOUT_HOURS * 3600000 }));
  }
  function clear() { sessionStorage.removeItem(KEY); }
  function getSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(KEY));
      if (!s || s.expires < Date.now()) { clear(); return null; }
      return s;
    } catch { return null; }
  }

  async function login(username, password) {
    const ok = await DB.verifyPassword(username.trim().toLowerCase(), password);
    if (!ok) throw new Error('Kullanıcı adı veya şifre yanlış.');
    save(username.trim().toLowerCase());
    return await DB.getUser(username.trim().toLowerCase());
  }

  function logout() { clear(); window.location.href = 'index.html'; }

  async function currentUser() {
    const s = getSession();
    if (!s) return null;
    return await DB.getUser(s.username);
  }

  function requireAuth() {
    if (!getSession()) { window.location.href = 'index.html'; return false; }
    return true;
  }

  return { login, logout, currentUser, requireAuth, getSession };
})();

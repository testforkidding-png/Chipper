const Auth = (() => {
  const SK = 'cipher_session_v2';

  async function login(username, password) {
    const uname = username.toLowerCase().trim();
    if (!uname || !password) throw new Error('Kullanıcı adı ve şifre girin.');

    let user = await DB.getUser(uname);
    if (!user) throw new Error('Kullanıcı bulunamadı!');

    // DB içindeki yeni şifreleme fonksiyonunu kullan
    const hash = await DB._sha256(password);
    
    if (user.password_hash !== hash) throw new Error('Şifre yanlış.');

    localStorage.setItem(SK, JSON.stringify({ username: user.username, loginTime: Date.now() }));
    return user;
  }

  function logout() {
    localStorage.removeItem(SK);
    window.location.href = 'index.html';
  }

  function getSession() {
    try { return JSON.parse(localStorage.getItem(SK)); } catch { return null; }
  }

  function requireAuth() {
    if (!getSession()) { window.location.href = 'index.html'; return false; }
    return true;
  }

  return { login, logout, getSession, requireAuth };
})();

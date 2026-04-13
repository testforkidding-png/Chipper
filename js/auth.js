/**
 * CIPHER Auth v8 — Clean
 */
const Auth = (() => {
  const SK = 'cipher_session_v2';
  let _encKey = null;

  function _sha256(s) {
    const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const b=new TextEncoder().encode(s),L=b.length,bL=L*8,eL=(L+1+8)%64,pL=eL<=56?55-(L+1)%64:119-(L+1)%64;
    const p=new Uint8Array(L+1+pL+1+8);p.set(b);p[L]=0x80;
    const dv=new DataView(p.buffer);dv.setUint32(p.length-4,bL&0xffffffff,false);dv.setUint32(p.length-8,Math.floor(bL/0x100000000),false);
    const r=(n,b)=>(n>>>b)|(n<<(32-b));
    for(let i=0;i<p.length;i+=64){const W=new Uint32Array(64);for(let t=0;t<16;t++)W[t]=dv.getUint32(i+t*4,false);for(let t=16;t<64;t++)W[t]=((r(W[t-2],17)^r(W[t-2],19)^(W[t-2]>>>10))+W[t-7]+(r(W[t-15],7)^r(W[t-15],18)^(W[t-15]>>>3))+W[t-16])|0;let[a,b,c,d,e,f,g,h]=H;for(let t=0;t<64;t++){const T1=(h+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+K[t]+W[t])|0,T2=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))|0;h=g;g=f;f=e;e=(d+T1)|0;d=c;c=b;b=a;a=(T1+T2)|0;}H[0]=(H[0]+a)|0;H[1]=(H[1]+b)|0;H[2]=(H[2]+c)|0;H[3]=(H[3]+d)|0;H[4]=(H[4]+e)|0;H[5]=(H[5]+f)|0;H[6]=(H[6]+g)|0;H[7]=(H[7]+h)|0;}
    return H.map(n=>(n>>>0).toString(16).padStart(8,'0')).join('');
  }
  const hashPassword = s => Promise.resolve(_sha256(s + '_cipher_salt'));

  async function deriveEncKey(pass, uid) {
    if (!crypto?.subtle) return;
    try {
      const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
      _encKey = await crypto.subtle.deriveKey({ name:'PBKDF2', salt:new TextEncoder().encode('cipher_'+uid), iterations:100000, hash:'SHA-256' }, km, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
    } catch { _encKey = null; }
  }

  async function encryptMsg(t) { if(!_encKey)return t; try{const iv=crypto.getRandomValues(new Uint8Array(12));const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},_encKey,new TextEncoder().encode(t));const b=new Uint8Array(12+ct.byteLength);b.set(iv);b.set(new Uint8Array(ct),12);return btoa(String.fromCharCode(...b));}catch{return t;} }
  async function decryptMsg(d) { if(!_encKey)return d; try{const b=Uint8Array.from(atob(d),c=>c.charCodeAt(0));const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b.slice(0,12)},_encKey,b.slice(12));return new TextDecoder().decode(pt);}catch{return d;} }

  function _saveSession(user) {
    const safe = { username:user.username, display_name:user.display_name||'', avatar_url:user.avatar_url||null, is_admin:user.is_admin||false, badges:user.badges||[], banner_color:user.banner_color||'#0A1628', status:user.status||'', status_emoji:user.status_emoji||'', server_roles:user.server_roles||{}, bio:user.bio||'', password_hash:user.password_hash||'' };
    const payload = { username:user.username, expires:Date.now()+CONFIG.SESSION_HOURS*3600000, user:safe };
    const data = JSON.stringify(payload);
    // Save to multiple places for maximum reliability
    try { localStorage.setItem(SK, data); } catch(e) { console.error('localStorage save failed:', e); }
    try { sessionStorage.setItem('cipher_session_backup', data); } catch(e) {}
    // Also save to a legacy key in case app.js looks for it
    try { localStorage.setItem('cipher_session', data); } catch(e) {}
    console.log('[CIPHER auth] session saved for:', user.username, '| expires:', new Date(payload.expires).toISOString());
  }
  function getSession() { try { const s=JSON.parse(localStorage.getItem(SK)); if(!s||s.expires<Date.now()){localStorage.removeItem(SK);return null;} return s; } catch{return null;} }
  function _clear() { localStorage.removeItem(SK); localStorage.removeItem('cipher_session'); try { sessionStorage.removeItem('cipher_session_backup'); } catch(e) {} _encKey=null; }

  async function login(uname, password) {
    const u = uname.toLowerCase().trim();
    if (!u||!password) throw new Error('Kullanıcı adı ve şifre girin.');
    let user;
    try { user = await DB.getUser(u); }
    catch(e) {
      if (e.message.includes('column')||e.message.includes('schema')) throw new Error('Şema eksik — admin panelindeki SQL\'i çalıştırın.');
      if (e.message.includes('fetch')||e.message.includes('network')||e.message.includes('Failed')) throw new Error('Sunucuya ulaşılamıyor.');
      throw new Error('Giriş hatası: ' + e.message);
    }
    if (!user) throw new Error('Kullanıcı bulunamadı.');
    if (user.locked) throw new Error('Hesap kilitli.');
    if (user.stale_hash) throw new Error('Şifrenizi admin panelinden sıfırlatın.');
    const hash = await hashPassword(password);
    if (user.password_hash !== hash) throw new Error('Şifre yanlış.');
    await deriveEncKey(password, u);
    _saveSession(user);
    DB.updateUser(u, { last_seen:Date.now(), online:true }).catch(()=>{});
    return user;
  }

  async function register(uname, password, displayName) {
    if (!CONFIG.ALLOW_REGISTER) throw new Error('Kayıt kapalı.');
    const u = uname.toLowerCase().trim();
    if (!/^[a-z0-9_.-]{3,20}$/.test(u)) throw new Error('Kullanıcı adı: 3-20 karakter, harf/rakam/_');
    if (password.length < 6) throw new Error('Şifre en az 6 karakter.');
    if (!displayName?.trim()) throw new Error('Ad zorunlu.');
    let existing;
    try { existing = await DB.getUser(u); }
    catch(e) { throw new Error('Bağlantı hatası: ' + e.message); }
    if (existing) throw new Error('Bu kullanıcı adı alınmış.');
    const hash = await hashPassword(password), now = Date.now();
    const user = await DB.createUser({ username:u, password_hash:hash, display_name:displayName.trim(), bio:'', avatar_url:null, banner_color:'#0A1628', status:'', status_emoji:'', is_admin:false, locked:false, badges:['early'], server_roles:{friends:false,private:false,public:true,family:false}, last_seen:now, online:true, created_at:now });
    await deriveEncKey(password, u);
    _saveSession(user);
    return user;
  }

  async function changeDisplayName(username, newName) {
    if (!newName?.trim()) throw new Error('Ad boş olamaz.');
    return DB.updateUser(username, { display_name: newName.trim() });
  }

  async function changePassword(username, oldPwd, newPwd) {
    const user = await DB.getUser(username);
    if (!user) throw new Error('Kullanıcı bulunamadı.');
    if (user.password_hash !== await hashPassword(oldPwd)) throw new Error('Mevcut şifre yanlış.');
    if (newPwd.length < 6) throw new Error('Yeni şifre en az 6 karakter.');
    return DB.updateUser(username, { password_hash: await hashPassword(newPwd) });
  }

  function logout() {
    const s = getSession();
    if (s) DB.updateUser(s.username, { last_seen:Date.now(), online:false }).catch(()=>{});
    _clear();
    setTimeout(() => window.location.href = 'index.html', 50);
  }

  async function currentUser() {
    const s = getSession(); if (!s) return null;
    if (s.user) return s.user;
    return DB.getUser(s.username);
  }

  function requireAuth() { if (!getSession()) { window.location.href='index.html'; return false; } return true; }

  // Heartbeat
  const _lsk = u => 'cipher_ls_' + u;
  const _lsLocal = (u, ts, on) => { try { localStorage.setItem(_lsk(u), JSON.stringify({ts,online:on})); } catch {} };
  const _getLocal = u => { try { return JSON.parse(localStorage.getItem(_lsk(u))); } catch { return null; } };

  function startHeartbeat(username) {
    const tick = () => { const n=Date.now(); _lsLocal(username,n,true); DB.updateUser(username,{last_seen:n,online:true}).catch(()=>{}); };
    const off  = () => { const n=Date.now(); _lsLocal(username,n,false); DB.updateUser(username,{last_seen:n,online:false}).catch(()=>{}); };
    tick();
    setInterval(tick, 25000);
    window.addEventListener('beforeunload', off);
    window.addEventListener('pagehide', off);
    document.addEventListener('visibilitychange', () => document.hidden ? off() : tick());
    window.addEventListener('focus', tick);
    window.addEventListener('blur', off);
  }

  return { login, register, logout, currentUser, requireAuth, changeDisplayName, changePassword, encryptMsg, decryptMsg, hashPassword, getSession, startHeartbeat, getLastSeenLocal: _getLocal };
})();

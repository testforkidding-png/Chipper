/**
 * CIPHER - Ultimate Auth & DB Fix v3.1
 * Kayıt ve Giriş senkronizasyonu düzeltildi.
 */

const DB = (() => {
  const store = 'cipher_users_v3'; // Versiyonu güncelledik, temiz başlangıç yapar.
  
  const _all = () => {
    try {
      return JSON.parse(localStorage.getItem(store) || '{}');
    } catch { return {}; }
  };

  return {
    getUser: async (u) => {
      if (!u) return null;
      const cleanU = u.toLowerCase().trim();
      const users = _all();
      return users[cleanU] || null;
    },
    saveUser: async (user) => {
      const users = _all();
      const cleanU = user.username.toLowerCase().trim();
      users[cleanU] = {
        ...user,
        username: cleanU, // Kaydederken her zaman küçük harf
        created: Date.now()
      };
      localStorage.setItem(store, JSON.stringify(users));
      return users[cleanU];
    }
  };
})();

const Auth = (() => {
  const SK = 'cipher_session_v3';

  // SHA-256 (Kırılmaz ve Stabil)
  function _sha256(str) {
    const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const bytes=new TextEncoder().encode(str);
    const len=bytes.length,bitLen=len*8;
    const extra=(len+1+8)%64,padLen=extra<=56?55-(len+1)%64:119-(len+1)%64;
    const padded=new Uint8Array(len+1+padLen+1+8);
    padded.set(bytes);padded[len]=0x80;
    const dv=new DataView(padded.buffer);
    dv.setUint32(padded.length-4,bitLen&0xffffffff,false);
    dv.setUint32(padded.length-8,Math.floor(bitLen/0x100000000),false);
    const r=(n,b)=>(n>>>b)|(n<<(32-b));
    for(let i=0;i<padded.length;i+=64){
      const W=new Uint32Array(64);
      for(let t=0;t<16;t++)W[t]=dv.getUint32(i+t*4,false);
      for(let t=16;t<64;t++)W[t]=((r(W[t-2],17)^r(W[t-2],19)^(W[t-2]>>>10))+W[t-7]+(r(W[t-15],7)^r(W[t-15],18)^(W[t-15]>>>3))+W[t-16])|0;
      let[a,b,c,d,e,f,g,h]=H;
      for(let t=0;t<64;t++){
        const T1=(h+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+K[t]+W[t])|0;
        const T2=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))|0;
        h=g;g=f;f=e;e=(d+T1)|0;d=c;c=b;b=a;a=(T1+T2)|0;
      }
      H[0]=(H[0]+a)|0;H[1]=(H[1]+b)|0;H[2]=(H[2]+c)|0;H[3]=(H[3]+d)|0;
      H[4]=(H[4]+e)|0;H[5]=(H[5]+f)|0;H[6]=(H[6]+g)|0;H[7]=(H[7]+h)|0;
    }
    return H.map(n=>(n>>>0).toString(16).padStart(8,'0')).join('');
  }

  const hashPassword = (p) => Promise.resolve(_sha256(p + '_cipher_salt'));

  return {
    register: async (username, password, name) => {
      const uname = (username || "").toLowerCase().trim();
      if (!uname || !password) throw new Error("Bilgiler eksik.");
      
      const exists = await DB.getUser(uname);
      if (exists) throw new Error("Kullanıcı zaten var.");

      const hash = await hashPassword(password);
      return await DB.saveUser({
        username: uname,
        password_hash: hash,
        displayName: name || uname,
        locked: false
      });
    },

    login: async (username, password) => {
      const uname = (username || "").toLowerCase().trim();
      const user = await DB.getUser(uname);
      
      if (!user) {
        console.error("Bulunamayan kullanıcı:", uname);
        throw new Error("Kullanıcı bulunamadı.");
      }

      const hash = await hashPassword(password);
      if (user.password_hash !== hash) throw new Error("Şifre yanlış.");

      localStorage.setItem(SK, JSON.stringify({
        username: uname, 
        expires: Date.now() + 86400000 
      }));
      return user;
    },

    logout: () => {
      localStorage.removeItem(SK);
      window.location.reload();
    },

    getSession: () => {
      try {
        const s = JSON.parse(localStorage.getItem(SK));
        return (s && s.expires > Date.now()) ? s : null;
      } catch { return null; }
    }
  };
})();

// Global erişim
window.Auth = Auth;
window.DB = DB;

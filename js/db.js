/**
 * CIPHER DB v4 - Tam Supabase Uyumlu
 */
const DB = (() => {
  const NS = 'cipher_';
  
  // Supabase bağlantısını kur
  const supabase = (CONFIG.USE_SUPABASE && typeof supabase !== 'undefined') 
    ? supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY) 
    : null;

  const impl = () => {
    // SUPABASE MODU
    if (CONFIG.USE_SUPABASE && supabase) {
      return {
        // KULLANICILAR
        getUser: async (username) => {
          const { data } = await supabase.from('users').select('*').eq('username', username).single();
          return data;
        },
        getAllUsers: async () => {
          const { data } = await supabase.from('users').select('*');
          return data || [];
        },
        createUser: async (user) => {
          const { error } = await supabase.from('users').insert([user]);
          if (error) throw error;
          return true;
        },
        deleteUser: async (username) => {
          await supabase.from('users').delete().eq('username', username);
        },

        // MESAJLAR & KONUŞMALAR
        getConversations: async (username) => {
          const { data } = await supabase.from('conversations')
            .select('*')
            .filter('participants', 'cs', `{"${username}"}`);
          return data || [];
        },
        getConversation: async (id) => {
          const { data } = await supabase.from('conversations').select('*').eq('id', id).single();
          return data;
        },
        createConversation: async (conv) => {
          const { error } = await supabase.from('conversations').upsert([conv]);
          if (error) throw error;
          return conv;
        },
        updateConversation: async (id, updates) => {
          await supabase.from('conversations').update(updates).eq('id', id);
        },
        getMessages: async (convId) => {
          const { data } = await supabase.from('messages').select('*').eq('conv_id', convId).order('created_at', { ascending: true });
          return data || [];
        },
        createMessage: async (msg) => {
          const { error } = await supabase.from('messages').insert([msg]);
          if (error) throw error;
          return msg;
        },
        subscribeMessages: (convId, callback) => {
          return supabase.channel(`msgs_${convId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conv_id=eq.${convId}` }, callback)
            .subscribe();
        }
      };
    }

    // LOCALSTORAGE MODU (Eski sistem - Sadece bu cihazda kalır)
    return {
      getUser: async (u) => JSON.parse(localStorage.getItem(NS + 'u_' + u)),
      getAllUsers: async () => {
        const users = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key.startsWith(NS + 'u_')) users.push(JSON.parse(localStorage.getItem(key)));
        }
        return users;
      },
      createUser: async (user) => {
        localStorage.setItem(NS + 'u_' + user.username, JSON.stringify(user));
      },
      // ... diğer yerel fonksiyonlar
    };
  };

  return {
    ...impl(),
    _sha256: async (str) => { // Auth.js ile aynı sonucu vermesi için
        const buf = new TextEncoder().encode(str);
        const hash = await crypto.subtle.digest('SHA-256', buf);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  };
})();

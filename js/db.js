/**
 * CIPHER DB v4 - Tam Supabase Entegrasyonu
 */
const DB = (() => {
  const NS = 'cipher_';
  
  // Supabase istemcisini başlat
  const supabaseClient = (CONFIG.USE_SUPABASE && typeof supabase !== 'undefined') 
    ? supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY) 
    : null;

  const impl = () => {
    if (CONFIG.USE_SUPABASE && supabaseClient) {
      return {
        // --- KULLANICI İŞLEMLERİ ---
        getUser: async (username) => {
          const { data } = await supabaseClient.from('users').select('*').eq('username', username).single();
          return data;
        },
        getAllUsers: async () => {
          const { data } = await supabaseClient.from('users').select('*').order('created_at', { ascending: false });
          return data || [];
        },
        createUser: async (user) => {
          const { data, error } = await supabaseClient.from('users').insert([user]);
          if (error) throw error;
          return data;
        },
        deleteUser: async (username) => {
          const { error } = await supabaseClient.from('users').delete().eq('username', username);
          if (error) throw error;
        },

        // --- MESAJ & KONUŞMA İŞLEMLERİ ---
        getConversations: async (username) => {
          const { data } = await supabaseClient.from('conversations').select('*').filter('participants', 'cs', `{"${username}"}`);
          return data || [];
        },
        getConversation: async (id) => {
          const { data } = await supabaseClient.from('conversations').select('*').eq('id', id).single();
          return data;
        },
        createConversation: async (conv) => {
          await supabaseClient.from('conversations').upsert([conv]);
          return conv;
        },
        updateConversation: async (id, updates) => {
          await supabaseClient.from('conversations').update(updates).eq('id', id);
        },
        getMessages: async (convId) => {
          const { data } = await supabaseClient.from('messages').select('*').eq('conv_id', convId).order('created_at', { ascending: true });
          return data || [];
        },
        createMessage: async (msg) => {
          await supabaseClient.from('messages').insert([msg]);
          return msg;
        },
        subscribeMessages: (convId, callback) => {
          return supabaseClient.channel(`msgs_${convId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conv_id=eq.${convId}` }, callback)
            .subscribe();
        }
      };
    }

    // --- LOCALSTORAGE YEDEĞİ (Supabase Kapalıysa) ---
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
      createUser: async (user) => localStorage.setItem(NS + 'u_' + user.username, JSON.stringify(user)),
      deleteUser: async (u) => localStorage.removeItem(NS + 'u_' + u),
      getConversations: async () => [],
      getMessages: async () => []
    };
  };

  return {
    ...impl(),
    _sha256: async (str) => {
      const buf = new TextEncoder().encode(str);
      const hash = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  };
})();

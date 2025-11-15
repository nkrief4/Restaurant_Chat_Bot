(function () {
  let clientPromise = null;

  async function fetchConfig() {
    const response = await fetch("/api/config");
    if (!response.ok) {
      throw new Error("Unable to load Supabase configuration.");
    }
    const payload = await response.json();
    if (!payload?.supabaseUrl || !payload?.supabaseAnonKey) {
      throw new Error("Supabase configuration is incomplete.");
    }
    return payload;
  }

  window.getSupabaseClient = async function getSupabaseClient() {
    if (clientPromise) {
      return clientPromise;
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabase SDK is not loaded.");
    }
    clientPromise = (async () => {
      const { supabaseUrl, supabaseAnonKey } = await fetchConfig();
      return window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          detectSessionInUrl: true,
        },
      });
    })();
    return clientPromise;
  };
})();

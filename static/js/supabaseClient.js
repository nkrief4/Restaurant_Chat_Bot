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

  async function performSecuredLogin(email, password) {
    if (!email || !password) {
      throw new Error("Email et mot de passe requis.");
    }
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      credentials: "same-origin",
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok || !payload) {
      const detail = payload?.detail || "Impossible de vérifier vos identifiants.";
      throw new Error(detail);
    }

    if (!payload.access_token || !payload.refresh_token) {
      throw new Error("Réponse d'authentification incomplète.");
    }

    const supabase = await getSupabaseClient();
    const { error } = await supabase.auth.setSession({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
    });
    if (error) {
      throw error;
    }
    return payload;
  }

  window.secureSupabaseLogin = performSecuredLogin;
})();

import { state } from "./state.js";

export function redirectToLogin() {
    // Nettoyage avant redirection
    if (window.location.pathname !== '/login') {
        window.location.href = '/login';
    }
}

export async function ensureAuthenticated() {
    const { data, error } = await state.supabase.auth.getSession();
    if (error || !data?.session) {
        redirectToLogin();
        throw error || new Error("AUTH_REQUIRED");
    }
    state.session = data.session;
    state.token = data.session.access_token || null;
    const userId = data.session.user?.id || null;
    if (state.token) {
        try {
            window.supabaseToken = state.token; // legacy consumers
            localStorage.setItem("supabase_token", state.token);
            const previousUserId = localStorage.getItem("supabase_user_id");
            if (previousUserId && userId && previousUserId !== userId) {
                localStorage.removeItem("activeRestaurantId");
                localStorage.removeItem("restaurantId");
            }
            if (userId) {
                localStorage.setItem("supabase_user_id", userId);
            }
        } catch (_) {
            // ignore storage errors
        }
    }
    return data.session.user;
}

export async function getAccessToken() {
    if (state.token) {
        return state.token;
    }
    const { data, error } = await state.supabase.auth.getSession();
    const token = data && data.session ? data.session.access_token : null;
    if (error || !token) {
        throw new Error("Session expirée. Merci de vous reconnecter.");
    }
    state.session = data.session;
    state.token = token;
    try {
        window.supabaseToken = token;
        localStorage.setItem("supabase_token", token);
        const userId = data.session?.user?.id || null;
        const previousUserId = localStorage.getItem("supabase_user_id");
        if (previousUserId && userId && previousUserId !== userId) {
            localStorage.removeItem("activeRestaurantId");
            localStorage.removeItem("restaurantId");
        }
        if (userId) {
            localStorage.setItem("supabase_user_id", userId);
        }
    } catch (_) {
        // ignore storage errors
    }
    return token;
}

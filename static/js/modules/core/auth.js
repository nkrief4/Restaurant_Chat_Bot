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
    window.supabaseToken = state.token; // Ensure legacy scripts have access immediately
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
    return token;
}

import { state } from "./state.js";

export async function ensureSupabaseClient() {
    if (state.supabase) {
        return state.supabase;
    }
    if (!window.getSupabaseClient) {
        throw new Error("Supabase non initialisé");
    }
    state.supabase = await window.getSupabaseClient();
    return state.supabase;
}

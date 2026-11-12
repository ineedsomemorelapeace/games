import { createClient as createSupabaseClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm";
const SUPABASE_URL = "https://nboidswcvvszojuvthcf.supabase.co";
const SUPABASE_KEY = "sb_publishable_q-rzIARDR4vBxvSS0AeIrw_mE_b6qeR";
const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "carsongames_supabase_auth" },
  realtime: { params: { eventsPerSecond: 10 } }
});
function decorateUser(user) {
  if (!user) return null;
  return Object.assign(user, { username: user.user_metadata?.username || user.username || user.email?.split("@")[0] || "User" });
}
function decorateSession(session) {
  if (session?.user) decorateUser(session.user);
  return session;
}
const auth = {
  async signUp({ email, username, password }) {
    try {
      const cleanEmail = String(email || "").trim().toLowerCase();
      const cleanUsername = String(username || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error("Enter a valid email address.");
      if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(cleanUsername)) throw new Error("Username must be 3–24 characters and use only letters, numbers, dots, underscores, or hyphens.");
      if (typeof password !== "string" || password.length < 8) throw new Error("Password must be at least 8 characters.");
      const result = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: { data: { username: cleanUsername } }
      });
      if (result.error) throw result.error;
      if (!result.data.session) throw new Error("Account created, but email confirmation is enabled. In Supabase, open Authentication → Sign In / Providers → Email and turn OFF Confirm email, then sign in here.");
      decorateUser(result.data.user);
      return { data: result.data, error: null };
    } catch (error) { return { data: null, error }; }
  },
  async signInWithPassword({ email, password }) {
    try {
      const cleanEmail = String(email || "").trim().toLowerCase();
      const result = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
      if (result.error) throw result.error;
      decorateUser(result.data.user);
      return { data: result.data, error: null };
    } catch (error) { return { data: null, error }; }
  },
  async getUser() {
    const result = await supabase.auth.getUser();
    if (result.data?.user) decorateUser(result.data.user);
    return result;
  },
  signOut: () => supabase.auth.signOut(),
  updateUser: (attributes) => supabase.auth.updateUser(attributes),
  onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange((event, session) => {
      const decorated = decorateSession(session);
      window.setTimeout(() => callback(event, decorated), 0);
    });
  }
};
const storage = {
  from(bucket) {
    const api = supabase.storage.from(bucket);
    return {
      upload(path, file, options = {}) {
        return api.upload(path, file, { contentType: options.contentType || file?.type || "application/octet-stream", upsert: options.upsert ?? false, cacheControl: options.cacheControl || "3600" });
      },
      list(prefix = "", options = {}) { return api.list(prefix, options); },
      remove(paths) { return api.remove(paths); },
      getPublicUrl(path) { return api.getPublicUrl(path); },
      createSignedUrl(path, expiresIn) { return api.createSignedUrl(path, expiresIn); }
    };
  }
};
export function createClient() {
  return {
    from: (table) => supabase.from(table),
    auth,
    storage,
    functions: { invoke: (...args) => supabase.functions.invoke(...args) },
    channel: (name, options) => supabase.channel(String(name).replace(/^public:/, "cg:"), options),
    removeChannel: (channel) => supabase.removeChannel(channel)
  };
}
export { supabase };

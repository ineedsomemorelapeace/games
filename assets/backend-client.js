import { createClient as createSupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
const SUPABASE_URL = "https://nboidswcvvszojuvthcf.supabase.co";
const SUPABASE_KEY = "sb_publishable_q-rzIARDR4vBxvSS0AeIrw_mE_b6qeR";
const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "carsongames_supabase_auth" },
  realtime: { params: { eventsPerSecond: 10 } }
});
function usernameEmail(username) {
  const clean = String(username || "").trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,24}$/.test(clean)) throw new Error("Username must be 3–24 characters and use only letters, numbers, dots, underscores, or hyphens.");
  return clean + "@accounts.carsongames.local";
}
function decorateUser(user) {
  if (!user) return null;
  return Object.assign(user, { username: user.user_metadata?.username || user.username || user.email?.split("@")[0] || "User" });
}
function decorateSession(session) {
  if (session?.user) decorateUser(session.user);
  return session;
}
const auth = {
  async signUp({ username, password }) {
    try {
      const email = usernameEmail(username);
      if (typeof password !== "string" || password.length < 8) throw new Error("Password must be at least 8 characters.");
      const result = await supabase.auth.signUp({ email, password, options: { data: { username: String(username).trim() } } });
      if (result.error) throw result.error;
      if (!result.data.session) throw new Error("Account created, but Supabase requires email confirmation. In Dih, open Authentication → Sign In / Providers → Email and turn OFF Confirm email. These username-only accounts use an internal address and cannot receive confirmation emails.");
      decorateUser(result.data.user);
      return { data: result.data, error: null };
    } catch (error) { return { data: null, error }; }
  },
  async signInWithPassword({ username, password }) {
    try {
      const result = await supabase.auth.signInWithPassword({ email: usernameEmail(username), password });
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
    return supabase.auth.onAuthStateChange((event, session) => callback(event, decorateSession(session)));
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
    channel: (name, options) => supabase.channel(String(name).replace(/^public:/, "cg:"), options),
    removeChannel: (channel) => supabase.removeChannel(channel)
  };
}
export { supabase };

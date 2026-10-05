const API_ROOT = "/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The server request failed.");
  return body;
}

class Query {
  constructor(table) {
    this.table = table;
    this.operation = "select";
    this.selectColumns = "*";
    this.filters = [];
    this.orderBy = null;
    this.maxRows = null;
    this.values = [];
    this.inputRows = null;
  }

  select(columns = "*") { this.selectColumns = columns; this.operation = "select"; return this; }
  eq(column, value) { this.filters.push({ column, operator: "eq", value }); return this; }
  neq(column, value) { this.filters.push({ column, operator: "neq", value }); return this; }
  in(column, value) { this.filters.push({ column, operator: "in", value }); return this; }
  not(column, operator, value) { this.filters.push({ column, operator: operator === "is" && value === null ? "not_null" : "neq", value }); return this; }
  order(column, options = {}) { this.orderBy = { column, ascending: options.ascending !== false }; return this; }
  limit(value) { this.maxRows = value; return this; }
  single() { this.singleResult = true; return this; }
  maybeSingle() { this.singleResult = true; this.maybeSingleResult = true; return this; }
  insert(rows) { this.operation = "insert"; this.inputRows = Array.isArray(rows) ? rows : [rows]; return this; }
  update(values) { this.operation = "update"; this.values = [values]; return this; }
  delete() { this.operation = "delete"; return this; }

  async execute() {
    try {
      const result = await request("/db/query", { method: "POST", body: JSON.stringify({ table: this.table, operation: this.operation, select: this.selectColumns, filters: this.filters, order: this.orderBy, limit: this.maxRows, values: this.values, rows: this.inputRows }) });
      let data = result.data;
      if (this.singleResult) data = data[0] || null;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  then(resolve, reject) { return this.execute().then(resolve, reject); }
}

function authApi() {
  const listeners = new Set();
  const notify = user => listeners.forEach(listener => listener("SIGNED_IN", { user }));
  return {
    async signUp({ email, password, options = {} }) {
      try { const result = await request("/auth/signup", { method: "POST", body: JSON.stringify({ email, password, username: options.data?.username }) }); notify(result.user); return { data: result, error: null }; }
      catch (error) { return { data: null, error }; }
    },
    async signInWithPassword({ email, password }) {
      try { const result = await request("/auth/signin", { method: "POST", body: JSON.stringify({ email, password }) }); notify(result.user); return { data: result, error: null }; }
      catch (error) { return { data: null, error }; }
    },
    async getUser() { try { const result = await request("/auth/user"); return { data: { user: result.user }, error: null }; } catch (error) { return { data: { user: null }, error }; } },
    async signOut() { await request("/auth/signout", { method: "POST" }); notify(null); return { error: null }; },
    async updateUser({ password }) { try { await request("/auth/password", { method: "PATCH", body: JSON.stringify({ password }) }); return { error: null }; } catch (error) { return { error }; } },
    onAuthStateChange(callback) { listeners.add(callback); authApi().getUser().then(result => callback("INITIAL_SESSION", result.data)); return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } }; }
  };
}

function storageApi() {
  return {
    from(bucket) {
      return {
        async upload(path, file) {
          try { await request(`/storage/${encodeURIComponent(bucket)}/${encodeURIComponent(path)}`, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file }); return { error: null }; } catch (error) { return { error }; }
        },
        async list(prefix = "") { try { return { data: (await request(`/storage/${encodeURIComponent(bucket)}?prefix=${encodeURIComponent(prefix)}`)).files, error: null }; } catch (error) { return { data: [], error }; } },
        async remove(paths) { try { await request(`/storage/${encodeURIComponent(bucket)}`, { method: "DELETE", body: JSON.stringify({ paths }) }); return { error: null }; } catch (error) { return { error }; } },
        getPublicUrl(path) { return { data: { publicUrl: `${API_ROOT}/storage/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}` } }; }
      };
    }
  };
}

export function createClient() {
  const auth = authApi();
  return {
    from: table => new Query(table),
    auth,
    storage: storageApi(),
    channel: () => ({ on: function () { return this; }, subscribe: callback => { callback?.("SUBSCRIBED"); return { unsubscribe() {} }; } }),
    removeChannel: () => {}
  };
}
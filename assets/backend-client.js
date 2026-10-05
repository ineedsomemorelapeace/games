const API_ROOT = "https://carson-games-e801ce365c25.herokuapp.com/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    credentials: "include",
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

  select(columns = "*") {
    this.selectColumns = columns;
    if (!this.inputRows && this.operation === "select") this.operation = "select";
    this.returnRows = this.operation === "insert" || this.operation === "update";
    return this;
  }
  eq(column, value) { this.filters.push({ column, operator: "eq", value }); return this; }
  neq(column, value) { this.filters.push({ column, operator: "neq", value }); return this; }
  ilike(column, value) { this.filters.push({ column, operator: "ilike", value }); return this; }
  in(column, value) { this.filters.push({ column, operator: "in", value }); return this; }
  contains(column, value) { this.filters.push({ column, operator: "contains", value }); return this; }
  gte(column, value) { this.filters.push({ column, operator: "gte", value }); return this; }
  not(column, operator, value) { this.filters.push({ column, operator: operator === "is" && value === null ? "not_null" : "neq", value }); return this; }
  order(column, options = {}) { this.orderBy = { column, ascending: options.ascending !== false }; return this; }
  limit(value) { this.maxRows = value; return this; }
  range(from, to) { this.offset = from; this.maxRows = to - from + 1; return this; }
  single() { this.singleResult = true; return this; }
  maybeSingle() { this.singleResult = true; this.maybeSingleResult = true; return this; }
  insert(rows) { this.operation = "insert"; this.inputRows = Array.isArray(rows) ? rows : [rows]; return this; }
  update(values) { this.operation = "update"; this.values = [values]; return this; }
  delete() { this.operation = "delete"; return this; }

  async execute() {
    try {
      const result = await request("/db/query", { method: "POST", body: JSON.stringify({ table: this.table, operation: this.operation, select: this.selectColumns, filters: this.filters, order: this.orderBy, offset: this.offset, limit: this.maxRows, values: this.values, rows: this.inputRows, returning: this.returnRows }) });
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

function parseChannelFilter(filter) {
  if (!filter) return null;
  const match = filter.match(/^([A-Za-z_][A-Za-z0-9_]*)=(eq|neq|ilike|gte)=(.*)$/);
  return match ? { column: match[1], operator: match[2], value: match[3] } : null;
}

function createChannel(name) {
  const databaseHandlers = [];
  const broadcastHandlers = [];
  let timer = null;
  let eventCursor = 0;
  let previousRows = null;
  let stopped = false;

  async function pollDatabase() {
    const config = databaseHandlers[0]?.config;
    if (!config || stopped) return;
    const table = config.table;
    const filter = parseChannelFilter(config.filter);
    const query = request("/db/query", {
      method: "POST",
      body: JSON.stringify({ table, operation: "select", select: "*", filters: filter ? [filter] : [], order: { column: "id", ascending: true }, limit: 1000 })
    });

    try {
      const rows = (await query).data || [];
      const currentRows = new Map(rows.map(row => [String(row.id), row]));
      if (previousRows) {
        for (const row of rows) {
          const key = String(row.id);
          const oldRow = previousRows.get(key);
          const event = oldRow ? (JSON.stringify(oldRow) === JSON.stringify(row) ? null : "UPDATE") : "INSERT";
          if (event) databaseHandlers.filter(handler => handler.event === "*" || handler.event === event).forEach(handler => handler.callback({ event, new: row, old: oldRow }));
        }
        for (const [key, oldRow] of previousRows) {
          if (!currentRows.has(key)) databaseHandlers.filter(handler => handler.event === "*" || handler.event === "DELETE").forEach(handler => handler.callback({ event: "DELETE", old: oldRow }));
        }
      }
      previousRows = currentRows;
    } catch (error) {
      console.warn(`Channel poll failed for ${table}:`, error);
    }
  }

  async function pollBroadcasts() {
    if (stopped || !broadcastHandlers.length) return;
    try {
      const result = await request(`/events?after=${eventCursor}`);
      eventCursor = result.nextCursor || eventCursor;
      (result.events || []).filter(event => event.channel === name).forEach(event => {
        broadcastHandlers.filter(handler => handler.event === event.event).forEach(handler => handler.callback({ payload: event.payload }));
      });
    } catch (error) {
      console.warn(`Broadcast poll failed for ${name}:`, error);
    }
  }

  const channel = {
    on(type, config, callback) {
      if (type === "postgres_changes") databaseHandlers.push({ event: config.event || "*", config, callback });
      if (type === "broadcast") broadcastHandlers.push({ event: config.event, callback });
      return channel;
    },
    subscribe(callback) {
      if (databaseHandlers.length) {
        pollDatabase();
        timer = setInterval(pollDatabase, 2000);
      }
      if (broadcastHandlers.length) {
        pollBroadcasts();
        timer = setInterval(pollBroadcasts, 1000);
      }
      callback?.("SUBSCRIBED");
      return { unsubscribe() { channel.stop(); } };
    },
    async send(message) {
      await request("/events/broadcast", { method: "POST", body: JSON.stringify({ channel: name, event: message.event, payload: message.payload }) });
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
  return channel;
}

export function createClient() {
  const auth = authApi();
  const channels = new Set();
  return {
    from: table => new Query(table),
    auth,
    storage: storageApi(),
    channel: name => {
      const channel = createChannel(name);
      channels.add(channel);
      return channel;
    },
    removeChannel: channel => {
      channel?.stop?.();
      channels.delete(channel);
    }
  };
}
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const queryRecords = internalQuery({
  args: { collection: v.string(), limit: v.number() },
  returns: v.array(v.object({ id: v.string(), data: v.any(), created_at: v.number(), updated_at: v.number() })),
  handler: async (ctx, args) => {
    const docs = await ctx.db.query("records").withIndex("by_collection", q => q.eq("collection", args.collection)).take(Math.max(1, Math.min(args.limit, 500)));
    return docs.map(doc => ({ id: doc.externalId, data: doc.data, created_at: doc.createdAt, updated_at: doc.updatedAt }));
  },
});

export const writeRecord = internalMutation({
  args: { collection: v.string(), id: v.string(), data: v.any(), operation: v.string(), now: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("records").withIndex("by_collection_and_external_id", q => q.eq("collection", args.collection).eq("externalId", args.id)).unique();
    if (args.operation === "delete") {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }
    if (existing) await ctx.db.patch(existing._id, { data: args.data, updatedAt: args.now });
    else await ctx.db.insert("records", { collection: args.collection, externalId: args.id, data: args.data, createdAt: args.now, updatedAt: args.now });
    return null;
  },
});

export const runQuery = action({
  args: { token: v.string(), table: v.string(), operation: v.string(), filters: v.array(v.any()), order: v.optional(v.any()), limit: v.optional(v.number()), offset: v.optional(v.number()), rows: v.optional(v.any()), values: v.optional(v.any()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const user = await ctx.runAction(internal.auth.getUserForInternal, { token: args.token });
    if (!user) throw new Error("You must be signed in.");
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(args.table) || args.table === "users") throw new Error("Unsupported collection.");
    const all = await ctx.runQuery(internal.db.queryRecords, { collection: args.table, limit: 500 });
    const matches = all.filter(row => args.filters.every((f: any) => {
      const actual = f.column === "id" ? row.id : row.data?.[f.column];
      switch (f.operator) {
        case "eq": return actual === f.value;
        case "neq": return actual !== f.value;
        case "gte": return actual >= f.value;
        case "ilike": return typeof actual === "string" && new RegExp("^" + String(f.value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i").test(actual);
        case "in": return Array.isArray(f.value) && f.value.includes(actual);
        case "contains": return Array.isArray(actual) ? f.value.every((x: any) => actual.includes(x)) : typeof actual === "object" && actual !== null && Object.entries(f.value).every(([k,v]) => actual[k] === v);
        case "not_null": return actual !== null && actual !== undefined;
        default: return false;
      }
    }));
    if (args.operation === "select") {
      if (args.order?.column) matches.sort((a,b) => {
        const av = args.order.column === "id" ? a.id : a.data?.[args.order.column];
        const bv = args.order.column === "id" ? b.id : b.data?.[args.order.column];
        return (av < bv ? -1 : av > bv ? 1 : 0) * (args.order.ascending === false ? -1 : 1);
      });
      const selected = matches.slice(args.offset || 0, (args.offset || 0) + Math.min(args.limit || 100, 100));
      return { data: selected.map(r => ({ id: r.id, ...r.data })), error: null };
    }
    if (args.operation === "delete" || args.operation === "update") {
      for (const row of matches) {
        const data = args.operation === "delete" ? row.data : { ...row.data, ...(Array.isArray(args.values) ? args.values[0] : args.values) };
        await ctx.runMutation(internal.db.writeRecord, { collection: args.table, id: row.id, data, operation: args.operation, now: Date.now() });
      }
      return { data: [], error: null };
    }
    if (args.operation === "insert") {
      const rows = Array.isArray(args.rows) ? args.rows : [args.rows];
      const inserted = [];
      for (const data of rows) {
        const id = String(data?.id || crypto.randomUUID());
        const { id: ignored, ...cleanData } = data || {};
        await ctx.runMutation(internal.db.writeRecord, { collection: args.table, id, data: cleanData, operation: "insert", now: Date.now() });
        inserted.push({ id, ...cleanData });
      }
      return { data: inserted, error: null };
    }
    throw new Error("Unsupported database operation.");
  },
});

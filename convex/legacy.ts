import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

async function tokenHash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

export const listEvents = action({
  args: { token: v.string(), after: v.number() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(internal.auth.getSessionUser, { tokenHash: await tokenHash(args.token), now: Date.now() });
    if (!user) throw new Error("You must be signed in.");
    return await ctx.runQuery(internal.legacy.eventsAfter, { after: args.after });
  },
});
export const eventsAfter = internalQuery({
  args: { after: v.number() }, returns: v.any(),
  handler: async (ctx, args) => {
    const events = await ctx.db.query("events").withIndex("by_cursor", q => q.gt("cursor", args.after)).order("asc").take(500);
    return { events: events.map(e => ({ cursor: e.cursor, channel: e.channel, event: e.event, payload: e.payload })), nextCursor: events.length ? events[events.length - 1].cursor : args.after };
  },
});
export const publishEvent = action({
  args: { token: v.string(), channel: v.string(), event: v.string(), payload: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(internal.auth.getSessionUser, { tokenHash: await tokenHash(args.token), now: Date.now() });
    if (!user) throw new Error("You must be signed in.");
    await ctx.runMutation(internal.legacy.addEvent, { channel: args.channel, event: args.event, payload: args.payload, now: Date.now() });
    return null;
  },
});
export const addEvent = internalMutation({
  args: { channel: v.string(), event: v.string(), payload: v.any(), now: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const latest = await ctx.db.query("events").withIndex("by_cursor").order("desc").first();
    await ctx.db.insert("events", { cursor: (latest?.cursor || 0) + 1, channel: args.channel, event: args.event, payload: args.payload, createdAt: args.now });
    return null;
  },
});
export const updatePassword = action({
  args: { token: v.string(), password: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(internal.auth.getSessionUser, { tokenHash: await tokenHash(args.token), now: Date.now() });
    if (!user) throw new Error("You must be signed in.");
    if (args.password.length < 8 || args.password.length > 256) throw new Error("Password must be at least 8 characters.");
    await ctx.runMutation(internal.legacy.changePassword, { externalId: user.externalId, password: args.password });
    return null;
  },
});
export const changePassword = internalMutation({
  args: { externalId: v.string(), password: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_external_id", q => q.eq("externalId", args.externalId)).unique();
    if (!user) throw new Error("Account not found.");
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = Array.from(saltBytes, b => b.toString(16).padStart(2, "0")).join("");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(args.password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 310000 }, key, 256);
    const hash = Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, "0")).join("");
    await ctx.db.patch(user._id, { passwordHash: `pbkdf2-sha256:${salt}:${hash}` });
    return null;
  },
});

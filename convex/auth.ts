import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { ConvexError } from "convex/values";

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashText(value: string) {
  const bytes = new TextEncoder().encode(value);
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 310000 }, key, 256);
  return toHex(bits);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const createAccount = internalMutation({
  args: {
    username: v.string(),
    normalizedUsername: v.string(),
    internalEmail: v.string(),
    passwordHash: v.string(),
    externalId: v.string(),
    tokenHash: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  },
  returns: v.object({ userId: v.id("users") }),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("users").withIndex("by_normalized_username", q => q.eq("normalizedUsername", args.normalizedUsername)).unique();
    if (existing) throw new ConvexError("Username is already in use.");
    const userId = await ctx.db.insert("users", {
      externalId: args.externalId,
      username: args.username,
      normalizedUsername: args.normalizedUsername,
      internalEmail: args.internalEmail,
      passwordHash: args.passwordHash,
      role: "user",
      tags: [],
      background: "",
      mutedUntil: 0,
      bannedUntil: 0,
      createdAt: args.createdAt,
    });
    await ctx.db.insert("sessions", { tokenHash: args.tokenHash, userId, expiresAt: args.expiresAt });
    return { userId };
  },
});

export const findAccount = internalQuery({
  args: { normalizedUsername: v.string() },
  returns: v.union(v.null(), v.object({
    _id: v.id("users"),
    username: v.string(),
    normalizedUsername: v.string(),
    passwordHash: v.string(),
    role: v.string(),
    rank: v.optional(v.string()),
    grade: v.optional(v.string()),
    tags: v.array(v.string()),
    background: v.string(),
    avatar: v.optional(v.string()),
    mutedUntil: v.number(),
    bannedUntil: v.number(),
    banReason: v.optional(v.string()),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_normalized_username", q => q.eq("normalizedUsername", args.normalizedUsername)).unique();
    if (!user) return null;
    return {
      _id: user._id,
      username: user.username,
      normalizedUsername: user.normalizedUsername,
      passwordHash: user.passwordHash,
      role: user.role,
      rank: user.rank,
      grade: user.grade,
      tags: user.tags,
      background: user.background,
      avatar: user.avatar,
      mutedUntil: user.mutedUntil,
      bannedUntil: user.bannedUntil,
      banReason: user.banReason,
      createdAt: user.createdAt,
    };
  },
});

export const saveSession = internalMutation({
  args: { tokenHash: v.string(), userId: v.id("users"), expiresAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("sessions", args);
    return null;
  },
});

export const getSessionUser = internalQuery({
  args: { tokenHash: v.string(), now: v.number() },
  returns: v.union(v.null(), v.object({
    externalId: v.string(),
    username: v.string(),
    role: v.string(),
    rank: v.optional(v.string()),
    grade: v.optional(v.string()),
    tags: v.array(v.string()),
    background: v.string(),
    avatar: v.optional(v.string()),
    mutedUntil: v.number(),
    bannedUntil: v.number(),
    banReason: v.optional(v.string()),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const session = await ctx.db.query("sessions").withIndex("by_token_hash", q => q.eq("tokenHash", args.tokenHash)).unique();
    if (!session || session.expiresAt <= args.now) return null;
    const user = await ctx.db.get(session.userId);
    if (!user) return null;
    return {
      externalId: user.externalId,
      username: user.username,
      role: user.role,
      rank: user.rank,
      grade: user.grade,
      tags: user.tags,
      background: user.background,
      avatar: user.avatar,
      mutedUntil: user.mutedUntil,
      bannedUntil: user.bannedUntil,
      banReason: user.banReason,
      createdAt: user.createdAt,
    };
  },
});

export const signUp = action({
  args: { username: v.string(), password: v.string() },
  returns: v.object({ user: v.object({ id: v.string(), username: v.string(), role: v.string() }), token: v.string() }),
  handler: async (ctx, args) => {
    const username = args.username.trim();
    if (!username || /\s/.test(username) || username.length > 24 || args.password.length < 8 || args.password.length > 256) {
      throw new ConvexError("Use a username without spaces (24 characters max) and a password of at least 8 characters.");
    }
    const normalizedUsername = username.toLowerCase();
    const salt = randomToken();
    const passwordHash = `pbkdf2-sha256:${salt}:${await hashPassword(args.password, salt)}`;
    const token = randomToken();
    const now = Date.now();
    const externalId = randomToken();
    const internalEmail = `${normalizedUsername}@accounts.carsongames.local`;
    const result = await ctx.runMutation(internal.auth.createAccount, {
      username, normalizedUsername, internalEmail, passwordHash, externalId,
      tokenHash: await hashText(token), expiresAt: now + SESSION_MS, createdAt: now,
    });
    return { user: { id: externalId, username, role: "user" }, token };
  },
});

export const signIn = action({
  args: { username: v.string(), password: v.string() },
  returns: v.object({ user: v.object({ id: v.string(), username: v.string(), role: v.string() }), token: v.string() }),
  handler: async (ctx, args) => {
    const normalizedUsername = args.username.trim().toLowerCase();
    const user = await ctx.runQuery(internal.auth.findAccount, { normalizedUsername });
    if (!user || !user.passwordHash.startsWith("pbkdf2-sha256:")) throw new ConvexError("Invalid username or password.");
    const [, salt, expected] = user.passwordHash.split(":");
    const actual = await hashPassword(args.password, salt);
    if (actual !== expected) throw new ConvexError("Invalid username or password.");
    const token = randomToken();
    await ctx.runMutation(internal.auth.saveSession, {
      tokenHash: await hashText(token), userId: user._id, expiresAt: Date.now() + SESSION_MS,
    });
    return { user: { id: user._id, username: user.username, role: user.role }, token };
  },
});

export const getUser = action({
  args: { token: v.string() },
  returns: v.union(v.null(), v.object({
    id: v.string(), username: v.string(), role: v.string(), rank: v.optional(v.string()),
    grade: v.optional(v.string()), tags: v.array(v.string()), background: v.string(),
    avatar: v.optional(v.string()), mutedUntil: v.number(), bannedUntil: v.number(),
    banReason: v.optional(v.string()), createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    if (!args.token) return null;
    const user = await ctx.runQuery(internal.auth.getSessionUser, { tokenHash: await hashText(args.token), now: Date.now() });
    if (!user) return null;
    return { id: user.externalId, ...user };
  },
});

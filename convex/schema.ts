import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * CarsonGames Convex migration schema.
 *
 * The existing static frontend uses a Supabase-like compatibility client.
 * During migration, keep the legacy backend running until the adapter and every
 * feature are switched and verified. Do not expose password hashes or sessions
 * from public queries.
 */
export default defineSchema({
  users: defineTable({
    externalId: v.string(),
    username: v.string(),
    normalizedUsername: v.string(),
    internalEmail: v.string(),
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
  })
    .index("by_external_id", ["externalId"])
    .index("by_normalized_username", ["normalizedUsername"]),

  sessions: defineTable({
    tokenHash: v.string(),
    userId: v.id("users"),
    expiresAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_user", ["userId"]),

  announcements: defineTable({
    externalId: v.string(),
    text: v.string(),
    createdAt: v.number(),
  }).index("by_external_id", ["externalId"]),

  /**
   * Generic records preserve the legacy API's flexible collections such as
   * messages, whispers, vc_rooms, and other app-specific data without forcing
   * a UI/data-model rewrite during the first migration phase.
   */
  records: defineTable({
    collection: v.string(),
    externalId: v.string(),
    data: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_collection", ["collection"])
    .index("by_collection_and_external_id", ["collection", "externalId"]),

  events: defineTable({
    cursor: v.number(),
    channel: v.string(),
    event: v.string(),
    payload: v.any(),
    createdAt: v.number(),
  })
    .index("by_cursor", ["cursor"])
    .index("by_channel_and_cursor", ["channel", "cursor"]),

  storageObjects: defineTable({
    bucket: v.string(),
    path: v.string(),
    storageId: v.id("_storage"),
    contentType: v.string(),
    size: v.number(),
    updatedAt: v.number(),
  }).index("by_bucket_and_path", ["bucket", "path"]),
});

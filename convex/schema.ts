import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    email: v.string(),
    normalizedEmail: v.string(),
    passwordHash: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    status: v.union(v.literal("active"), v.literal("disabled")),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastLoginAt: v.optional(v.number()),
    creativeCount: v.number(),
    imageCount: v.number(),
    videoCount: v.number(),
    spendUsdCents: v.number(),
    billableUnits: v.number(),
    // Vmake credits used by this user's completed enhancements (absent = 0).
    vmakeCredits: v.optional(v.number()),
  }).index("by_normalizedEmail", ["normalizedEmail"]),
  invites: defineTable({
    email: v.string(),
    normalizedEmail: v.string(),
    createdByUserId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("revoked"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    acceptedAt: v.optional(v.number()),
    acceptedByUserId: v.optional(v.id("users")),
    userDeletedAt: v.optional(v.number()),
  })
    .index("by_normalizedEmail", ["normalizedEmail"])
    .index("by_createdAt", ["createdAt"]),
  assets: defineTable({
    userId: v.id("users"),
    type: v.union(v.literal("reference"), v.literal("generated")),
    mediaKind: v.union(v.literal("image"), v.literal("video")),
    bucket: v.string(),
    key: v.string(),
    publicUrl: v.string(),
    sourceUrl: v.optional(v.string()),
    contentType: v.optional(v.string()),
    fileName: v.string(),
    sizeBytes: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_user_createdAt", ["userId", "createdAt"]),
  creatives: defineTable({
    userId: v.id("users"),
    batchId: v.string(),
    kind: v.union(v.literal("image"), v.literal("video")),
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    modelFamily: v.string(),
    modelLabel: v.string(),
    endpointId: v.string(),
    prompt: v.string(),
    aspectRatio: v.string(),
    position: v.number(),
    referenceAssetIds: v.array(v.id("assets")),
    durationSeconds: v.optional(v.number()),
    resolution: v.optional(v.string()),
    falRequestId: v.optional(v.string()),
    outputAssetId: v.optional(v.id("assets")),
    outputUrl: v.optional(v.string()),
    outputMimeType: v.optional(v.string()),
    sourceProviderUrl: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    estimatedCostUsdCents: v.number(),
    actualCostUsdCents: v.optional(v.number()),
    billableUnits: v.number(),
    billingUnit: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    // Which service ran the job; absent means fal.ai.
    provider: v.optional(v.union(v.literal("fal"), v.literal("vmake"))),
    // Vmake task id, set only when Vmake queues the job instead of finishing it at once.
    providerTaskId: v.optional(v.string()),
    // Vmake credits this creative costs (Vmake enhancements only).
    vmakeCredits: v.optional(v.number()),
    // For enhancements: the creative whose image was enhanced.
    sourceCreativeId: v.optional(v.id("creatives")),
    // When a sync request started copying a finished Vmake result (prevents double copies).
    providerClaimedAt: v.optional(v.number()),
  })
    .index("by_user_createdAt", ["userId", "createdAt"])
    .index("by_createdAt", ["createdAt"])
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_falRequestId", ["falRequestId"]),
});

import {
  mutationGeneric as mutation,
  queryGeneric as query,
} from "convex/server";
import { v } from "convex/values";
import { assertServerSecret, getUserById } from "./lib";

const queuedCreativeInput = v.object({
  batchId: v.string(),
  kind: v.union(v.literal("image"), v.literal("video")),
  status: v.union(
    v.literal("queued"),
    v.literal("failed"),
    v.literal("processing"),
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
  errorMessage: v.optional(v.string()),
  estimatedCostUsdCents: v.number(),
  billableUnits: v.number(),
  billingUnit: v.string(),
});

export const createBatch = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.id("users"),
    creatives: v.array(queuedCreativeInput),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const user = await getUserById(ctx, args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const createdIds = [];
    const now = Date.now();

    for (const creative of args.creatives) {
      const creativeId = await ctx.db.insert("creatives", {
        userId: args.userId,
        ...creative,
        createdAt: now,
        updatedAt: now,
      });
      createdIds.push(creativeId);
    }

    return { creativeIds: createdIds };
  },
});

export const listSyncCandidates = query({
  args: {
    serverSecret: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const user = await getUserById(ctx, args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const source =
      user.role === "admin"
        ? await ctx.db.query("creatives").order("desc").collect()
        : (await ctx.db.query("creatives").order("desc").collect()).filter(
            (creative) => creative.userId === args.userId,
          );

    return source
      .filter(
      (creative) =>
        creative.status === "queued" || creative.status === "processing",
      )
      .slice(0, 40);
  },
});

export const markProcessing = mutation({
  args: {
    serverSecret: v.string(),
    creativeId: v.id("creatives"),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const creative = await ctx.db.get(args.creativeId);
    if (!creative || creative.status !== "queued") {
      return;
    }

    await ctx.db.patch(args.creativeId, {
      status: "processing",
      updatedAt: Date.now(),
    });
  },
});

export const markFailed = mutation({
  args: {
    serverSecret: v.string(),
    creativeId: v.id("creatives"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const creative = await ctx.db.get(args.creativeId);
    if (!creative || creative.status === "completed" || creative.status === "failed") {
      return;
    }

    await ctx.db.patch(args.creativeId, {
      status: "failed",
      errorMessage: args.errorMessage,
      updatedAt: Date.now(),
    });
  },
});

export const completeCreative = mutation({
  args: {
    serverSecret: v.string(),
    creativeId: v.id("creatives"),
    asset: v.object({
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
    }),
    actualCostUsdCents: v.number(),
    outputUrl: v.string(),
    outputMimeType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const creative = await ctx.db.get(args.creativeId);
    if (!creative) {
      throw new Error("Creative not found");
    }

    if (creative.status === "completed") {
      return { assetId: creative.outputAssetId ?? null };
    }

    const user = await ctx.db.get(creative.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const now = Date.now();
    const assetId = await ctx.db.insert("assets", {
      userId: creative.userId,
      type: "generated",
      mediaKind: creative.kind,
      ...args.asset,
      createdAt: now,
    });

    await ctx.db.patch(args.creativeId, {
      status: "completed",
      outputAssetId: assetId,
      outputUrl: args.outputUrl,
      outputMimeType: args.outputMimeType,
      actualCostUsdCents: args.actualCostUsdCents,
      completedAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(creative.userId, {
      creativeCount: user.creativeCount + 1,
      imageCount: user.imageCount + (creative.kind === "image" ? 1 : 0),
      videoCount: user.videoCount + (creative.kind === "video" ? 1 : 0),
      spendUsdCents: user.spendUsdCents + args.actualCostUsdCents,
      billableUnits: user.billableUnits + creative.billableUnits,
      updatedAt: now,
    });

    return { assetId };
  },
});

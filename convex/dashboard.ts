import { queryGeneric as query } from "convex/server";
import type { GenericId as Id } from "convex/values";
import { v } from "convex/values";
import { assertServerSecret, getUserById } from "./lib";

export const getSnapshot = query({
  args: {
    serverSecret: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const currentUser = await getUserById(ctx, args.userId);
    if (!currentUser) {
      throw new Error("User not found");
    }

    const creatives =
      currentUser.role === "admin"
        ? await ctx.db.query("creatives").order("desc").take(24)
        : (await ctx.db.query("creatives").order("desc").collect())
            .filter((creative) => creative.userId === args.userId)
            .slice(0, 24);

    const assetIds = creatives
      .map((creative) => creative.outputAssetId)
      .filter((assetId): assetId is Id<"assets"> => Boolean(assetId));
    const assetMap = new Map();
    const userMap = new Map([[currentUser._id, currentUser]]);

    for (const assetId of assetIds) {
      const asset = await ctx.db.get(assetId);
      if (asset) {
        assetMap.set(asset._id, asset);
      }
    }

    if (currentUser.role === "admin") {
      const uniqueUserIds = Array.from(new Set(creatives.map((creative) => creative.userId)));
      for (const userId of uniqueUserIds) {
        if (!userMap.has(userId)) {
          const user = await ctx.db.get(userId);
          if (user) {
            userMap.set(userId, user);
          }
        }
      }
    }

    return {
      currentUser: {
        id: currentUser._id,
        email: currentUser.email,
        role: currentUser.role,
        creativeCount: currentUser.creativeCount,
        imageCount: currentUser.imageCount,
        videoCount: currentUser.videoCount,
        spendUsdCents: currentUser.spendUsdCents,
        billableUnits: currentUser.billableUnits,
      },
      creatives: creatives.map((creative) => ({
        id: creative._id,
        userId: creative.userId,
        kind: creative.kind,
        status: creative.status,
        modelFamily: creative.modelFamily,
        modelLabel: creative.modelLabel,
        prompt: creative.prompt,
        aspectRatio: creative.aspectRatio,
        position: creative.position,
        durationSeconds: creative.durationSeconds ?? null,
        resolution: creative.resolution ?? null,
        outputUrl: creative.outputUrl ?? null,
        outputMimeType: creative.outputMimeType ?? null,
        errorMessage: creative.errorMessage ?? null,
        estimatedCostUsdCents: creative.estimatedCostUsdCents,
        actualCostUsdCents:
          creative.actualCostUsdCents ?? creative.estimatedCostUsdCents,
        billableUnits: creative.billableUnits,
        billingUnit: creative.billingUnit,
        createdAt: creative.createdAt,
        userEmail:
          currentUser.role === "admin"
            ? userMap.get(creative.userId)?.email ?? "Unknown user"
            : currentUser.email,
        asset:
          creative.outputAssetId && assetMap.has(creative.outputAssetId)
            ? assetMap.get(creative.outputAssetId)
            : null,
      })),
    };
  },
});

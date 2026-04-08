import { mutationGeneric as mutation } from "convex/server";
import { v } from "convex/values";
import { assertServerSecret, getUserById } from "./lib";

export const createAssets = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.id("users"),
    assets: v.array(
      v.object({
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
      }),
    ),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const user = await getUserById(ctx, args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const createdAt = Date.now();
    const assetIds = [];

    for (const asset of args.assets) {
      const assetId = await ctx.db.insert("assets", {
        userId: args.userId,
        ...asset,
        createdAt,
      });
      assetIds.push(assetId);
    }

    return { assetIds };
  },
});

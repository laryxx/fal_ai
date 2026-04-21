import {
  mutationGeneric as mutation,
  queryGeneric as query,
} from "convex/server";
import { v } from "convex/values";
import {
  assertServerSecret,
  getUserByEmail,
  getUserById,
  normalizeEmail,
} from "./lib";

export const createInvite = mutation({
  args: {
    serverSecret: v.string(),
    adminUserId: v.id("users"),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const adminUser = await getUserById(ctx, args.adminUserId);
    if (!adminUser || adminUser.role !== "admin") {
      throw new Error("Only the admin can create invites");
    }

    const normalizedEmail = normalizeEmail(args.email);
    const existingUser = await getUserByEmail(ctx, args.email);
    if (existingUser) {
      throw new Error("That email already belongs to a user");
    }

    const invites = await ctx.db.query("invites").collect();
    const existingInvite =
      invites.find((invite) => invite.normalizedEmail === normalizedEmail) ?? null;

    const now = Date.now();

    if (existingInvite) {
      await ctx.db.patch(existingInvite._id, {
        email: args.email.trim(),
        normalizedEmail,
        status: "pending",
        updatedAt: now,
      });

      return { inviteId: existingInvite._id };
    }

    const inviteId = await ctx.db.insert("invites", {
      email: args.email.trim(),
      normalizedEmail,
      createdByUserId: args.adminUserId,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    return { inviteId };
  },
});

export const deleteUser = mutation({
  args: {
    serverSecret: v.string(),
    adminUserId: v.id("users"),
    userIdToDelete: v.id("users"),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const adminUser = await getUserById(ctx, args.adminUserId);
    if (!adminUser || adminUser.role !== "admin") {
      throw new Error("Only the admin can delete users");
    }

    if (args.adminUserId === args.userIdToDelete) {
      throw new Error("You cannot delete your own account");
    }

    const userToDelete = await getUserById(ctx, args.userIdToDelete);
    if (!userToDelete) {
      throw new Error("User not found");
    }

    const invite = await ctx.db
      .query("invites")
      .withIndex("by_normalizedEmail", (q) =>
        q.eq("normalizedEmail", userToDelete.normalizedEmail),
      )
      .first();

    if (invite) {
      await ctx.db.patch(invite._id, { userDeletedAt: Date.now() });
    }

    await ctx.db.delete(args.userIdToDelete);
  },
});

export const promoteToAdmin = mutation({
  args: {
    serverSecret: v.string(),
    adminUserId: v.id("users"),
    userIdToPromote: v.id("users"),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const adminUser = await getUserById(ctx, args.adminUserId);
    if (!adminUser || adminUser.role !== "admin") {
      throw new Error("Only the admin can promote users");
    }

    const userToPromote = await getUserById(ctx, args.userIdToPromote);
    if (!userToPromote) {
      throw new Error("User not found");
    }

    if (userToPromote.role === "admin") {
      throw new Error("User is already an admin");
    }

    await ctx.db.patch(args.userIdToPromote, {
      role: "admin",
      updatedAt: Date.now(),
    });
  },
});

export const getMemberFullLog = query({
  args: {
    serverSecret: v.string(),
    adminUserId: v.id("users"),
    memberId: v.id("users"),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const adminUser = await getUserById(ctx, args.adminUserId);
    if (!adminUser || adminUser.role !== "admin") {
      throw new Error("Only admin can export member data");
    }

    const member = await getUserById(ctx, args.memberId);
    if (!member) throw new Error("Member not found");

    const creatives = await ctx.db
      .query("creatives")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", args.memberId))
      .order("desc")
      .collect();

    return {
      email: member.email,
      creatives: creatives.map((c) => ({
        createdAt: c.createdAt,
        kind: c.kind,
        modelLabel: c.modelLabel,
        prompt: c.prompt,
        aspectRatio: c.aspectRatio,
        durationSeconds: c.durationSeconds ?? null,
        status: c.status,
        actualCostUsdCents: c.actualCostUsdCents ?? c.estimatedCostUsdCents,
        billableUnits: c.billableUnits,
        billingUnit: c.billingUnit,
      })),
    };
  },
});

export const getMemberDetail = query({
  args: {
    serverSecret: v.string(),
    adminUserId: v.id("users"),
    memberId: v.id("users"),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const adminUser = await getUserById(ctx, args.adminUserId);
    if (!adminUser || adminUser.role !== "admin") {
      throw new Error("Only admin can view member details");
    }

    const member = await getUserById(ctx, args.memberId);
    if (!member) throw new Error("Member not found");

    const invite = await ctx.db
      .query("invites")
      .withIndex("by_normalizedEmail", (q) =>
        q.eq("normalizedEmail", member.normalizedEmail),
      )
      .first();

    const creatives = await ctx.db
      .query("creatives")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", args.memberId))
      .order("desc")
      .take(100);

    const assetMap = new Map();
    for (const creative of creatives) {
      if (creative.outputAssetId && !assetMap.has(creative.outputAssetId)) {
        const asset = await ctx.db.get(creative.outputAssetId);
        if (asset) assetMap.set(asset._id, asset);
      }
    }

    return {
      summary: {
        id: member._id,
        email: member.email,
        role: member.role,
        createdAt: member.createdAt,
        spendUsdCents: member.spendUsdCents,
        creativeCount: member.creativeCount,
        imageCount: member.imageCount,
        videoCount: member.videoCount,
        invitedAt: invite?.createdAt ?? null,
        acceptedAt: invite?.acceptedAt ?? null,
      },
      log: creatives.map((c) => ({
        id: c._id,
        kind: c.kind,
        status: c.status,
        prompt: c.prompt,
        modelLabel: c.modelLabel,
        actualCostUsdCents: c.actualCostUsdCents ?? c.estimatedCostUsdCents,
        outputUrl: c.outputUrl ?? null,
        outputMimeType: c.outputMimeType ?? null,
        createdAt: c.createdAt,
        asset:
          c.outputAssetId && assetMap.has(c.outputAssetId)
            ? { publicUrl: (assetMap.get(c.outputAssetId) as { publicUrl: string }).publicUrl }
            : null,
      })),
    };
  },
});

export const listTeamFiltered = query({
  args: {
    serverSecret: v.string(),
    adminUserId: v.id("users"),
    fromTimestamp: v.number(),
    toTimestamp: v.number(),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const adminUser = await getUserById(ctx, args.adminUserId);
    if (!adminUser || adminUser.role !== "admin") {
      throw new Error("Only the admin can access team data");
    }

    const users = await ctx.db.query("users").collect();

    if (args.fromTimestamp === 0) {
      return users
        .map((user) => ({
          id: user._id,
          email: user.email,
          role: user.role,
          spendUsdCents: user.spendUsdCents,
          creativeCount: user.creativeCount,
          lastLoginAt: user.lastLoginAt ?? null,
          createdAt: user.createdAt,
        }))
        .sort((a, b) => b.spendUsdCents - a.spendUsdCents);
    }

    const creatives = await ctx.db
      .query("creatives")
      .withIndex("by_createdAt", (q) =>
        q.gte("createdAt", args.fromTimestamp).lt("createdAt", args.toTimestamp),
      )
      .collect();

    const userStats = new Map<string, { spendUsdCents: number; creativeCount: number }>();
    for (const creative of creatives) {
      const key = creative.userId as string;
      const existing = userStats.get(key) ?? { spendUsdCents: 0, creativeCount: 0 };
      userStats.set(key, {
        spendUsdCents:
          existing.spendUsdCents + (creative.actualCostUsdCents ?? 0),
        creativeCount: existing.creativeCount + 1,
      });
    }

    const result = [];
    for (const user of users) {
      const stats = userStats.get(user._id as string);
      if (!stats) continue;
      result.push({
        id: user._id,
        email: user.email,
        role: user.role,
        spendUsdCents: stats.spendUsdCents,
        creativeCount: stats.creativeCount,
        lastLoginAt: user.lastLoginAt ?? null,
        createdAt: user.createdAt,
      });
    }

    return result.sort((a, b) => b.spendUsdCents - a.spendUsdCents);
  },
});

export const listTeam = query({
  args: {
    serverSecret: v.string(),
    adminUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const adminUser = await getUserById(ctx, args.adminUserId);
    if (!adminUser || adminUser.role !== "admin") {
      throw new Error("Only the admin can access team data");
    }

    const [users, invites] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("invites").order("desc").collect(),
    ]);

    return {
      users: users
        .map((user) => ({
          id: user._id,
          email: user.email,
          role: user.role,
          creativeCount: user.creativeCount,
          imageCount: user.imageCount,
          videoCount: user.videoCount,
          spendUsdCents: user.spendUsdCents,
          billableUnits: user.billableUnits,
          lastLoginAt: user.lastLoginAt ?? null,
          createdAt: user.createdAt,
        }))
        .sort((left, right) => right.spendUsdCents - left.spendUsdCents),
      invites: invites.map((invite) => ({
        id: invite._id,
        email: invite.email,
        status: invite.status,
        createdAt: invite.createdAt,
        acceptedAt: invite.acceptedAt ?? null,
        userDeletedAt: invite.userDeletedAt ?? null,
      })),
    };
  },
});

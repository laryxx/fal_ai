import {
  mutationGeneric as mutation,
  queryGeneric as query,
} from "convex/server";
import { v } from "convex/values";
import { assertServerSecret, getUserByEmail, normalizeEmail } from "./lib";

export const getBootstrapState = query({
  args: { serverSecret: v.string() },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const users = await ctx.db.query("users").collect();

    return {
      bootstrapRequired: users.length === 0,
      userCount: users.length,
    };
  },
});

export const getUserByEmailForAuth = query({
  args: {
    serverSecret: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    return await getUserByEmail(ctx, args.email);
  },
});

export const getUserByIdForSession = query({
  args: {
    serverSecret: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    return await ctx.db.get(args.userId);
  },
});

export const bootstrapAdmin = mutation({
  args: {
    serverSecret: v.string(),
    email: v.string(),
    passwordHash: v.string(),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const existingUsers = await ctx.db.query("users").collect();
    if (existingUsers.length > 0) {
      throw new Error("Admin bootstrap is already complete");
    }

    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      email: args.email.trim(),
      normalizedEmail: normalizeEmail(args.email),
      passwordHash: args.passwordHash,
      role: "admin",
      status: "active",
      createdAt: now,
      updatedAt: now,
      creativeCount: 0,
      imageCount: 0,
      videoCount: 0,
      spendUsdCents: 0,
      billableUnits: 0,
    });

    return { userId };
  },
});

export const createMemberFromInvite = mutation({
  args: {
    serverSecret: v.string(),
    email: v.string(),
    passwordHash: v.string(),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const normalizedEmail = normalizeEmail(args.email);
    const users = await ctx.db.query("users").collect();
    const existingUser =
      users.find((user) => user.normalizedEmail === normalizedEmail) ?? null;

    if (existingUser) {
      throw new Error("An account with this email already exists");
    }

    const invites = await ctx.db.query("invites").collect();
    const invite =
      invites.find((entry) => entry.normalizedEmail === normalizedEmail) ?? null;

    if (!invite || invite.status !== "pending") {
      throw new Error("This email does not have an active invite");
    }

    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      email: args.email.trim(),
      normalizedEmail,
      passwordHash: args.passwordHash,
      role: "member",
      status: "active",
      createdAt: now,
      updatedAt: now,
      creativeCount: 0,
      imageCount: 0,
      videoCount: 0,
      spendUsdCents: 0,
      billableUnits: 0,
    });

    await ctx.db.patch(invite._id, {
      status: "accepted",
      acceptedAt: now,
      acceptedByUserId: userId,
      updatedAt: now,
    });

    return { userId };
  },
});

export const recordLogin = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    assertServerSecret(args.serverSecret);

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db.patch(args.userId, {
      lastLoginAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

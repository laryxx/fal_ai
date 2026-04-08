import type { AnyDataModel, GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { GenericId as Id } from "convex/values";

export type ConvexCtx =
  | GenericQueryCtx<AnyDataModel>
  | GenericMutationCtx<AnyDataModel>;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function getServerSecret() {
  const secret = process.env.APP_SERVER_SECRET;
  if (!secret) {
    throw new Error("APP_SERVER_SECRET is missing in the Convex environment");
  }
  return secret;
}

export function assertServerSecret(serverSecret: string) {
  if (serverSecret !== getServerSecret()) {
    throw new Error("Unauthorized server request");
  }
}

export async function getUserById(ctx: ConvexCtx, userId: Id<"users">) {
  return await ctx.db.get(userId);
}

export async function getUserByEmail(ctx: ConvexCtx, email: string) {
  const normalizedEmail = normalizeEmail(email);
  const users = await ctx.db.query("users").collect();
  return users.find((user) => user.normalizedEmail === normalizedEmail) ?? null;
}

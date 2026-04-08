import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { getBaseEnv } from "@/lib/env";

function getClient() {
  return new ConvexHttpClient(getBaseEnv().CONVEX_URL, {
    logger: false,
  });
}

function withServerSecret<T extends Record<string, unknown>>(args?: T) {
  return {
    serverSecret: getBaseEnv().APP_SERVER_SECRET,
    ...(args ?? {}),
  };
}

export async function convexGetBootstrapState() {
  const client = getClient();
  return await client.query(anyApi.auth.getBootstrapState, withServerSecret());
}

export async function convexGetUserByEmail(email: string) {
  const client = getClient();
  return await client.query(anyApi.auth.getUserByEmailForAuth, withServerSecret({ email }));
}

export async function convexGetUserById(userId: string) {
  const client = getClient();
  return await client.query(anyApi.auth.getUserByIdForSession, withServerSecret({ userId }));
}

export async function convexBootstrapAdmin(email: string, passwordHash: string) {
  const client = getClient();
  return await client.mutation(anyApi.auth.bootstrapAdmin, withServerSecret({ email, passwordHash }));
}

export async function convexCreateMemberFromInvite(
  email: string,
  passwordHash: string,
) {
  const client = getClient();
  return await client.mutation(anyApi.auth.createMemberFromInvite, withServerSecret({ email, passwordHash }));
}

export async function convexRecordLogin(userId: string) {
  const client = getClient();
  return await client.mutation(anyApi.auth.recordLogin, withServerSecret({ userId }));
}

export async function convexCreateInvite(adminUserId: string, email: string) {
  const client = getClient();
  return await client.mutation(anyApi.admin.createInvite, withServerSecret({ adminUserId, email }));
}

export async function convexGetMemberFullLog(adminUserId: string, memberId: string) {
  const client = getClient();
  return await client.query(anyApi.admin.getMemberFullLog, withServerSecret({ adminUserId, memberId }));
}

export async function convexGetMemberDetail(adminUserId: string, memberId: string) {
  const client = getClient();
  return await client.query(anyApi.admin.getMemberDetail, withServerSecret({ adminUserId, memberId }));
}

export async function convexListTeamFiltered(adminUserId: string, fromTimestamp: number, toTimestamp: number) {
  const client = getClient();
  return await client.query(anyApi.admin.listTeamFiltered, withServerSecret({ adminUserId, fromTimestamp, toTimestamp }));
}

export async function convexDeleteUser(adminUserId: string, userIdToDelete: string) {
  const client = getClient();
  return await client.mutation(anyApi.admin.deleteUser, withServerSecret({ adminUserId, userIdToDelete }));
}

export async function convexPromoteToAdmin(adminUserId: string, userIdToPromote: string) {
  const client = getClient();
  return await client.mutation(anyApi.admin.promoteToAdmin, withServerSecret({ adminUserId, userIdToPromote }));
}

export async function convexListTeam(adminUserId: string) {
  const client = getClient();
  return await client.query(anyApi.admin.listTeam, withServerSecret({ adminUserId }));
}

export async function convexCreateAssets(userId: string, assets: unknown[]) {
  const client = getClient();
  return await client.mutation(anyApi.assets.createAssets, withServerSecret({ userId, assets }));
}

export async function convexCreateCreativeBatch(userId: string, creatives: unknown[]) {
  const client = getClient();
  return await client.mutation(anyApi.creatives.createBatch, withServerSecret({ userId, creatives }));
}

export async function convexListSyncCandidates(userId: string) {
  const client = getClient();
  return await client.query(anyApi.creatives.listSyncCandidates, withServerSecret({ userId }));
}

export async function convexMarkCreativeProcessing(creativeId: string) {
  const client = getClient();
  return await client.mutation(anyApi.creatives.markProcessing, withServerSecret({ creativeId }));
}

export async function convexMarkCreativeFailed(
  creativeId: string,
  errorMessage: string,
) {
  const client = getClient();
  return await client.mutation(anyApi.creatives.markFailed, withServerSecret({ creativeId, errorMessage }));
}

export async function convexCompleteCreative(args: Record<string, unknown>) {
  const client = getClient();
  return await client.mutation(anyApi.creatives.completeCreative, withServerSecret(args));
}

export async function convexGetDashboardSnapshot(userId: string) {
  const client = getClient();
  return await client.query(anyApi.dashboard.getSnapshot, withServerSecret({ userId }));
}

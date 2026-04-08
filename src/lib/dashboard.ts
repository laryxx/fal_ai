import type { AppSession } from "@/lib/auth/session";
import { clearSessionCookie } from "@/lib/auth/session";
import { getBaseEnvSafe, getServerEnvSafe } from "@/lib/env";
import {
  convexGetBootstrapState,
  convexGetDashboardSnapshot,
  convexGetUserById,
  convexListTeam,
} from "@/lib/convex";
import type { AppData } from "@/lib/types";

export async function loadAppData(session: AppSession | null): Promise<AppData> {
  const baseEnvState = getBaseEnvSafe();
  if (!baseEnvState.ok) {
    return {
      configurationError: baseEnvState.error,
      bootstrapRequired: false,
      authenticated: false,
      snapshot: null,
      team: null,
    };
  }

  const mediaEnvState = getServerEnvSafe();
  const configurationError = mediaEnvState.ok
    ? null
    : `${mediaEnvState.error}. Auth works, but generation stays disabled until the fal.ai and R2 vars are filled.`;

  const envState = baseEnvState;
  if (!envState.ok) {
    return {
      configurationError: envState.error,
      bootstrapRequired: false,
      authenticated: false,
      snapshot: null,
      team: null,
    };
  }

  const bootstrapState = await convexGetBootstrapState();
  if (!session) {
    return {
      configurationError,
      bootstrapRequired: bootstrapState.bootstrapRequired,
      authenticated: false,
      snapshot: null,
      team: null,
    };
  }

  const currentUser = await convexGetUserById(session.userId);
  if (!currentUser) {
    await clearSessionCookie();
    return {
      configurationError,
      bootstrapRequired: bootstrapState.bootstrapRequired,
      authenticated: false,
      snapshot: null,
      team: null,
    };
  }

  const snapshot = await convexGetDashboardSnapshot(currentUser._id);
  const team =
    currentUser.role === "admin" ? await convexListTeam(currentUser._id) : null;

  return {
    configurationError,
    bootstrapRequired: bootstrapState.bootstrapRequired,
    authenticated: true,
    snapshot,
    team,
  };
}

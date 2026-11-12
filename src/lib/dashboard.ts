import { redirect } from "next/navigation";
import type { AppSession } from "@/lib/auth/session";

import { getBaseEnvSafe, getServerEnvSafe } from "@/lib/env";
import {
  convexGetBootstrapState,
  convexGetDashboardSnapshot,
  convexGetUserById,
  convexListTeam,
} from "@/lib/convex";
import type { AppData } from "@/lib/types";
import { isVmakeConfigured } from "@/lib/vmake";

export async function loadAppData(session: AppSession | null): Promise<AppData> {
  const baseEnvState = getBaseEnvSafe();
  if (!baseEnvState.ok) {
    return {
      configurationError: baseEnvState.error,
      vmakeEnabled: false,
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
      vmakeEnabled: false,
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
      vmakeEnabled: mediaEnvState.ok && isVmakeConfigured(),
      bootstrapRequired: bootstrapState.bootstrapRequired,
      authenticated: false,
      snapshot: null,
      team: null,
    };
  }

  const currentUser = await convexGetUserById(session.userId);
  if (!currentUser) {
    redirect("/api/auth/sign-out");
  }

  const snapshot = await convexGetDashboardSnapshot(currentUser._id);
  const team =
    currentUser.role === "admin" ? await convexListTeam(currentUser._id) : null;

  return {
    configurationError,
    vmakeEnabled: mediaEnvState.ok && isVmakeConfigured(),
    bootstrapRequired: bootstrapState.bootstrapRequired,
    authenticated: true,
    snapshot,
    team,
  };
}

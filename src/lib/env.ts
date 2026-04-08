import { z } from "zod";

const baseEnvSchema = z.object({
  SESSION_SECRET: z.string().min(32),
  APP_SERVER_SECRET: z.string().min(16),
  CONVEX_URL: z.string().url().optional(),
  NEXT_PUBLIC_CONVEX_URL: z.string().url().optional(),
});

const mediaEnvSchema = baseEnvSchema.extend({
  FAL_KEY: z.string().min(1),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_PUBLIC_BASE_URL: z.string().url(),
});

export type ServerEnv = ReturnType<typeof getServerEnv>;
export type BaseEnv = ReturnType<typeof getBaseEnv>;

let cachedBaseEnv: ReturnType<typeof buildBaseEnv> | null = null;
let cachedServerEnv: ReturnType<typeof buildServerEnv> | null = null;

function toErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unknown environment configuration error";
}

function buildBaseEnv() {
  const parsed = baseEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid base environment configuration: ${issues}`);
  }

  const convexUrl = parsed.data.CONVEX_URL ?? parsed.data.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("Set CONVEX_URL or NEXT_PUBLIC_CONVEX_URL");
  }

  return {
    ...parsed.data,
    CONVEX_URL: convexUrl,
  };
}

function buildServerEnv() {
  const parsed = mediaEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid media environment configuration: ${issues}`);
  }

  const convexUrl = parsed.data.CONVEX_URL ?? parsed.data.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("Set CONVEX_URL or NEXT_PUBLIC_CONVEX_URL");
  }

  return {
    ...parsed.data,
    CONVEX_URL: convexUrl,
    R2_ENDPOINT: `https://${parsed.data.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  };
}

export function getBaseEnv() {
  if (!cachedBaseEnv) {
    cachedBaseEnv = buildBaseEnv();
  }

  return cachedBaseEnv;
}

export function getServerEnv() {
  if (!cachedServerEnv) {
    cachedServerEnv = buildServerEnv();
  }

  return cachedServerEnv;
}

export function getBaseEnvSafe() {
  try {
    return {
      ok: true as const,
      env: getBaseEnv(),
      error: null,
    };
  } catch (error) {
    return {
      ok: false as const,
      env: null,
      error: toErrorMessage(error),
    };
  }
}

export function getServerEnvSafe() {
  try {
    return {
      ok: true as const,
      env: getServerEnv(),
      error: null,
    };
  } catch (error) {
    return {
      ok: false as const,
      env: null,
      error: toErrorMessage(error),
    };
  }
}

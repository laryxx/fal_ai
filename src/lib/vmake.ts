import { getServerEnv } from "@/lib/env";
import {
  convexCompleteCreative,
  convexMarkCreativeFailed,
  convexSetProviderTaskId,
} from "@/lib/convex";
import { uploadToR2 } from "@/lib/r2";

// Vmake "Fast 2K - Image Quality Repair" (catalog id SKM0004): 10 credits per image.
// Dollar cost assumes the Pro plan: $29.99 for 4,500 credits a month.
const VMAKE_PLAN_PRICE_USD_CENTS = 2999;
const VMAKE_PLAN_CREDITS = 4500;
const ENHANCE_CREDITS = 10;

export const vmakeEnhance = {
  modelFamily: "vmake-enhance",
  modelLabel: "Vmake Enhance",
  endpointId: "vmake/SKM0004",
  resolution: "Fast 2K",
  vmakeCredits: ENHANCE_CREDITS,
  estimatedCostUsdCents:
    Math.round(((ENHANCE_CREDITS * VMAKE_PLAN_PRICE_USD_CENTS) / VMAKE_PLAN_CREDITS) * 100) / 100,
};

// How long an enhancement may stay unfinished before the sync route gives up on it.
export const VMAKE_STALE_AFTER_MS = 10 * 60 * 1000;

export function isVmakeConfigured() {
  return Boolean(process.env.MT_AK && process.env.MT_SK);
}

export type VmakeServiceResult =
  | {
      status: "completed";
      taskId?: string;
      outputUrl: string;
      width?: number | null;
      height?: number | null;
      sizeBytes?: number | null;
    }
  | { status: "processing"; taskId?: string }
  | { status: "failed"; taskId?: string; error: string };

/** Call the Python service in api/vmake.py (or VMAKE_SERVICE_URL in local dev). */
export async function callVmakeService(
  origin: string,
  body: { action: "enhance"; imageUrl: string } | { action: "status"; taskId: string },
): Promise<VmakeServiceResult> {
  const url = process.env.VMAKE_SERVICE_URL || `${origin}/api/vmake`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-app-secret": getServerEnv().APP_SERVER_SECRET,
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(110_000),
  });

  let payload: Partial<VmakeServiceResult> & { error?: string } = {};
  try {
    payload = await response.json();
  } catch {
    // fall through to the error below
  }

  if (payload.status === "completed" || payload.status === "processing" || payload.status === "failed") {
    return payload as VmakeServiceResult;
  }

  throw new Error(payload.error ?? `Vmake service returned HTTP ${response.status}`);
}

function getFileName(url: string) {
  const last = new URL(url).pathname.split("/").filter(Boolean).pop();
  return last || "enhanced.jpeg";
}

/** Store a Vmake result on the creative: copy finished images into R2, remember queued task ids. */
export async function applyVmakeResult(
  creative: { _id: string; userId: string; estimatedCostUsdCents: number },
  result: VmakeServiceResult,
) {
  if (result.status === "processing") {
    if (result.taskId) {
      await convexSetProviderTaskId(creative._id, result.taskId);
    }
    return;
  }

  if (result.status === "failed") {
    await convexMarkCreativeFailed(creative._id, result.error);
    return;
  }

  // Vmake's result link expires after 7 days, so keep our own copy in R2.
  const source = await fetch(result.outputUrl, { cache: "no-store" });
  if (!source.ok) {
    await convexMarkCreativeFailed(creative._id, "Could not download the enhanced image from Vmake");
    return;
  }

  const contentType = source.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await source.arrayBuffer());
  const fileName = getFileName(result.outputUrl);
  const uploaded = await uploadToR2({
    keyPrefix: `outputs/${creative.userId}/image`,
    fileName,
    body: buffer,
    contentType,
  });

  await convexCompleteCreative({
    creativeId: creative._id,
    asset: {
      bucket: uploaded.bucket,
      key: uploaded.key,
      publicUrl: uploaded.publicUrl,
      sourceUrl: result.outputUrl.split("?")[0],
      contentType,
      fileName,
      sizeBytes: buffer.byteLength,
      width: result.width ?? undefined,
      height: result.height ?? undefined,
    },
    actualCostUsdCents: creative.estimatedCostUsdCents,
    outputUrl: uploaded.publicUrl,
    outputMimeType: contentType,
  });
}

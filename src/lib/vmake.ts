import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { getServerEnv } from "@/lib/env";
import {
  convexClaimVmakeCompletion,
  convexCompleteCreative,
  convexMarkCreativeFailed,
  convexSetProviderTaskId,
} from "@/lib/convex";
import { uploadStreamToR2, uploadToR2 } from "@/lib/r2";
import { VMAKE_MAX_DIMENSION } from "@/lib/vmake-options";

/** How long an unfinished Vmake job may run before the sync route gives up on it. */
export function getVmakeStaleAfterMs(kind: "image" | "video", hasTaskId: boolean) {
  // Without a task id the enhance request itself is still talking to Vmake;
  // that request is capped at 5 minutes, so anything older died.
  if (!hasTaskId) return 10 * 60 * 1000;
  // 4K/8K video restoration can take a long time on Vmake's side.
  return kind === "video" ? 3 * 60 * 60 * 1000 : 30 * 60 * 1000;
}

/**
 * Reword Vmake's failure reasons for people. Vmake's own texts can be off
 * (it says "video" for images), so known cases get our wording.
 */
export function friendlyVmakeError(message: string, kind: "image" | "video") {
  if (/resolution limit|4096/i.test(message)) {
    return `This ${kind} is too large for Vmake (maximum ${VMAKE_MAX_DIMENSION} × ${VMAKE_MAX_DIMENSION} pixels). Enhanced files are usually bigger than that, so remove watermarks before enhancing. No credits were used.`;
  }
  if (/credit|quota|balance|insufficient|limit reached|daily/i.test(message)) {
    return `Vmake refused the job: not enough Vmake credits, or the daily API credit limit was reached. Check the Vmake dashboard. (${message})`;
  }
  return message;
}

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
      durationSeconds?: number | null;
    }
  | { status: "processing"; taskId?: string }
  | { status: "failed"; taskId?: string; error: string };

/** Call the Python service in api/vmake.py (VMAKE_SERVICE_URL, or this site's /api/vmake). */
export async function callVmakeService(
  origin: string,
  body: { action: "enhance"; mediaUrl: string; task: string } | { action: "status"; taskId: string },
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
    signal: AbortSignal.timeout(290_000),
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

function getFileName(url: string, kind: "image" | "video") {
  const last = new URL(url).pathname.split("/").filter(Boolean).pop();
  return last || (kind === "video" ? "enhanced.mp4" : "enhanced.jpeg");
}

/** Store a Vmake result on the creative: copy finished media into R2, remember queued task ids. */
export async function applyVmakeResult(
  creative: {
    _id: string;
    userId: string;
    kind: "image" | "video";
    estimatedCostUsdCents: number;
    durationSeconds?: number | null;
  },
  result: VmakeServiceResult,
) {
  if (result.status === "processing") {
    if (result.taskId) {
      await convexSetProviderTaskId(creative._id, result.taskId);
    }
    return;
  }

  if (result.status === "failed") {
    await convexMarkCreativeFailed(creative._id, friendlyVmakeError(result.error, creative.kind));
    return;
  }

  // Only one request may copy a finished result (the gallery syncs every few seconds).
  if (!(await convexClaimVmakeCompletion(creative._id))) {
    return;
  }

  // Vmake's result link expires after 7 days, so keep our own copy in R2.
  const source = await fetch(result.outputUrl, { cache: "no-store" });
  if (!source.ok || !source.body) {
    await convexMarkCreativeFailed(creative._id, `Vmake finished, but the result could not be downloaded from Vmake`);
    return;
  }

  const contentType =
    source.headers.get("content-type") || (creative.kind === "video" ? "video/mp4" : "image/jpeg");
  const fileName = getFileName(result.outputUrl, creative.kind);
  const keyPrefix = `outputs/${creative.userId}/${creative.kind}`;
  const contentLength = Number(source.headers.get("content-length") || 0);

  let uploaded: { bucket: string; key: string; publicUrl: string };
  let sizeBytes: number;
  if (contentLength > 0) {
    // Stream large files (4K/8K video) straight through instead of holding them in memory.
    uploaded = await uploadStreamToR2({
      keyPrefix,
      fileName,
      body: Readable.fromWeb(source.body as unknown as NodeWebReadableStream<Uint8Array>),
      contentLength,
      contentType,
    });
    sizeBytes = contentLength;
  } else {
    const buffer = Buffer.from(await source.arrayBuffer());
    uploaded = await uploadToR2({ keyPrefix, fileName, body: buffer, contentType });
    sizeBytes = buffer.byteLength;
  }

  await convexCompleteCreative({
    creativeId: creative._id,
    asset: {
      bucket: uploaded.bucket,
      key: uploaded.key,
      publicUrl: uploaded.publicUrl,
      sourceUrl: result.outputUrl.split("?")[0],
      contentType,
      fileName,
      sizeBytes,
      width: result.width ?? undefined,
      height: result.height ?? undefined,
      durationSeconds:
        creative.kind === "video"
          ? (result.durationSeconds ?? creative.durationSeconds ?? undefined)
          : undefined,
    },
    actualCostUsdCents: creative.estimatedCostUsdCents,
    outputUrl: uploaded.publicUrl,
    outputMimeType: contentType,
  });
}

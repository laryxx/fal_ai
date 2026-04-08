import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth/session";
import { getServerEnvSafe } from "@/lib/env";
import {
  convexCompleteCreative,
  convexListSyncCandidates,
  convexMarkCreativeFailed,
  convexMarkCreativeProcessing,
} from "@/lib/convex";
import { getFalResult, getFalStatus } from "@/lib/fal";
import { uploadToR2 } from "@/lib/r2";

type FalMediaFile = {
  url: string;
  content_type?: string;
};

type FalResultShape = {
  data?: {
    images?: FalMediaFile[];
    video?: FalMediaFile;
  };
};

function getFileNameFromUrl(url: string, fallback: string) {
  const pathname = new URL(url).pathname;
  const lastSegment = pathname.split("/").filter(Boolean).pop();
  return lastSegment || fallback;
}

function getOutputFile(result: FalResultShape, kind: "image" | "video") {
  if (kind === "video") {
    return result.data?.video ?? null;
  }

  return result.data?.images?.[0] ?? null;
}

export async function POST() {
  if (!getServerEnvSafe().ok) {
    return NextResponse.json(
      { error: "Configure the environment before syncing creatives" },
      { status: 503 },
    );
  }

  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const candidates = await convexListSyncCandidates(session.userId);
  let processed = 0;

  for (const creative of candidates) {
    if (!creative.falRequestId || !creative.endpointId) {
      continue;
    }

    try {
      const status = await getFalStatus(creative.endpointId, creative.falRequestId);

      if (status.status === "IN_PROGRESS") {
        await convexMarkCreativeProcessing(creative._id);
        continue;
      }

      if (status.status === "FAILED" || status.status === "ERROR") {
        await convexMarkCreativeFailed(
          creative._id,
          status.logs?.map((log) => log.message).filter(Boolean).join(" ") ||
            "fal.ai could not complete this request",
        );
        continue;
      }

      if (status.status !== "COMPLETED") {
        continue;
      }

      const result = await getFalResult(creative.endpointId, creative.falRequestId);
      const outputFile = getOutputFile(result, creative.kind);
      if (!outputFile?.url) {
        await convexMarkCreativeFailed(creative._id, "fal.ai returned no media output");
        continue;
      }

      const sourceResponse = await fetch(outputFile.url);
      if (!sourceResponse.ok) {
        await convexMarkCreativeFailed(creative._id, "Could not download the generated file");
        continue;
      }

      const contentType =
        outputFile.content_type ||
        sourceResponse.headers.get("content-type") ||
        (creative.kind === "video" ? "video/mp4" : "image/png");
      const buffer = Buffer.from(await sourceResponse.arrayBuffer());
      const fileName = getFileNameFromUrl(
        outputFile.url,
        creative.kind === "video" ? "creative.mp4" : "creative.png",
      );
      const uploaded = await uploadToR2({
        keyPrefix: `outputs/${creative.userId}/${creative.kind}`,
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
          sourceUrl: outputFile.url,
          contentType,
          fileName,
          sizeBytes: buffer.byteLength,
          durationSeconds: creative.durationSeconds ?? undefined,
        },
        actualCostUsdCents: creative.estimatedCostUsdCents,
        outputUrl: uploaded.publicUrl,
        outputMimeType: contentType,
      });

      processed += 1;
    } catch (error) {
      await convexMarkCreativeFailed(
        creative._id,
        error instanceof Error ? error.message : "Unexpected sync failure",
      );
    }
  }

  return NextResponse.json({ ok: true, processed });
}

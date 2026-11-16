import { after, NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth/session";
import { getServerEnvSafe } from "@/lib/env";
import {
  convexCreateEnhancement,
  convexGetCreativeForEnhancement,
  convexGetUserById,
  convexMarkCreativeFailed,
} from "@/lib/convex";
import { isOwnR2Url } from "@/lib/r2";
import {
  applyVmakeResult,
  callVmakeService,
  isVmakeConfigured,
} from "@/lib/vmake";
import {
  creditsToUsdCents,
  getVideoEnhanceQuote,
  getVideoRemoveQuote,
  imageEnhanceOption,
  imageRemoveOption,
  vmakeLabels,
} from "@/lib/vmake-options";

// Handles every Vmake job: image/video enhancement and watermark/object removal,
// for gallery creatives and uploaded files. The Vmake request runs after the
// response is sent; uploading a large video to Vmake can take a few minutes.
export const maxDuration = 300;

const schema = z.object({
  kind: z.enum(["image", "video"]).default("image"),
  operation: z.enum(["enhance", "remove"]).default("enhance"),
  creativeId: z.string().min(1).optional(),
  upload: z
    .object({
      url: z.string().url(),
      fileName: z.string().min(1).max(255),
      durationSeconds: z.number().positive().max(4 * 60 * 60).optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
    })
    .optional(),
  // video enhance
  tier: z.enum(["fast", "quality", "master"]).optional(),
  resolution: z.enum(["2K", "4K", "8K"]).optional(),
  // video removal
  mode: z.enum(["watermark", "subtitle", "smart", "smart-pro"]).optional(),
});

function aspectRatioOf(width?: number, height?: number) {
  if (!width || !height) return "16:9";
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(width, height);
  return `${width / d}:${height / d}`;
}

const knownErrors = [
  "Creative not found",
  "Only finished images can be processed",
  "Only finished videos can be processed",
  "This image was already processed this way",
  "This video was already processed this way",
];

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function POST(request: Request) {
  if (!getServerEnvSafe().ok) {
    return NextResponse.json(
      { error: "Configure Convex, fal.ai, and Cloudflare R2 first" },
      { status: 503 },
    );
  }

  if (!isVmakeConfigured()) {
    return NextResponse.json(
      { error: "Vmake is not configured (set MT_AK and MT_SK)" },
      { status: 503 },
    );
  }

  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const user = await convexGetUserById(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return badRequest("Invalid request");
  }
  const input = parsed.data;
  const { kind, operation } = input;

  // ---- What is being processed ----
  let durationSeconds: number | undefined;
  let upload:
    | { url: string; fileName: string; aspectRatio: string; durationSeconds?: number }
    | undefined;

  if (input.upload) {
    if (!isOwnR2Url(input.upload.url, `uploads/${user._id}/`)) {
      return badRequest("Upload not found");
    }
    durationSeconds = input.upload.durationSeconds;
    upload = {
      url: input.upload.url,
      fileName: input.upload.fileName,
      aspectRatio: aspectRatioOf(input.upload.width, input.upload.height),
      durationSeconds,
    };
  } else if (input.creativeId) {
    const source = await convexGetCreativeForEnhancement(user._id, input.creativeId);
    if (!source || source.kind !== kind) {
      return badRequest("Creative not found");
    }
    durationSeconds = source.durationSeconds ?? undefined;
  } else {
    return badRequest("Nothing to process");
  }

  if (kind === "video" && !durationSeconds) {
    return badRequest("This video's length is unknown, so its cost can't be calculated");
  }

  // ---- Which Vmake task, and what it costs ----
  let task: string;
  let modeLabel: string;
  let credits: number;
  let billableUnits: number;

  if (kind === "image") {
    const option = operation === "remove" ? imageRemoveOption : imageEnhanceOption;
    task = option.task;
    modeLabel = option.label;
    credits = option.credits;
    billableUnits = 1;
  } else {
    const quote =
      operation === "remove"
        ? input.mode
          ? getVideoRemoveQuote(input.mode, durationSeconds!)
          : null
        : input.tier && input.resolution
          ? getVideoEnhanceQuote(input.tier, input.resolution, durationSeconds!)
          : null;
    if (!quote) {
      return badRequest(
        operation === "remove"
          ? "Choose a removal mode"
          : "Choose an available quality and resolution",
      );
    }
    task = quote.task;
    modeLabel = quote.label;
    credits = quote.credits;
    billableUnits = quote.seconds;
  }

  const estimatedCostUsdCents = creditsToUsdCents(credits);
  const labels = vmakeLabels[kind][operation];

  let created: { creativeId: string; sourceUrl: string };
  try {
    created = await convexCreateEnhancement({
      userId: user._id,
      kind,
      sourceCreativeId: upload ? undefined : input.creativeId,
      upload,
      modelFamily: labels.modelFamily,
      modelLabel: labels.modelLabel,
      endpointId: `vmake/${task}`,
      resolution: modeLabel,
      estimatedCostUsdCents,
      vmakeCredits: credits,
      billableUnits,
      billingUnit: kind === "video" ? "second" : "image",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known = knownErrors.find((text) => message.includes(text));
    return NextResponse.json(
      { error: known ?? "Could not start the Vmake job" },
      { status: known ? 400 : 500 },
    );
  }

  const origin = new URL(request.url).origin;
  const creative = {
    _id: created.creativeId,
    userId: user._id as string,
    kind,
    estimatedCostUsdCents,
    durationSeconds,
  };

  // Respond right away; the gallery shows the new card as "Rendering..." and
  // picks up the result on its next refresh.
  after(async () => {
    try {
      const result = await callVmakeService(origin, {
        action: "enhance",
        mediaUrl: created.sourceUrl,
        task,
      });
      await applyVmakeResult(creative, result);
    } catch (error) {
      await convexMarkCreativeFailed(
        created.creativeId,
        error instanceof Error ? error.message : "Vmake job failed",
      );
    }
  });

  return NextResponse.json({ ok: true, creativeId: created.creativeId, credits });
}

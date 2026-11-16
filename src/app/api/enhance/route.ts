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
  imageEnhanceOption,
} from "@/lib/vmake-options";

// The Vmake request runs after the response is sent; uploading a large video
// to Vmake can take a few minutes.
export const maxDuration = 300;

const videoOptions = {
  tier: z.enum(["fast", "quality", "master"]),
  resolution: z.enum(["2K", "4K", "8K"]),
};

const schema = z.union([
  z.object({
    kind: z.literal("video"),
    creativeId: z.string().min(1),
    ...videoOptions,
  }),
  z.object({
    kind: z.literal("video"),
    upload: z.object({
      url: z.string().url(),
      fileName: z.string().min(1).max(255),
      durationSeconds: z.number().positive().max(4 * 60 * 60),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
    }),
    ...videoOptions,
  }),
  z.object({
    kind: z.literal("image").optional(),
    creativeId: z.string().min(1),
  }),
]);

function aspectRatioOf(width?: number, height?: number) {
  if (!width || !height) return "16:9";
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(width, height);
  return `${width / d}:${height / d}`;
}

const knownErrors = [
  "Creative not found",
  "Only finished images can be enhanced",
  "Only finished videos can be enhanced",
  "This image is already enhanced",
  "This video is already enhanced",
];

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
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const input = parsed.data;

  let kind: "image" | "video";
  let task: string;
  let resolutionLabel: string;
  let credits: number;
  let billableUnits: number;
  let durationSeconds: number | undefined;
  let sourceCreativeId: string | undefined;
  let upload:
    | { url: string; fileName: string; aspectRatio: string; durationSeconds?: number }
    | undefined;

  if (input.kind === "video") {
    if ("upload" in input) {
      if (!isOwnR2Url(input.upload.url, `uploads/${user._id}/`)) {
        return NextResponse.json({ error: "Upload not found" }, { status: 400 });
      }
      durationSeconds = input.upload.durationSeconds;
      upload = {
        url: input.upload.url,
        fileName: input.upload.fileName,
        aspectRatio: aspectRatioOf(input.upload.width, input.upload.height),
        durationSeconds,
      };
    } else {
      const source = await convexGetCreativeForEnhancement(user._id, input.creativeId);
      if (!source || source.kind !== "video") {
        return NextResponse.json({ error: "Creative not found" }, { status: 400 });
      }
      if (!source.durationSeconds) {
        return NextResponse.json(
          { error: "This video's length is unknown, so its cost can't be calculated" },
          { status: 400 },
        );
      }
      durationSeconds = source.durationSeconds;
      sourceCreativeId = input.creativeId;
    }

    const quote = getVideoEnhanceQuote(input.tier, input.resolution, durationSeconds);
    if (!quote) {
      return NextResponse.json(
        { error: `${input.tier} mode has no ${input.resolution} option` },
        { status: 400 },
      );
    }
    kind = "video";
    task = quote.task;
    resolutionLabel = quote.label;
    credits = quote.credits;
    billableUnits = quote.seconds;
  } else {
    kind = "image";
    task = imageEnhanceOption.task;
    resolutionLabel = imageEnhanceOption.label;
    credits = imageEnhanceOption.credits;
    billableUnits = 1;
    sourceCreativeId = input.creativeId;
  }

  const estimatedCostUsdCents = creditsToUsdCents(credits);

  let created: { creativeId: string; sourceUrl: string };
  try {
    created = await convexCreateEnhancement({
      userId: user._id,
      kind,
      sourceCreativeId,
      upload,
      modelFamily: kind === "video" ? "vmake-video-enhance" : "vmake-enhance",
      modelLabel: kind === "video" ? "Vmake Video Enhance" : "Vmake Enhance",
      endpointId: `vmake/${task}`,
      resolution: resolutionLabel,
      estimatedCostUsdCents,
      vmakeCredits: credits,
      billableUnits,
      billingUnit: kind === "video" ? "second" : "image",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known = knownErrors.find((text) => message.includes(text));
    return NextResponse.json(
      { error: known ?? "Could not start the enhancement" },
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
        error instanceof Error ? error.message : "Vmake enhancement failed",
      );
    }
  });

  return NextResponse.json({ ok: true, creativeId: created.creativeId, credits });
}

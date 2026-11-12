import { after, NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth/session";
import { getServerEnvSafe } from "@/lib/env";
import {
  convexCreateEnhancement,
  convexGetUserById,
  convexMarkCreativeFailed,
} from "@/lib/convex";
import {
  applyVmakeResult,
  callVmakeService,
  isVmakeConfigured,
  vmakeEnhance,
} from "@/lib/vmake";

// The Vmake job runs after the response is sent; give it room to finish.
export const maxDuration = 120;

const schema = z.object({
  creativeId: z.string().min(1),
});

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

  let created: { creativeId: string; sourceUrl: string };
  try {
    created = await convexCreateEnhancement({
      userId: user._id,
      sourceCreativeId: parsed.data.creativeId,
      modelFamily: vmakeEnhance.modelFamily,
      modelLabel: vmakeEnhance.modelLabel,
      endpointId: vmakeEnhance.endpointId,
      resolution: vmakeEnhance.resolution,
      estimatedCostUsdCents: vmakeEnhance.estimatedCostUsdCents,
      vmakeCredits: vmakeEnhance.vmakeCredits,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known = ["Image not found", "Only finished images can be enhanced", "This image is already enhanced"]
      .find((text) => message.includes(text));
    return NextResponse.json(
      { error: known ?? "Could not start the enhancement" },
      { status: known ? 400 : 500 },
    );
  }

  const origin = new URL(request.url).origin;
  const creative = {
    _id: created.creativeId,
    userId: user._id as string,
    estimatedCostUsdCents: vmakeEnhance.estimatedCostUsdCents,
  };

  // Respond right away; the gallery shows the new card as "Rendering..." and
  // picks up the result on its next refresh.
  after(async () => {
    try {
      const result = await callVmakeService(origin, {
        action: "enhance",
        imageUrl: created.sourceUrl,
      });
      await applyVmakeResult(creative, result);
    } catch (error) {
      await convexMarkCreativeFailed(
        created.creativeId,
        error instanceof Error ? error.message : "Vmake enhancement failed",
      );
    }
  });

  return NextResponse.json({ ok: true, creativeId: created.creativeId });
}

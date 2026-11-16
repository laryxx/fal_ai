import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth/session";
import { getServerEnv, getServerEnvSafe } from "@/lib/env";
import { convexGetUserById } from "@/lib/convex";
import { createPresignedUploadUrl } from "@/lib/r2";

const schema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1),
  // "reference" = reference image for generation; "video" = a video to enhance.
  purpose: z.enum(["reference", "video"]).optional(),
});

export async function POST(request: Request) {
  if (!getServerEnvSafe().ok) {
    return NextResponse.json({ error: "Server not configured" }, { status: 503 });
  }

  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const user = await convexGetUserById(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const purpose = parsed.data.purpose ?? "reference";
  if (purpose === "video" && !parsed.data.contentType.startsWith("video/")) {
    return NextResponse.json({ error: "Only video files can be enhanced" }, { status: 400 });
  }

  const env = getServerEnv();
  const sanitized = parsed.data.fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
  const folder = purpose === "video" ? "uploads" : "references";
  const key = `${folder}/${user._id}/${crypto.randomUUID()}-${sanitized}`;

  const presignedUrl = await createPresignedUploadUrl({
    key,
    contentType: parsed.data.contentType,
  });

  const publicUrl = `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;

  return NextResponse.json({ presignedUrl, publicUrl });
}

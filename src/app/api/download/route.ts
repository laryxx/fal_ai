import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth/session";
import { getServerEnvSafe } from "@/lib/env";
import { createSignedR2DownloadUrl } from "@/lib/r2";

function sanitizeDownloadName(fileName: string) {
  const normalized = fileName.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  return normalized || "download";
}

export async function GET(request: Request) {
  const envResult = getServerEnvSafe();
  if (!envResult.ok || !envResult.env) {
    return NextResponse.json(
      { error: "Configure the environment before downloading assets" },
      { status: 503 },
    );
  }

  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const downloadUrl = searchParams.get("url");
  const fileName = sanitizeDownloadName(
    searchParams.get("filename") ?? searchParams.get("fileName") ?? "download",
  );

  if (!downloadUrl) {
    return NextResponse.json({ error: "Missing download URL" }, { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(downloadUrl);
  } catch {
    return NextResponse.json({ error: "Invalid download URL" }, { status: 400 });
  }

  const allowedBaseUrl = envResult.env.R2_PUBLIC_BASE_URL.replace(/\/$/, "");
  if (
    targetUrl.href !== allowedBaseUrl &&
    !targetUrl.href.startsWith(`${allowedBaseUrl}/`)
  ) {
    return NextResponse.json({ error: "Download URL is not allowed" }, { status: 400 });
  }

  const signedUrl = await createSignedR2DownloadUrl({
    publicUrl: targetUrl.href,
    fileName,
  });

  return NextResponse.redirect(signedUrl, { status: 307 });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth/session";
import { getBaseEnvSafe } from "@/lib/env";
import { convexCreateInvite, convexGetUserById } from "@/lib/convex";

const inviteSchema = z.object({
  email: z.string().trim().email(),
});

export async function POST(request: Request) {
  if (!getBaseEnvSafe().ok) {
    return NextResponse.json(
      { error: "Configure Convex and the app secrets before creating invites" },
      { status: 503 },
    );
  }

  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const user = await convexGetUserById(session.userId);
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Only the admin can invite users" }, { status: 403 });
  }

  const parsed = inviteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  try {
    await convexCreateInvite(user._id, parsed.data.email);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not create the invite",
      },
      { status: 400 },
    );
  }
}

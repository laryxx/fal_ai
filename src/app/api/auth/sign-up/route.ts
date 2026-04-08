import { NextResponse } from "next/server";
import { authSchema } from "@/lib/auth/validators";
import { setSessionCookie } from "@/lib/auth/session";
import { getBaseEnvSafe } from "@/lib/env";
import {
  convexCreateMemberFromInvite,
  convexGetBootstrapState,
  convexGetUserById,
  convexRecordLogin,
} from "@/lib/convex";
import { hashPassword } from "@/lib/password";

export async function POST(request: Request) {
  if (!getBaseEnvSafe().ok) {
    return NextResponse.json(
      { error: "Configure Convex and the app secrets before signing up" },
      { status: 503 },
    );
  }

  const parsed = authSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email and password" }, { status: 400 });
  }

  const bootstrapState = await convexGetBootstrapState();
  if (bootstrapState.bootstrapRequired) {
    return NextResponse.json({ error: "Create the admin account first" }, { status: 409 });
  }

  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const result = await convexCreateMemberFromInvite(parsed.data.email, passwordHash);
    const user = await convexGetUserById(result.userId);

    if (!user) {
      return NextResponse.json({ error: "Failed to create the user" }, { status: 500 });
    }

    await convexRecordLogin(user._id);
    await setSessionCookie({
      userId: user._id,
      email: user.email,
      role: user.role,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not create the account",
      },
      { status: 400 },
    );
  }
}

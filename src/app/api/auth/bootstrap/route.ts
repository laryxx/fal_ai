import { NextResponse } from "next/server";
import { authSchema } from "@/lib/auth/validators";
import { setSessionCookie } from "@/lib/auth/session";
import { getBaseEnvSafe } from "@/lib/env";
import {
  convexBootstrapAdmin,
  convexGetBootstrapState,
  convexGetUserById,
  convexRecordLogin,
} from "@/lib/convex";
import { hashPassword } from "@/lib/password";

export async function POST(request: Request) {
  if (!getBaseEnvSafe().ok) {
    return NextResponse.json(
      { error: "Configure Convex and the app secrets before creating the admin account" },
      { status: 503 },
    );
  }

  const parsed = authSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email and password" }, { status: 400 });
  }

  const bootstrapState = await convexGetBootstrapState();
  if (!bootstrapState.bootstrapRequired) {
    return NextResponse.json({ error: "Admin bootstrap is already complete" }, { status: 409 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const result = await convexBootstrapAdmin(parsed.data.email, passwordHash);
  const user = await convexGetUserById(result.userId);

  if (!user) {
    return NextResponse.json({ error: "Failed to create the admin account" }, { status: 500 });
  }

  await convexRecordLogin(user._id);
  await setSessionCookie({
    userId: user._id,
    email: user.email,
    role: user.role,
  });

  return NextResponse.json({ ok: true });
}

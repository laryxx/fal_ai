import { NextResponse } from "next/server";
import { authSchema } from "@/lib/auth/validators";
import { setSessionCookie } from "@/lib/auth/session";
import { getBaseEnvSafe } from "@/lib/env";
import { convexGetUserByEmail, convexRecordLogin } from "@/lib/convex";
import { verifyPassword } from "@/lib/password";

export async function POST(request: Request) {
  if (!getBaseEnvSafe().ok) {
    return NextResponse.json(
      { error: "Configure Convex and the app secrets before signing in" },
      { status: 503 },
    );
  }

  const parsed = authSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email and password" }, { status: 400 });
  }

  const user = await convexGetUserByEmail(parsed.data.email);
  if (!user || user.status !== "active") {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const passwordValid = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!passwordValid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  await convexRecordLogin(user._id);
  await setSessionCookie({
    userId: user._id,
    email: user.email,
    role: user.role,
  });

  return NextResponse.json({ ok: true });
}

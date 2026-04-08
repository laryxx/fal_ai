import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getBaseEnv } from "@/lib/env";

const COOKIE_NAME = "fal-dash-session";

export type AppSession = {
  userId: string;
  email: string;
  role: "admin" | "member";
};

function getSigningKey() {
  return new TextEncoder().encode(getBaseEnv().SESSION_SECRET);
}

export async function createSessionToken(session: AppSession) {
  return await new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSigningKey());
}

export async function readSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getSigningKey());
    return {
      userId: String(payload.userId),
      email: String(payload.email),
      role: payload.role === "admin" ? "admin" : "member",
    } satisfies AppSession;
  } catch {
    return null;
  }
}

export async function setSessionCookie(session: AppSession) {
  const cookieStore = await cookies();
  const token = await createSessionToken(session);

  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

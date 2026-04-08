import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth/session";
import { getBaseEnvSafe } from "@/lib/env";
import { convexGetUserById, convexGetMemberDetail } from "@/lib/convex";

const schema = z.object({
  memberId: z.string().min(1),
});

export async function POST(request: Request) {
  if (!getBaseEnvSafe().ok) {
    return NextResponse.json({ error: "Server not configured" }, { status: 503 });
  }

  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const user = await convexGetUserById(session.userId);
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const detail = await convexGetMemberDetail(user._id, parsed.data.memberId);
  return NextResponse.json(detail);
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth/session";
import { getBaseEnvSafe } from "@/lib/env";
import { convexGetUserById, convexListTeamFiltered } from "@/lib/convex";

const filterSchema = z.object({
  fromTimestamp: z.number().min(0),
  toTimestamp: z.number().min(0),
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

  const parsed = filterSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const users = await convexListTeamFiltered(user._id, parsed.data.fromTimestamp, parsed.data.toTimestamp);
  return NextResponse.json({ users });
}

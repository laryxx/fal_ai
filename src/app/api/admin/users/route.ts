import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth/session";
import { getBaseEnvSafe } from "@/lib/env";
import { convexDeleteUser, convexPromoteToAdmin, convexGetUserById } from "@/lib/convex";

const actionSchema = z.object({
  userId: z.string().min(1),
  action: z.enum(["delete", "promote"]),
});

export async function POST(request: Request) {
  if (!getBaseEnvSafe().ok) {
    return NextResponse.json(
      { error: "Configure Convex and the app secrets before managing users" },
      { status: 503 },
    );
  }

  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const user = await convexGetUserById(session.userId);
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Only the admin can manage users" }, { status: 403 });
  }

  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { userId, action } = parsed.data;

  try {
    if (action === "delete") {
      await convexDeleteUser(user._id, userId);
    } else {
      await convexPromoteToAdmin(user._id, userId);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Action failed" },
      { status: 400 },
    );
  }
}

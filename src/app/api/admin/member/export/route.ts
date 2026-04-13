import { NextResponse } from "next/server";
import { z } from "zod";
import * as XLSX from "xlsx";
import { readSession } from "@/lib/auth/session";
import { getBaseEnvSafe } from "@/lib/env";
import { convexGetUserById, convexGetMemberFullLog } from "@/lib/convex";

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

  const data = await convexGetMemberFullLog(user._id, parsed.data.memberId);

  const rows = data.creatives.map((c: {
    createdAt: number;
    kind: string;
    modelLabel: string;
    prompt: string;
    aspectRatio: string;
    durationSeconds: number | null;
    status: string;
    actualCostUsdCents: number;
    billableUnits: number;
    billingUnit: string;
  }) => ({
    Date: new Date(c.createdAt).toLocaleString("en-US"),
    Kind: c.kind,
    Model: c.modelLabel,
    Prompt: c.prompt,
    "Aspect Ratio": c.aspectRatio,
    "Duration (s)": c.durationSeconds ?? "",
    Status: c.status,
    "Cost (USD)": (c.actualCostUsdCents / 100).toFixed(4).replace(".", ","),
    "Billable Units": c.billableUnits,
    "Billing Unit": c.billingUnit,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Generations");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const filename = `${data.email.replace(/[^a-z0-9]/gi, "_")}-generations.xlsx`;

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

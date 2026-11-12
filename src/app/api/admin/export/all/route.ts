import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { readSession } from "@/lib/auth/session";
import { getBaseEnvSafe } from "@/lib/env";
import { convexGetUserById, convexGetAllMembersFullLog } from "@/lib/convex";

export async function POST() {
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

  const members = await convexGetAllMembersFullLog(user._id);
  const wb = XLSX.utils.book_new();

  for (const member of members) {
    const rows = member.creatives.map((c: {
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
      vmakeCredits: number;
    }) => ({
      Date: new Date(c.createdAt).toLocaleString("en-US"),
      Kind: c.kind,
      Model: c.modelLabel,
      Prompt: c.prompt,
      "Aspect Ratio": c.aspectRatio,
      "Duration (s)": c.durationSeconds ?? "",
      Status: c.status,
      "Cost (USD)": c.actualCostUsdCents / 100,
      "Vmake Credits": c.vmakeCredits || "",
      "Billable Units": c.billableUnits,
      "Billing Unit": c.billingUnit,
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, member.email.slice(0, 31));
  }

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const date = new Date().toISOString().slice(0, 10);

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="all-members-${date}.xlsx"`,
    },
  });
}

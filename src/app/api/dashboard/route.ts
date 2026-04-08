import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth/session";
import { loadAppData } from "@/lib/dashboard";

export async function GET() {
  const session = await readSession();
  const data = await loadAppData(session);
  return NextResponse.json(data);
}

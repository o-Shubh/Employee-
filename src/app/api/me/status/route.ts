import { NextResponse } from "next/server";
import { getTenantCtxOrNull } from "@/server/auth/session";
import { getStatusSnapshot } from "@/server/services/status";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getTenantCtxOrNull();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const snap = await getStatusSnapshot(ctx, new Date());
  return NextResponse.json(snap, { headers: { "Cache-Control": "no-store" } });
}

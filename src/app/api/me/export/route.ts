import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getTenantCtxOrNull } from "@/server/auth/session";
import { resolveClientIp } from "@/server/security/client-ip";
import { exportMyData } from "@/server/services/privacy";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getTenantCtxOrNull();
  if (!ctx) return new NextResponse(null, { status: 401 });
  const data = await exportMyData(ctx, resolveClientIp(await headers()));
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="worklog-my-data-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}

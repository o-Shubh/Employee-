import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getTenantCtxOrNull } from "@/server/auth/session";
import { resolveClientIp } from "@/server/security/client-ip";
import { exportMyDataZip } from "@/server/services/privacy";

export const dynamic = "force-dynamic";

/** DPDP right of access: everything about the signed-in employee as a ZIP (CSV + JSON). */
export async function GET() {
  const ctx = await getTenantCtxOrNull();
  if (!ctx) return new NextResponse(null, { status: 401 });
  const zip = await exportMyDataZip(ctx, resolveClientIp(await headers()));
  return new NextResponse(Buffer.from(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="worklog-my-data-${new Date().toISOString().slice(0, 10)}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}

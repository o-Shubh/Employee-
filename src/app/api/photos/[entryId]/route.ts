import { NextResponse } from "next/server";
import { getTenantCtxOrNull } from "@/server/auth/session";
import { assertCanViewEmployee } from "@/server/services/attendance";
import { audit } from "@/server/services/audit";
import { storage } from "@/server/storage";

export const dynamic = "force-dynamic";

/** Check-in photo: visible to the employee, their manager and company admins. Every view by someone else is audited. */
export async function GET(_req: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const { entryId } = await params;
  const ctx = await getTenantCtxOrNull();
  if (!ctx) return new NextResponse(null, { status: 401 });
  const entry = await ctx.db.logEntry.findUnique({ where: { id: entryId }, select: { employeeId: true, photoKey: true } });
  if (!entry?.photoKey) return new NextResponse(null, { status: 404 });
  try {
    await assertCanViewEmployee(ctx, entry.employeeId);
  } catch {
    return new NextResponse(null, { status: 404 });
  }
  const bytes = await storage().get(entry.photoKey);
  if (!bytes) return new NextResponse(null, { status: 404 });
  if (entry.employeeId !== ctx.actor.employeeId) {
    await audit(ctx, { action: "photo.viewed", entityType: "LogEntry", entityId: entryId, subjectEmployeeId: entry.employeeId });
  }
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" },
  });
}

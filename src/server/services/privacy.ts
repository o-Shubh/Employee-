import type { TenantCtx } from "../context";
import { AppError } from "../errors";
import { audit } from "./audit";

/** Everything WorkLog holds about the signed-in employee (DPDP Act 2023, s.11 right to access). */
export async function exportMyData(ctx: TenantCtx, ip: string | null) {
  const employeeId = ctx.actor.employeeId;
  if (!employeeId) throw new AppError("NO_EMPLOYEE_PROFILE");
  const [profile, logEntries, dayRecords, certifications, devices, consents, auditEvents] = await Promise.all([
    ctx.db.employee.findUniqueOrThrow({
      where: { id: employeeId },
      include: {
        user: { select: { email: true, role: true, status: true, lastLoginAt: true, createdAt: true } },
        department: { select: { name: true } },
        manager: { select: { fullName: true, employeeCode: true } },
        officeLocation: { select: { name: true } },
      },
    }),
    ctx.db.logEntry.findMany({ where: { employeeId }, orderBy: { occurredAt: "asc" } }),
    ctx.db.dayRecord.findMany({ where: { employeeId }, orderBy: { workDate: "asc" } }),
    ctx.db.dayCertification.findMany({ where: { employeeId }, orderBy: { certifiedAt: "asc" } }),
    ctx.db.device.findMany({ where: { employeeId }, omit: { tokenHash: true } }),
    ctx.db.consentRecord.findMany({ where: { userId: ctx.actor.userId } }),
    ctx.db.auditEvent.findMany({ where: { OR: [{ subjectEmployeeId: employeeId }, { actorUserId: ctx.actor.userId }] }, orderBy: { createdAt: "asc" } }),
  ]);
  await audit(ctx, { action: "privacy.exported", entityType: "Employee", entityId: employeeId, subjectEmployeeId: employeeId, ip });
  return {
    exportedAt: new Date().toISOString(),
    timezone: ctx.tenant.timezone,
    note: "All timestamps are UTC (ISO 8601). workDate is the local calendar date in the timezone above.",
    profile,
    logEntries: logEntries.map((e) => ({ ...e, photoKey: e.photoKey ? "(photo on file — ask your administrator for a copy)" : null })),
    dayRecords,
    certifications,
    devices,
    consents,
    auditEvents,
  };
}

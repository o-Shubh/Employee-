import type { TenantCtx } from "../context";
import { AppError } from "../errors";
import { audit } from "./audit";

/** Everything WorkLog holds about the signed-in employee (DPDP Act 2023, s.11 right to access). */
export async function exportMyData(ctx: TenantCtx, ip: string | null) {
  const employeeId = ctx.actor.employeeId;
  if (!employeeId) throw new AppError("NO_EMPLOYEE_PROFILE");
  const [profile, logEntries, dayRecords, certifications, devices, consents, auditEvents, leaveRequests, leaveLedger, corrections, overtime] = await Promise.all([
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
    ctx.db.leaveRequest.findMany({ where: { employeeId }, orderBy: { startDate: "asc" }, include: { leaveType: { select: { code: true, name: true } } } }),
    ctx.db.leaveLedger.findMany({ where: { employeeId }, orderBy: { createdAt: "asc" }, include: { leaveType: { select: { code: true } } } }),
    ctx.db.correctionRequest.findMany({ where: { employeeId }, orderBy: { createdAt: "asc" } }),
    ctx.db.overtimeRequest.findMany({ where: { employeeId }, orderBy: { createdAt: "asc" } }),
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
    leaveRequests,
    leaveLedger,
    corrections,
    overtime,
  };
}

/** The same data as a ZIP: CSV files for spreadsheets plus the complete JSON. */
export async function exportMyDataZip(ctx: TenantCtx, ip: string | null): Promise<Uint8Array> {
  const { strToU8, zipSync } = await import("fflate");
  const { toCsv } = await import("@/domain/csv");
  const d = await exportMyData(ctx, ip);
  const iso = (x: Date | null | undefined) => (x ? x.toISOString() : "");
  const day = (x: Date) => x.toISOString().slice(0, 10);
  const files: Record<string, Uint8Array> = {
    "README.txt": strToU8(
      `WorkLog personal data export\nExported: ${d.exportedAt}\nTime zone: ${d.timezone}\n\n${d.note}\n\neverything.json holds every field; the CSV files are the same data in spreadsheet form.\n`,
    ),
    "everything.json": strToU8(JSON.stringify(d, null, 2)),
    "log_entries.csv": strToU8(toCsv([
      ["id", "work_date", "type", "break_kind", "note", "occurred_at_utc", "recorded_at_utc", "source", "supersedes_id", "ip"],
      ...d.logEntries.map((e) => [e.id, day(e.workDate), e.type, e.breakKind, e.note, iso(e.occurredAt), iso(e.recordedAt), e.source, e.supersedesId, e.ip]),
    ])),
    "days.csv": strToU8(toCsv([
      ["work_date", "state", "work_minutes", "break_minutes", "field_minutes", "first_in_utc", "last_out_utc", "flags"],
      ...d.dayRecords.map((r) => [day(r.workDate), r.state, r.workMin, r.breakMin, r.fieldMin, iso(r.firstInAt), iso(r.lastOutAt), r.flags.join(" ")]),
    ])),
    "certifications.csv": strToU8(toCsv([["work_date", "summary", "certified_at_utc"], ...d.certifications.map((c) => [day(c.workDate), c.summary, iso(c.certifiedAt)])])),
    "leave_requests.csv": strToU8(toCsv([
      ["type", "start", "end", "half_day_start", "half_day_end", "days", "reason", "status", "decided_at_utc", "comment"],
      ...d.leaveRequests.map((l) => [l.leaveType.code, day(l.startDate), day(l.endDate), l.halfDayStart, l.halfDayEnd, String(l.days), l.reason, l.status, iso(l.decidedAt), l.decisionComment]),
    ])),
    "leave_ledger.csv": strToU8(toCsv([["type", "year", "kind", "days", "reason", "at_utc"], ...d.leaveLedger.map((l) => [l.leaveType.code, l.year, l.kind, String(l.days), l.reason, iso(l.createdAt)])])),
    "corrections.csv": strToU8(toCsv([
      ["work_date", "reason", "status", "changes_json", "decided_at_utc", "comment"],
      ...d.corrections.map((c) => [day(c.workDate), c.reason, c.status, JSON.stringify(c.ops), iso(c.decidedAt), c.decisionComment]),
    ])),
    "overtime.csv": strToU8(toCsv([["work_date", "minutes", "reason", "status", "decided_at_utc", "comment"], ...d.overtime.map((o) => [day(o.workDate), o.minutes, o.reason, o.status, iso(o.decidedAt), o.decisionComment])])),
    "audit_trail.csv": strToU8(toCsv([["at_utc", "action", "reason", "ip", "before", "after"], ...d.auditEvents.map((a) => [iso(a.createdAt), a.action, a.reason, a.ip, a.before ? JSON.stringify(a.before) : "", a.after ? JSON.stringify(a.after) : ""])])),
  };
  return zipSync(files, { level: 6 });
}

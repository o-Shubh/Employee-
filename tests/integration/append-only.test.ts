import { describe, expect, it } from "vitest";
import { punch } from "@/server/services/attendance";
import { db, makeTenant, officeEnv } from "./fixtures";

describe("append-only log and audit trail", () => {
  it("log entries and audit events cannot be updated or deleted, even with raw SQL", async () => {
    const T = await makeTenant("ao");
    const { entryId } = await punch(T.ctx.employee, { type: "CHECK_IN" }, officeEnv(new Date(), T.deviceToken));

    await expect(db.logEntry.update({ where: { id: entryId }, data: { note: "edited" } })).rejects.toThrow(/WORKLOG_APPEND_ONLY/);
    await expect(db.logEntry.delete({ where: { id: entryId } })).rejects.toThrow(/WORKLOG_APPEND_ONLY/);
    await expect(db.$executeRawUnsafe(`UPDATE "LogEntry" SET "occurredAt" = now() - interval '2 hours' WHERE id = $1`, entryId)).rejects.toThrow(/WORKLOG_APPEND_ONLY/);

    const ev = await db.auditEvent.findFirstOrThrow({ where: { tenantId: T.tenant.id, entityId: entryId } });
    await expect(db.auditEvent.update({ where: { id: ev.id }, data: { reason: "x" } })).rejects.toThrow(/WORKLOG_APPEND_ONLY/);
    await expect(db.auditEvent.deleteMany({ where: { tenantId: T.tenant.id } })).rejects.toThrow(/WORKLOG_APPEND_ONLY/);

    expect(await db.logEntry.count({ where: { id: entryId } })).toBe(1);
  });

  it("break kind must accompany BREAK entries (DB check)", async () => {
    const T = await makeTenant("ck");
    await expect(
      db.logEntry.create({
        data: { tenantId: T.tenant.id, employeeId: T.employee.employee.id, workDate: new Date("2026-01-01"), type: "BREAK", occurredAt: new Date(), source: "SELF", createdById: T.employee.user.id },
      }),
    ).rejects.toThrow(/log_entry_break_kind_chk/);
  });
});

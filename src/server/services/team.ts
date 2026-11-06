import type { LogEntry } from "@prisma/client";
import { addDaysKey, dateKeyToDb, dbToDateKey, localDateKey } from "@/domain/time";
import { staleShiftMs, type TenantCtx } from "../context";
import { deriveShiftState } from "./attendance";
import { leaveInRange } from "./leave";
import { decidableWhere } from "./approval-rights";

export type BoardStatus = "ON_DUTY" | "BREAK" | "FIELD_DUTY" | "OFF" | "ON_LEAVE";

/**
 * Live team board: direct reports for a manager, everyone for an admin.
 * A fixed number of queries regardless of team size: people, recent log entries
 * (yesterday + today covers night shifts), recent day records (older missed
 * check-outs) and today's leave.
 */
export async function teamBoard(ctx: TenantCtx, now: Date) {
  const people = await ctx.db.employee.findMany({
    where: { status: "ACTIVE", ...(ctx.actor.role === "MANAGER" ? { managerId: ctx.actor.employeeId ?? "-" } : {}) },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, employeeCode: true, designation: true, department: { select: { name: true } } },
  });
  const ids = people.map((p) => p.id);
  const today = localDateKey(now, ctx.tenant.timezone);
  const yesterday = addDaysKey(today, -1);
  const [entries, records, leave] = await Promise.all([
    ctx.db.logEntry.findMany({
      where: { employeeId: { in: ids }, workDate: { gte: dateKeyToDb(yesterday) } },
      orderBy: [{ occurredAt: "asc" }, { recordedAt: "asc" }],
    }),
    ctx.db.dayRecord.findMany({
      where: { employeeId: { in: ids }, workDate: { gte: dateKeyToDb(addDaysKey(today, -14)), lt: dateKeyToDb(yesterday) } },
      orderBy: { workDate: "desc" },
      select: { employeeId: true, workDate: true, state: true },
    }),
    leaveInRange(ctx, today, today, ids),
  ]);

  const byEmployee = new Map<string, LogEntry[]>();
  for (const e of entries) {
    const list = byEmployee.get(e.employeeId) ?? [];
    list.push(e);
    byEmployee.set(e.employeeId, list);
  }
  const opts = { now, staleAfterMs: staleShiftMs() };

  return people.map((p) => {
    const mine = byEmployee.get(p.id) ?? [];
    let latest: string | null = null;
    for (const e of mine) {
      const k = dbToDateKey(e.workDate);
      if (!latest || k > latest) latest = k;
    }
    const shift = deriveShiftState(latest, latest ? mine.filter((e) => dbToDateKey(e.workDate) === latest) : [], today, opts);
    if (!latest) {
      // No entries since yesterday: report an older day that was never checked out.
      const last = records.find((r) => r.employeeId === p.id);
      if (last && (last.state === "MISSED_CHECKOUT" || last.state === "OPEN")) shift.missedCheckoutOn = dbToDateKey(last.workDate);
    }
    const l = leave.find((x) => x.employeeId === p.id);
    const halfDay = l && ((l.halfDayStart && dbToDateKey(l.startDate) === today) || (l.halfDayEnd && dbToDateKey(l.endDate) === today));
    // Someone on leave who checked in anyway shows their real status.
    const board: BoardStatus = shift.status === "OFF" && l ? "ON_LEAVE" : shift.status;
    return { person: p, shift, board, leave: l ? { code: l.leaveType.code, name: l.leaveType.name, halfDay: !!halfDay } : null };
  });
}

export async function pendingApprovalCount(ctx: TenantCtx) {
  if (ctx.actor.role !== "MANAGER" && ctx.actor.role !== "COMPANY_ADMIN") return 0;
  const where = { status: "PENDING" as const, ...(await decidableWhere(ctx)) };
  const [a, b, c] = await Promise.all([ctx.db.leaveRequest.count({ where }), ctx.db.correctionRequest.count({ where }), ctx.db.overtimeRequest.count({ where })]);
  return a + b + c;
}

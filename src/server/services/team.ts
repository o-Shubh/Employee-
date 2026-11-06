import { dbToDateKey, localDateKey } from "@/domain/time";
import type { TenantCtx } from "../context";
import { getShiftState } from "./attendance";
import { leaveInRange } from "./leave";
import { decidableWhere } from "./approval-rights";

export type BoardStatus = "ON_DUTY" | "BREAK" | "FIELD_DUTY" | "OFF" | "ON_LEAVE";

/** Live team board: direct reports for a manager, everyone for an admin. */
export async function teamBoard(ctx: TenantCtx, now: Date) {
  const people = await ctx.db.employee.findMany({
    where: { status: "ACTIVE", ...(ctx.actor.role === "MANAGER" ? { managerId: ctx.actor.employeeId ?? "-" } : {}) },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, employeeCode: true, designation: true, department: { select: { name: true } } },
  });
  const today = localDateKey(now, ctx.tenant.timezone);
  const leave = await leaveInRange(ctx, today, today, people.map((p) => p.id));
  const rows = await Promise.all(
    people.map(async (p) => {
      const s = await getShiftState(ctx, p.id, now);
      const l = leave.find((x) => x.employeeId === p.id);
      const halfDay = l && ((l.halfDayStart && dbToDateKey(l.startDate) === today) || (l.halfDayEnd && dbToDateKey(l.endDate) === today));
      // Someone on leave who checked in anyway shows their real status.
      const board: BoardStatus = s.status === "OFF" && l ? "ON_LEAVE" : s.status;
      return { person: p, shift: s, board, leave: l ? { code: l.leaveType.code, name: l.leaveType.name, halfDay: !!halfDay } : null };
    }),
  );
  return rows;
}

export async function pendingApprovalCount(ctx: TenantCtx) {
  if (ctx.actor.role !== "MANAGER" && ctx.actor.role !== "COMPANY_ADMIN") return 0;
  const where = { status: "PENDING" as const, ...decidableWhere(ctx) };
  const [a, b, c] = await Promise.all([ctx.db.leaveRequest.count({ where }), ctx.db.correctionRequest.count({ where }), ctx.db.overtimeRequest.count({ where })]);
  return a + b + c;
}

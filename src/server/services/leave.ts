import { z } from "zod";
import type { LeaveRequest, LeaveType } from "@prisma/client";
import { countLeaveDays, sumBalance, type WorkCalendar } from "@/domain/leave";
import { addDaysKey, dateKeyToDb, dbToDateKey, isDateKey, localDateKey, type DateKey } from "@/domain/time";
import { AppError } from "../errors";
import { isAdmin, type RequestEnv, type TenantCtx } from "../context";
import type { TenantClient } from "../db/tenant";
import { audit } from "./audit";
import { lockEmployee } from "./attendance";
import { assertCanDecide, decidableWhere, decisionInput } from "./approval-rights";

const num = (d: { toString(): string } | number) => Number(d);

export function workCalendar(ctx: TenantCtx): WorkCalendar {
  return { weeklyOff: new Set(ctx.tenant.weeklyOffDays), holidays: new Set() };
}

// ─────────────────────────── Leave types (admin) ───────────────────────────

export const leaveTypeInput = z.object({
  code: z.string().trim().toUpperCase().min(1).max(10).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(2).max(60),
  yearlyQuota: z.coerce.number().min(0).max(365).multipleOf(0.5),
  tracksBalance: z.boolean(),
  paid: z.boolean(),
  halfDayAllowed: z.boolean(),
  active: z.boolean(),
});

export async function listLeaveTypes(ctx: TenantCtx, opts: { activeOnly?: boolean } = {}) {
  return ctx.db.leaveType.findMany({ where: opts.activeOnly ? { active: true } : undefined, orderBy: { code: "asc" } });
}

export async function saveLeaveType(ctx: TenantCtx, id: string | null, raw: z.input<typeof leaveTypeInput>, env: RequestEnv) {
  if (!isAdmin(ctx)) throw new AppError("FORBIDDEN");
  const parsed = leaveTypeInput.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION");
  const data = parsed.data;
  if (id) {
    const before = await ctx.db.leaveType.findUnique({ where: { id } });
    if (!before) throw new AppError("NOT_FOUND");
    const t = await ctx.db.leaveType.update({ where: { id }, data });
    await audit(ctx, { action: "leave_type.updated", entityType: "LeaveType", entityId: id, ip: env.ip, at: env.now, before: { ...before, yearlyQuota: num(before.yearlyQuota) }, after: data });
    return t;
  }
  const exists = await ctx.db.leaveType.findFirst({ where: { code: data.code } });
  if (exists) throw new AppError("DUPLICATE_NAME");
  const t = await ctx.db.leaveType.create({ data: { tenantId: ctx.tenantId, ...data } });
  await audit(ctx, { action: "leave_type.created", entityType: "LeaveType", entityId: t.id, ip: env.ip, at: env.now, after: data });
  return t;
}

/**
 * Grant each active employee their yearly quota for `year`, once per type
 * (re-running is safe: employees who already have an allocation are skipped).
 */
export async function allocateYear(ctx: TenantCtx, year: number, env: RequestEnv) {
  if (!isAdmin(ctx)) throw new AppError("FORBIDDEN");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new AppError("VALIDATION");
  const [types, employees, existing] = await Promise.all([
    ctx.db.leaveType.findMany({ where: { active: true, tracksBalance: true, yearlyQuota: { gt: 0 } } }),
    ctx.db.employee.findMany({ where: { status: "ACTIVE" }, select: { id: true } }),
    ctx.db.leaveLedger.findMany({ where: { year, kind: "ALLOCATION" }, select: { employeeId: true, leaveTypeId: true } }),
  ]);
  const have = new Set(existing.map((e) => `${e.employeeId}:${e.leaveTypeId}`));
  const rows = employees.flatMap((e) =>
    types
      .filter((t) => !have.has(`${e.id}:${t.id}`))
      .map((t) => ({
        tenantId: ctx.tenantId, employeeId: e.id, leaveTypeId: t.id, year, kind: "ALLOCATION" as const,
        days: num(t.yearlyQuota), createdById: ctx.actor.userId, reason: `Yearly quota ${year}`, createdAt: env.now,
      })),
  );
  if (rows.length) await ctx.db.leaveLedger.createMany({ data: rows });
  await audit(ctx, { action: "leave.allocated", entityType: "LeaveLedger", ip: env.ip, at: env.now, after: { year, rows: rows.length } });
  return { created: rows.length };
}

export const adjustmentInput = z.object({
  employeeId: z.string().min(1),
  leaveTypeId: z.string().min(1),
  year: z.coerce.number().int().min(2000).max(2100),
  days: z.coerce.number().min(-365).max(365).multipleOf(0.5).refine((d) => d !== 0),
  reason: z.string().trim().min(3).max(300),
});

export async function adjustBalance(ctx: TenantCtx, raw: z.input<typeof adjustmentInput>, env: RequestEnv) {
  if (!isAdmin(ctx)) throw new AppError("FORBIDDEN");
  const parsed = adjustmentInput.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION");
  const a = parsed.data;
  const row = await ctx.db.leaveLedger.create({
    data: { tenantId: ctx.tenantId, employeeId: a.employeeId, leaveTypeId: a.leaveTypeId, year: a.year, kind: "ADJUSTMENT", days: a.days, createdById: ctx.actor.userId, reason: a.reason, createdAt: env.now },
  });
  await audit(ctx, { action: "leave.adjusted", entityType: "LeaveLedger", entityId: row.id, subjectEmployeeId: a.employeeId, ip: env.ip, at: env.now, reason: a.reason, after: { leaveTypeId: a.leaveTypeId, year: a.year, days: a.days } });
  return row;
}

// ─────────────────────────── Balances ───────────────────────────

export interface Balance {
  leaveType: LeaveType;
  /** allocations + adjustments − approved leave */
  balance: number;
  pending: number;
  available: number;
  used: number;
}

export async function getBalances(ctx: TenantCtx, employeeId: string, year: number, db: TenantClient = ctx.db): Promise<Balance[]> {
  const [types, ledger, pending] = await Promise.all([
    db.leaveType.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    db.leaveLedger.findMany({ where: { employeeId, year }, select: { leaveTypeId: true, days: true, kind: true } }),
    db.leaveRequest.findMany({
      where: { employeeId, status: "PENDING", startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
      select: { leaveTypeId: true, days: true },
    }),
  ]);
  return types.map((t) => {
    const rows = ledger.filter((l) => l.leaveTypeId === t.id).map((l) => ({ days: num(l.days), kind: l.kind }));
    const balance = sumBalance(rows);
    const used = 0 - sumBalance(rows.filter((r) => r.kind === "DEBIT" || r.kind === "REVERSAL")) + 0; // +0 avoids -0
    const pend = sumBalance(pending.filter((p) => p.leaveTypeId === t.id).map((p) => ({ days: num(p.days) })));
    return { leaveType: t, balance, pending: pend, available: balance - pend, used };
  });
}

// ─────────────────────────── Requests ───────────────────────────

export const applyLeaveInput = z.object({
  leaveTypeId: z.string().min(1),
  startDate: z.string().refine(isDateKey, "DATE_INVALID"),
  endDate: z.string().refine(isDateKey, "DATE_INVALID"),
  halfDayStart: z.boolean().default(false),
  halfDayEnd: z.boolean().default(false),
  reason: z.string().trim().min(3).max(500),
});

/** Preview: days that would be charged (used by the form before submitting). */
export function previewLeaveDays(ctx: TenantCtx, span: { startDate: string; endDate: string; halfDayStart: boolean; halfDayEnd: boolean }) {
  if (!isDateKey(span.startDate) || !isDateKey(span.endDate)) return { ok: false as const, error: "DATE_INVALID" };
  return countLeaveDays({ start: span.startDate, end: span.endDate, halfDayStart: span.halfDayStart, halfDayEnd: span.halfDayEnd }, workCalendar(ctx));
}

export async function applyLeave(ctx: TenantCtx, raw: z.input<typeof applyLeaveInput>, env: RequestEnv) {
  const employeeId = ctx.actor.employeeId;
  if (!employeeId) throw new AppError("NO_EMPLOYEE_PROFILE");
  const parsed = applyLeaveInput.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION");
  const input = parsed.data;
  const today = localDateKey(env.now, ctx.tenant.timezone);
  if (input.startDate < addDaysKey(today, -60)) throw new AppError("LEAVE_TOO_FAR_BACK");
  if (input.endDate > addDaysKey(today, 366)) throw new AppError("LEAVE_TOO_FAR_AHEAD");

  const type = await ctx.db.leaveType.findUnique({ where: { id: input.leaveTypeId } });
  if (!type || !type.active) throw new AppError("LEAVE_TYPE_NOT_FOUND");
  if ((input.halfDayStart || input.halfDayEnd) && !type.halfDayAllowed) throw new AppError("HALF_DAY_NOT_ALLOWED");
  const count = previewLeaveDays(ctx, input);
  if (!count.ok) throw new AppError(`LEAVE_${count.error}`);
  const year = Number(input.startDate.slice(0, 4));

  return ctx.db.$transaction(async (tx) => {
    await lockEmployee(tx, ctx.tenantId, employeeId);
    const overlap = await tx.leaveRequest.findFirst({
      where: {
        employeeId, status: { in: ["PENDING", "APPROVED"] },
        startDate: { lte: dateKeyToDb(input.endDate) }, endDate: { gte: dateKeyToDb(input.startDate) },
      },
    });
    if (overlap) throw new AppError("LEAVE_OVERLAP");
    if (type.tracksBalance) {
      const bal = (await getBalances(ctx, employeeId, year, tx)).find((b) => b.leaveType.id === type.id);
      if (!bal || bal.available < count.days) throw new AppError("INSUFFICIENT_BALANCE", { available: bal?.available ?? 0 });
    }
    const req = await tx.leaveRequest.create({
      data: {
        tenantId: ctx.tenantId, employeeId, leaveTypeId: type.id,
        startDate: dateKeyToDb(input.startDate), endDate: dateKeyToDb(input.endDate),
        halfDayStart: input.halfDayStart, halfDayEnd: input.halfDayEnd, days: count.days, reason: input.reason, createdAt: env.now,
      },
    });
    await audit(ctx, {
      action: "leave.requested", entityType: "LeaveRequest", entityId: req.id, subjectEmployeeId: employeeId, ip: env.ip, at: env.now,
      after: { type: type.code, startDate: input.startDate, endDate: input.endDate, halfDayStart: input.halfDayStart, halfDayEnd: input.halfDayEnd, days: count.days, reason: input.reason },
    }, tx);
    return req;
  });
}

async function debitOrReverse(ctx: TenantCtx, tx: TenantClient, req: LeaveRequest, kind: "DEBIT" | "REVERSAL", now: Date, reason: string) {
  await tx.leaveLedger.create({
    data: {
      tenantId: ctx.tenantId, employeeId: req.employeeId, leaveTypeId: req.leaveTypeId, year: req.startDate.getUTCFullYear(),
      kind, days: kind === "DEBIT" ? -num(req.days) : num(req.days), leaveRequestId: req.id, createdById: ctx.actor.userId, reason, createdAt: now,
    },
  });
}

export async function decideLeave(ctx: TenantCtx, id: string, raw: { decision: string; comment?: string | null }, env: RequestEnv) {
  const { decision, comment } = decisionInput(raw);
  return ctx.db.$transaction(async (tx) => {
    const req = await tx.leaveRequest.findUnique({ where: { id }, include: { leaveType: true } });
    if (!req) throw new AppError("NOT_FOUND");
    const right = await assertCanDecide(ctx, req.employeeId, tx);
    await lockEmployee(tx, ctx.tenantId, req.employeeId);
    const fresh = await tx.leaveRequest.findUniqueOrThrow({ where: { id } });
    if (fresh.status !== "PENDING") throw new AppError("ALREADY_DECIDED");

    if (decision === "APPROVE" && req.leaveType.tracksBalance) {
      const bal = (await getBalances(ctx, req.employeeId, req.startDate.getUTCFullYear(), tx)).find((b) => b.leaveType.id === req.leaveTypeId);
      // Other pending requests are re-checked when they are decided; only the real balance matters here.
      if (!bal || bal.balance < num(req.days)) throw new AppError("INSUFFICIENT_BALANCE");
    }
    const status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
    const updated = await tx.leaveRequest.update({
      where: { id }, data: { status, decidedById: ctx.actor.userId, decidedAt: env.now, decisionComment: comment },
    });
    if (status === "APPROVED") await debitOrReverse(ctx, tx, req, "DEBIT", env.now, `Approved leave ${dbToDateKey(req.startDate)}–${dbToDateKey(req.endDate)}`);
    await audit(ctx, {
      action: `leave.${status.toLowerCase()}`, entityType: "LeaveRequest", entityId: id, subjectEmployeeId: req.employeeId, ip: env.ip, at: env.now,
      reason: comment, before: { status: "PENDING" }, after: { status, right },
    }, tx);
    return updated;
  });
}

export async function cancelLeave(ctx: TenantCtx, id: string, raw: { comment?: string | null }, env: RequestEnv) {
  return ctx.db.$transaction(async (tx) => {
    const req = await tx.leaveRequest.findUnique({ where: { id } });
    if (!req) throw new AppError("NOT_FOUND");
    const own = req.employeeId === ctx.actor.employeeId;
    if (!own) await assertCanDecide(ctx, req.employeeId, tx);
    await lockEmployee(tx, ctx.tenantId, req.employeeId);
    const fresh = await tx.leaveRequest.findUniqueOrThrow({ where: { id } });
    if (fresh.status !== "PENDING" && fresh.status !== "APPROVED") throw new AppError("ALREADY_DECIDED");
    const today = localDateKey(env.now, ctx.tenant.timezone);
    if (own && fresh.status === "APPROVED" && dbToDateKey(fresh.startDate) <= today) throw new AppError("LEAVE_ALREADY_STARTED");
    const comment = raw.comment?.trim() || null;
    if (!own && !comment) throw new AppError("COMMENT_REQUIRED");

    const updated = await tx.leaveRequest.update({ where: { id }, data: { status: "CANCELLED", decisionComment: comment ?? fresh.decisionComment } });
    if (fresh.status === "APPROVED") await debitOrReverse(ctx, tx, fresh, "REVERSAL", env.now, "Approved leave cancelled");
    await audit(ctx, {
      action: "leave.cancelled", entityType: "LeaveRequest", entityId: id, subjectEmployeeId: req.employeeId, ip: env.ip, at: env.now,
      reason: comment, before: { status: fresh.status }, after: { status: "CANCELLED", byEmployee: own },
    }, tx);
    return updated;
  });
}

export async function listLeaveRequests(ctx: TenantCtx, employeeId: string, opts: { take?: number } = {}) {
  return ctx.db.leaveRequest.findMany({
    where: { employeeId }, orderBy: { startDate: "desc" }, take: opts.take ?? 100, include: { leaveType: { select: { code: true, name: true } } },
  });
}

/** Approved / pending leave overlapping [from, to] for one or many employees. */
export async function leaveInRange(ctx: TenantCtx, from: DateKey, to: DateKey, employeeIds?: string[], statuses: ("APPROVED" | "PENDING")[] = ["APPROVED"]) {
  return ctx.db.leaveRequest.findMany({
    where: {
      status: { in: statuses },
      startDate: { lte: dateKeyToDb(to) }, endDate: { gte: dateKeyToDb(from) },
      ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
    },
    include: { leaveType: { select: { code: true, name: true } } },
  });
}

export async function pendingLeaveForApprover(ctx: TenantCtx) {
  return ctx.db.leaveRequest.findMany({
    where: { status: "PENDING", ...decidableWhere(ctx) },
    orderBy: { createdAt: "asc" },
    include: { leaveType: { select: { code: true, name: true, tracksBalance: true } }, employee: { select: { id: true, fullName: true, employeeCode: true, managerId: true } } },
  });
}

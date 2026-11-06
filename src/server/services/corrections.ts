import { z } from "zod";
import type { LogEntry, Prisma } from "@prisma/client";
import { simulateCorrection, type CorrectionOp } from "@/domain/corrections";
import { BREAK_KINDS } from "@/domain/types";
import { addDaysKey, dateKeyToDb, dbToDateKey, isDateKey, localDateKey, startOfLocalDay, type DateKey } from "@/domain/time";
import { AppError } from "../errors";
import type { RequestEnv, TenantCtx } from "../context";
import type { TenantClient } from "../db/tenant";
import { audit } from "./audit";
import { loadDayEntries, lockEmployee, recomputeDay } from "./attendance";
import { assertCanDecide, decidableWhere, decisionInput } from "./approval-rights";

const opSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("ADD"),
    type: z.enum(["CHECK_IN", "ON_DUTY", "BREAK", "FIELD_DUTY", "CHECK_OUT"]),
    occurredAt: z.string().datetime(),
    breakKind: z.enum(BREAK_KINDS as [string, ...string[]]).nullish(),
    note: z.string().trim().max(500).nullish(),
  }),
  z.object({ op: z.literal("CHANGE_TIME"), entryId: z.string().min(1), occurredAt: z.string().datetime() }),
  z.object({ op: z.literal("REMOVE"), entryId: z.string().min(1) }),
]);

export const correctionInput = z.object({
  workDate: z.string().refine(isDateKey),
  ops: z.array(opSchema).min(1).max(20),
  reason: z.string().trim().min(5).max(500),
});

const MAX_DAYS_BACK = 45;

/** A shift can run past midnight: allow times from local midnight up to +36h. */
function windowFor(ctx: TenantCtx, workDate: DateKey) {
  const windowStart = startOfLocalDay(workDate, ctx.tenant.timezone);
  return { windowStart, windowEnd: new Date(windowStart.getTime() + 36 * 3600_000) };
}

function simulate(ctx: TenantCtx, entries: LogEntry[], workDate: DateKey, ops: CorrectionOp[], now: Date) {
  return simulateCorrection(entries, ops, { ...windowFor(ctx, workDate), now });
}

export async function previewCorrection(ctx: TenantCtx, raw: z.input<typeof correctionInput>, now: Date) {
  const employeeId = ctx.actor.employeeId;
  if (!employeeId) throw new AppError("NO_EMPLOYEE_PROFILE");
  const input = correctionInput.parse(raw);
  const entries = await loadDayEntries(ctx.db, employeeId, input.workDate);
  return simulate(ctx, entries, input.workDate, input.ops as CorrectionOp[], now);
}

export async function requestCorrection(ctx: TenantCtx, raw: z.input<typeof correctionInput>, env: RequestEnv) {
  const employeeId = ctx.actor.employeeId;
  if (!employeeId) throw new AppError("NO_EMPLOYEE_PROFILE");
  const parsed = correctionInput.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { workDate, reason } = parsed.data;
  const ops = parsed.data.ops as CorrectionOp[];
  const today = localDateKey(env.now, ctx.tenant.timezone);
  if (workDate > today) throw new AppError("CORRECTION_FUTURE_DAY");
  if (workDate < addDaysKey(today, -MAX_DAYS_BACK)) throw new AppError("CORRECTION_TOO_OLD");

  return ctx.db.$transaction(async (tx) => {
    await lockEmployee(tx, ctx.tenantId, employeeId);
    const entries = await loadDayEntries(tx, employeeId, workDate);
    const sim = simulate(ctx, entries, workDate, ops, env.now);
    if (!sim.ok) throw new AppError(`CORRECTION_${sim.error}`);
    const open = await tx.correctionRequest.findFirst({ where: { employeeId, workDate: dateKeyToDb(workDate), status: "PENDING" } });
    if (open) throw new AppError("CORRECTION_ALREADY_PENDING");
    const req = await tx.correctionRequest.create({
      data: { tenantId: ctx.tenantId, employeeId, workDate: dateKeyToDb(workDate), ops: ops as unknown as Prisma.InputJsonValue, reason, createdAt: env.now },
    });
    await audit(ctx, {
      action: "correction.requested", entityType: "CorrectionRequest", entityId: req.id, subjectEmployeeId: employeeId, ip: env.ip, at: env.now,
      reason, after: { workDate, ops: ops as unknown as Prisma.InputJsonValue },
    }, tx);
    return req;
  });
}

/**
 * Approving applies the ops as NEW entries (source CORRECTION) that supersede the
 * originals — nothing is edited or deleted. The day is recomputed, and any earlier
 * certification no longer matches, so the employee is asked to certify again.
 */
export async function decideCorrection(ctx: TenantCtx, id: string, raw: { decision: string; comment?: string | null }, env: RequestEnv) {
  const { decision, comment } = decisionInput(raw);
  return ctx.db.$transaction(async (tx) => {
    const req = await tx.correctionRequest.findUnique({ where: { id } });
    if (!req) throw new AppError("NOT_FOUND");
    const right = await assertCanDecide(ctx, req.employeeId, tx);
    await lockEmployee(tx, ctx.tenantId, req.employeeId);
    const fresh = await tx.correctionRequest.findUniqueOrThrow({ where: { id } });
    if (fresh.status !== "PENDING") throw new AppError("ALREADY_DECIDED");
    const workDate = dbToDateKey(req.workDate);
    const ops = req.ops as unknown as CorrectionOp[];

    let applied: string[] = [];
    if (decision === "APPROVE") {
      const entries = await loadDayEntries(tx, req.employeeId, workDate);
      const sim = simulate(ctx, entries, workDate, ops, env.now);
      if (!sim.ok) throw new AppError("CORRECTION_NO_LONGER_VALID", { reason: sim.error });
      applied = await applyOps(ctx, tx, req.employeeId, workDate, ops, entries, req.id, env);
    }
    const status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
    const updated = await tx.correctionRequest.update({
      where: { id }, data: { status, decidedById: ctx.actor.userId, decidedAt: env.now, decisionComment: comment, appliedEntryIds: applied },
    });
    await audit(ctx, {
      action: `correction.${status.toLowerCase()}`, entityType: "CorrectionRequest", entityId: id, subjectEmployeeId: req.employeeId,
      ip: env.ip, at: env.now, reason: comment, before: { status: "PENDING" }, after: { status, right, appliedEntryIds: applied, workDate },
    }, tx);
    if (status === "APPROVED") await recomputeDay(ctx, req.employeeId, workDate, env.now, tx);
    return updated;
  });
}

async function applyOps(
  ctx: TenantCtx, tx: TenantClient, employeeId: string, workDate: DateKey, ops: CorrectionOp[], entries: LogEntry[], requestId: string, env: RequestEnv,
) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const base = {
    tenantId: ctx.tenantId, employeeId, workDate: dateKeyToDb(workDate), recordedAt: env.now, source: "CORRECTION" as const,
    createdById: ctx.actor.userId, correctionRequestId: requestId, ip: env.ip,
  };
  const ids: string[] = [];
  for (const op of ops) {
    let row: LogEntry;
    if (op.op === "ADD") {
      row = await tx.logEntry.create({
        data: { ...base, type: op.type, breakKind: op.type === "BREAK" ? (op.breakKind as LogEntry["breakKind"]) : null, note: op.note || null, occurredAt: new Date(op.occurredAt) },
      });
    } else {
      const orig = byId.get(op.entryId)!;
      row = await tx.logEntry.create({
        data: op.op === "CHANGE_TIME"
          ? { ...base, type: orig.type, breakKind: orig.breakKind, note: orig.note, occurredAt: new Date(op.occurredAt), supersedesId: orig.id }
          : { ...base, type: "VOID", occurredAt: orig.occurredAt, supersedesId: orig.id },
      });
    }
    ids.push(row.id);
  }
  return ids;
}

export async function cancelCorrection(ctx: TenantCtx, id: string, env: RequestEnv) {
  const req = await ctx.db.correctionRequest.findUnique({ where: { id } });
  if (!req || req.employeeId !== ctx.actor.employeeId) throw new AppError("NOT_FOUND");
  if (req.status !== "PENDING") throw new AppError("ALREADY_DECIDED");
  const updated = await ctx.db.correctionRequest.update({ where: { id }, data: { status: "CANCELLED" } });
  await audit(ctx, { action: "correction.cancelled", entityType: "CorrectionRequest", entityId: id, subjectEmployeeId: req.employeeId, ip: env.ip, at: env.now });
  return updated;
}

export async function listCorrections(ctx: TenantCtx, employeeId: string, opts: { workDate?: DateKey } = {}) {
  return ctx.db.correctionRequest.findMany({
    where: { employeeId, ...(opts.workDate ? { workDate: dateKeyToDb(opts.workDate) } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function pendingCorrectionsForApprover(ctx: TenantCtx) {
  return ctx.db.correctionRequest.findMany({
    where: { status: "PENDING", ...decidableWhere(ctx) },
    orderBy: { createdAt: "asc" },
    include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
  });
}

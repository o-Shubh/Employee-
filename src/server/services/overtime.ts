import { z } from "zod";
import { addDaysKey, dateKeyToDb, isDateKey, localDateKey } from "@/domain/time";
import { AppError } from "../errors";
import type { RequestEnv, TenantCtx } from "../context";
import { audit } from "./audit";
import { approverUserIdsFor, assertCanDecide, decidableWhere, decisionInput, userIdOfEmployee } from "./approval-rights";
import { actorName, fmtKeyForText, notify } from "./notifications";
import { sendEmails } from "../mail";
import { formatHm } from "@/domain/timeline";

export const overtimeInput = z.object({
  workDate: z.string().refine(isDateKey),
  minutes: z.coerce.number().int().min(15).max(720),
  reason: z.string().trim().min(5).max(500),
});

/** Claim (past/today) or pre-approval (up to 30 days ahead). Caps are enforced by the Phase 3 rules engine. */
export async function requestOvertime(ctx: TenantCtx, raw: z.input<typeof overtimeInput>, env: RequestEnv) {
  const employeeId = ctx.actor.employeeId;
  if (!employeeId) throw new AppError("NO_EMPLOYEE_PROFILE");
  const parsed = overtimeInput.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { workDate, minutes, reason } = parsed.data;
  const today = localDateKey(env.now, ctx.tenant.timezone);
  if (workDate < addDaysKey(today, -30) || workDate > addDaysKey(today, 30)) throw new AppError("OVERTIME_DATE_OUT_OF_RANGE");
  const dup = await ctx.db.overtimeRequest.findFirst({ where: { employeeId, workDate: dateKeyToDb(workDate), status: { in: ["PENDING", "APPROVED"] } } });
  if (dup) throw new AppError("OVERTIME_ALREADY_REQUESTED");
  const req = await ctx.db.overtimeRequest.create({
    data: { tenantId: ctx.tenantId, employeeId, workDate: dateKeyToDb(workDate), minutes, reason, createdAt: env.now },
  });
  await audit(ctx, { action: "overtime.requested", entityType: "OvertimeRequest", entityId: req.id, subjectEmployeeId: employeeId, ip: env.ip, at: env.now, reason, after: { workDate, minutes } });
  await sendEmails(await notify(ctx, ctx.db, await approverUserIdsFor(ctx, employeeId), "overtime.requested", {
    name: await actorName(ctx, ctx.db), duration: formatHm(minutes), date: fmtKeyForText(workDate), reason,
  }, "/approvals"));
  return req;
}

export async function decideOvertime(ctx: TenantCtx, id: string, raw: { decision: string; comment?: string | null }, env: RequestEnv) {
  const { decision, comment } = decisionInput(raw);
  const req = await ctx.db.overtimeRequest.findUnique({ where: { id } });
  if (!req) throw new AppError("NOT_FOUND");
  const right = await assertCanDecide(ctx, req.employeeId);
  const status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
  // Conditional update: only one decision can win if two approvers click at once.
  const res = await ctx.db.overtimeRequest.updateMany({
    where: { id, status: "PENDING" }, data: { status, decidedById: ctx.actor.userId, decidedAt: env.now, decisionComment: comment },
  });
  if (res.count === 0) throw new AppError("ALREADY_DECIDED");
  await audit(ctx, {
    action: `overtime.${status.toLowerCase()}`, entityType: "OvertimeRequest", entityId: id, subjectEmployeeId: req.employeeId,
    ip: env.ip, at: env.now, reason: comment, before: { status: "PENDING" }, after: { status, right, minutes: req.minutes },
  });
  await sendEmails(await notify(ctx, ctx.db, [await userIdOfEmployee(ctx.db, req.employeeId)], status === "APPROVED" ? "overtime.approved" : "overtime.rejected", {
    duration: formatHm(req.minutes), date: fmtKeyForText(req.workDate.toISOString().slice(0, 10)), by: await actorName(ctx, ctx.db), comment: comment ?? "",
  }, "/requests"));
  return { ...req, status };
}

export async function cancelOvertime(ctx: TenantCtx, id: string, env: RequestEnv) {
  const req = await ctx.db.overtimeRequest.findUnique({ where: { id } });
  if (!req || req.employeeId !== ctx.actor.employeeId) throw new AppError("NOT_FOUND");
  const res = await ctx.db.overtimeRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELLED" } });
  if (res.count === 0) throw new AppError("ALREADY_DECIDED");
  await audit(ctx, { action: "overtime.cancelled", entityType: "OvertimeRequest", entityId: id, subjectEmployeeId: req.employeeId, ip: env.ip, at: env.now });
}

export async function listOvertime(ctx: TenantCtx, employeeId: string) {
  return ctx.db.overtimeRequest.findMany({ where: { employeeId }, orderBy: { workDate: "desc" }, take: 100 });
}

export async function pendingOvertimeForApprover(ctx: TenantCtx) {
  return ctx.db.overtimeRequest.findMany({
    where: { status: "PENDING", ...(await decidableWhere(ctx)) },
    orderBy: { createdAt: "asc" },
    include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
  });
}

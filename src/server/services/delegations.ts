import { z } from "zod";
import { addDaysKey, dateKeyToDb, dbToDateKey, isDateKey, localDateKey } from "@/domain/time";
import { AppError } from "../errors";
import type { RequestEnv, TenantCtx } from "../context";
import { sendEmails } from "../mail";
import { audit } from "./audit";
import { actorName, fmtKeyForText, notify } from "./notifications";

export const delegationInput = z.object({
  /** Admins may set it up for any manager; managers only for themselves. */
  fromEmployeeId: z.string().optional(),
  toEmployeeId: z.string().min(1),
  startDate: z.string().refine(isDateKey),
  endDate: z.string().refine(isDateKey),
  reason: z.string().trim().max(300).optional(),
});

/** "While I'm away, my team's requests go to …" */
export async function createDelegation(ctx: TenantCtx, raw: z.input<typeof delegationInput>, env: RequestEnv) {
  const parsed = delegationInput.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION");
  const input = parsed.data;
  const fromId = input.fromEmployeeId || ctx.actor.employeeId;
  if (!fromId) throw new AppError("NO_EMPLOYEE_PROFILE");
  if (fromId !== ctx.actor.employeeId && ctx.actor.role !== "COMPANY_ADMIN") throw new AppError("FORBIDDEN");
  if (ctx.actor.role !== "MANAGER" && ctx.actor.role !== "COMPANY_ADMIN") throw new AppError("FORBIDDEN");
  if (fromId === input.toEmployeeId) throw new AppError("DELEGATE_SELF");
  const today = localDateKey(env.now, ctx.tenant.timezone);
  if (input.endDate < input.startDate) throw new AppError("LEAVE_END_BEFORE_START");
  if (input.endDate < today) throw new AppError("DELEGATION_IN_PAST");
  if (input.endDate > addDaysKey(today, 180)) throw new AppError("DELEGATION_TOO_LONG");

  const [from, to] = await Promise.all([
    ctx.db.employee.findUnique({ where: { id: fromId }, include: { user: { select: { role: true } } } }),
    ctx.db.employee.findUnique({ where: { id: input.toEmployeeId }, include: { user: { select: { role: true, id: true } } } }),
  ]);
  if (!from || !to || to.status !== "ACTIVE") throw new AppError("NOT_FOUND");
  if (to.user.role !== "MANAGER" && to.user.role !== "COMPANY_ADMIN") throw new AppError("DELEGATE_ROLE_REQUIRED");
  const overlap = await ctx.db.approverDelegation.findFirst({
    where: { fromEmployeeId: fromId, revokedAt: null, startDate: { lte: dateKeyToDb(input.endDate) }, endDate: { gte: dateKeyToDb(input.startDate) } },
  });
  if (overlap) throw new AppError("DELEGATION_OVERLAP");

  const d = await ctx.db.approverDelegation.create({
    data: {
      tenantId: ctx.tenantId, fromEmployeeId: fromId, toEmployeeId: to.id, startDate: dateKeyToDb(input.startDate), endDate: dateKeyToDb(input.endDate),
      reason: input.reason || null, createdById: ctx.actor.userId, createdAt: env.now,
    },
  });
  await audit(ctx, {
    action: "delegation.created", entityType: "ApproverDelegation", entityId: d.id, subjectEmployeeId: fromId, ip: env.ip, at: env.now,
    after: { to: to.fullName, startDate: input.startDate, endDate: input.endDate, reason: input.reason ?? null },
  });
  await sendEmails(await notify(ctx, ctx.db, [to.user.id], "delegation.assigned", {
    name: from.fullName, from: fmtKeyForText(input.startDate), to: fmtKeyForText(input.endDate),
  }, "/approvals"));
  return d;
}

export async function revokeDelegation(ctx: TenantCtx, id: string, env: RequestEnv) {
  const d = await ctx.db.approverDelegation.findUnique({ where: { id } });
  if (!d || d.revokedAt) throw new AppError("NOT_FOUND");
  if (d.fromEmployeeId !== ctx.actor.employeeId && ctx.actor.role !== "COMPANY_ADMIN") throw new AppError("FORBIDDEN");
  await ctx.db.approverDelegation.update({ where: { id }, data: { revokedAt: env.now } });
  await audit(ctx, { action: "delegation.revoked", entityType: "ApproverDelegation", entityId: id, subjectEmployeeId: d.fromEmployeeId, ip: env.ip, at: env.now, after: { by: await actorName(ctx, ctx.db) } });
}

/** Current and upcoming delegations involving the actor (or all, for admins). */
export async function listDelegations(ctx: TenantCtx, now: Date) {
  const today = dateKeyToDb(localDateKey(now, ctx.tenant.timezone));
  const me = ctx.actor.employeeId ?? "-";
  const rows = await ctx.db.approverDelegation.findMany({
    where: {
      revokedAt: null, endDate: { gte: today },
      ...(ctx.actor.role === "COMPANY_ADMIN" ? {} : { OR: [{ fromEmployeeId: me }, { toEmployeeId: me }] }),
    },
    orderBy: { startDate: "asc" },
    include: { from: { select: { fullName: true } }, to: { select: { fullName: true } } },
  });
  return rows.map((r) => ({ ...r, start: dbToDateKey(r.startDate), end: dbToDateKey(r.endDate), active: r.startDate <= today }));
}

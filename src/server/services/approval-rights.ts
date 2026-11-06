import { dateKeyToDb, localDateKey } from "@/domain/time";
import { AppError } from "../errors";
import type { TenantCtx } from "../context";
import type { TenantClient } from "../db/tenant";
import { adminUserIds } from "./notifications";

export type DecisionRight = "MANAGER" | "ADMIN" | "SELF_ADMIN" | "DELEGATE";

const todayDb = (ctx: TenantCtx, now = new Date()) => dateKeyToDb(localDateKey(now, ctx.tenant.timezone));

/** Managers who have delegated their approvals to `employeeId` for today. */
export async function activeDelegatorsFor(ctx: TenantCtx, employeeId: string, db: TenantClient = ctx.db, now = new Date()) {
  const today = todayDb(ctx, now);
  const rows = await db.approverDelegation.findMany({
    where: { toEmployeeId: employeeId, revokedAt: null, startDate: { lte: today }, endDate: { gte: today } },
    select: { fromEmployeeId: true },
  });
  return [...new Set(rows.map((r) => r.fromEmployeeId))];
}

/** Today's delegates of a manager. */
export async function activeDelegatesOf(ctx: TenantCtx, managerId: string, db: TenantClient = ctx.db, now = new Date()) {
  const today = todayDb(ctx, now);
  const rows = await db.approverDelegation.findMany({
    where: { fromEmployeeId: managerId, revokedAt: null, startDate: { lte: today }, endDate: { gte: today } },
    select: { toEmployeeId: true },
  });
  return rows.map((r) => r.toEmployeeId);
}

/**
 * Who may approve a request from `employeeId`:
 *  - their direct reporting manager, any company admin, or someone the manager has
 *    delegated approvals to for today;
 *  - never the requester themselves, except a company admin who reports to no one
 *    (otherwise their requests could never be decided). That case is audited.
 */
export async function assertCanDecide(ctx: TenantCtx, employeeId: string, db: TenantClient = ctx.db): Promise<DecisionRight> {
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { managerId: true } });
  if (!emp) throw new AppError("NOT_FOUND");
  if (employeeId === ctx.actor.employeeId) {
    if (ctx.actor.role === "COMPANY_ADMIN" && !emp.managerId) return "SELF_ADMIN";
    throw new AppError("CANNOT_APPROVE_OWN");
  }
  if (ctx.actor.role === "COMPANY_ADMIN") return "ADMIN";
  if (!ctx.actor.employeeId || ctx.actor.role !== "MANAGER") throw new AppError("FORBIDDEN");
  if (emp.managerId === ctx.actor.employeeId) return "MANAGER";
  if (emp.managerId && (await activeDelegatorsFor(ctx, ctx.actor.employeeId, db)).includes(emp.managerId)) return "DELEGATE";
  throw new AppError("FORBIDDEN");
}

/** Prisma `where` limiting requests to the ones this actor may decide (incl. delegated teams). */
export async function decidableWhere(ctx: TenantCtx, db: TenantClient = ctx.db) {
  if (ctx.actor.role === "COMPANY_ADMIN") return {};
  const me = ctx.actor.employeeId;
  if (ctx.actor.role !== "MANAGER" || !me) return { id: "__none__" };
  const managers = [me, ...(await activeDelegatorsFor(ctx, me, db))];
  return { employee: { managerId: { in: managers } }, employeeId: { not: me } };
}

/** Users to notify about a new request: the manager and their delegates, or the admins when there's no manager. */
export async function approverUserIdsFor(ctx: TenantCtx, employeeId: string, db: TenantClient = ctx.db) {
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { managerId: true } });
  if (!emp?.managerId) return adminUserIds(db);
  const ids = [emp.managerId, ...(await activeDelegatesOf(ctx, emp.managerId, db))];
  const people = await db.employee.findMany({ where: { id: { in: ids }, status: "ACTIVE" }, select: { userId: true } });
  return people.length ? people.map((p) => p.userId) : adminUserIds(db);
}

export async function userIdOfEmployee(db: TenantClient, employeeId: string) {
  return (await db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { userId: true } })).userId;
}

export const decisionInput = (raw: { decision: string; comment?: string | null }) => {
  const decision = raw.decision === "APPROVE" ? "APPROVE" : raw.decision === "REJECT" ? "REJECT" : null;
  if (!decision) throw new AppError("VALIDATION");
  const comment = raw.comment?.trim() || null;
  if (decision === "REJECT" && !comment) throw new AppError("COMMENT_REQUIRED");
  if (comment && comment.length > 500) throw new AppError("VALIDATION");
  return { decision, comment } as const;
};

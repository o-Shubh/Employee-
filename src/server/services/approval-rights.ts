import { AppError } from "../errors";
import type { TenantCtx } from "../context";
import type { TenantClient } from "../db/tenant";

export type DecisionRight = "MANAGER" | "ADMIN" | "SELF_ADMIN";

/**
 * Who may approve a request from `employeeId`:
 *  - their direct reporting manager, or any company admin;
 *  - never the requester themselves — except a company admin who reports to no
 *    one (otherwise their requests could never be decided). That case is audited.
 */
export async function assertCanDecide(ctx: TenantCtx, employeeId: string, db: TenantClient = ctx.db): Promise<DecisionRight> {
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { managerId: true } });
  if (!emp) throw new AppError("NOT_FOUND");
  if (employeeId === ctx.actor.employeeId) {
    if (ctx.actor.role === "COMPANY_ADMIN" && !emp.managerId) return "SELF_ADMIN";
    throw new AppError("CANNOT_APPROVE_OWN");
  }
  if (ctx.actor.role === "COMPANY_ADMIN") return "ADMIN";
  if (ctx.actor.role === "MANAGER" && ctx.actor.employeeId && emp.managerId === ctx.actor.employeeId) return "MANAGER";
  throw new AppError("FORBIDDEN");
}

/** Prisma `where` limiting requests to the ones this actor may decide. */
export function decidableWhere(ctx: TenantCtx) {
  if (ctx.actor.role === "COMPANY_ADMIN") return {};
  if (ctx.actor.role === "MANAGER" && ctx.actor.employeeId) return { employee: { managerId: ctx.actor.employeeId } };
  return { id: "__none__" };
}

export const decisionInput = (raw: { decision: string; comment?: string | null }) => {
  const decision = raw.decision === "APPROVE" ? "APPROVE" : raw.decision === "REJECT" ? "REJECT" : null;
  if (!decision) throw new AppError("VALIDATION");
  const comment = raw.comment?.trim() || null;
  if (decision === "REJECT" && !comment) throw new AppError("COMMENT_REQUIRED");
  if (comment && comment.length > 500) throw new AppError("VALIDATION");
  return { decision, comment } as const;
};

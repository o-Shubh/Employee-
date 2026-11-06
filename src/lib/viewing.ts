import "server-only";
import type { TenantCtx } from "@/server/context";
import { assertCanViewEmployee } from "@/server/services/attendance";
import { AppError } from "@/server/errors";

/** Resolve whose logs are being viewed (?employee=) and enforce self/manager/admin access. */
export async function resolveViewedEmployee(ctx: TenantCtx, requested?: string) {
  const id = requested || ctx.actor.employeeId;
  if (!id) throw new AppError("NO_EMPLOYEE_PROFILE");
  await assertCanViewEmployee(ctx, id);
  const employee = await ctx.db.employee.findUniqueOrThrow({ where: { id }, select: { id: true, fullName: true, employeeCode: true } });
  return { employee, isSelf: id === ctx.actor.employeeId };
}

import type { TenantCtx } from "@/server/context";
import { listManagerOptions } from "@/server/services/employees";

export async function employeeFormOptions(ctx: TenantCtx) {
  const [departments, managers, locations] = await Promise.all([
    ctx.db.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    listManagerOptions(ctx),
    ctx.db.officeLocation.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { departments, managers, locations };
}

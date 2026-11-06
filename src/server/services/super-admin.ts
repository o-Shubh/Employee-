import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { isValidTimeZone } from "@/domain/time";
import { prismaUnscoped as db } from "../db/client";
import { AppError } from "../errors";
import { generateTempPassword, hashPassword } from "../auth/password";

/** Platform (vendor) operations. Deliberately cross-tenant; only reachable by SUPER_ADMIN. */
export interface SuperCtx {
  userId: string;
  ip: string | null;
  now: Date;
}

async function platformAudit(ctx: SuperCtx, action: string, entityType: string, entityId: string, after?: Prisma.InputJsonValue, tenantId?: string) {
  await db.auditEvent.create({
    data: { tenantId: tenantId ?? null, actorUserId: ctx.userId, action, entityType, entityId, after, ip: ctx.ip },
  });
}

export async function listTenants() {
  return db.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: { plan: { select: { name: true, maxEmployees: true } }, _count: { select: { employees: true } } },
  });
}

export async function listPlans() {
  return db.plan.findMany({ orderBy: { maxEmployees: "asc" }, include: { _count: { select: { tenants: true } } } });
}

export const tenantInput = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().min(2).max(40).regex(/^[a-z0-9-]+$/, "SLUG_INVALID"),
  timezone: z.string().trim().default("Asia/Kolkata").refine(isValidTimeZone, "TZ_INVALID"),
  planId: z.string().min(1),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.string().trim().toLowerCase().email(),
});

export async function createTenant(ctx: SuperCtx, raw: z.input<typeof tenantInput>) {
  const parsed = tenantInput.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION", { fields: parsed.error.issues.map((i) => i.path.join(".")) });
  const input = parsed.data;
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  try {
    const tenant = await db.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: { name: input.name, slug: input.slug, timezone: input.timezone, planId: input.planId },
      });
      const user = await tx.user.create({
        data: { tenantId: t.id, email: input.adminEmail, passwordHash, role: "COMPANY_ADMIN", mustChangePassword: true },
      });
      await tx.employee.create({
        data: { tenantId: t.id, userId: user.id, employeeCode: "ADMIN-001", fullName: input.adminName, designation: "Administrator" },
      });
      return t;
    });
    await platformAudit(ctx, "tenant.created", "Tenant", tenant.id, { name: input.name, slug: input.slug, adminEmail: input.adminEmail }, tenant.id);
    return { tenant, tempPassword };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = String((e.meta?.target as string[] | undefined)?.join(",") ?? "");
      throw new AppError(target.includes("slug") ? "SLUG_TAKEN" : "EMAIL_TAKEN");
    }
    throw e;
  }
}

export async function setTenantStatus(ctx: SuperCtx, tenantId: string, status: "ACTIVE" | "SUSPENDED") {
  const t = await db.tenant.update({ where: { id: tenantId }, data: { status } });
  await platformAudit(ctx, `tenant.${status.toLowerCase()}`, "Tenant", tenantId, { status }, tenantId);
  return t;
}

export async function setTenantPlan(ctx: SuperCtx, tenantId: string, planId: string) {
  const t = await db.tenant.update({ where: { id: tenantId }, data: { planId } });
  await platformAudit(ctx, "tenant.plan_changed", "Tenant", tenantId, { planId }, tenantId);
  return t;
}

export const planInput = z.object({
  code: z.string().trim().toLowerCase().min(2).max(30).regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(2).max(60),
  maxEmployees: z.coerce.number().int().min(1).max(1_000_000),
  priceMonthlyInr: z.coerce.number().int().min(0),
});

export async function upsertPlan(ctx: SuperCtx, id: string | null, raw: Record<keyof z.input<typeof planInput>, unknown>) {
  const input = planInput.parse(raw);
  const plan = id ? await db.plan.update({ where: { id }, data: input }) : await db.plan.create({ data: input });
  await platformAudit(ctx, id ? "plan.updated" : "plan.created", "Plan", plan.id, input);
  return plan;
}

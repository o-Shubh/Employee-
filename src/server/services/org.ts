import { z } from "zod";
import { isValidCidr } from "@/domain/cidr";
import { AppError } from "../errors";
import { isAdmin, type RequestEnv, type TenantCtx } from "../context";
import { audit } from "./audit";

function requireAdmin(ctx: TenantCtx) {
  if (!isAdmin(ctx)) throw new AppError("FORBIDDEN");
}

// ─── Departments ───
export const departmentInput = z.object({ name: z.string().trim().min(2).max(80) });

export async function listDepartments(ctx: TenantCtx) {
  return ctx.db.department.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { employees: true } } } });
}

export async function createDepartment(ctx: TenantCtx, raw: z.input<typeof departmentInput>, env: RequestEnv) {
  requireAdmin(ctx);
  const { name } = departmentInput.parse(raw);
  const exists = await ctx.db.department.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (exists) throw new AppError("DUPLICATE_NAME");
  const d = await ctx.db.department.create({ data: { tenantId: ctx.tenantId, name } });
  await audit(ctx, { action: "department.created", entityType: "Department", entityId: d.id, ip: env.ip, at: env.now, after: { name } });
  return d;
}

export async function renameDepartment(ctx: TenantCtx, id: string, raw: z.input<typeof departmentInput>, env: RequestEnv) {
  requireAdmin(ctx);
  const { name } = departmentInput.parse(raw);
  const before = await ctx.db.department.findUnique({ where: { id } });
  if (!before) throw new AppError("NOT_FOUND");
  const d = await ctx.db.department.update({ where: { id }, data: { name } });
  await audit(ctx, { action: "department.renamed", entityType: "Department", entityId: id, ip: env.ip, at: env.now, before: { name: before.name }, after: { name } });
  return d;
}

// ─── Office locations ───
export const locationInput = z.object({
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().max(300).optional(),
  cidrs: z
    .array(z.string().trim())
    .transform((a) => a.filter(Boolean))
    .refine((a) => a.length > 0, "CIDR_REQUIRED")
    .refine((a) => a.every(isValidCidr), "CIDR_INVALID"),
  active: z.boolean().default(true),
});

export async function listLocations(ctx: TenantCtx) {
  return ctx.db.officeLocation.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { employees: true } } } });
}

export async function upsertLocation(ctx: TenantCtx, id: string | null, raw: z.input<typeof locationInput>, env: RequestEnv) {
  requireAdmin(ctx);
  const parsed = locationInput.safeParse(raw);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message === "CIDR_INVALID" ? "CIDR_INVALID" : "VALIDATION");
  const data = { ...parsed.data, address: parsed.data.address || null };
  if (id) {
    const before = await ctx.db.officeLocation.findUnique({ where: { id } });
    if (!before) throw new AppError("NOT_FOUND");
    const loc = await ctx.db.officeLocation.update({ where: { id }, data });
    await audit(ctx, {
      action: "location.updated", entityType: "OfficeLocation", entityId: id, ip: env.ip, at: env.now,
      before: { name: before.name, cidrs: before.cidrs, active: before.active }, after: { name: loc.name, cidrs: loc.cidrs, active: loc.active },
    });
    return loc;
  }
  const loc = await ctx.db.officeLocation.create({ data: { tenantId: ctx.tenantId, ...data } });
  await audit(ctx, { action: "location.created", entityType: "OfficeLocation", entityId: loc.id, ip: env.ip, at: env.now, after: { name: loc.name, cidrs: loc.cidrs } });
  return loc;
}

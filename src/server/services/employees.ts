import { Prisma, type Role } from "@prisma/client";
import { z } from "zod";
import { parseCsvObjects } from "@/domain/csv";
import { dateKeyToDb, isDateKey } from "@/domain/time";
import { AppError } from "../errors";
import { isAdmin, type RequestEnv, type TenantCtx } from "../context";
import type { TenantClient } from "../db/tenant";
import { generateTempPassword, hashPassword } from "../auth/password";
import { audit } from "./audit";

const TENANT_ROLES = ["COMPANY_ADMIN", "MANAGER", "EMPLOYEE"] as const;

function requireAdmin(ctx: TenantCtx) {
  if (!isAdmin(ctx)) throw new AppError("FORBIDDEN");
}

const optionalId = z.string().trim().optional().transform((v) => v || null);

export const employeeInput = z.object({
  employeeCode: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9._\-/]+$/, "CODE_INVALID"),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(TENANT_ROLES),
  designation: z.string().trim().max(120).optional().transform((v) => v || null),
  departmentId: optionalId,
  managerId: optionalId,
  officeLocationId: optionalId,
  joinedOn: z
    .string()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || isDateKey(v), "DATE_INVALID"),
});
export type EmployeeInput = z.input<typeof employeeInput>;

export const employeeUpdateInput = employeeInput.omit({ email: true, employeeCode: true }).extend({
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

export async function listEmployees(ctx: TenantCtx, opts: { q?: string } = {}) {
  requireAdmin(ctx);
  const q = opts.q?.trim();
  return ctx.db.employee.findMany({
    where: q
      ? {
          OR: [
            { fullName: { contains: q, mode: "insensitive" } },
            { employeeCode: { contains: q, mode: "insensitive" } },
            { user: { email: { contains: q, mode: "insensitive" } } },
          ],
        }
      : undefined,
    orderBy: [{ status: "asc" }, { fullName: "asc" }],
    include: {
      user: { select: { email: true, role: true, status: true, lastLoginAt: true } },
      department: { select: { name: true } },
      manager: { select: { fullName: true } },
      officeLocation: { select: { name: true } },
    },
  });
}

export async function getEmployee(ctx: TenantCtx, id: string) {
  requireAdmin(ctx);
  const e = await ctx.db.employee.findUnique({
    where: { id },
    include: { user: { select: { email: true, role: true, status: true, lastLoginAt: true } } },
  });
  if (!e) throw new AppError("NOT_FOUND");
  return e;
}

/** Managers selectable as "reports to". */
export async function listManagerOptions(ctx: TenantCtx) {
  return ctx.db.employee.findMany({
    where: { status: "ACTIVE", user: { role: { in: ["MANAGER", "COMPANY_ADMIN"] } } },
    select: { id: true, fullName: true, employeeCode: true },
    orderBy: { fullName: "asc" },
  });
}

async function assertValidManager(db: TenantClient, employeeId: string | null, managerId: string | null) {
  if (!managerId) return;
  if (managerId === employeeId) throw new AppError("MANAGER_SELF");
  const m = await db.employee.findUnique({ where: { id: managerId }, include: { user: { select: { role: true } } } });
  if (!m) throw new AppError("MANAGER_NOT_FOUND");
  if (m.user.role !== "MANAGER" && m.user.role !== "COMPANY_ADMIN") throw new AppError("MANAGER_ROLE_REQUIRED");
  // Prevent reporting cycles: walk up from the proposed manager.
  let cursor: string | null = m.managerId;
  for (let i = 0; cursor && i < 50; i++) {
    if (cursor === employeeId) throw new AppError("MANAGER_CYCLE");
    const up: { managerId: string | null } | null = await db.employee.findUnique({ where: { id: cursor }, select: { managerId: true } });
    cursor = up?.managerId ?? null;
  }
}

async function assertPlanCapacity(ctx: TenantCtx, db: TenantClient, adding: number) {
  const plan = await db.plan.findUnique({ where: { id: ctx.tenant.planId } });
  const active = await db.employee.count({ where: { status: "ACTIVE" } });
  if (plan && active + adding > plan.maxEmployees) throw new AppError("PLAN_LIMIT", { max: plan.maxEmployees });
}

function mapUniqueError(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    const target = String((e.meta?.target as string[] | undefined)?.join(",") ?? "");
    throw new AppError(target.includes("email") ? "EMAIL_TAKEN" : target.includes("employeeCode") ? "CODE_TAKEN" : "DUPLICATE");
  }
  throw e;
}

async function insertEmployee(ctx: TenantCtx, db: TenantClient, input: z.output<typeof employeeInput>, passwordHash: string) {
  const user = await db.user.create({
    data: { email: input.email, passwordHash, role: input.role as Role, mustChangePassword: true },
  });
  return db.employee.create({
    data: {
      userId: user.id,
      employeeCode: input.employeeCode,
      fullName: input.fullName,
      designation: input.designation,
      departmentId: input.departmentId,
      managerId: input.managerId,
      officeLocationId: input.officeLocationId,
      joinedOn: input.joinedOn ? dateKeyToDb(input.joinedOn) : null,
    },
  });
}

export async function createEmployee(ctx: TenantCtx, raw: EmployeeInput, env: RequestEnv) {
  requireAdmin(ctx);
  const parsed = employeeInput.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("VALIDATION", { fields: parsed.error.issues.map((i) => i.path.join(".")) });
  }
  const input = parsed.data;
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  try {
    const employee = await ctx.db.$transaction(async (tx) => {
      await assertPlanCapacity(ctx, tx, 1);
      await assertValidManager(tx, null, input.managerId);
      const emp = await insertEmployee(ctx, tx, input, passwordHash);
      await audit(ctx, {
        action: "employee.created", entityType: "Employee", entityId: emp.id, subjectEmployeeId: emp.id, ip: env.ip,
        after: { ...input },
      }, tx);
      return emp;
    });
    return { employee, tempPassword };
  } catch (e) {
    if (e instanceof AppError) throw e;
    mapUniqueError(e);
  }
}

export async function updateEmployee(ctx: TenantCtx, id: string, raw: z.input<typeof employeeUpdateInput>, env: RequestEnv) {
  requireAdmin(ctx);
  const parsed = employeeUpdateInput.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION", { fields: parsed.error.issues.map((i) => i.path.join(".")) });
  const input = parsed.data;
  return ctx.db.$transaction(async (tx) => {
    const before = await tx.employee.findUnique({ where: { id }, include: { user: { select: { role: true, status: true } } } });
    if (!before) throw new AppError("NOT_FOUND");
    if (before.userId === ctx.actor.userId && (input.role !== "COMPANY_ADMIN" || input.status !== "ACTIVE")) {
      throw new AppError("CANNOT_DEMOTE_SELF");
    }
    await assertValidManager(tx, id, input.managerId);
    if (before.status === "INACTIVE" && input.status === "ACTIVE") await assertPlanCapacity(ctx, tx, 1);
    if (before.user.role !== input.role && input.role === "EMPLOYEE") {
      const reports = await tx.employee.count({ where: { managerId: id, status: "ACTIVE" } });
      if (reports > 0) throw new AppError("HAS_DIRECT_REPORTS");
    }
    const emp = await tx.employee.update({
      where: { id },
      data: {
        fullName: input.fullName,
        designation: input.designation,
        departmentId: input.departmentId,
        managerId: input.managerId,
        officeLocationId: input.officeLocationId,
        joinedOn: input.joinedOn ? dateKeyToDb(input.joinedOn) : null,
        status: input.status,
      },
    });
    await tx.user.update({
      where: { id: before.userId },
      data: { role: input.role as Role, status: input.status === "ACTIVE" ? "ACTIVE" : "DISABLED" },
    });
    await audit(ctx, {
      action: "employee.updated", entityType: "Employee", entityId: id, subjectEmployeeId: id, ip: env.ip,
      before: {
        fullName: before.fullName, designation: before.designation, departmentId: before.departmentId, managerId: before.managerId,
        officeLocationId: before.officeLocationId, status: before.status, role: before.user.role,
      },
      after: { ...input },
    }, tx);
    return emp;
  });
}

export async function resetEmployeePassword(ctx: TenantCtx, id: string, env: RequestEnv) {
  requireAdmin(ctx);
  const emp = await ctx.db.employee.findUnique({ where: { id } });
  if (!emp) throw new AppError("NOT_FOUND");
  const tempPassword = generateTempPassword();
  await ctx.db.user.update({
    where: { id: emp.userId },
    data: { passwordHash: await hashPassword(tempPassword), mustChangePassword: true },
  });
  await audit(ctx, { action: "user.password_reset", entityType: "User", entityId: emp.userId, subjectEmployeeId: id, ip: env.ip });
  return { tempPassword };
}

// ─────────────────────────── Bulk CSV import ───────────────────────────

export const CSV_HEADERS = [
  "employee_code", "full_name", "email", "role", "department", "manager_code", "office_location", "designation", "joined_on",
] as const;

export interface ImportRowError {
  row: number; // 1-based data row (header excluded)
  field: string;
  code: string;
}

/**
 * Validate everything first; import nothing if any row is invalid (all-or-nothing).
 * Missing departments are created. Managers may be other rows of the same file.
 */
export async function importEmployeesCsv(ctx: TenantCtx, csvText: string, env: RequestEnv) {
  requireAdmin(ctx);
  const rows = parseCsvObjects(csvText);
  if (rows.length === 0) throw new AppError("CSV_EMPTY");
  if (rows.length > 2000) throw new AppError("CSV_TOO_LARGE");
  const missingHeaders = ["employee_code", "full_name", "email"].filter((h) => !(h in rows[0]!));
  if (missingHeaders.length) throw new AppError("CSV_MISSING_HEADERS", { headers: missingHeaders });

  const errors: ImportRowError[] = [];
  const [locations, existing, departments] = await Promise.all([
    ctx.db.officeLocation.findMany({ select: { id: true, name: true } }),
    ctx.db.employee.findMany({ select: { id: true, employeeCode: true, user: { select: { role: true } } } }),
    ctx.db.department.findMany({ select: { id: true, name: true } }),
  ]);
  const locByName = new Map(locations.map((l) => [l.name.toLowerCase(), l.id]));
  const existingByCode = new Map(existing.map((e) => [e.employeeCode.toLowerCase(), e]));
  const fileCodes = new Map<string, { role: string }>();
  const fileEmails = new Set<string>();

  const parsedRows = rows.map((r, i) => {
    const rowNo = i + 1;
    const role = (r.role || "EMPLOYEE").toUpperCase();
    const candidate = {
      employeeCode: r.employee_code ?? "",
      fullName: r.full_name ?? "",
      email: r.email ?? "",
      role,
      designation: r.designation,
      joinedOn: r.joined_on,
    };
    const res = employeeInput.omit({ departmentId: true, managerId: true, officeLocationId: true }).safeParse(candidate);
    if (!res.success) {
      for (const issue of res.error.issues) errors.push({ row: rowNo, field: String(issue.path[0] ?? ""), code: "INVALID" });
      return null;
    }
    const code = res.data.employeeCode.toLowerCase();
    if (existingByCode.has(code) || fileCodes.has(code)) errors.push({ row: rowNo, field: "employee_code", code: "CODE_TAKEN" });
    if (fileEmails.has(res.data.email)) errors.push({ row: rowNo, field: "email", code: "DUPLICATE_IN_FILE" });
    fileCodes.set(code, { role: res.data.role });
    fileEmails.add(res.data.email);

    let officeLocationId: string | null = null;
    if (r.office_location) {
      officeLocationId = locByName.get(r.office_location.toLowerCase()) ?? null;
      if (!officeLocationId) errors.push({ row: rowNo, field: "office_location", code: "LOCATION_NOT_FOUND" });
    }
    return { rowNo, data: res.data, department: r.department || null, managerCode: r.manager_code?.toLowerCase() || null, officeLocationId };
  });

  for (const p of parsedRows) {
    if (!p?.managerCode) continue;
    const role = existingByCode.get(p.managerCode)?.user.role ?? fileCodes.get(p.managerCode)?.role;
    if (!role) errors.push({ row: p.rowNo, field: "manager_code", code: "MANAGER_NOT_FOUND" });
    else if (role !== "MANAGER" && role !== "COMPANY_ADMIN") errors.push({ row: p.rowNo, field: "manager_code", code: "MANAGER_ROLE_REQUIRED" });
    else if (p.managerCode === p.data.employeeCode.toLowerCase()) errors.push({ row: p.rowNo, field: "manager_code", code: "MANAGER_SELF" });
  }

  if (errors.length) return { ok: false as const, errors };

  const valid = parsedRows.filter((p): p is NonNullable<typeof p> => !!p);
  // Hash outside the transaction (argon2 is deliberately slow).
  const withPasswords = await Promise.all(
    valid.map(async (p) => {
      const tempPassword = generateTempPassword();
      return { ...p, tempPassword, passwordHash: await hashPassword(tempPassword) };
    }),
  );

  try {
    const created = await ctx.db.$transaction(
      async (tx) => {
        await assertPlanCapacity(ctx, tx, withPasswords.length);
        const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));
        for (const p of withPasswords) {
          if (p.department && !deptByName.has(p.department.toLowerCase())) {
            const d = await tx.department.create({ data: { name: p.department } });
            deptByName.set(p.department.toLowerCase(), d.id);
          }
        }
        const idByCode = new Map(existing.map((e) => [e.employeeCode.toLowerCase(), e.id]));
        const out: { employeeId: string; employeeCode: string; email: string; tempPassword: string }[] = [];
        for (const p of withPasswords) {
          const emp = await insertEmployee(ctx, tx, {
            ...p.data,
            departmentId: p.department ? deptByName.get(p.department.toLowerCase())! : null,
            managerId: null, // second pass, so managers later in the file work
            officeLocationId: p.officeLocationId,
          }, p.passwordHash);
          idByCode.set(p.data.employeeCode.toLowerCase(), emp.id);
          out.push({ employeeId: emp.id, employeeCode: emp.employeeCode, email: p.data.email, tempPassword: p.tempPassword });
        }
        for (const p of withPasswords) {
          if (!p.managerCode) continue;
          await tx.employee.update({
            where: { id: idByCode.get(p.data.employeeCode.toLowerCase())! },
            data: { managerId: idByCode.get(p.managerCode)! },
          });
        }
        await audit(ctx, {
          action: "employee.bulk_imported", entityType: "Employee", ip: env.ip,
          after: { count: out.length, codes: out.map((o) => o.employeeCode) },
        }, tx);
        return out;
      },
      { timeout: 60_000 },
    );
    return { ok: true as const, created };
  } catch (e) {
    if (e instanceof AppError) throw e;
    mapUniqueError(e);
  }
}

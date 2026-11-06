import { randomUUID } from "node:crypto";
import type { Role } from "@prisma/client";
import { prismaUnscoped } from "@/server/db/client";
import { forTenant } from "@/server/db/tenant";
import type { RequestEnv, TenantCtx } from "@/server/context";
import { generateDeviceToken, hashDeviceToken } from "@/server/security/device-token";

export const db = prismaUnscoped;
export const OFFICE_IP = "10.1.2.3";
export const HOME_IP = "49.36.10.20";

/** A fresh, fully isolated tenant with an admin, a manager and an employee (with an approved device). */
export async function makeTenant(label = "t") {
  const suffix = randomUUID().slice(0, 8);
  const plan = await db.plan.upsert({
    where: { code: "test" },
    create: { code: "test", name: "Test", maxEmployees: 1000 },
    update: {},
  });
  const tenant = await db.tenant.create({
    data: { name: `${label}-${suffix}`, slug: `${label}-${suffix}`, planId: plan.id, timezone: "Asia/Kolkata" },
  });
  const location = await db.officeLocation.create({
    data: { tenantId: tenant.id, name: "HQ", cidrs: ["10.0.0.0/8"] },
  });

  async function person(role: Role, code: string, managerId?: string) {
    const user = await db.user.create({
      data: { tenantId: tenant.id, email: `${code}-${suffix}@example.test`.toLowerCase(), passwordHash: "x", role, mustChangePassword: false },
    });
    const employee = await db.employee.create({
      data: { tenantId: tenant.id, userId: user.id, employeeCode: code, fullName: `${code} Person`, officeLocationId: location.id, managerId },
    });
    return { user, employee };
  }
  const admin = await person("COMPANY_ADMIN", "ADM");
  const manager = await person("MANAGER", "MGR");
  const employee = await person("EMPLOYEE", "EMP", manager.employee.id);
  const other = await person("EMPLOYEE", "EMP2");

  const deviceToken = generateDeviceToken();
  const device = await db.device.create({
    data: { tenantId: tenant.id, employeeId: employee.employee.id, label: "Desk PC", tokenHash: hashDeviceToken(deviceToken), status: "APPROVED" },
  });

  const ctxFor = (p: { user: { id: string; role: Role }; employee: { id: string } }): TenantCtx => ({
    tenantId: tenant.id,
    tenant,
    db: forTenant(tenant.id, db),
    actor: { userId: p.user.id, role: p.user.role, employeeId: p.employee.id },
  });

  return {
    tenant, location, admin, manager, employee, other, device, deviceToken,
    ctx: { admin: ctxFor(admin), manager: ctxFor(manager), employee: ctxFor(employee), other: ctxFor(other) },
  };
}

export const officeEnv = (now: Date, deviceToken: string | null): RequestEnv => ({ now, ip: OFFICE_IP, deviceToken, userAgent: "vitest" });

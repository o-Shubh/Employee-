import { describe, expect, it, beforeAll } from "vitest";
import { forTenant, TenantScopeError } from "@/server/db/tenant";
import { punch } from "@/server/services/attendance";
import { db, makeTenant, officeEnv } from "./fixtures";

describe("tenant isolation", () => {
  let A: Awaited<ReturnType<typeof makeTenant>>;
  let B: Awaited<ReturnType<typeof makeTenant>>;

  beforeAll(async () => {
    A = await makeTenant("a");
    B = await makeTenant("b");
    await punch(B.ctx.employee, { type: "CHECK_IN" }, officeEnv(new Date(), B.deviceToken));
  });

  it("findMany only returns the caller's tenant rows", async () => {
    const a = forTenant(A.tenant.id, db);
    const emps = await a.employee.findMany();
    expect(emps.length).toBe(4);
    expect(emps.every((e) => e.tenantId === A.tenant.id)).toBe(true);
    expect(await a.logEntry.count()).toBe(0);
    expect(await a.user.count()).toBe(4);
  });

  it("an explicit where on another tenant's id finds nothing", async () => {
    const a = forTenant(A.tenant.id, db);
    expect(await a.employee.findUnique({ where: { id: B.employee.employee.id } })).toBeNull();
    expect(await a.employee.findFirst({ where: { tenantId: B.tenant.id } })).toBeNull();
    expect(await a.logEntry.findMany({ where: { employeeId: B.employee.employee.id } })).toEqual([]);
    expect(await a.device.findFirst({ where: { tokenHash: B.device.tokenHash } })).toBeNull();
  });

  it("OR clauses cannot escape the tenant filter", async () => {
    const a = forTenant(A.tenant.id, db);
    const rows = await a.employee.findMany({ where: { OR: [{ id: B.employee.employee.id }, { tenantId: B.tenant.id }] } });
    expect(rows).toEqual([]);
  });

  it("cannot update or delete another tenant's rows", async () => {
    const a = forTenant(A.tenant.id, db);
    await expect(a.employee.update({ where: { id: B.employee.employee.id }, data: { fullName: "pwned" } })).rejects.toThrow();
    const res = await a.employee.updateMany({ where: { id: B.employee.employee.id }, data: { fullName: "pwned" } });
    expect(res.count).toBe(0);
    await expect(a.department.delete({ where: { id: "nope" } })).rejects.toThrow();
    const fresh = await db.employee.findUniqueOrThrow({ where: { id: B.employee.employee.id } });
    expect(fresh.fullName).not.toBe("pwned");
  });

  it("creates are stamped with the caller's tenant; foreign tenantId is rejected", async () => {
    const a = forTenant(A.tenant.id, db);
    const d = await a.department.create({ data: { name: "Ops" } });
    expect(d.tenantId).toBe(A.tenant.id);
    await expect(a.department.create({ data: { name: "Sneaky", tenantId: B.tenant.id } })).rejects.toBeInstanceOf(TenantScopeError);
    await expect(a.department.update({ where: { id: d.id }, data: { tenantId: B.tenant.id } })).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("nested relation writes are blocked (they would bypass the filter)", async () => {
    const a = forTenant(A.tenant.id, db);
    await expect(
      a.department.update({
        where: { id: (await a.department.findFirstOrThrow()).id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { employees: { connect: { id: B.employee.employee.id } } } as any,
      }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("composite foreign keys stop cross-tenant references even with the unscoped client", async () => {
    // A log entry in tenant A that points at an employee of tenant B must be rejected by Postgres.
    await expect(
      db.logEntry.create({
        data: {
          tenantId: A.tenant.id, employeeId: B.employee.employee.id, workDate: new Date("2026-01-01"),
          type: "CHECK_IN", occurredAt: new Date(), source: "SELF", createdById: A.admin.user.id,
        },
      }),
    ).rejects.toThrow(/Foreign key constraint/i);
    await expect(
      db.employee.update({ where: { id: A.employee.employee.id }, data: { managerId: B.manager.employee.id } }),
    ).rejects.toThrow(/Foreign key constraint/i);
  });

  it("tenant model: a tenant can read only itself and cannot change plan/status", async () => {
    const a = forTenant(A.tenant.id, db);
    expect(await a.tenant.findMany()).toHaveLength(1);
    expect(await a.tenant.findUnique({ where: { id: B.tenant.id } })).toMatchObject({ id: A.tenant.id });
    await expect(a.tenant.update({ where: { id: A.tenant.id }, data: { status: "ACTIVE" } })).rejects.toBeInstanceOf(TenantScopeError);
    await expect(a.tenant.create({ data: { name: "x", slug: "x", planId: A.tenant.planId } })).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("services: a manager of tenant A cannot see tenant B's employee day", async () => {
    const { getMonth } = await import("@/server/services/attendance");
    await expect(getMonth(A.ctx.admin, B.employee.employee.id, 2026, 1, new Date())).resolves.toEqual([]);
    await expect(getMonth(A.ctx.manager, B.employee.employee.id, 2026, 1, new Date())).rejects.toThrow("FORBIDDEN");
  });
});

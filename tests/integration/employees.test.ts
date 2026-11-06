import { describe, expect, it } from "vitest";
import { importEmployeesCsv, createEmployee, updateEmployee } from "@/server/services/employees";
import { assertCanViewEmployee } from "@/server/services/attendance";
import { db, makeTenant, officeEnv } from "./fixtures";

const env = officeEnv(new Date(), null);

describe("employee admin", () => {
  it("CSV import is all-or-nothing and resolves managers defined in the same file", async () => {
    const T = await makeTenant("csv");
    const bad = `employee_code,full_name,email,role,department,manager_code,office_location
X1,Good Row,good-${T.tenant.id}@example.test,EMPLOYEE,Finance,,HQ
X2,Bad Email,not-an-email,EMPLOYEE,,,HQ
X3,Ghost Manager,ghost-${T.tenant.id}@example.test,EMPLOYEE,,NOPE,HQ`;
    const r1 = await importEmployeesCsv(T.ctx.admin, bad, env);
    expect(r1?.ok).toBe(false);
    expect(await db.employee.count({ where: { tenantId: T.tenant.id } })).toBe(4); // unchanged

    const good = `employee_code,full_name,email,role,department,manager_code,office_location
E900,Asha Verma,asha-${T.tenant.id}@example.test,EMPLOYEE,Finance,M900,HQ
M900,Ravi Kumar,ravi-${T.tenant.id}@example.test,MANAGER,Finance,,HQ`;
    const r2 = await importEmployeesCsv(T.ctx.admin, good, env);
    expect(r2?.ok).toBe(true);
    const asha = await db.employee.findFirstOrThrow({ where: { tenantId: T.tenant.id, employeeCode: "E900" }, include: { manager: true, department: true, user: true } });
    expect(asha.manager?.employeeCode).toBe("M900");
    expect(asha.department?.name).toBe("Finance");
    expect(asha.user.mustChangePassword).toBe(true);
  });

  it("rejects reporting loops and non-manager managers; only admins can manage employees", async () => {
    const T = await makeTenant("emp");
    await expect(
      updateEmployee(T.ctx.admin, T.manager.employee.id, { fullName: "MGR Person", role: "MANAGER", managerId: T.employee.employee.id, status: "ACTIVE" }, env),
    ).rejects.toThrow("MANAGER_ROLE_REQUIRED");
    await expect(
      createEmployee(T.ctx.manager, { employeeCode: "Z1", fullName: "Zed", email: `z-${T.tenant.id}@example.test`, role: "EMPLOYEE" }, env),
    ).rejects.toThrow("FORBIDDEN");
    // admin reports to manager; manager reporting to admin would be a loop
    await db.employee.update({ where: { id: T.admin.employee.id }, data: { managerId: T.manager.employee.id } });
    await expect(
      updateEmployee(T.ctx.admin, T.manager.employee.id, { fullName: "MGR Person", role: "MANAGER", managerId: T.admin.employee.id, status: "ACTIVE" }, env),
    ).rejects.toThrow("MANAGER_CYCLE");
  });

  it("email addresses are unique across tenants without revealing which tenant has it", async () => {
    const A = await makeTenant("ua");
    const B = await makeTenant("ub");
    await expect(
      createEmployee(B.ctx.admin, { employeeCode: "DUP", fullName: "Dup", email: A.employee.user.email, role: "EMPLOYEE" }, env),
    ).rejects.toThrow("EMAIL_TAKEN");
  });

  it("managers see only their direct reports", async () => {
    const T = await makeTenant("scope");
    await expect(assertCanViewEmployee(T.ctx.manager, T.employee.employee.id)).resolves.toBeUndefined();
    await expect(assertCanViewEmployee(T.ctx.manager, T.other.employee.id)).rejects.toThrow("FORBIDDEN");
    await expect(assertCanViewEmployee(T.ctx.employee, T.other.employee.id)).rejects.toThrow("FORBIDDEN");
    await expect(assertCanViewEmployee(T.ctx.admin, T.other.employee.id)).resolves.toBeUndefined();
  });
});

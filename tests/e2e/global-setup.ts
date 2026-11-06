import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, type Role } from "@prisma/client";
import { hashPassword } from "../../src/server/auth/password";

export const STATE_FILE = path.join(__dirname, ".state.json");
export const PASSWORD = "E2e-Passw0rd-2026";
const NOTICE = "2026-11-v1";

/** Fresh tenants for this run: A (full team) and B (to prove isolation). */
export default async function globalSetup() {
  const url = process.env.DATABASE_URL_TEST!;
  if (!/test/i.test(url)) throw new Error("e2e must run against a test database");
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  const db = new PrismaClient({ datasources: { db: { url } } });
  const run = randomUUID().slice(0, 8);
  const hash = await hashPassword(PASSWORD);
  const plan = await db.plan.upsert({ where: { code: "e2e" }, create: { code: "e2e", name: "E2E", maxEmployees: 100 }, update: {} });

  async function tenant(label: string) {
    const t = await db.tenant.create({ data: { name: `E2E ${label} ${run}`, slug: `e2e-${label}-${run}`, planId: plan.id } });
    await db.officeLocation.create({ data: { tenantId: t.id, name: "HQ", cidrs: ["10.0.0.0/8"] } });
    const cl = await db.leaveType.create({ data: { tenantId: t.id, code: "CL", name: "Casual leave", yearlyQuota: 8 } });
    const year = new Date().getUTCFullYear();
    const people: Record<string, { email: string; employeeId: string; userId: string }> = {};
    async function person(key: string, role: Role, managerKey?: string, opts: { consent?: boolean; mustChange?: boolean } = {}) {
      const email = `${key}-${label}-${run}@e2e.test`;
      const user = await db.user.create({ data: { tenantId: t.id, email, passwordHash: hash, role, mustChangePassword: opts.mustChange ?? false } });
      const emp = await db.employee.create({
        data: { tenantId: t.id, userId: user.id, employeeCode: key.toUpperCase(), fullName: `${key[0]!.toUpperCase()}${key.slice(1)} ${label}`, managerId: managerKey ? people[managerKey]!.employeeId : null },
      });
      if (opts.consent !== false) await db.consentRecord.create({ data: { tenantId: t.id, userId: user.id, noticeVersion: NOTICE } });
      await db.leaveLedger.create({ data: { tenantId: t.id, employeeId: emp.id, leaveTypeId: cl.id, year, kind: "ALLOCATION", days: 8, createdById: user.id } });
      people[key] = { email, employeeId: emp.id, userId: user.id };
    }
    await person("admin", "COMPANY_ADMIN");
    await person("manager", "MANAGER");
    await person("cover", "MANAGER");
    await person("worker", "EMPLOYEE", "manager");
    await person("newbie", "EMPLOYEE", "manager", { consent: false, mustChange: true });
    return { id: t.id, people };
  }

  const state = { password: PASSWORD, a: await tenant("a"), b: await tenant("b") };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  await db.$disconnect();
}

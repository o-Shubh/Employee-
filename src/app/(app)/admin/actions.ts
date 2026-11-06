"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requireUser, requestEnv } from "@/server/auth/session";
import { run } from "@/server/actions";
import type { FormState } from "@/components/action-form";
import { createEmployee, importEmployeesCsv, resetEmployeePassword, updateEmployee } from "@/server/services/employees";
import { createDepartment, renameDepartment, upsertLocation } from "@/server/services/org";
import { decideDevice } from "@/server/services/devices";
import { adjustBalance, allocateYear, saveLeaveType } from "@/server/services/leave";

async function adminCtx() {
  const ctx = await requireUser({ roles: ["COMPANY_ADMIN"] });
  return { ctx, env: await requestEnv() };
}
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function createEmployeeAction(_p: FormState, f: FormData): Promise<FormState> {
  const { ctx, env } = await adminCtx();
  const t = await getTranslations("admin.employees");
  const res = await run(() =>
    createEmployee(ctx, {
      employeeCode: s(f, "employeeCode"), fullName: s(f, "fullName"), email: s(f, "email"),
      role: s(f, "role") as "EMPLOYEE", designation: s(f, "designation"), departmentId: s(f, "departmentId"),
      managerId: s(f, "managerId"), officeLocationId: s(f, "officeLocationId"), joinedOn: s(f, "joinedOn"),
    }, env),
  );
  if (!res.ok) return { ok: false, code: res.code };
  revalidatePath("/admin/employees");
  return { ok: true, message: t("created", { email: s(f, "email"), password: res.data!.tempPassword }) };
}

export async function updateEmployeeAction(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const { ctx, env } = await adminCtx();
  const res = await run(() =>
    updateEmployee(ctx, id, {
      fullName: s(f, "fullName"), role: s(f, "role") as "EMPLOYEE", designation: s(f, "designation"),
      departmentId: s(f, "departmentId"), managerId: s(f, "managerId"), officeLocationId: s(f, "officeLocationId"),
      joinedOn: s(f, "joinedOn"), status: s(f, "status") as "ACTIVE",
    }, env),
  );
  if (!res.ok) return { ok: false, code: res.code };
  revalidatePath("/admin/employees");
  return { ok: true };
}

export async function resetPasswordAction(id: string, _p: FormState): Promise<FormState> {
  const { ctx, env } = await adminCtx();
  const t = await getTranslations("admin.employees");
  const res = await run(() => resetEmployeePassword(ctx, id, env));
  if (!res.ok) return { ok: false, code: res.code };
  return { ok: true, message: t("passwordReset", { password: res.data.tempPassword }) };
}

export type ImportState =
  | undefined
  | { ok: false; code?: string; errors?: { row: number; field: string; code: string }[] }
  | { ok: true; created: { employeeCode: string; email: string; tempPassword: string }[] };

export async function importEmployeesAction(_p: ImportState, f: FormData): Promise<ImportState> {
  const { ctx, env } = await adminCtx();
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, code: "CSV_EMPTY" };
  if (file.size > 2_000_000) return { ok: false, code: "CSV_TOO_LARGE" };
  const text = await file.text();
  const res = await run(() => importEmployeesCsv(ctx, text, env));
  if (!res.ok) return { ok: false, code: res.code };
  if (!res.data!.ok) return { ok: false, errors: res.data!.errors };
  revalidatePath("/admin/employees");
  return { ok: true, created: res.data!.created.map(({ employeeCode, email, tempPassword }) => ({ employeeCode, email, tempPassword })) };
}

export async function createDepartmentAction(_p: FormState, f: FormData): Promise<FormState> {
  const { ctx, env } = await adminCtx();
  const res = await run(() => createDepartment(ctx, { name: s(f, "name") }, env));
  if (!res.ok) return { ok: false, code: res.code };
  revalidatePath("/admin/departments");
  return { ok: true };
}

export async function renameDepartmentAction(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const { ctx, env } = await adminCtx();
  const res = await run(() => renameDepartment(ctx, id, { name: s(f, "name") }, env));
  if (!res.ok) return { ok: false, code: res.code };
  revalidatePath("/admin/departments");
  return { ok: true };
}

export async function saveLocationAction(id: string | null, _p: FormState, f: FormData): Promise<FormState> {
  const { ctx, env } = await adminCtx();
  const cidrs = s(f, "cidrs").split(/[\s,]+/).filter(Boolean);
  const res = await run(() =>
    upsertLocation(ctx, id, { name: s(f, "name"), address: s(f, "address"), cidrs, active: f.get("active") === "on" }, env),
  );
  if (!res.ok) return { ok: false, code: res.code };
  revalidatePath("/admin/locations");
  return { ok: true };
}

export async function decideDeviceAction(deviceId: string, decision: "APPROVE" | "REJECT" | "REVOKE", _p: FormState, f: FormData): Promise<FormState> {
  const { ctx, env } = await adminCtx();
  const res = await run(() => decideDevice(ctx, { deviceId, decision, note: s(f, "note") || undefined }, env));
  if (!res.ok) return { ok: false, code: res.code };
  revalidatePath("/admin/devices");
  return { ok: true };
}

// ─── Phase 2: leave admin ───

export async function saveLeaveTypeAction(id: string | null, _p: FormState, f: FormData): Promise<FormState> {
  const { ctx, env } = await adminCtx();
  const res = await run(() =>
    saveLeaveType(ctx, id, {
      code: s(f, "code"), name: s(f, "name"), yearlyQuota: s(f, "yearlyQuota") || "0",
      tracksBalance: f.get("tracksBalance") === "on", paid: f.get("paid") === "on", halfDayAllowed: f.get("halfDayAllowed") === "on", active: f.get("active") === "on",
    } as never, env),
  );
  revalidatePath("/admin/leave-types");
  return res.ok ? { ok: true } : { ok: false, code: res.code };
}

export async function allocateYearAction(_p: FormState, f: FormData): Promise<FormState> {
  const { ctx, env } = await adminCtx();
  const t = await getTranslations("admin.leaveTypes");
  const res = await run(() => allocateYear(ctx, Number(s(f, "year")), env));
  revalidatePath("/admin/leave-types");
  return res.ok ? { ok: true, message: t("allocated", { count: res.data.created }) } : { ok: false, code: res.code };
}

export async function adjustBalanceAction(_p: FormState, f: FormData): Promise<FormState> {
  const { ctx, env } = await adminCtx();
  const res = await run(() =>
    adjustBalance(ctx, { employeeId: s(f, "employeeId"), leaveTypeId: s(f, "leaveTypeId"), year: s(f, "year"), days: s(f, "days"), reason: s(f, "reason") } as never, env),
  );
  revalidatePath("/admin/leave-types");
  return res.ok ? { ok: true } : { ok: false, code: res.code };
}

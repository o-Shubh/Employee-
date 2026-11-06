"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requireSuperAdmin, requestEnv } from "@/server/auth/session";
import { run } from "@/server/actions";
import { createTenant, setTenantPlan, setTenantStatus, upsertPlan } from "@/server/services/super-admin";
import type { FormState } from "@/components/action-form";

async function superCtx() {
  const user = await requireSuperAdmin();
  const env = await requestEnv();
  return { userId: user.id, ip: env.ip, now: env.now };
}
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function createTenantAction(_p: FormState, f: FormData): Promise<FormState> {
  const ctx = await superCtx();
  const t = await getTranslations("super");
  const res = await run(() =>
    createTenant(ctx, {
      name: s(f, "name"), slug: s(f, "slug"), timezone: s(f, "timezone") || "Asia/Kolkata",
      planId: s(f, "planId"), adminName: s(f, "adminName"), adminEmail: s(f, "adminEmail"),
    }),
  );
  if (!res.ok) return { ok: false, code: res.code };
  revalidatePath("/super");
  return { ok: true, message: t("created", { email: s(f, "adminEmail"), password: res.data.tempPassword }) };
}

export async function tenantStatusAction(tenantId: string, status: "ACTIVE" | "SUSPENDED", _p: FormState): Promise<FormState> {
  const ctx = await superCtx();
  const res = await run(() => setTenantStatus(ctx, tenantId, status));
  revalidatePath("/super");
  return res.ok ? { ok: true } : { ok: false, code: res.code };
}

export async function tenantPlanAction(tenantId: string, _p: FormState, f: FormData): Promise<FormState> {
  const ctx = await superCtx();
  const res = await run(() => setTenantPlan(ctx, tenantId, s(f, "planId")));
  revalidatePath("/super");
  return res.ok ? { ok: true } : { ok: false, code: res.code };
}

export async function savePlanAction(id: string | null, _p: FormState, f: FormData): Promise<FormState> {
  const ctx = await superCtx();
  const res = await run(() =>
    upsertPlan(ctx, id, { code: s(f, "code"), name: s(f, "name"), maxEmployees: s(f, "maxEmployees"), priceMonthlyInr: s(f, "priceMonthlyInr") }),
  );
  revalidatePath("/super/plans");
  return res.ok ? { ok: true } : { ok: false, code: res.code };
}

import "server-only";
import { cache } from "react";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { prismaUnscoped } from "../db/client";
import { forTenant } from "../db/tenant";
import type { RequestEnv, TenantCtx } from "../context";
import { resolveClientIp } from "../security/client-ip";
import { deviceCookieName } from "../security/device-token";
import { hasCurrentConsent } from "../services/consent";
import { auth } from "./index";

/** Re-reads the user on every request, so role changes / disabling take effect immediately. */
export const getCurrentUser = cache(async () => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await prismaUnscoped.user.findUnique({
    where: { id },
    include: { tenant: true, employee: { select: { id: true, fullName: true, employeeCode: true } } },
  });
  if (!user || user.status !== "ACTIVE") return null;
  if (user.tenant && user.tenant.status !== "ACTIVE") return null;
  return user;
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

interface RequireOpts {
  roles?: Role[];
  /** Skip the forced password-change / consent redirects (used by those pages themselves). */
  allowIncompleteOnboarding?: boolean;
}

/** Guard for tenant pages and server actions. Returns a tenant-scoped context. */
export const requireUser = cache(async (opts: RequireOpts = {}): Promise<TenantCtx & { user: CurrentUser }> => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "SUPER_ADMIN" || !user.tenantId || !user.tenant) redirect("/super");

  const ctx: TenantCtx & { user: CurrentUser } = {
    user,
    tenantId: user.tenantId,
    tenant: user.tenant,
    db: forTenant(user.tenantId, prismaUnscoped),
    actor: { userId: user.id, role: user.role, employeeId: user.employee?.id ?? null },
  };

  if (!opts.allowIncompleteOnboarding) {
    if (user.mustChangePassword) redirect("/change-password");
    if (!(await hasCurrentConsent(ctx))) redirect("/consent");
  }
  if (opts.roles && !opts.roles.includes(user.role)) redirect("/dashboard?denied=1");
  return ctx;
});

export async function requireSuperAdmin() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") redirect("/dashboard");
  return user;
}

/** Facts about the current HTTP request, for services. */
export async function requestEnv(employeeId?: string | null): Promise<RequestEnv> {
  const h = await headers();
  const c = await cookies();
  return {
    now: new Date(),
    ip: resolveClientIp(h),
    userAgent: h.get("user-agent"),
    deviceToken: employeeId ? (c.get(deviceCookieName(employeeId))?.value ?? null) : null,
  };
}

/** For route handlers: tenant context or null (no redirects). Onboarding must be complete. */
export async function getTenantCtxOrNull(): Promise<TenantCtx | null> {
  const user = await getCurrentUser();
  if (!user?.tenantId || !user.tenant || user.mustChangePassword) return null;
  const ctx: TenantCtx = {
    tenantId: user.tenantId,
    tenant: user.tenant,
    db: forTenant(user.tenantId, prismaUnscoped),
    actor: { userId: user.id, role: user.role, employeeId: user.employee?.id ?? null },
  };
  return (await hasCurrentConsent(ctx)) ? ctx : null;
}

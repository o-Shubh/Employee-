import type { Role, Tenant } from "@prisma/client";
import type { TenantDb } from "./db/tenant";

/** Everything a tenant-side service needs. Built by requireUser() or by tests. */
export interface TenantCtx {
  tenantId: string;
  tenant: Tenant;
  db: TenantDb;
  actor: { userId: string; role: Role; employeeId: string | null };
}

/** Request facts that come from the HTTP layer (injected so services stay testable). */
export interface RequestEnv {
  now: Date;
  ip: string | null;
  userAgent?: string | null;
  deviceToken?: string | null;
}

export const staleShiftMs = () => Number(process.env.STALE_SHIFT_HOURS ?? 16) * 3600_000;

export const isAdmin = (ctx: TenantCtx) => ctx.actor.role === "COMPANY_ADMIN";
export const isManagerOrAdmin = (ctx: TenantCtx) => ctx.actor.role === "COMPANY_ADMIN" || ctx.actor.role === "MANAGER";

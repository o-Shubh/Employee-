import { z } from "zod";
import { AppError } from "../errors";
import { isAdmin, type RequestEnv, type TenantCtx } from "../context";
import { audit } from "./audit";

export const settingsInput = z.object({
  idleTimeoutMin: z.coerce.number().int().min(5).max(240),
  requirePhotoAtCheckIn: z.boolean(),
  allowFieldCheckoutAnywhere: z.boolean(),
  escalationDays: z.coerce.number().int().min(1).max(30),
  weeklyOffDays: z.array(z.coerce.number().int().min(1).max(7)).max(6),
  photoRetentionDays: z.coerce.number().int().min(7).max(3650),
  grievanceContact: z.string().trim().max(300).optional().transform((v) => v || null),
});

/** Company-level settings. Plan, status and slug stay platform-managed (enforced by forTenant). */
export async function updateTenantSettings(ctx: TenantCtx, raw: z.input<typeof settingsInput>, env: RequestEnv) {
  if (!isAdmin(ctx)) throw new AppError("FORBIDDEN");
  const parsed = settingsInput.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION");
  const data = { ...parsed.data, weeklyOffDays: [...new Set(parsed.data.weeklyOffDays)].sort() };
  const before = ctx.tenant;
  const t = await ctx.db.tenant.update({ where: { id: ctx.tenantId }, data });
  await audit(ctx, {
    action: "settings.updated", entityType: "Tenant", entityId: ctx.tenantId, ip: env.ip, at: env.now,
    before: Object.fromEntries(Object.keys(data).map((k) => [k, before[k as keyof typeof before] as never])),
    after: data,
  });
  return t;
}

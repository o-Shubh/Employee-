import type { TenantCtx } from "../context";
import { getShiftState, pendingCertification } from "./attendance";
import { dbToDateKey } from "@/domain/time";
import { leaveInRange } from "./leave";
import type { StatusSnapshot } from "@/lib/status-snapshot";

/** Everything the floating widget needs, computed server-side as of `now`. */
export async function getStatusSnapshot(ctx: TenantCtx, now: Date): Promise<StatusSnapshot | null> {
  const employeeId = ctx.actor.employeeId;
  if (!employeeId) return null;
  const s = await getShiftState(ctx, employeeId, now);
  const pending = s.status === "OFF" ? await pendingCertification(ctx, employeeId, now) : null;
  const [leave] = await leaveInRange(ctx, s.todayKey, s.todayKey, [employeeId]);
  return {
    status: s.status,
    statusSince: s.computation.statusSince?.toISOString() ?? null,
    currentBreakKind: s.computation.currentBreakKind,
    workSeconds: s.computation.workSeconds,
    breakSeconds: s.computation.breakSeconds,
    fieldSeconds: s.computation.fieldSeconds,
    firstInAt: s.computation.firstInAt?.toISOString() ?? null,
    asOf: now.toISOString(),
    workDate: s.workDate,
    timezone: ctx.tenant.timezone,
    idleTimeoutMin: ctx.tenant.idleTimeoutMin,
    requirePhoto: ctx.tenant.requirePhotoAtCheckIn,
    missedCheckoutOn: s.missedCheckoutOn,
    certifyDate: pending ? dbToDateKey(pending.workDate) : null,
    leaveToday: leave?.leaveType.name ?? null,
  };
}

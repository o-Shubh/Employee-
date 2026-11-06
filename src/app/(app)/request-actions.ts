"use server";

import { revalidatePath } from "next/cache";
import { requireUser, requestEnv } from "@/server/auth/session";
import { run } from "@/server/actions";
import type { FormState } from "@/components/action-form";
import { applyLeave, cancelLeave, decideLeave, previewLeaveDays } from "@/server/services/leave";
import { cancelCorrection, decideCorrection, previewCorrection, requestCorrection } from "@/server/services/corrections";
import { cancelOvertime, decideOvertime, requestOvertime } from "@/server/services/overtime";
import type { CorrectionOp } from "@/domain/corrections";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const touch = () => {
  revalidatePath("/", "layout");
};

// ─── Leave ───
export async function previewLeaveAction(span: { startDate: string; endDate: string; halfDayStart: boolean; halfDayEnd: boolean }) {
  const ctx = await requireUser();
  const r = previewLeaveDays(ctx, span);
  return r.ok ? { ok: true as const, days: r.days } : { ok: false as const, code: `LEAVE_${r.error}` };
}

export async function applyLeaveAction(_p: FormState, f: FormData): Promise<FormState> {
  const ctx = await requireUser();
  const env = await requestEnv();
  const res = await run(() =>
    applyLeave(ctx, {
      leaveTypeId: s(f, "leaveTypeId"), startDate: s(f, "startDate"), endDate: s(f, "endDate") || s(f, "startDate"),
      halfDayStart: f.get("halfDayStart") === "on", halfDayEnd: f.get("halfDayEnd") === "on", reason: s(f, "reason"),
    }, env),
  );
  if (!res.ok) return { ok: false, code: res.code };
  touch();
  return { ok: true };
}

export async function cancelLeaveAction(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const ctx = await requireUser();
  const env = await requestEnv();
  const res = await run(() => cancelLeave(ctx, id, { comment: s(f, "comment") }, env));
  touch();
  return res.ok ? { ok: true } : { ok: false, code: res.code };
}

// ─── Corrections ───
export async function previewCorrectionAction(input: { workDate: string; ops: CorrectionOp[]; reason: string }) {
  const ctx = await requireUser();
  const res = await run(() => previewCorrection(ctx, { ...input, reason: input.reason || "preview" }, new Date()));
  if (!res.ok) return { ok: false as const, code: res.code };
  const sim = res.data;
  return sim.ok ? { ok: true as const, workSeconds: sim.workSeconds, breakSeconds: sim.breakSeconds } : { ok: false as const, code: `CORRECTION_${sim.error}` };
}

export async function requestCorrectionAction(input: { workDate: string; ops: CorrectionOp[]; reason: string }) {
  const ctx = await requireUser();
  const env = await requestEnv();
  const res = await run(async () => {
    await requestCorrection(ctx, input, env);
  });
  touch();
  return res;
}

export async function cancelCorrectionAction(id: string, _p: FormState): Promise<FormState> {
  const ctx = await requireUser();
  const env = await requestEnv();
  const res = await run(() => cancelCorrection(ctx, id, env));
  touch();
  return res.ok ? { ok: true } : { ok: false, code: res.code };
}

// ─── Overtime ───
export async function requestOvertimeAction(_p: FormState, f: FormData): Promise<FormState> {
  const ctx = await requireUser();
  const env = await requestEnv();
  const hours = Number(s(f, "hours") || 0);
  const mins = Number(s(f, "minutes") || 0);
  const res = await run(() => requestOvertime(ctx, { workDate: s(f, "workDate"), minutes: hours * 60 + mins, reason: s(f, "reason") }, env));
  if (!res.ok) return { ok: false, code: res.code };
  touch();
  return { ok: true };
}

export async function cancelOvertimeAction(id: string, _p: FormState): Promise<FormState> {
  const ctx = await requireUser();
  const env = await requestEnv();
  const res = await run(() => cancelOvertime(ctx, id, env));
  touch();
  return res.ok ? { ok: true } : { ok: false, code: res.code };
}

// ─── Approvals ───
export async function decideAction(kind: "leave" | "correction" | "overtime", id: string, _p: FormState, f: FormData): Promise<FormState> {
  const ctx = await requireUser({ roles: ["MANAGER", "COMPANY_ADMIN"] });
  const env = await requestEnv();
  const input = { decision: s(f, "decision"), comment: s(f, "comment") };
  const fn = kind === "leave" ? decideLeave : kind === "correction" ? decideCorrection : decideOvertime;
  const res = await run(async () => {
    await fn(ctx, id, input, env);
  });
  touch();
  return res.ok ? { ok: true } : { ok: false, code: res.code };
}

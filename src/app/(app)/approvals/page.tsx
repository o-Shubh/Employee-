import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { getBalances, pendingLeaveForApprover } from "@/server/services/leave";
import { pendingCorrectionsForApprover } from "@/server/services/corrections";
import { pendingOvertimeForApprover } from "@/server/services/overtime";
import { loadDayEntries } from "@/server/services/attendance";
import type { CorrectionOp } from "@/domain/corrections";
import { dbToDateKey } from "@/domain/time";
import { formatHm } from "@/domain/timeline";
import { fmtDateKey, fmtDateTime } from "@/lib/format";
import { CorrectionOpsList } from "@/components/correction-ops";
import { DecisionForm } from "@/components/decision-form";
import { RequestStatus } from "@/components/request-status";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { decideAction } from "@/app/(app)/request-actions";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("approvals") };
}

const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default async function ApprovalsPage() {
  const ctx = await requireUser({ roles: ["MANAGER", "COMPANY_ADMIN"] });
  const t = await getTranslations("approvals");
  const tz = ctx.tenant.timezone;
  const [leave, corrections, overtime] = await Promise.all([pendingLeaveForApprover(ctx), pendingCorrectionsForApprover(ctx), pendingOvertimeForApprover(ctx)]);

  const balances = new Map(
    await Promise.all(
      [...new Set(leave.map((l) => `${l.employeeId}:${l.startDate.getUTCFullYear()}`))].map(async (k) => {
        const [emp, year] = k.split(":");
        return [k, await getBalances(ctx, emp!, Number(year))] as const;
      }),
    ),
  );
  const correctionEntries = new Map(
    await Promise.all(corrections.map(async (c) => [c.id, await loadDayEntries(ctx.db, c.employeeId, dbToDateKey(c.workDate))] as const)),
  );
  const otDays = await ctx.db.dayRecord.findMany({
    where: { OR: overtime.map((o) => ({ employeeId: o.employeeId, workDate: o.workDate })) },
  });
  const otWorked = new Map(otDays.map((d) => [`${d.employeeId}:${dbToDateKey(d.workDate)}`, d.workMin]));

  const recent = await Promise.all([
    ctx.db.leaveRequest.findMany({ where: { decidedById: ctx.actor.userId }, orderBy: { decidedAt: "desc" }, take: 10, include: { employee: { select: { fullName: true } }, leaveType: { select: { code: true } } } }),
    ctx.db.correctionRequest.findMany({ where: { decidedById: ctx.actor.userId }, orderBy: { decidedAt: "desc" }, take: 10, include: { employee: { select: { fullName: true } } } }),
    ctx.db.overtimeRequest.findMany({ where: { decidedById: ctx.actor.userId }, orderBy: { decidedAt: "desc" }, take: 10, include: { employee: { select: { fullName: true } } } }),
  ]);
  const decided = [
    ...recent[0].map((r) => ({ id: r.id, at: r.decidedAt!, who: r.employee.fullName, what: t("recentLeave", { type: r.leaveType.code, from: fmtDateKey(dbToDateKey(r.startDate)), days: fmtDays(Number(r.days)) }), status: r.status })),
    ...recent[1].map((r) => ({ id: r.id, at: r.decidedAt!, who: r.employee.fullName, what: t("recentCorrection", { date: fmtDateKey(dbToDateKey(r.workDate)) }), status: r.status })),
    ...recent[2].map((r) => ({ id: r.id, at: r.decidedAt!, who: r.employee.fullName, what: t("recentOvertime", { date: fmtDateKey(dbToDateKey(r.workDate)), duration: formatHm(r.minutes) }), status: r.status })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 15);

  const total = leave.length + corrections.length + overtime.length;
  const isOwn = (employeeId: string) => employeeId === ctx.actor.employeeId;

  return (
    <>
      <PageHeader title={t("title")} description={total === 0 ? t("allClear") : t("waiting", { count: total })} />
      <div className="space-y-6">
        <Panel title={t("leaveTitle", { count: leave.length })}>
          {leave.length === 0 ? (
            <EmptyState title={t("none")} />
          ) : (
            <ul className="divide-y divide-rule">
              {leave.map((l) => {
                const bal = balances.get(`${l.employeeId}:${l.startDate.getUTCFullYear()}`)?.find((b) => b.leaveType.id === l.leaveTypeId);
                const start = dbToDateKey(l.startDate);
                const end = dbToDateKey(l.endDate);
                return (
                  <li key={l.id} className="grid gap-3 py-4 lg:grid-cols-[1fr_minmax(20rem,26rem)]">
                    <div className="space-y-1 text-sm">
                      <p className="font-medium">
                        {l.employee.fullName} <span className="font-normal text-ink-3">({l.employee.employeeCode})</span>
                        {isOwn(l.employeeId) && <span className="ml-2 text-xs text-break">{t("yourOwn")}</span>}
                      </p>
                      <p>
                        {t("leaveLine", { type: l.leaveType.name, days: fmtDays(Number(l.days)), from: fmtDateKey(start), to: fmtDateKey(end) })}
                        {(l.halfDayStart || l.halfDayEnd) && ` ${t("withHalfDay")}`}
                      </p>
                      <p className="text-ink-2">{l.reason}</p>
                      {bal && l.leaveType.tracksBalance && (
                        <p className={bal.balance < Number(l.days) ? "text-xs text-danger" : "text-xs text-ink-3"}>
                          {t("balanceLine", { balance: fmtDays(bal.balance), pending: fmtDays(bal.pending) })}
                        </p>
                      )}
                      <p className="text-xs text-ink-3">{t("submittedAt", { time: fmtDateTime(l.createdAt, tz) })}</p>
                    </div>
                    <DecisionForm action={decideAction.bind(null, "leave", l.id)} />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title={t("correctionsTitle", { count: corrections.length })}>
          {corrections.length === 0 ? (
            <EmptyState title={t("none")} />
          ) : (
            <ul className="divide-y divide-rule">
              {corrections.map((c) => {
                const date = dbToDateKey(c.workDate);
                return (
                  <li key={c.id} className="grid gap-3 py-4 lg:grid-cols-[1fr_minmax(20rem,26rem)]">
                    <div className="space-y-1 text-sm">
                      <p className="font-medium">
                        {c.employee.fullName} <span className="font-normal text-ink-3">({c.employee.employeeCode})</span>
                        {isOwn(c.employeeId) && <span className="ml-2 text-xs text-break">{t("yourOwn")}</span>}
                      </p>
                      <p>
                        <Link className="text-primary hover:underline" href={`/logs/${date}?employee=${c.employeeId}`}>
                          {fmtDateKey(date)}
                        </Link>
                      </p>
                      <CorrectionOpsList ops={c.ops as unknown as CorrectionOp[]} entries={correctionEntries.get(c.id) ?? []} timezone={tz} />
                      <p className="text-ink-2">{c.reason}</p>
                      <p className="text-xs text-ink-3">{t("submittedAt", { time: fmtDateTime(c.createdAt, tz) })}</p>
                    </div>
                    <DecisionForm action={decideAction.bind(null, "correction", c.id)} />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title={t("overtimeTitle", { count: overtime.length })}>
          {overtime.length === 0 ? (
            <EmptyState title={t("none")} />
          ) : (
            <ul className="divide-y divide-rule">
              {overtime.map((o) => {
                const date = dbToDateKey(o.workDate);
                const worked = otWorked.get(`${o.employeeId}:${date}`);
                return (
                  <li key={o.id} className="grid gap-3 py-4 lg:grid-cols-[1fr_minmax(20rem,26rem)]">
                    <div className="space-y-1 text-sm">
                      <p className="font-medium">
                        {o.employee.fullName} <span className="font-normal text-ink-3">({o.employee.employeeCode})</span>
                        {isOwn(o.employeeId) && <span className="ml-2 text-xs text-break">{t("yourOwn")}</span>}
                      </p>
                      <p>{t("overtimeLine", { duration: formatHm(o.minutes), date: fmtDateKey(date) })}</p>
                      <p className="text-ink-2">{o.reason}</p>
                      <p className="text-xs text-ink-3">{worked !== undefined ? t("workedThatDay", { worked: formatHm(worked) }) : t("noLogThatDay")}</p>
                    </div>
                    <DecisionForm action={decideAction.bind(null, "overtime", o.id)} />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title={t("recentTitle")}>
          {decided.length === 0 ? (
            <EmptyState title={t("noRecent")} />
          ) : (
            <ul className="divide-y divide-rule text-sm">
              {decided.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="tabular w-36 text-xs text-ink-3">{fmtDateTime(d.at, tz)}</span>
                  <span className="font-medium">{d.who}</span>
                  <span className="text-ink-2">{d.what}</span>
                  <span className="ml-auto">
                    <RequestStatus status={d.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

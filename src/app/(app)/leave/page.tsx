import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { getBalances, listLeaveRequests } from "@/server/services/leave";
import { dbToDateKey, localDateKey } from "@/domain/time";
import { fmtDateKey } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { RequestStatus } from "@/components/request-status";
import { EmptyState, Notice, PageHeader, Panel, Table } from "@/components/ui";
import { cancelLeaveAction } from "@/app/(app)/request-actions";
import { ApplyLeaveForm } from "./apply-form";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("leave") };
}

const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default async function LeavePage() {
  const ctx = await requireUser();
  const t = await getTranslations("leave");
  const employeeId = ctx.actor.employeeId;
  if (!employeeId) return <Notice>{t("noProfile")}</Notice>;
  const now = new Date();
  const today = localDateKey(now, ctx.tenant.timezone);
  const year = Number(today.slice(0, 4));
  const [balances, requests] = await Promise.all([getBalances(ctx, employeeId, year), listLeaveRequests(ctx, employeeId)]);

  return (
    <>
      <PageHeader title={t("title")} description={t("description", { year })} />
      <div className="space-y-6">
        {balances.length === 0 ? (
          <Notice tone="info">{t("noTypes")}</Notice>
        ) : (
          <dl className="grid gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
            {balances.map((b) => (
              <div key={b.leaveType.id} className="bg-surface px-4 py-3">
                <dt className="text-xs text-ink-3">
                  {b.leaveType.name} ({b.leaveType.code})
                </dt>
                {b.leaveType.tracksBalance ? (
                  <>
                    <dd className="tabular mt-1 text-2xl font-semibold">{fmtDays(b.available)}</dd>
                    <dd className="text-xs text-ink-3">
                      {t("balanceDetail", { used: fmtDays(b.used), pending: fmtDays(b.pending) })}
                    </dd>
                  </>
                ) : (
                  <dd className="mt-1 text-sm text-ink-2">{t("noLimit")}</dd>
                )}
              </div>
            ))}
          </dl>
        )}
        {balances.length > 0 && (
          <Panel title={t("applyTitle")}>
            <ApplyLeaveForm
              today={today}
              types={balances.map((b) => ({ id: b.leaveType.id, name: b.leaveType.name, code: b.leaveType.code, halfDayAllowed: b.leaveType.halfDayAllowed, available: b.leaveType.tracksBalance ? b.available : null }))}
            />
          </Panel>
        )}
        <Panel title={t("history")}>
          {requests.length === 0 ? (
            <EmptyState title={t("noRequests")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t("dates")}</th>
                  <th>{t("type")}</th>
                  <th>{t("days")}</th>
                  <th>{t("reason")}</th>
                  <th>{t("status")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const start = dbToDateKey(r.startDate);
                  const end = dbToDateKey(r.endDate);
                  const cancellable = r.status === "PENDING" || (r.status === "APPROVED" && start > today);
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">
                        {fmtDateKey(start)}
                        {end !== start && <> – {fmtDateKey(end)}</>}
                        {(r.halfDayStart || r.halfDayEnd) && <span className="block text-xs text-ink-3">{t("includesHalfDay")}</span>}
                      </td>
                      <td>{r.leaveType.code}</td>
                      <td className="tabular">{fmtDays(Number(r.days))}</td>
                      <td className="max-w-xs text-ink-2">
                        {r.reason}
                        {r.decisionComment && <span className="block text-xs text-ink-3">{t("comment", { comment: r.decisionComment })}</span>}
                      </td>
                      <td>
                        <RequestStatus status={r.status} />
                      </td>
                      <td>
                        {cancellable && (
                          <ActionForm action={cancelLeaveAction.bind(null, r.id)} submitLabel={t("cancel")} variant="secondary" className="contents">
                            <></>
                          </ActionForm>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>
    </>
  );
}

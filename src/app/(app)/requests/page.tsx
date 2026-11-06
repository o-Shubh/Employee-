import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { listCorrections } from "@/server/services/corrections";
import { listOvertime } from "@/server/services/overtime";
import { dbToDateKey, localDateKey } from "@/domain/time";
import { formatHm } from "@/domain/timeline";
import { fmtDateKey, fmtDateTime } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { RequestStatus } from "@/components/request-status";
import { EmptyState, Notice, PageHeader, Panel, Table } from "@/components/ui";
import { cancelCorrectionAction, cancelOvertimeAction } from "@/app/(app)/request-actions";
import { OvertimeForm } from "./overtime-form";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("requests") };
}

export default async function RequestsPage() {
  const ctx = await requireUser();
  const t = await getTranslations("requests");
  const employeeId = ctx.actor.employeeId;
  if (!employeeId) return <Notice>{t("noProfile")}</Notice>;
  const tz = ctx.tenant.timezone;
  const [corrections, overtime] = await Promise.all([listCorrections(ctx, employeeId), listOvertime(ctx, employeeId)]);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="space-y-6">
        <Panel title={t("correctionsTitle")}>
          <p className="mb-4 text-sm text-ink-2">{t.rich("correctionsHelp", { link: (c) => <Link href="/logs" className="text-primary underline">{c}</Link> })}</p>
          {corrections.length === 0 ? (
            <EmptyState title={t("noCorrections")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t("day")}</th>
                  <th>{t("reason")}</th>
                  <th>{t("submitted")}</th>
                  <th>{t("status")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {corrections.map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/logs/${dbToDateKey(c.workDate)}`} className="text-primary hover:underline">
                        {fmtDateKey(dbToDateKey(c.workDate))}
                      </Link>
                    </td>
                    <td className="max-w-sm text-ink-2">
                      {c.reason}
                      {c.decisionComment && <span className="block text-xs text-ink-3">{t("comment", { comment: c.decisionComment })}</span>}
                    </td>
                    <td className="tabular text-xs">{fmtDateTime(c.createdAt, tz)}</td>
                    <td>
                      <RequestStatus status={c.status} />
                    </td>
                    <td>
                      {c.status === "PENDING" && (
                        <ActionForm action={cancelCorrectionAction.bind(null, c.id)} submitLabel={t("withdraw")} variant="secondary" className="contents">
                          <></>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel title={t("overtimeTitle")}>
          <OvertimeForm today={localDateKey(new Date(), tz)} />
          <div className="mt-6">
            {overtime.length === 0 ? (
              <EmptyState title={t("noOvertime")} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>{t("day")}</th>
                    <th>{t("duration")}</th>
                    <th>{t("reason")}</th>
                    <th>{t("status")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {overtime.map((o) => (
                    <tr key={o.id}>
                      <td className="whitespace-nowrap">{fmtDateKey(dbToDateKey(o.workDate))}</td>
                      <td className="tabular">{formatHm(o.minutes)}</td>
                      <td className="max-w-sm text-ink-2">
                        {o.reason}
                        {o.decisionComment && <span className="block text-xs text-ink-3">{t("comment", { comment: o.decisionComment })}</span>}
                      </td>
                      <td>
                        <RequestStatus status={o.status} />
                      </td>
                      <td>
                        {o.status === "PENDING" && (
                          <ActionForm action={cancelOvertimeAction.bind(null, o.id)} submitLabel={t("withdraw")} variant="secondary" className="contents">
                            <></>
                          </ActionForm>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}

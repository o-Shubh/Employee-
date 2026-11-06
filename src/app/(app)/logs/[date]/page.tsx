import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { getDayDetail } from "@/server/services/attendance";
import { AppError } from "@/server/errors";
import { isDateKey } from "@/domain/time";
import { formatDuration } from "@/domain/timeline";
import { fmtDateKey, fmtDateTime } from "@/lib/format";
import { graphLabels } from "@/lib/graph-labels";
import { resolveViewedEmployee } from "@/lib/viewing";
import { DutyGraph } from "@/components/duty-graph";
import { EntryList } from "@/components/entry-list";
import { CertifyForm } from "@/components/certify-form";
import { AuditList } from "@/components/audit-list";
import { Badge, Notice, PageHeader, Panel } from "@/components/ui";

export default async function DayPage({ params, searchParams }: { params: Promise<{ date: string }>; searchParams: Promise<{ employee?: string }> }) {
  const { date } = await params;
  const sp = await searchParams;
  if (!isDateKey(date)) notFound();
  const ctx = await requireUser();
  const t = await getTranslations("day");
  let viewed;
  try {
    viewed = await resolveViewedEmployee(ctx, sp.employee);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const now = new Date();
  const tz = ctx.tenant.timezone;
  const d = await getDayDetail(ctx, viewed.employee.id, date, now);
  const c = d.computation;
  const canCertify = viewed.isSelf && d.entries.length > 0 && c.status === "OFF" && !c.missedCheckout && !d.isCertified;

  return (
    <>
      <PageHeader
        title={fmtDateKey(date)}
        description={viewed.isSelf ? t("yourDay") : t("dayOf", { name: viewed.employee.fullName, code: viewed.employee.employeeCode })}
        actions={
          <Link href={`/logs?month=${date.slice(0, 7)}${sp.employee ? `&employee=${sp.employee}` : ""}`} className="text-sm text-primary hover:underline">
            {t("backToMonth")}
          </Link>
        }
      />
      <div className="space-y-6">
        {c.missedCheckout && <Notice tone="warning">{t("missedCheckout")}</Notice>}
        {c.anomalies.length > 0 && <Notice tone="warning">{t("anomalies")}</Notice>}

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-4">
          {[
            [t("worked"), formatDuration(c.workSeconds)],
            [t("break"), formatDuration(c.breakSeconds)],
            [t("field"), formatDuration(c.fieldSeconds)],
            [t("certification"), d.isCertified ? t("certified") : d.certifications.length ? t("needsRecertify") : t("notCertified")],
          ].map(([k, v]) => (
            <div key={k} className="bg-surface px-4 py-3">
              <dt className="text-xs text-ink-3">{k}</dt>
              <dd className="tabular mt-1 text-lg font-semibold">{v}</dd>
            </div>
          ))}
        </dl>

        <Panel title={t("graph")}>
          <DutyGraph
            dateKey={date}
            timezone={tz}
            now={now.getTime()}
            labels={await graphLabels(fmtDateKey(date))}
            segments={c.segments.map((s) => ({ status: s.status, start: s.start.toISOString(), end: s.end?.toISOString() ?? null, unbounded: s.unbounded }))}
          />
        </Panel>

        {canCertify && (
          <Panel title={t("certifyTitle")}>
            <CertifyForm key={date} workDate={date} dateLabel={fmtDateKey(date)} />
          </Panel>
        )}

        {d.certifications.length > 0 && (
          <Panel title={t("summaries")}>
            <ul className="space-y-3">
              {d.certifications.map((cert, i) => (
                <li key={cert.id} className="text-sm">
                  <p className="text-ink">{cert.summary}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                    {t("certifiedAt", { time: fmtDateTime(cert.certifiedAt, tz) })}
                    {i === 0 && !d.isCertified && <Badge tone="break">{t("outdated")}</Badge>}
                    {i > 0 && <Badge>{t("earlier")}</Badge>}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel title={t("entries")}>
          <p className="mb-3 text-xs text-ink-3">{t("entriesNote")}</p>
          <EntryList entries={d.entries} timezone={tz} emptyText={t("noEntries")} showPhotos />
        </Panel>

        <Panel title={t("audit")}>
          <AuditList events={d.auditEvents} timezone={tz} emptyText={t("noAudit")} />
        </Panel>
      </div>
    </>
  );
}

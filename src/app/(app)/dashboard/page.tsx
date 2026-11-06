import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { getShiftState, pendingCertification } from "@/server/services/attendance";
import { dbToDateKey } from "@/domain/time";
import { fmtDateKey } from "@/lib/format";
import { graphLabels } from "@/lib/graph-labels";
import { Notice, PageHeader, Panel } from "@/components/ui";
import { DashboardStatus } from "@/components/status/dashboard-status";
import { LiveDutyGraph } from "@/components/status/live-duty-graph";
import { CertifyForm } from "@/components/certify-form";
import { EntryList } from "@/components/entry-list";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("dashboard") };
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const ctx = await requireUser();
  const t = await getTranslations("dashboard");
  const { denied } = await searchParams;
  const employeeId = ctx.actor.employeeId;
  if (!employeeId) return <Notice>{t("noProfile")}</Notice>;

  const now = new Date();
  const state = await getShiftState(ctx, employeeId, now);
  const pending = state.status === "OFF" ? await pendingCertification(ctx, employeeId, now) : null;
  const pendingKey = pending ? dbToDateKey(pending.workDate) : null;
  const tz = ctx.tenant.timezone;

  return (
    <>
      <PageHeader title={t("greeting", { name: ctx.user.employee?.fullName.split(" ")[0] ?? "" })} description={t("today", { date: fmtDateKey(state.workDate) })} />
      <div className="space-y-6">
        {denied && <Notice tone="warning">{t("denied")}</Notice>}
        {state.missedCheckoutOn && (
          <Notice tone="warning">
            {t.rich("missedCheckout", {
              date: fmtDateKey(state.missedCheckoutOn),
              link: (chunks) => (
                <Link className="font-medium underline" href={`/logs/${state.missedCheckoutOn}/correct`}>
                  {chunks}
                </Link>
              ),
            })}
          </Notice>
        )}
        <DashboardStatus />
        {pendingKey && (
          <Panel title={t("certifyTitle")}>
            <CertifyForm key={pendingKey} workDate={pendingKey} dateLabel={fmtDateKey(pendingKey)} />
          </Panel>
        )}
        <Panel title={t("graphTitle")}>
          <LiveDutyGraph
            dateKey={state.workDate}
            timezone={tz}
            labels={await graphLabels(fmtDateKey(state.workDate))}
            segments={state.computation.segments.map((s) => ({
              status: s.status,
              start: s.start.toISOString(),
              end: s.end?.toISOString() ?? null,
              unbounded: s.unbounded,
            }))}
          />
        </Panel>
        <Panel title={t("entriesTitle")} actions={<Link href={`/logs/${state.workDate}`} className="text-sm text-primary hover:underline">{t("fullDay")}</Link>}>
          <EntryList entries={state.entries.map((e) => ({ ...e, superseded: false }))} timezone={tz} emptyText={t("noEntries")} />
        </Panel>
      </div>
    </>
  );
}

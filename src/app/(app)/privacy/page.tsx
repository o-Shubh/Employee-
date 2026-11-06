import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { listMyConsents } from "@/server/services/consent";
import { fmtDateTime } from "@/lib/format";
import { AuditList } from "@/components/audit-list";
import { PageHeader, Panel } from "@/components/ui";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("privacy") };
}

export default async function PrivacyPage() {
  const ctx = await requireUser();
  const t = await getTranslations("privacy");
  const tz = ctx.tenant.timezone;
  const [consents, events] = await Promise.all([
    listMyConsents(ctx),
    ctx.db.auditEvent.findMany({
      where: { OR: [{ subjectEmployeeId: ctx.actor.employeeId ?? "-" }, { actorUserId: ctx.actor.userId }] },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);
  const recorded = t.raw("recordedItems") as string[];
  const never = t.raw("neverItems") as string[];
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={<a href="/api/me/export" className="rounded-md border border-rule-strong px-3 py-2 text-sm font-medium hover:bg-surface-2">{t("download")}</a>} />
      <div className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <Panel title={t("recorded")}>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
              {recorded.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Panel>
          <Panel title={t("never")}>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
              {never.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Panel>
        </div>
        <Panel title={t("consents")}>
          <ul className="space-y-1 text-sm">
            {consents.map((c) => (
              <li key={c.id} className="tabular">
                {t("consentLine", { version: c.noticeVersion, time: fmtDateTime(c.acceptedAt, tz) })}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title={t("trail")}>
          <p className="mb-3 text-xs text-ink-3">{t("trailNote")}</p>
          <AuditList events={events} timezone={tz} emptyText={t("trailEmpty")} />
        </Panel>
      </div>
    </>
  );
}

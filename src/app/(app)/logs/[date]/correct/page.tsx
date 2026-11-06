import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { getDayDetail } from "@/server/services/attendance";
import { listCorrections } from "@/server/services/corrections";
import { isDateKey, localDateKey } from "@/domain/time";
import { effectiveEntries } from "@/domain/timeline";
import { fmtDateKey } from "@/lib/format";
import { Notice, PageHeader, Panel } from "@/components/ui";
import { CorrectionBuilder } from "./correction-builder";

export default async function CorrectPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isDateKey(date)) notFound();
  const ctx = await requireUser();
  const t = await getTranslations("corrections");
  const employeeId = ctx.actor.employeeId;
  if (!employeeId) redirect("/dashboard");
  const now = new Date();
  if (date > localDateKey(now, ctx.tenant.timezone)) notFound();
  const [detail, existing] = await Promise.all([getDayDetail(ctx, employeeId, date, now), listCorrections(ctx, employeeId, { workDate: date })]);
  const pending = existing.find((c) => c.status === "PENDING");
  const current = effectiveEntries(detail.entries).filter((e) => e.type !== "VOID");

  return (
    <>
      <PageHeader title={t("title", { date: fmtDateKey(date) })} description={t("description")} />
      {pending ? (
        <Notice tone="info">{t("alreadyPending")}</Notice>
      ) : (
        <Panel>
          <CorrectionBuilder
            workDate={date}
            timezone={ctx.tenant.timezone}
            suggestCheckout={detail.computation.missedCheckout}
            entries={current.map((e) => ({ id: e.id, type: e.type as "CHECK_IN", breakKind: e.breakKind, note: e.note, occurredAt: e.occurredAt.toISOString() }))}
          />
        </Panel>
      )}
    </>
  );
}

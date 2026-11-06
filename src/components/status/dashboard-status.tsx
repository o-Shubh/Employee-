"use client";
import { useTranslations } from "next-intl";
import { formatDuration } from "@/domain/timeline";
import { clock, liveTotals } from "@/lib/status-snapshot";
import { cn } from "@/components/ui";
import { PunchControls, PunchError } from "./punch-controls";
import { useStatus } from "./status-provider";

const TEXT = { ON_DUTY: "text-duty", BREAK: "text-break", FIELD_DUTY: "text-field", OFF: "text-off" } as const;

export function DashboardStatus() {
  const t = useTranslations("dashboard");
  const ts = useTranslations("status");
  const tb = useTranslations("breakKind");
  const { snapshot, now } = useStatus();
  const live = liveTotals(snapshot, now);
  const fmt = (iso: string) => clock(iso, snapshot.timezone);
  const label =
    snapshot.status === "BREAK" && snapshot.currentBreakKind ? ts("breakOf", { kind: tb(snapshot.currentBreakKind) }) : ts(snapshot.status);

  return (
    <section className="rounded-lg border border-rule bg-surface">
      <div className="grid gap-6 p-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <div>
            <p className="text-sm text-ink-3">{t("currentStatus")}</p>
            <p className={cn("mt-1 text-3xl font-semibold tracking-tight", TEXT[snapshot.status])} aria-live="polite">
              {label}
            </p>
            <p className="mt-1 text-sm text-ink-2">
              {snapshot.status !== "OFF" && snapshot.statusSince
                ? t("inStatusFor", { duration: formatDuration(live.inStatus), time: fmt(snapshot.statusSince) })
                : snapshot.firstInAt
                  ? t("checkedOutToday")
                  : t("notCheckedIn")}
            </p>
          </div>
          <PunchError />
          <PunchControls />
        </div>
        <dl className="grid grid-cols-2 content-start gap-px overflow-hidden rounded-md border border-rule bg-rule">
          {[
            ["worked", live.work],
            ["onBreak", live.brk],
            ["fieldDuty", live.field],
          ].map(([k, v]) => (
            <div key={k as string} className="bg-surface px-4 py-3">
              <dt className="text-xs text-ink-3">{t(k as string)}</dt>
              <dd className="tabular mt-1 text-xl font-semibold">{formatDuration(v as number)}</dd>
            </div>
          ))}
          <div className="bg-surface px-4 py-3">
            <dt className="text-xs text-ink-3">{t("firstIn")}</dt>
            <dd className="tabular mt-1 text-xl font-semibold">{snapshot.firstInAt ? fmt(snapshot.firstInAt) : "—"}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

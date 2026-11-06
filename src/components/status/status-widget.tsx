"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatDuration } from "@/domain/timeline";
import { clock, liveTotals } from "@/lib/status-snapshot";
import { cn } from "@/components/ui";
import { PunchControls, PunchError } from "./punch-controls";
import { useStatus } from "./status-provider";

const BAR = { ON_DUTY: "bg-duty", BREAK: "bg-break", FIELD_DUTY: "bg-field", OFF: "bg-off" } as const;
const TEXT = { ON_DUTY: "text-duty", BREAK: "text-break", FIELD_DUTY: "text-field", OFF: "text-off" } as const;

/** Floating panel, visible on every page: status, live timer, today's work/break totals. */
export function StatusWidget() {
  const t = useTranslations("widget");
  const ts = useTranslations("status");
  const tb = useTranslations("breakKind");
  const { snapshot, now } = useStatus();
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      const pref = localStorage.getItem("wl_widget");
      // Phones start collapsed so the panel doesn't cover the page.
      setOpen(pref ? pref !== "collapsed" : window.innerWidth >= 640);
    } catch {
      /* storage blocked */
    }
  }, []);
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem("wl_widget", o ? "collapsed" : "open");
      } catch {
        /* ignore */
      }
      return !o;
    });
  };

  const live = liveTotals(snapshot, now);
  const label = snapshot.status === "BREAK" && snapshot.currentBreakKind ? ts("breakOf", { kind: tb(snapshot.currentBreakKind) }) : ts(snapshot.status);
  const sinceText = snapshot.statusSince && snapshot.status !== "OFF"
    ? clock(snapshot.statusSince, snapshot.timezone)
    : null;
  const onDashboard = pathname === "/dashboard";

  return (
    <aside
      aria-label={t("label")}
      className="fixed bottom-4 right-4 z-40 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-rule bg-surface shadow-lg print:hidden"
    >
      <div className={cn("h-1", BAR[snapshot.status])} />
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-4 pt-3 text-left">
        <span className={cn("text-sm font-semibold", TEXT[snapshot.status])}>
          <span aria-live="polite">{label}</span>
          {sinceText && <span className="ml-1.5 font-normal text-ink-3">{t("since", { time: sinceText })}</span>}
        </span>
        <span className="tabular text-sm font-semibold text-ink">{formatDuration(live.inStatus)}</span>
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4 pt-2">
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md bg-surface-2 px-2.5 py-2">
              <dt className="text-ink-3">{t("workToday")}</dt>
              <dd className="tabular mt-0.5 text-base font-semibold text-ink">{formatDuration(live.work)}</dd>
            </div>
            <div className="rounded-md bg-surface-2 px-2.5 py-2">
              <dt className="text-ink-3">{t("breakToday")}</dt>
              <dd className="tabular mt-0.5 text-base font-semibold text-ink">{formatDuration(live.brk)}</dd>
            </div>
          </dl>
          {!onDashboard && (
            <>
              <PunchError />
              <PunchControls compact />
            </>
          )}
          {snapshot.missedCheckoutOn && <p className="text-xs text-break">{t("missedCheckout", { date: snapshot.missedCheckoutOn })}</p>}
        </div>
      )}
      {!open && <div className="pb-3" />}
    </aside>
  );
}

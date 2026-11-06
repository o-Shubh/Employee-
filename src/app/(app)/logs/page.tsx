import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { getMonth } from "@/server/services/attendance";
import { AppError } from "@/server/errors";
import { dbToDateKey, isoWeekday, localDateKey, monthDateKeys } from "@/domain/time";
import { formatHm } from "@/domain/timeline";
import { resolveViewedEmployee } from "@/lib/viewing";
import { PageHeader, cn } from "@/components/ui";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("myLogs") };
}

const STATE_STYLE = {
  CERTIFIED: "border-l-duty",
  CLOSED: "border-l-break",
  MISSED_CHECKOUT: "border-l-danger",
  OPEN: "border-l-field",
} as const;

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ month?: string; employee?: string }> }) {
  const ctx = await requireUser();
  const t = await getTranslations("logs");
  const sp = await searchParams;
  const now = new Date();
  const todayKey = localDateKey(now, ctx.tenant.timezone);
  const [y, m] = (/^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : todayKey.slice(0, 7)).split("-").map(Number) as [number, number];

  let viewed;
  try {
    viewed = await resolveViewedEmployee(ctx, sp.employee);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const records = await getMonth(ctx, viewed.employee.id, y, m, now);
  const byDate = new Map(records.map((r) => [dbToDateKey(r.workDate), r]));
  const days = monthDateKeys(y, m);
  const leading = isoWeekday(days[0]!) - 1;

  const q = (month: string) => `/logs?month=${month}${sp.employee ? `&employee=${sp.employee}` : ""}`;
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  const totals = records.reduce(
    (a, r) => ({ work: a.work + r.workMin, brk: a.brk + r.breakMin, days: a.days + (r.workMin > 0 ? 1 : 0), uncertified: a.uncertified + (r.state === "CLOSED" ? 1 : 0) }),
    { work: 0, brk: 0, days: 0, uncertified: 0 },
  );
  const weekdays = t.raw("weekdays") as string[];

  return (
    <>
      <PageHeader
        title={viewed.isSelf ? t("title") : t("titleFor", { name: viewed.employee.fullName })}
        description={t("description")}
        actions={
          <div className="flex items-center gap-2">
            <Link href={q(shift(-1))} className="rounded-md border border-rule-strong px-3 py-1.5 text-sm hover:bg-surface-2">
              {t("prev")}
            </Link>
            <span className="min-w-36 text-center text-sm font-medium">{monthLabel}</span>
            <Link href={q(shift(1))} className="rounded-md border border-rule-strong px-3 py-1.5 text-sm hover:bg-surface-2">
              {t("next")}
            </Link>
          </div>
        }
      />

      <dl className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-4">
        {[
          [t("daysWorked"), String(totals.days)],
          [t("totalWork"), formatHm(totals.work)],
          [t("totalBreak"), formatHm(totals.brk)],
          [t("awaitingCertification"), String(totals.uncertified)],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface px-4 py-3">
            <dt className="text-xs text-ink-3">{k}</dt>
            <dd className="tabular mt-1 text-lg font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-7 gap-1.5">
          {weekdays.map((w) => (
            <div key={w} className="px-2 pb-1 text-xs font-medium text-ink-3">
              {w}
            </div>
          ))}
          {Array.from({ length: leading }, (_, i) => (
            <div key={`pad${i}`} />
          ))}
          {days.map((key) => {
            const r = byDate.get(key);
            const weekend = isoWeekday(key) >= 6;
            const future = key > todayKey;
            return (
              <Link
                key={key}
                href={`/logs/${key}${sp.employee ? `?employee=${sp.employee}` : ""}`}
                aria-disabled={future}
                className={cn(
                  "flex min-h-24 flex-col rounded-md border border-rule border-l-4 bg-surface p-2 text-sm hover:border-rule-strong",
                  r ? STATE_STYLE[r.state] : "border-l-rule",
                  weekend && !r && "bg-surface-2",
                  future && "pointer-events-none opacity-50",
                  key === todayKey && "ring-1 ring-primary",
                )}
              >
                <span className="tabular text-xs font-medium text-ink-2">{Number(key.slice(8))}</span>
                {r && (
                  <span className="mt-auto space-y-0.5">
                    <span className="tabular block font-semibold">{formatHm(r.workMin)}</span>
                    {r.breakMin > 0 && <span className="tabular block text-xs text-ink-3">{t("breakShort", { time: formatHm(r.breakMin) })}</span>}
                    <span className="block text-xs text-ink-3">{t(`state.${r.state}`)}</span>
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
      <ul className="mt-4 flex flex-wrap gap-4 text-xs text-ink-3">
        {(["CERTIFIED", "CLOSED", "MISSED_CHECKOUT", "OPEN"] as const).map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className={cn("inline-block h-3 w-1 rounded-sm", { CERTIFIED: "bg-duty", CLOSED: "bg-break", MISSED_CHECKOUT: "bg-danger", OPEN: "bg-field" }[s])} />
            {t(`state.${s}`)}
          </li>
        ))}
      </ul>
    </>
  );
}

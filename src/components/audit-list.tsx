import { getTranslations } from "next-intl/server";
import type { AuditEvent } from "@prisma/client";
import { fmtDateTime } from "@/lib/format";
import { EmptyState } from "@/components/ui";

/** Human-readable audit trail. Raw before/after values are available behind "Details". */
export async function AuditList({ events, timezone, emptyText }: { events: AuditEvent[]; timezone: string; emptyText: string }) {
  const t = await getTranslations("audit");
  if (events.length === 0) return <EmptyState title={emptyText} />;
  return (
    <ol className="divide-y divide-rule text-sm">
      {events.map((e) => (
        <li key={e.id} className="py-2.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="tabular text-xs text-ink-3">{fmtDateTime(e.createdAt, timezone)}</span>
            <span className="font-medium">{t.has(`action.${e.action}`) ? t(`action.${e.action}`) : e.action}</span>
            {e.reason && <span className="text-ink-2">{t.has(`reason.${e.reason}`) ? t(`reason.${e.reason}`) : e.reason}</span>}
            {e.ip && <span className="text-xs text-ink-3">{t("ip", { ip: e.ip })}</span>}
          </div>
          {(e.before || e.after) && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-ink-3">{t("details")}</summary>
              <pre className="mt-1 overflow-x-auto rounded bg-surface-2 p-2 text-xs">{JSON.stringify({ before: e.before, after: e.after }, null, 2)}</pre>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}

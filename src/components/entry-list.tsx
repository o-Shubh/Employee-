import { getTranslations } from "next-intl/server";
import type { LogEntry } from "@prisma/client";
import { fmtDateTime, fmtTimeSec } from "@/lib/format";
import { Badge, EmptyState, cn } from "@/components/ui";

const TONE = { CHECK_IN: "duty", ON_DUTY: "duty", BREAK: "break", FIELD_DUTY: "field", CHECK_OUT: "off", VOID: "danger" } as const;

/** Raw, append-only entries exactly as recorded — including back-dated and superseded ones. */
export async function EntryList({
  entries,
  timezone,
  emptyText,
  showPhotos = false,
}: {
  entries: (LogEntry & { superseded: boolean })[];
  timezone: string;
  emptyText: string;
  showPhotos?: boolean;
}) {
  const t = await getTranslations("entries");
  const tl = await getTranslations("logType");
  const tb = await getTranslations("breakKind");
  if (entries.length === 0) return <EmptyState title={emptyText} />;
  return (
    <ol className="divide-y divide-rule">
      {entries.map((e) => {
        const backdated = e.recordedAt.getTime() - e.occurredAt.getTime() > 60_000;
        return (
          <li key={e.id} className={cn("flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5 text-sm", e.superseded && "text-ink-3 line-through")}>
            <span className="tabular w-20 shrink-0 font-medium">{fmtTimeSec(e.occurredAt, timezone)}</span>
            <Badge tone={TONE[e.type]}>{tl(e.type)}</Badge>
            {e.breakKind && <span>{tb(e.breakKind)}</span>}
            {e.note && <span className="text-ink-2">{e.note}</span>}
            <span className="ml-auto flex flex-wrap gap-2 text-xs text-ink-3 no-underline">
              {e.source !== "SELF" && <Badge>{t(`source.${e.source}`)}</Badge>}
              {e.offsite && <Badge tone="break">{t("offsite")}</Badge>}
              {backdated && <span>{t("recordedAt", { time: fmtDateTime(e.recordedAt, timezone) })}</span>}
              {e.superseded && <Badge tone="danger">{t("superseded")}</Badge>}
              {e.ip && <span>{t("ip", { ip: e.ip })}</span>}
              {showPhotos && e.photoKey && (
                <a className="text-primary underline" href={`/api/photos/${e.id}`} target="_blank" rel="noreferrer">
                  {t("photo")}
                </a>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

import { getTranslations } from "next-intl/server";
import type { CorrectionOp } from "@/domain/corrections";
import { fmtTime } from "@/lib/format";

interface EntryLite {
  id: string;
  type: string;
  breakKind: string | null;
  occurredAt: Date;
}

/** Human-readable list of the changes a correction asks for. */
export async function CorrectionOpsList({ ops, entries, timezone }: { ops: CorrectionOp[]; entries: EntryLite[]; timezone: string }) {
  const t = await getTranslations("corrections");
  const tl = await getTranslations("logType");
  const tb = await getTranslations("breakKind");
  const byId = new Map(entries.map((e) => [e.id, e]));
  const label = (type: string, kind?: string | null) => (kind ? `${tl(type)} (${tb(kind)})` : tl(type));
  return (
    <ul className="space-y-0.5 text-sm">
      {ops.map((op, i) => {
        if (op.op === "ADD") return <li key={i}>{t("opAdd", { what: label(op.type, op.breakKind), time: fmtTime(op.occurredAt, timezone) })}{op.note ? `: ${op.note}` : ""}</li>;
        const e = byId.get(op.entryId);
        const what = e ? label(e.type, e.breakKind) : t("unknownEntry");
        const from = e ? fmtTime(e.occurredAt, timezone) : "?";
        if (op.op === "CHANGE_TIME") return <li key={i}>{t("opChange", { what, from, to: fmtTime(op.occurredAt, timezone) })}</li>;
        return <li key={i}>{t("opRemove", { what, time: from })}</li>;
      })}
    </ul>
  );
}

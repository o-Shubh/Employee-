"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { CorrectionOp } from "@/domain/corrections";
import { formatHm } from "@/domain/timeline";
import { BREAK_KINDS, type BreakKind } from "@/domain/types";
import { Button, Input, Notice, Select, Textarea, cn } from "@/components/ui";
import { previewCorrectionAction, requestCorrectionAction } from "@/app/(app)/request-actions";

interface Entry {
  id: string;
  type: "CHECK_IN" | "ON_DUTY" | "BREAK" | "FIELD_DUTY" | "CHECK_OUT";
  breakKind: string | null;
  note: string | null;
  occurredAt: string;
}
type NewRow = { key: number; type: Entry["type"]; local: string; breakKind: string; note: string };

const TYPES: Entry["type"][] = ["CHECK_IN", "ON_DUTY", "BREAK", "FIELD_DUTY", "CHECK_OUT"];

/**
 * Edit a copy of the day: change times, remove entries, add missing ones. Only the
 * differences are sent as a request; nothing changes until a manager approves.
 */
export function CorrectionBuilder({ workDate, timezone, entries, suggestCheckout }: { workDate: string; timezone: string; entries: Entry[]; suggestCheckout: boolean }) {
  const t = useTranslations("corrections");
  const tl = useTranslations("logType");
  const tb = useTranslations("breakKind");
  const te = useTranslations("errors");
  const router = useRouter();
  const toLocal = (iso: string) => formatInTimeZone(new Date(iso), timezone, "yyyy-MM-dd'T'HH:mm");
  const toIso = (local: string) => fromZonedTime(local, timezone).toISOString();

  const [times, setTimes] = useState<Record<string, string>>(() => Object.fromEntries(entries.map((e) => [e.id, toLocal(e.occurredAt)])));
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<NewRow[]>(() =>
    suggestCheckout ? [{ key: 1, type: "CHECK_OUT", local: `${workDate}T18:00`, breakKind: "LUNCH", note: "" }] : entries.length === 0
      ? [{ key: 1, type: "CHECK_IN", local: `${workDate}T09:00`, breakKind: "LUNCH", note: "" }, { key: 2, type: "CHECK_OUT", local: `${workDate}T18:00`, breakKind: "LUNCH", note: "" }]
      : [],
  );
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const ops = useMemo<CorrectionOp[]>(() => {
    const out: CorrectionOp[] = [];
    for (const e of entries) {
      if (removed.has(e.id)) out.push({ op: "REMOVE", entryId: e.id });
      else if (times[e.id] && times[e.id] !== toLocal(e.occurredAt)) out.push({ op: "CHANGE_TIME", entryId: e.id, occurredAt: toIso(times[e.id]!) });
    }
    for (const r of added) {
      if (!r.local) continue;
      out.push({ op: "ADD", type: r.type, occurredAt: toIso(r.local), breakKind: r.type === "BREAK" ? (r.breakKind as BreakKind) : null, note: r.type === "FIELD_DUTY" ? r.note : null });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, times, removed, added]);

  const msg = (code: string) => (te.has(code) ? te(code) : te("UNEXPECTED"));
  const check = () =>
    start(async () => {
      setError(null);
      const r = await previewCorrectionAction({ workDate, ops, reason });
      setPreview(r.ok ? { ok: true, text: t("previewOk", { work: formatHm(Math.floor(r.workSeconds / 60)), brk: formatHm(Math.floor(r.breakSeconds / 60)) }) } : { ok: false, text: msg(r.code) });
    });
  const submit = () =>
    start(async () => {
      const r = await requestCorrectionAction({ workDate, ops, reason });
      if (!r.ok) setError(r.code);
      else router.push(`/logs/${workDate}?corrected=1`);
    });

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold">{t("recorded")}</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-ink-3">{t("nothingRecorded")}</p>
        ) : (
          <ul className="divide-y divide-rule rounded-md border border-rule">
            {entries.map((e) => {
              const isRemoved = removed.has(e.id);
              return (
                <li key={e.id} className={cn("flex flex-wrap items-center gap-3 px-3 py-2 text-sm", isRemoved && "bg-danger-soft")}>
                  <span className={cn("w-36 font-medium", isRemoved && "line-through")}>
                    {tl(e.type)}
                    {e.breakKind && ` (${tb(e.breakKind)})`}
                  </span>
                  <Input type="datetime-local" aria-label={t("timeFor", { what: tl(e.type) })} value={times[e.id]} disabled={isRemoved}
                    onChange={(ev) => setTimes((x) => ({ ...x, [e.id]: ev.target.value }))} className="h-9 w-56" />
                  <label className="ml-auto flex items-center gap-2 text-ink-2">
                    <input type="checkbox" className="size-4" checked={isRemoved}
                      onChange={(ev) => setRemoved((s) => { const n = new Set(s); if (ev.target.checked) n.add(e.id); else n.delete(e.id); return n; })} />
                    {t("remove")}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{t("addMissing")}</h2>
        <ul className="space-y-2">
          {added.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center gap-2">
              <Select aria-label={t("entryType")} value={r.type} className="h-9 w-40"
                onChange={(ev) => setAdded((a) => a.map((x) => (x.key === r.key ? { ...x, type: ev.target.value as Entry["type"] } : x)))}>
                {TYPES.map((ty) => <option key={ty} value={ty}>{tl(ty)}</option>)}
              </Select>
              {r.type === "BREAK" && (
                <Select aria-label={t("breakType")} value={r.breakKind} className="h-9 w-32"
                  onChange={(ev) => setAdded((a) => a.map((x) => (x.key === r.key ? { ...x, breakKind: ev.target.value } : x)))}>
                  {BREAK_KINDS.map((k) => <option key={k} value={k}>{tb(k)}</option>)}
                </Select>
              )}
              <Input type="datetime-local" aria-label={t("time")} value={r.local} className="h-9 w-56"
                onChange={(ev) => setAdded((a) => a.map((x) => (x.key === r.key ? { ...x, local: ev.target.value } : x)))} />
              {r.type === "FIELD_DUTY" && (
                <Input aria-label={t("fieldNote")} placeholder={t("fieldNote")} value={r.note} className="h-9 w-56"
                  onChange={(ev) => setAdded((a) => a.map((x) => (x.key === r.key ? { ...x, note: ev.target.value } : x)))} />
              )}
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdded((a) => a.filter((x) => x.key !== r.key))}>
                {t("removeRow")}
              </Button>
            </li>
          ))}
        </ul>
        <Button type="button" variant="secondary" size="sm" className="mt-2"
          onClick={() => setAdded((a) => [...a, { key: Date.now(), type: "CHECK_OUT", local: `${workDate}T18:00`, breakKind: "LUNCH", note: "" }])}>
          {t("addRow")}
        </Button>
      </section>

      <section className="space-y-2">
        <label htmlFor="corr-reason" className="block text-sm font-semibold">{t("reason")}</label>
        <Textarea id="corr-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={t("reasonPlaceholder")} />
      </section>

      {preview && <Notice tone={preview.ok ? "info" : "error"}>{preview.text}</Notice>}
      {error && <Notice tone="error">{msg(error)}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={check} disabled={pending || ops.length === 0}>{t("check")}</Button>
        <Button type="button" onClick={submit} disabled={pending || ops.length === 0 || reason.trim().length < 5}>{t("submit")}</Button>
      </div>
      <p className="text-xs text-ink-3">{t("footnote")}</p>
    </div>
  );
}

"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { applyLeaveAction, previewLeaveAction } from "@/app/(app)/request-actions";

export function ApplyLeaveForm({ types, today }: { types: { id: string; name: string; code: string; halfDayAllowed: boolean; available: number | null }[]; today: string }) {
  const t = useTranslations("leave");
  const te = useTranslations("errors");
  const [state, action, pending] = useActionState(applyLeaveAction, undefined);
  const form = useRef<HTMLFormElement>(null);
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [span, setSpan] = useState({ startDate: today, endDate: today, halfDayStart: false, halfDayEnd: false });
  const [preview, setPreview] = useState<{ days?: number; code?: string } | null>(null);
  const type = types.find((x) => x.id === typeId);
  const single = span.startDate === span.endDate;

  useEffect(() => {
    let live = true;
    if (!span.startDate || !span.endDate) return;
    previewLeaveAction(span).then((r) => live && setPreview(r.ok ? { days: r.days } : { code: r.code }));
    return () => {
      live = false;
    };
  }, [span]);
  useEffect(() => {
    if (state?.ok) {
      form.current?.reset();
      setSpan({ startDate: today, endDate: today, halfDayStart: false, halfDayEnd: false });
    }
  }, [state, today]);

  return (
    <form ref={form} action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("type")} htmlFor="leaveTypeId">
          <Select id="leaveTypeId" name="leaveTypeId" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} ({x.code}){x.available !== null ? `, ${t("availableShort", { days: x.available })}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("from")} htmlFor="startDate">
          <Input id="startDate" name="startDate" type="date" required value={span.startDate}
            onChange={(e) => setSpan((s) => ({ ...s, startDate: e.target.value, endDate: s.endDate < e.target.value ? e.target.value : s.endDate }))} />
        </Field>
        <Field label={t("to")} htmlFor="endDate">
          <Input id="endDate" name="endDate" type="date" required min={span.startDate} value={span.endDate}
            onChange={(e) => setSpan((s) => ({ ...s, endDate: e.target.value }))} />
        </Field>
      </div>
      {type?.halfDayAllowed && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="halfDayStart" className="size-4" checked={span.halfDayStart}
              onChange={(e) => setSpan((s) => ({ ...s, halfDayStart: e.target.checked, halfDayEnd: single && e.target.checked ? false : s.halfDayEnd }))} />
            {single ? t("secondHalfOnly") : t("startSecondHalf")}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="halfDayEnd" className="size-4" checked={span.halfDayEnd}
              onChange={(e) => setSpan((s) => ({ ...s, halfDayEnd: e.target.checked, halfDayStart: single && e.target.checked ? false : s.halfDayStart }))} />
            {single ? t("firstHalfOnly") : t("endFirstHalf")}
          </label>
        </div>
      )}
      <Field label={t("reason")} htmlFor="reason">
        <Textarea id="reason" name="reason" rows={2} required minLength={3} maxLength={500} placeholder={t("reasonPlaceholder")} />
      </Field>
      <p className="text-sm text-ink-2" aria-live="polite">
        {preview?.days !== undefined ? t("willUse", { days: preview.days }) : preview?.code ? te.has(preview.code) ? te(preview.code) : "" : ""}
      </p>
      {state?.ok === false && state.code && <Notice tone="error">{te.has(state.code) ? te(state.code) : te("UNEXPECTED")}</Notice>}
      {state?.ok && <Notice tone="success">{t("submitted")}</Notice>}
      <Button type="submit" disabled={pending || !preview?.days}>
        {t("submit")}
      </Button>
    </form>
  );
}

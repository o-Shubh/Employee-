"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { allowedActions } from "@/domain/status-machine";
import { BREAK_KINDS, type BreakKind } from "@/domain/types";
import { Button, Input, cn } from "@/components/ui";
import { Modal } from "@/components/modal";
import { PhotoCapture } from "./photo-capture";
import { useStatus } from "./status-provider";

/** Status-change buttons. `compact` = floating widget; otherwise the dashboard version. */
export function PunchControls({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("punch");
  const tb = useTranslations("breakKind");
  const { snapshot, punch, busy } = useStatus();
  const [mode, setMode] = useState<null | "break" | "field" | "photo" | "checkout">(null);
  const [note, setNote] = useState("");
  const actions = allowedActions(snapshot.status);
  const size = compact ? "sm" : "md";

  const checkIn = () => (snapshot.requirePhoto ? setMode("photo") : void punch({ type: "CHECK_IN" }));
  const close = () => setMode(null);

  return (
    <>
      <div className={cn("flex flex-wrap gap-2", compact && "gap-1.5")}>
        {actions.includes("CHECK_IN") && (
          <Button size={compact ? "sm" : "lg"} onClick={checkIn} disabled={busy} variant="duty">
            {t("checkIn")}
          </Button>
        )}
        {actions.includes("ON_DUTY") && (
          <Button size={size} onClick={() => punch({ type: "ON_DUTY" })} disabled={busy} variant="duty">
            {snapshot.status === "BREAK" ? t("endBreak") : t("backOnDuty")}
          </Button>
        )}
        {actions.includes("BREAK") && (
          <Button size={size} variant="secondary" onClick={() => setMode("break")} disabled={busy}>
            {snapshot.status === "BREAK" ? t("changeBreak") : t("startBreak")}
          </Button>
        )}
        {actions.includes("FIELD_DUTY") && (
          <Button size={size} variant="secondary" onClick={() => setMode("field")} disabled={busy}>
            {t("fieldDuty")}
          </Button>
        )}
        {actions.includes("CHECK_OUT") && (
          <Button size={size} variant="secondary" onClick={() => setMode("checkout")} disabled={busy}>
            {t("checkOut")}
          </Button>
        )}
      </div>

      <Modal open={mode === "break"} onClose={close} title={t("breakTitle")}>
        <div className="grid grid-cols-3 gap-2">
          {BREAK_KINDS.filter((k) => !(snapshot.status === "BREAK" && snapshot.currentBreakKind === k)).map((k: BreakKind) => (
            <Button
              key={k}
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                const r = await punch({ type: "BREAK", breakKind: k });
                if (r.ok) close();
              }}
            >
              {tb(k)}
            </Button>
          ))}
        </div>
      </Modal>

      <Modal open={mode === "field"} onClose={close} title={t("fieldTitle")}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await punch({ type: "FIELD_DUTY", note });
            if (r.ok) {
              setNote("");
              close();
            }
          }}
        >
          <label htmlFor="field-note" className="block text-sm text-ink-2">
            {t("fieldNoteLabel")}
          </label>
          <Input id="field-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} required placeholder={t("fieldNotePlaceholder")} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy || note.trim().length < 2}>
              {t("startField")}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={mode === "checkout"} onClose={close} title={t("checkOutTitle")}>
        <p className="text-sm text-ink-2">{t("checkOutConfirm")}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            {t("cancel")}
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              const r = await punch({ type: "CHECK_OUT" });
              if (r.ok) close();
            }}
          >
            {t("checkOut")}
          </Button>
        </div>
      </Modal>

      <Modal open={mode === "photo"} onClose={close} title={t("photoTitle")}>
        {mode === "photo" && (
          <PhotoCapture
            busy={busy}
            onCancel={close}
            onCapture={async (photo) => {
              const r = await punch({ type: "CHECK_IN", photo });
              if (r.ok) close();
            }}
          />
        )}
      </Modal>
    </>
  );
}

export function PunchError() {
  const { error, clearError } = useStatus();
  const t = useTranslations("errors");
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-ink">
      <span>{t.has(error) ? t(error) : t("UNEXPECTED")}</span>
      <button type="button" onClick={clearError} className="text-ink-3 hover:text-ink" aria-label={t("dismiss")}>
        ×
      </button>
    </div>
  );
}

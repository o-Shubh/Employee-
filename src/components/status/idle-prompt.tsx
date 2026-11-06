"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { BREAK_KINDS } from "@/domain/types";
import { Button, Select } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useStatus } from "./status-provider";
import { PunchError } from "./punch-controls";
import { clock } from "@/lib/status-snapshot";

/** "Were you on a break?" — the employee decides. Time is never deducted automatically. */
export function IdlePrompt() {
  const t = useTranslations("idle");
  const tb = useTranslations("breakKind");
  const { idleSince, answerIdle, busy, snapshot } = useStatus();
  const [kind, setKind] = useState("PERSONAL");
  if (idleSince === null) return null;
  const since = clock(idleSince, snapshot.timezone);
  return (
    <Modal open onClose={() => void answerIdle(false)} title={t("title")}>
      <p className="text-sm text-ink-2">{t("body", { since })}</p>
      <div className="mt-4 space-y-1.5">
        <label htmlFor="idle-kind" className="text-sm font-medium">
          {t("kindLabel")}
        </label>
        <Select id="idle-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {BREAK_KINDS.map((k) => (
            <option key={k} value={k}>
              {tb(k)}
            </option>
          ))}
        </Select>
      </div>
      <p className="mt-3 text-xs text-ink-3">{t("note")}</p>
      <div className="mt-3">
        <PunchError />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => answerIdle(false)} disabled={busy}>
          {t("no")}
        </Button>
        <Button onClick={() => answerIdle(true, kind)} disabled={busy}>
          {t("yes")}
        </Button>
      </div>
    </Modal>
  );
}

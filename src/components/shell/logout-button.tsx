"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { logoutAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useStatus } from "@/components/status/status-provider";

/** Reminds the employee to check out before logging out. */
export function LogoutButton() {
  const t = useTranslations("shell");
  const { snapshot, punch, busy } = useStatus();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const logout = () => start(() => logoutAction());
  return (
    <>
      <button
        type="button"
        className="rounded-md px-2 py-1.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink"
        onClick={() => (snapshot.status === "OFF" ? logout() : setOpen(true))}
        disabled={pending}
      >
        {t("logout")}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("stillCheckedInTitle")}>
        <p className="text-sm text-ink-2">{t("stillCheckedInBody")}</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button variant="secondary" onClick={logout} disabled={pending}>
            {t("logoutAnyway")}
          </Button>
          <Button
            disabled={busy || pending}
            onClick={async () => {
              const r = await punch({ type: "CHECK_OUT" });
              if (r.ok) logout();
            }}
          >
            {t("checkOutAndLogout")}
          </Button>
        </div>
      </Modal>
    </>
  );
}

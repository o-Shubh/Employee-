"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";

/** Adds the address the server sees for this browser to the form's allowed-networks box. */
export function UseMyNetwork({ ip, isPrivate }: { ip: string | null; isPrivate: boolean }) {
  const t = useTranslations("admin.locations");
  const ref = useRef<HTMLDivElement>(null);
  const [added, setAdded] = useState(false);
  if (!ip) return <p className="text-xs text-ink-3">{t("ipUnknown")}</p>;
  const cidr = ip.includes(":") ? `${ip}/128` : `${ip}/32`;
  return (
    <div ref={ref} className="space-y-1 rounded-md bg-surface-2 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink-2">{t("yourAddress", { ip })}</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={added}
          onClick={() => {
            const area = ref.current?.closest("form")?.querySelector<HTMLTextAreaElement>("textarea[name=cidrs]");
            if (!area) return;
            const lines = area.value.split(/\s+/).filter(Boolean);
            if (!lines.includes(cidr)) area.value = [...lines, cidr].join("\n");
            setAdded(true);
          }}
        >
          {added ? t("added") : t("useMyNetwork")}
        </Button>
      </div>
      <p className="text-ink-3">{isPrivate ? t("privateWarning") : t("publicHint")}</p>
    </div>
  );
}

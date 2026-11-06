"use client";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useTranslations("shell");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="rounded-md px-2 py-1.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink"
      aria-label={dark ? t("lightMode") : t("darkMode")}
    >
      {mounted ? (dark ? t("lightMode") : t("darkMode")) : t("darkMode")}
    </button>
  );
}

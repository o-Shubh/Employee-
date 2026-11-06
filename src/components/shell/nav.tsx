"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/components/ui";

export interface NavGroup {
  label: string; // i18n key in "nav"
  items: { href: string; label: string; badge?: number }[];
}

export function Nav({ groups }: { groups: NavGroup[] }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <nav className="space-y-6">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="px-3 pb-1.5 text-xs font-medium text-ink-3">{t(g.label)}</p>
          <ul className="space-y-0.5">
            {g.items.map((i) => {
              const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-3 py-1.5 text-sm",
                      active ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      {t(i.label)}
                      {!!i.badge && (
                        <span className="tabular rounded-full bg-break px-1.5 text-xs font-semibold text-white" aria-label={t("pendingCount", { count: i.badge })}>
                          {i.badge}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

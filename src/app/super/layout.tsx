import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSuperAdmin } from "@/server/auth/session";
import { logoutAction } from "@/app/(app)/actions";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function SuperLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSuperAdmin();
  if (user.mustChangePassword) redirect("/change-password");
  const t = await getTranslations("super");
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-6 px-4 py-3 md:px-8">
          <p className="font-semibold tracking-tight">{t("brand")}</p>
          <nav className="flex gap-4 text-sm">
            <Link href="/super" className="text-ink-2 hover:text-ink">
              {t("tenants")}
            </Link>
            <Link href="/super/plans" className="text-ink-2 hover:text-ink">
              {t("plans")}
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm text-ink-3">
            <span>{user.email}</span>
            <ThemeToggle />
            <form action={logoutAction}>
              <button className="rounded-md px-2 py-1.5 text-ink-2 hover:bg-surface-2">{t("logout")}</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">{children}</main>
    </div>
  );
}

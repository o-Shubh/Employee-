import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { getStatusSnapshot } from "@/server/services/status";
import { pendingApprovalCount } from "@/server/services/team";
import { unreadCount } from "@/server/services/notifications";
import { StatusProvider } from "@/components/status/status-provider";
import { StatusWidget } from "@/components/status/status-widget";
import { IdlePrompt } from "@/components/status/idle-prompt";
import { Nav, type NavGroup } from "@/components/shell/nav";
import { LogoutButton } from "@/components/shell/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import type { StatusSnapshot } from "@/lib/status-snapshot";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUser();
  const t = await getTranslations("shell");
  const now = new Date();
  const snapshot: StatusSnapshot = (await getStatusSnapshot(ctx, now)) ?? {
    status: "OFF", statusSince: null, currentBreakKind: null, workSeconds: 0, breakSeconds: 0, fieldSeconds: 0, firstInAt: null,
    asOf: now.toISOString(), workDate: "", timezone: ctx.tenant.timezone, idleTimeoutMin: ctx.tenant.idleTimeoutMin,
    requirePhoto: false, missedCheckoutOn: null, certifyDate: null, leaveToday: null,
  };

  const role = ctx.actor.role;
  const unread = await unreadCount(ctx);
  const groups: NavGroup[] = [
    {
      label: "me",
      items: [
        { href: "/dashboard", label: "dashboard" },
        { href: "/notifications", label: "notifications", badge: unread },
        { href: "/logs", label: "myLogs" },
        { href: "/leave", label: "leave" },
        { href: "/requests", label: "requests" },
        { href: "/device", label: "device" },
        { href: "/privacy", label: "privacy" },
        { href: "/account", label: "account" },
      ],
    },
  ];
  if (role === "MANAGER" || role === "COMPANY_ADMIN") {
    const pending = await pendingApprovalCount(ctx);
    groups.push({ label: "team", items: [{ href: "/team", label: "teamToday" }, { href: "/approvals", label: "approvals", badge: pending }] });
  }
  if (role === "COMPANY_ADMIN") {
    groups.push({
      label: "admin",
      items: [
        { href: "/admin/employees", label: "employees" },
        { href: "/admin/departments", label: "departments" },
        { href: "/admin/locations", label: "locations" },
        { href: "/admin/devices", label: "devices" },
        { href: "/admin/leave-types", label: "leaveTypes" },
        { href: "/admin/audit", label: "audit" },
        { href: "/admin/settings", label: "settings" },
      ],
    });
  }

  return (
    <StatusProvider initial={snapshot}>
      <div className="flex min-h-dvh flex-col md:flex-row">
        <aside className="border-b border-rule bg-surface md:sticky md:top-0 md:h-dvh md:w-60 md:shrink-0 md:border-b-0 md:border-r">
          <div className="flex h-full flex-col gap-6 p-4">
            <div>
              <p className="text-base font-semibold tracking-tight text-ink">WorkLog</p>
              <p className="truncate text-xs text-ink-3">{ctx.tenant.name}</p>
            </div>
            <div className="hidden md:block">
              <Nav groups={groups} />
            </div>
            <details className="md:hidden">
              <summary className="cursor-pointer text-sm text-ink-2">{t("menu")}</summary>
              <div className="mt-3">
                <Nav groups={groups} />
              </div>
            </details>
            <div className="mt-auto space-y-1 border-t border-rule pt-4">
              <p className="truncate text-sm font-medium text-ink">{ctx.user.employee?.fullName ?? ctx.user.email}</p>
              <p className="truncate text-xs text-ink-3">{t(`role.${role}`)}</p>
              <div className="flex flex-wrap gap-1 pt-2">
                <ThemeToggle />
                <LogoutButton />
              </div>
            </div>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 pb-24 pt-6 md:px-8 md:pt-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
      {ctx.actor.employeeId && <StatusWidget />}
      <IdlePrompt />
    </StatusProvider>
  );
}

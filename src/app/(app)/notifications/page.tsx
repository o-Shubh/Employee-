import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { listNotifications, renderNotification, type NotifyParams } from "@/server/services/notifications";
import { fmtDateTime } from "@/lib/format";
import { Button, EmptyState, PageHeader, cn } from "@/components/ui";
import { markAllReadAction } from "@/app/(app)/account-actions";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("notifications") };
}

export default async function NotificationsPage() {
  const ctx = await requireUser();
  const t = await getTranslations("notificationsPage");
  const items = await listNotifications(ctx);
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <>
      <PageHeader
        title={t("title")}
        description={unread ? t("unread", { count: unread }) : t("allRead")}
        actions={
          unread > 0 && (
            <form action={markAllReadAction}>
              <Button variant="secondary" size="sm">
                {t("markAllRead")}
              </Button>
            </form>
          )
        }
      />
      {items.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <ul className="divide-y divide-rule rounded-lg border border-rule bg-surface">
          {items.map((n) => {
            const { title, body } = renderNotification(n.kind, n.params as NotifyParams);
            const inner = (
              <>
                <p className={cn("text-sm", !n.readAt && "font-semibold")}>{title}</p>
                {body && <p className="mt-0.5 text-sm text-ink-2">{body}</p>}
                <p className="mt-1 text-xs text-ink-3">{fmtDateTime(n.createdAt, ctx.tenant.timezone)}</p>
              </>
            );
            return (
              <li key={n.id} className={cn("px-5 py-3", !n.readAt && "border-l-4 border-l-primary")}>
                {n.link ? (
                  <Link href={n.link} className="block hover:opacity-80">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

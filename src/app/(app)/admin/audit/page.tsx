import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { addDaysKey, isDateKey, localDateKey, startOfLocalDay } from "@/domain/time";
import { fmtDateTime } from "@/lib/format";
import { Button, EmptyState, Input, PageHeader, Select, Table } from "@/components/ui";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("audit") };
}

const PAGE = 100;

/** Company-wide audit trail with filters. Read-only: the table itself is append-only. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ employee?: string; action?: string; from?: string; to?: string; page?: string }> }) {
  const ctx = await requireUser({ roles: ["COMPANY_ADMIN"] });
  const t = await getTranslations("admin.audit");
  const ta = await getTranslations("audit");
  const sp = await searchParams;
  const tz = ctx.tenant.timezone;
  const today = localDateKey(new Date(), tz);
  const from = sp.from && isDateKey(sp.from) ? sp.from : addDaysKey(today, -30);
  const to = sp.to && isDateKey(sp.to) ? sp.to : today;
  const page = Math.max(1, Number(sp.page) || 1);

  const where = {
    createdAt: { gte: startOfLocalDay(from, tz), lt: startOfLocalDay(addDaysKey(to, 1), tz) },
    ...(sp.employee ? { subjectEmployeeId: sp.employee } : {}),
    ...(sp.action ? { action: { startsWith: sp.action } } : {}),
  };
  const [events, total, employees, users] = await Promise.all([
    ctx.db.auditEvent.findMany({ where, orderBy: { createdAt: "desc" }, take: PAGE, skip: (page - 1) * PAGE }),
    ctx.db.auditEvent.count({ where }),
    ctx.db.employee.findMany({ orderBy: { fullName: "asc" }, select: { id: true, fullName: true, employeeCode: true, userId: true } }),
    ctx.db.user.findMany({ select: { id: true, email: true } }),
  ]);
  const empName = new Map(employees.map((e) => [e.id, e.fullName]));
  const actorName = new Map(employees.map((e) => [e.userId, e.fullName]));
  const userEmail = new Map(users.map((u) => [u.id, u.email]));
  const groups = ["attendance", "day", "leave", "correction", "overtime", "device", "employee", "user", "auth", "consent", "privacy", "photo", "location", "department", "leave_type"];
  const q = (p: number) => {
    const u = new URLSearchParams({ from, to, page: String(p) });
    if (sp.employee) u.set("employee", sp.employee);
    if (sp.action) u.set("action", sp.action);
    return `/admin/audit?${u}`;
  };

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <form className="mb-6 grid gap-3 rounded-lg border border-rule bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto]">
        <Select name="employee" defaultValue={sp.employee ?? ""} aria-label={t("employee")}>
          <option value="">{t("anyone")}</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.fullName} ({e.employeeCode})
            </option>
          ))}
        </Select>
        <Select name="action" defaultValue={sp.action ?? ""} aria-label={t("category")}>
          <option value="">{t("allCategories")}</option>
          {groups.map((g) => (
            <option key={g} value={`${g}.`}>
              {t(`group.${g}`)}
            </option>
          ))}
        </Select>
        <Input type="date" name="from" defaultValue={from} aria-label={t("from")} />
        <Input type="date" name="to" defaultValue={to} aria-label={t("to")} />
        <Button type="submit" variant="secondary">
          {t("filter")}
        </Button>
      </form>
      <p className="mb-3 text-sm text-ink-3">{t("count", { count: total })}</p>
      {events.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t("when")}</th>
              <th>{t("event")}</th>
              <th>{t("about")}</th>
              <th>{t("by")}</th>
              <th>{t("ip")}</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="tabular whitespace-nowrap text-xs">{fmtDateTime(e.createdAt, tz)}</td>
                <td>
                  <span className="font-medium">{ta.has(`action.${e.action}`) ? ta(`action.${e.action}`) : e.action}</span>
                  {e.reason && <span className="block text-xs text-ink-2">{ta.has(`reason.${e.reason}`) ? ta(`reason.${e.reason}`) : e.reason}</span>}
                  {(e.before || e.after) && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-ink-3">{ta("details")}</summary>
                      <pre className="mt-1 max-w-xl overflow-x-auto rounded bg-surface-2 p-2 text-xs">{JSON.stringify({ before: e.before, after: e.after }, null, 2)}</pre>
                    </details>
                  )}
                </td>
                <td className="text-sm">{e.subjectEmployeeId ? empName.get(e.subjectEmployeeId) ?? "—" : "—"}</td>
                <td className="text-sm">{e.actorUserId ? actorName.get(e.actorUserId) ?? userEmail.get(e.actorUserId) ?? t("platform") : t("system")}</td>
                <td className="tabular text-xs text-ink-3">{e.ip ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="mt-4 flex gap-3 text-sm">
        {page > 1 && <Link href={q(page - 1)} className="text-primary hover:underline">{t("newer")}</Link>}
        {page * PAGE < total && <Link href={q(page + 1)} className="text-primary hover:underline">{t("older")}</Link>}
      </div>
    </>
  );
}

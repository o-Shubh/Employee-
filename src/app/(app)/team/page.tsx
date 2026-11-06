import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { getShiftState } from "@/server/services/attendance";
import { formatDuration } from "@/domain/timeline";
import { fmtTime } from "@/lib/format";
import { Badge, EmptyState, PageHeader, STATUS_TONE, Table } from "@/components/ui";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("teamToday") };
}

/** Phase 1 team view (read-only). Phase 2 turns this into the live board with leave + approvals. */
export default async function TeamPage() {
  const ctx = await requireUser({ roles: ["MANAGER", "COMPANY_ADMIN"] });
  const t = await getTranslations("team");
  const ts = await getTranslations("status");
  const now = new Date();
  const people = await ctx.db.employee.findMany({
    where: { status: "ACTIVE", ...(ctx.actor.role === "MANAGER" ? { managerId: ctx.actor.employeeId ?? "-" } : {}) },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, employeeCode: true, designation: true },
  });
  const rows = await Promise.all(people.map(async (p) => ({ p, s: await getShiftState(ctx, p.id, now) })));
  const counts = rows.reduce<Record<string, number>>((a, r) => ((a[r.s.status] = (a[r.s.status] ?? 0) + 1), a), {});
  const tz = ctx.tenant.timezone;

  return (
    <>
      <PageHeader title={t("title")} description={ctx.actor.role === "MANAGER" ? t("descriptionManager") : t("descriptionAdmin")} />
      <ul className="mb-6 flex flex-wrap gap-2">
        {(["ON_DUTY", "BREAK", "FIELD_DUTY", "OFF"] as const).map((s) => (
          <li key={s}>
            <Badge tone={STATUS_TONE[s]}>
              {ts(s)}: {counts[s] ?? 0}
            </Badge>
          </li>
        ))}
      </ul>
      {rows.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t("employee")}</th>
              <th>{t("status")}</th>
              <th>{t("since")}</th>
              <th>{t("firstIn")}</th>
              <th>{t("worked")}</th>
              <th>{t("break")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, s }) => (
              <tr key={p.id}>
                <td>
                  <span className="font-medium">{p.fullName}</span>
                  <span className="block text-xs text-ink-3">
                    {p.employeeCode}
                    {p.designation ? `, ${p.designation}` : ""}
                  </span>
                </td>
                <td>
                  <Badge tone={STATUS_TONE[s.status]}>{ts(s.status)}</Badge>
                  {s.missedCheckoutOn && <span className="ml-2 text-xs text-danger">{t("missedCheckout")}</span>}
                </td>
                <td className="tabular">{s.status !== "OFF" && s.computation.statusSince ? fmtTime(s.computation.statusSince, tz) : "—"}</td>
                <td className="tabular">{s.computation.firstInAt ? fmtTime(s.computation.firstInAt, tz) : "—"}</td>
                <td className="tabular">{formatDuration(s.computation.workSeconds)}</td>
                <td className="tabular">{formatDuration(s.computation.breakSeconds)}</td>
                <td>
                  <Link className="text-sm text-primary hover:underline" href={`/logs?employee=${p.id}`}>
                    {t("viewLogs")}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

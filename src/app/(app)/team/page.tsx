import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { pendingApprovalCount, teamBoard, type BoardStatus } from "@/server/services/team";
import { formatDuration } from "@/domain/timeline";
import { fmtTime } from "@/lib/format";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, EmptyState, Notice, PageHeader, Table, cn } from "@/components/ui";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("teamToday") };
}

const TONE: Record<BoardStatus, "duty" | "break" | "field" | "off" | "neutral"> = { ON_DUTY: "duty", BREAK: "break", FIELD_DUTY: "field", OFF: "off", ON_LEAVE: "neutral" };
const ORDER: BoardStatus[] = ["ON_DUTY", "FIELD_DUTY", "BREAK", "ON_LEAVE", "OFF"];
const BAR: Record<BoardStatus, string> = { ON_DUTY: "bg-duty", BREAK: "bg-break", FIELD_DUTY: "bg-field", OFF: "bg-off", ON_LEAVE: "bg-rule-strong" };

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireUser({ roles: ["MANAGER", "COMPANY_ADMIN"] });
  const t = await getTranslations("team");
  const tb = await getTranslations("board");
  const now = new Date();
  const { status: filter } = await searchParams;
  const [rows, pending] = await Promise.all([teamBoard(ctx, now), pendingApprovalCount(ctx)]);
  const counts = Object.fromEntries(ORDER.map((s) => [s, rows.filter((r) => r.board === s).length])) as Record<BoardStatus, number>;
  const shown = rows
    .filter((r) => !filter || r.board === filter)
    .sort((a, b) => ORDER.indexOf(a.board) - ORDER.indexOf(b.board) || a.person.fullName.localeCompare(b.person.fullName));
  const tz = ctx.tenant.timezone;

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader title={t("title")} description={ctx.actor.role === "MANAGER" ? t("descriptionManager") : t("descriptionAdmin")} />
      <div className="space-y-6">
        {pending > 0 && (
          <Notice tone="warning">
            {t.rich("pendingApprovals", { count: pending, link: (c) => <Link href="/approvals" className="font-medium underline">{c}</Link> })}
          </Notice>
        )}
        {rows.length > 0 && (
          <div>
            <div className="flex h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              {ORDER.map((s) => counts[s] > 0 && <div key={s} className={BAR[s]} style={{ width: `${(counts[s] / rows.length) * 100}%` }} />)}
            </div>
            <ul className="mt-3 flex flex-wrap gap-2 text-sm">
              <li>
                <Link href="/team" className={cn("rounded-md border px-2.5 py-1", !filter ? "border-ink bg-surface font-medium" : "border-rule hover:bg-surface-2")}>
                  {tb("all", { count: rows.length })}
                </Link>
              </li>
              {ORDER.map((s) => (
                <li key={s}>
                  <Link href={`/team?status=${s}`} className={cn("rounded-md border px-2.5 py-1", filter === s ? "border-ink bg-surface font-medium" : "border-rule hover:bg-surface-2")}>
                    {tb(s)}: <span className="tabular">{counts[s]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {shown.length === 0 ? (
          <EmptyState title={rows.length === 0 ? t("empty") : t("noneInFilter")} />
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
              {shown.map(({ person: p, shift: s, board, leave }) => (
                <tr key={p.id}>
                  <td>
                    <span className="font-medium">{p.fullName}</span>
                    <span className="block text-xs text-ink-3">
                      {p.employeeCode}
                      {p.designation ? `, ${p.designation}` : ""}
                    </span>
                  </td>
                  <td>
                    <Badge tone={TONE[board]}>{tb(board)}</Badge>
                    {leave && (board !== "ON_LEAVE" || leave.halfDay) && (
                      <span className="ml-2 text-xs text-ink-3">{leave.halfDay ? t("halfDayLeave", { type: leave.code }) : t("leaveToday", { type: leave.code })}</span>
                    )}
                    {board === "ON_LEAVE" && !leave?.halfDay && <span className="ml-2 text-xs text-ink-3">{leave?.name}</span>}
                    {s.missedCheckoutOn && <span className="ml-2 text-xs text-danger">{t("missedCheckout")}</span>}
                    {board === "FIELD_DUTY" && s.entries.at(-1)?.note && <span className="block text-xs text-ink-3">{s.entries.at(-1)?.note}</span>}
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
        <p className="text-xs text-ink-3">{t("refreshNote")}</p>
      </div>
    </>
  );
}

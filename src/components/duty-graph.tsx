import { startOfLocalDay, formatLocal } from "@/domain/time";
import type { WorkStatus } from "@/domain/types";

export interface GraphSegment {
  status: Exclude<WorkStatus, "OFF">;
  start: string; // ISO
  end: string | null; // null = still running
  unbounded?: boolean;
}

export interface DutyGraphLabels {
  rows: Record<WorkStatus, string>;
  total: string;
  title: string;
  /** e.g. "Unknown — no check-out recorded" */
  unbounded: string;
}

const ROWS: WorkStatus[] = ["OFF", "BREAK", "ON_DUTY", "FIELD_DUTY"];
const STROKE: Record<WorkStatus, string> = {
  OFF: "var(--off)",
  BREAK: "var(--break)",
  ON_DUTY: "var(--duty)",
  FIELD_DUTY: "var(--field)",
};

const H = 3600_000;
const LABEL_W = 92;
const TOTAL_W = 64;
const CELL_W = 30;
const ROW_H = 30;
const TOP = 22;

function hm(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * The logbook's signature view: a 24-hour grid with a step line through the
 * four duty rows, like a paper ELD log. Pure SVG; renders on server or client.
 */
export function DutyGraph({
  dateKey,
  timezone,
  segments,
  now,
  labels,
}: {
  dateKey: string;
  timezone: string;
  segments: GraphSegment[];
  now: number;
  labels: DutyGraphLabels;
}) {
  const dayStart = startOfLocalDay(dateKey, timezone).getTime();
  const resolved = segments.map((s) => ({
    ...s,
    s: Date.parse(s.start),
    e: s.end ? Date.parse(s.end) : now,
  }));
  const lastEnd = Math.max(dayStart + 24 * H, ...resolved.map((r) => r.e));
  const hours = Math.min(36, Math.ceil((lastEnd - dayStart) / H)); // night shifts can extend the grid
  const windowEnd = dayStart + hours * H;
  const gridW = hours * CELL_W;
  const width = LABEL_W + gridW + TOTAL_W;
  const height = TOP + ROWS.length * ROW_H + 8;
  const x = (t: number) => LABEL_W + ((Math.min(Math.max(t, dayStart), windowEnd) - dayStart) / H) * CELL_W;
  const rowY = (st: WorkStatus) => TOP + ROWS.indexOf(st) * ROW_H + ROW_H / 2;

  // Totals per row; whatever isn't logged in the elapsed window is "off".
  const totals: Record<WorkStatus, number> = { OFF: 0, BREAK: 0, ON_DUTY: 0, FIELD_DUTY: 0 };
  for (const r of resolved) totals[r.status] += Math.max(0, r.e - r.s);
  const elapsedEnd = Math.min(windowEnd, Math.max(now, dayStart));
  totals.OFF = Math.max(0, elapsedEnd - dayStart - totals.BREAK - totals.ON_DUTY - totals.FIELD_DUTY);

  // Step path: OFF baseline, jumping into each segment's row.
  const sorted = [...resolved].sort((a, b) => a.s - b.s);
  let d = `M ${x(dayStart)} ${rowY("OFF")}`;
  let cursorRow: WorkStatus = "OFF";
  let cursorT = dayStart;
  for (const seg of sorted) {
    if (seg.s > cursorT && cursorRow !== "OFF") {
      d += ` V ${rowY("OFF")}`; // gap between segments = off duty
      cursorRow = "OFF";
    }
    d += ` H ${x(seg.s)} V ${rowY(seg.status)} H ${x(seg.e)}`;
    cursorRow = seg.status;
    cursorT = seg.e;
  }
  const running = sorted.at(-1)?.end === null && !sorted.at(-1)?.unbounded;
  if (!running) {
    if (cursorRow !== "OFF") d += ` V ${rowY("OFF")}`;
    d += ` H ${x(Math.max(Math.min(elapsedEnd, windowEnd), cursorT))}`;
  }

  return (
    <figure className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[720px]" role="img" aria-label={labels.title}>
        {/* hour labels */}
        {Array.from({ length: hours + 1 }, (_, i) => {
          const label = formatLocal(new Date(dayStart + i * H), timezone, "H");
          return (
            <text key={`h${i}`} x={LABEL_W + i * CELL_W} y={13} textAnchor="middle" fontSize={10} fill="var(--ink-3)">
              {i % 2 === 0 ? (label === "0" ? (i === 0 ? "0" : "24") : label) : ""}
            </text>
          );
        })}
        <text x={LABEL_W + gridW + TOTAL_W - 6} y={13} textAnchor="end" fontSize={10} fill="var(--ink-3)">
          {labels.total}
        </text>

        {/* rows */}
        {ROWS.map((r, i) => (
          <g key={r}>
            <rect x={LABEL_W} y={TOP + i * ROW_H} width={gridW} height={ROW_H} fill={i % 2 ? "var(--surface-2)" : "var(--surface)"} />
            <text x={8} y={TOP + i * ROW_H + ROW_H / 2 + 4} fontSize={11} fontWeight={500} fill={STROKE[r]}>
              {labels.rows[r]}
            </text>
            <text x={width - 6} y={TOP + i * ROW_H + ROW_H / 2 + 4} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--ink)" className="tabular">
              {hm(totals[r])}
            </text>
          </g>
        ))}

        {/* hour + quarter-hour ticks, as on a paper log */}
        {Array.from({ length: hours * 4 + 1 }, (_, q) => {
          const xx = LABEL_W + (q / 4) * CELL_W;
          const major = q % 4 === 0;
          return major ? (
            <line key={`t${q}`} x1={xx} x2={xx} y1={TOP} y2={TOP + ROWS.length * ROW_H} stroke="var(--rule)" strokeWidth={1} />
          ) : (
            ROWS.map((_, i) => (
              <line key={`q${q}-${i}`} x1={xx} x2={xx} y1={TOP + i * ROW_H} y2={TOP + i * ROW_H + (q % 2 === 0 ? 9 : 5)} stroke="var(--rule)" strokeWidth={1} />
            ))
          );
        })}
        <rect x={LABEL_W} y={TOP} width={gridW} height={ROWS.length * ROW_H} fill="none" stroke="var(--rule-strong)" />

        {/* status line */}
        <path d={d} fill="none" stroke="var(--ink)" strokeWidth={2.25} strokeLinejoin="miter" />
        {sorted.map((seg, i) => (
          <line key={`s${i}`} x1={x(seg.s)} x2={x(seg.e)} y1={rowY(seg.status)} y2={rowY(seg.status)} stroke={STROKE[seg.status]} strokeWidth={4} strokeLinecap="butt" />
        ))}
        {sorted
          .filter((s) => s.unbounded)
          .map((s, i) => (
            <g key={`u${i}`}>
              <line x1={x(s.s)} x2={x(Math.min(windowEnd, s.s + 3 * H))} y1={rowY(s.status)} y2={rowY(s.status)} stroke="var(--danger)" strokeWidth={2} strokeDasharray="4 4" />
              <title>{labels.unbounded}</title>
            </g>
          ))}
        {now > dayStart && now < windowEnd && (
          <line x1={x(now)} x2={x(now)} y1={TOP - 4} y2={TOP + ROWS.length * ROW_H + 4} stroke="var(--primary)" strokeWidth={1} strokeDasharray="2 3" />
        )}
      </svg>
    </figure>
  );
}

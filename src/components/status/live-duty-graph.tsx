"use client";
import { DutyGraph, type DutyGraphLabels, type GraphSegment } from "@/components/duty-graph";
import { useStatus } from "./status-provider";

/** Duty graph whose running segment grows with the shared status clock. */
export function LiveDutyGraph(props: { dateKey: string; timezone: string; segments: GraphSegment[]; labels: DutyGraphLabels }) {
  const { now } = useStatus();
  // Re-render at most once a minute; the graph's resolution is far coarser than seconds.
  const minute = Math.floor(now / 60_000) * 60_000;
  return <DutyGraph {...props} now={minute} />;
}

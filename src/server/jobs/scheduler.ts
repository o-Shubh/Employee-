import { runSweep } from "./sweep";

const EVERY_MS = 15 * 60_000;
let started = false;

/**
 * In-process scheduler (started from instrumentation.ts). With several app
 * instances only one runs each pass (advisory lock). For serverless hosting,
 * disable it (DISABLE_SCHEDULER=1) and call POST /api/cron/sweep from a cron.
 */
export function startScheduler() {
  if (started || process.env.DISABLE_SCHEDULER === "1") return;
  started = true;
  const tick = () =>
    runSweep()
      .then((r) => !r.skipped && (r.escalated || r.emailsRetried) && console.info("[sweep]", r))
      .catch((e) => console.error("[sweep] failed", e));
  setTimeout(tick, 30_000);
  setInterval(tick, EVERY_MS).unref?.();
}

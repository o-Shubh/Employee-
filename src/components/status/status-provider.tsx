"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { idleBreakAction, punchAction } from "@/app/(app)/actions";
import type { StatusSnapshot } from "@/lib/status-snapshot";
import type { PunchInput } from "@/server/services/attendance";

type Result = { ok: true } | { ok: false; code: string };

interface StatusContextValue {
  snapshot: StatusSnapshot;
  now: number;
  busy: boolean;
  error: string | null;
  clearError: () => void;
  punch: (input: PunchInput) => Promise<Result>;
  refresh: () => Promise<void>;
  /** Idle prompt state */
  idleSince: number | null;
  answerIdle: (wasOnBreak: boolean, breakKind?: string) => Promise<Result>;
}

const Ctx = createContext<StatusContextValue | null>(null);

export function useStatus() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStatus must be used inside <StatusProvider>");
  return v;
}

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "scroll"] as const;
const CHANNEL = "worklog-activity";

/**
 * Single source of truth for the employee's live status:
 *  - polls /api/me/status (and on focus), ticks a local clock every second
 *  - idle detector: only notices THAT input happened in this tab (never what);
 *    shares activity across tabs via BroadcastChannel; asks, never deducts
 *  - warns on tab close while still checked in
 */
export function StatusProvider({ initial, children }: { initial: StatusSnapshot; children: ReactNode }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initial);
  const [now, setNow] = useState(() => Date.parse(initial.asOf)); // matches the server render
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idleSince, setIdleSince] = useState<number | null>(null);
  const lastActivity = useRef(Date.now());
  const channel = useRef<BroadcastChannel | null>(null);
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;

  useEffect(() => setSnapshot(initial), [initial]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/me/status", { cache: "no-store" });
      if (res.ok) setSnapshot((await res.json()) as StatusSnapshot);
    } catch {
      /* offline: keep extrapolating locally */
    }
  }, []);

  // Clock + polling
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(refresh, 60_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // Idle detection
  useEffect(() => {
    let lastBroadcast = 0;
    const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;
    channel.current = bc;
    const markActive = (t = Date.now(), fromOtherTab = false) => {
      lastActivity.current = Math.max(lastActivity.current, t);
      if (!fromOtherTab && bc && t - lastBroadcast > 15_000) {
        lastBroadcast = t;
        bc.postMessage({ type: "activity", at: t });
      }
    };
    const onActivity = () => markActive();
    if (bc) {
      bc.onmessage = (ev: MessageEvent<{ type: string; at?: number }>) => {
        if (ev.data.type === "activity" && ev.data.at) markActive(ev.data.at, true);
        if (ev.data.type === "idle-resolved") {
          setIdleSince(null);
          void refresh();
        }
      };
    }
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, { passive: true });

    const check = () => {
      const s = snapRef.current;
      const thresholdMs = s.idleTimeoutMin * 60_000;
      const idleFor = Date.now() - lastActivity.current;
      const since = s.statusSince ? Date.parse(s.statusSince) : 0;
      if (s.status === "ON_DUTY" && idleFor >= thresholdMs && lastActivity.current > since) {
        setIdleSince((cur) => cur ?? lastActivity.current);
      }
    };
    const interval = setInterval(check, 30_000);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
      bc?.close();
    };
  }, [refresh]);

  // Check-out reminder when the tab is closed while still checked in
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (snapRef.current.status !== "OFF") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const punch = useCallback(
    async (input: PunchInput): Promise<Result> => {
      setBusy(true);
      setError(null);
      try {
        const res = await punchAction(input);
        if (!res.ok) {
          setError(res.code);
          return { ok: false, code: res.code };
        }
        lastActivity.current = Date.now();
        await refresh();
        router.refresh();
        return { ok: true };
      } finally {
        setBusy(false);
      }
    },
    [refresh, router],
  );

  const answerIdle = useCallback(
    async (wasOnBreak: boolean, breakKind = "PERSONAL"): Promise<Result> => {
      const since = idleSince;
      lastActivity.current = Date.now();
      if (!wasOnBreak || since === null) {
        setIdleSince(null);
        channel.current?.postMessage({ type: "idle-resolved" });
        return { ok: true };
      }
      setBusy(true);
      try {
        const res = await idleBreakAction({ idleSince: new Date(since).toISOString(), breakKind });
        if (!res.ok) {
          setError(res.code);
          return { ok: false, code: res.code };
        }
        setIdleSince(null);
        channel.current?.postMessage({ type: "idle-resolved" });
        await refresh();
        router.refresh();
        return { ok: true };
      } finally {
        setBusy(false);
      }
    },
    [idleSince, refresh, router],
  );

  const value = useMemo(
    () => ({ snapshot, now, busy, error, clearError: () => setError(null), punch, refresh, idleSince, answerIdle }),
    [snapshot, now, busy, error, punch, refresh, idleSince, answerIdle],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

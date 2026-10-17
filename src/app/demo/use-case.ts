"use client";

import { useCallback, useEffect, useState } from "react";
import type { CaseState } from "@/agent/case";
import type { Check } from "@/agent/checks";
import type { TraceEvent } from "@/agent/trace";

export interface CaseSnapshot {
  case: CaseState;
  steps: boolean[];
  checks: Check[];
}

export type Act = (tool: string, args?: Record<string, unknown>, actor?: "presenter" | "voice") => Promise<TraceEvent | null>;

/** The shared case record from the server, polled so every screen and the autopilot agree. */
export function useCase() {
  const [data, setData] = useState<CaseSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/case", { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {
      // Keep the last snapshot if a poll fails.
    }
  }, []);

  useEffect(() => {
    // The first fetch and each poll update state only from the async callback.
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, 900);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  const act: Act = useCallback(
    async (tool, args = {}, actor = "presenter") => {
      setError(null);
      const res = await fetch("/api/case/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, args, actor }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Step failed (HTTP ${res.status})`);
        return null;
      }
      await refresh();
      return body.event as TraceEvent;
    },
    [refresh],
  );

  const approve = useCallback(async () => {
    const res = await fetch("/api/case/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approver: "Demo finance reviewer" }),
    });
    await refresh();
    return res.ok;
  }, [refresh]);

  const reset = useCallback(async () => {
    await fetch("/api/case/reset", { method: "POST" });
    await refresh();
  }, [refresh]);

  return { data, error, setError, refresh, act, approve, reset };
}

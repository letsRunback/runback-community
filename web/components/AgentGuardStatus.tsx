"use client";

/**
 * Feature #5 MVP's UI half — polls the exact state the SDK's own
 * enforceToolCall pre-hook checks (see packages/sdk/src/collector.ts's
 * `guard` option and web/app/api/agents/authorization-status), through the
 * session-authenticated twin route since a browser can't hold the SDK's
 * API key. Deliberately the first polling UI in this app — no SSE/WebSocket
 * infra exists (see the plan this shipped against), so this is a plain
 * setInterval, honest about the same latency floor the SDK's own poll has.
 */
import { useEffect, useState } from "react";

interface Status {
  revoked: boolean;
  reason: string | null;
}

export default function AgentGuardStatus({ agentName, pollMs = 10_000 }: { agentName: string; pollMs?: number }) {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/app/agents/${encodeURIComponent(agentName)}/authorization`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setStatus({ revoked: !!data.revoked, reason: data.reason ?? null });
      } catch {
        /* leave last-known status showing rather than flash to "unknown" on a blip */
      }
    }
    void poll();
    const id = setInterval(poll, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [agentName, pollMs]);

  if (!status) return null; // no flash-of-"authorized" before the first poll resolves

  return status.revoked ? (
    <span className="guard-status guard-status--revoked mono" title={status.reason ?? undefined}>
      ⛔ authorization revoked{status.reason ? ` — ${status.reason}` : ""}
    </span>
  ) : (
    <span className="guard-status guard-status--ok mono">● authorized</span>
  );
}

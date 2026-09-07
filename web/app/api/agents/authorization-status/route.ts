/**
 * Read by the SDK's enforceToolCall pre-hook (packages/sdk/src/collector.ts),
 * cached with a short TTL client-side — this is the live half of Feature #5's
 * kill-switch. Bearer-key auth via resolveApiKey, the same mechanism
 * /api/ingest uses, since this is called server-to-server from the SDK, not
 * from a browser session.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/ingest";
import { orgHasFeature } from "@/lib/planGate";
import { getAuthorizationState } from "@/lib/guard";
import { rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const resolved = await resolveApiKey(key);
  if (!resolved || !resolved.orgId) {
    return NextResponse.json({ error: key ? "Invalid API key" : "Missing API key" }, { status: 401 });
  }

  // Polled repeatedly by every guarded agent process — a per-org bucket, not
  // per-IP, since many agent instances behind one NAT share an org.
  const rl = await rateLimit(`guard-status:org:${resolved.orgId}`, 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  }

  const agentName = req.nextUrl.searchParams.get("agent_name");
  if (!agentName) return NextResponse.json({ error: "agent_name query param is required" }, { status: 400 });

  // Not entitled → never revoked. A feature an org hasn't opted into (no
  // guard cron ever runs for them) must not silently block their agents.
  if (!(await orgHasFeature(resolved.orgId, "guard"))) {
    return NextResponse.json({ revoked: false, reason: null });
  }

  const state = await getAuthorizationState(resolved.orgId, agentName);
  return NextResponse.json({ revoked: state.revoked, reason: state.reason });
}

import { NextRequest, NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/ingest";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { raiseFinding } from "@/lib/workflow";

export const runtime = "nodejs";

/**
 * Receives bypass reports from @runback/sdk's installBypassGuard() — a
 * model-provider call made outside any withDebugger()-instrumented context,
 * detected client-side (see packages/sdk/src/bypassGuard.ts). Turns each
 * into a governance finding through the same ServiceNow/Jira/PagerDuty
 * pipeline as ledger_tamper, critical_gap, and shadow_agent — this is the
 * SDK-integration equivalent of a coverage gap, not a new kind of alert.
 *
 * Works identically for the hosted service and a self-hosted deployment:
 * the SDK posts to whatever RUNBACK_INGEST_URL/apiKey it was configured
 * with, same as run events themselves — a self-hosted org's bypass reports
 * never leave its own perimeter.
 */

interface BypassEventBody {
  ts?: string;
  method?: string;
  url?: string;
  hostname?: string;
  mode?: "observe" | "block";
}

export async function POST(req: NextRequest) {
  const preRl = await rateLimit(`ingest-bypass-preauth:${clientIp(req)}`, 300, 60_000);
  if (!preRl.ok) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const resolved = await resolveApiKey(key);
  if (!resolved?.orgId) {
    return NextResponse.json({ error: key ? "Invalid API key" : "Missing API key" }, { status: 401 });
  }
  const orgId = resolved.orgId;

  const rl = await rateLimit(`ingest-bypass:${orgId}`, 200, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Retry after " + rl.retryAfter + "s.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const events = (body as { events?: unknown })?.events;
  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: "events[] required" }, { status: 400 });
  }
  // A misbehaving guard shouldn't be able to flood the findings pipeline —
  // one bypass hostname produces one deduped finding regardless, but cap
  // the batch itself defensively.
  if (events.length > 50) {
    return NextResponse.json({ error: "Too many events (max 50 per request)" }, { status: 400 });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || "https://runback.dev";
  let raised = 0;
  for (const raw of events as BypassEventBody[]) {
    if (!raw?.hostname || typeof raw.hostname !== "string") continue;
    const method = typeof raw.method === "string" ? raw.method : "GET";
    const url = typeof raw.url === "string" ? raw.url : raw.hostname;
    const mode = raw.mode === "block" ? "block" : "observe";
    const r = await raiseFinding(orgId, {
      kind: "sdk_bypass",
      // Keyed on the hostname alone, like shadow_agent — "an unwrapped call
      // to this provider is happening" isn't a state an agent moves
      // through, it's just true until fixed. One open finding per
      // hostname, not one per occurrence.
      dedupeKey: `sdk_bypass:${raw.hostname}`,
      title: `Runback: an unwrapped call to ${raw.hostname} bypassed instrumentation`,
      detail: `${method} ${url} was made directly to ${raw.hostname}, outside any withDebugger()-instrumented call — the SDK's bypass guard caught it (mode: ${mode}). This request has no captured context, no policy gate, and no audit record. Wrap the call with withDebugger()/dbg.model, or route it through a call that already is.`,
      urgency: "high",
      link: `${base}/app/coverage`,
    });
    if (r.raised) raised++;
  }

  return NextResponse.json({ ok: true, raised });
}

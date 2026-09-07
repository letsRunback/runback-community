import { NextRequest, NextResponse } from "next/server";
import { ingestPayloadSchema } from "@runback/schema";
import type { TraceEvent } from "@runback/schema";
import { storeEvents, resolveApiKey } from "@/lib/ingest";
import { meterIngest } from "@/lib/usage";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // ── pre-auth IP gate: limits DB load from unauthenticated flood ──
  const preRl = await rateLimit(`ingest-preauth:${clientIp(req)}`, 300, 60_000);
  if (!preRl.ok) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  // ── auth: Bearer key → sha256 → api_keys lookup ──
  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const resolved = await resolveApiKey(key);
  if (!resolved) {
    return NextResponse.json(
      { error: key ? "Invalid API key" : "Missing API key" },
      { status: 401 }
    );
  }

  // ── per-org rate limit: 1,000 requests per minute ──
  const rl = await rateLimit(`ingest:${resolved.orgId}`, 1000, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Ingest rate limit exceeded. Retry after " + rl.retryAfter + "s.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  // ── validate ──
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = ingestPayloadSchema.safeParse(body);
  if (!parsed.success) {
    console.error("[ingest] validation failed:", JSON.stringify(parsed.error.issues, null, 2));
    return NextResponse.json(
      { error: "Invalid trace payload", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  // ── usage cap: block NEW runs once a metered plan is at its monthly limit ──
  const meter = await meterIngest(resolved.orgId, parsed.data.events as TraceEvent[]);
  if (!meter.allowed) {
    // A self-hosted, unlicensed (Community) deployment hits this too — its
    // 1,000-runs/month cap comes from the same `free` plan limits, since
    // there's no subscription to check. Pointing it at a runback.dev/pricing
    // URL from inside what's often an air-gapped deployment made no sense;
    // resolveApiKey.orgId has no reachable /pricing page there either
    // (proxy.ts 307s every marketing route to /login self-hosted). A signed
    // Enterprise license lifts this cap entirely (see lib/entitlements.ts) —
    // the fix is a license, not a hosted checkout page.
    const selfHosted = !!process.env.RUNBACK_SELF_HOSTED;
    return NextResponse.json(
      {
        error: `Monthly run limit reached (${meter.runs.toLocaleString()}/${meter.limit.toLocaleString()}). ${
          selfHosted
            ? "The Community edition is capped at 1,000 runs/month — contact hello@runback.dev for an Enterprise license to lift it."
            : "Upgrade to keep ingesting."
        }`,
        code: "usage_limit",
        usage: { runs: meter.runs, limit: meter.limit },
        upgrade: selfHosted ? "mailto:hello@runback.dev" : "https://runback.dev/pricing",
      },
      { status: 429 }
    );
  }

  const ingested = await storeEvents(parsed.data.events as TraceEvent[], resolved.projectId, resolved.orgId);
  return NextResponse.json({
    ok: true,
    ingested,
    usage: meter.limit === Infinity ? undefined : { runs: meter.runs, limit: meter.limit },
  });
}

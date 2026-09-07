import { NextRequest, NextResponse } from "next/server";
import { mapOtlpToEvents } from "@/lib/otel/mapper";
import { storeEvents, resolveApiKey } from "@/lib/ingest";
import { meterIngest } from "@/lib/usage";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import type { TraceEvent } from "@runback/schema";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * OTLP/HTTP traces endpoint. Point any OpenTelemetry GenAI exporter here:
 *   OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://<host>/api/otel
 *   OTEL_EXPORTER_OTLP_TRACES_HEADERS=authorization=Bearer <RUNBACK_API_KEY>
 * Works with LangGraph, CrewAI, OpenLLMetry/Traceloop, OpenInference, and any
 * framework that emits GenAI spans — no Runback SDK required.
 */
export async function POST(req: NextRequest) {
  // ── pre-auth IP gate: limits DB load from unauthenticated flood ──
  const preRl = await rateLimit(`otel-preauth:${clientIp(req)}`, 300, 60_000);
  if (!preRl.ok) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const resolved = await resolveApiKey(key);
  if (!resolved) {
    return NextResponse.json(
      { error: key ? "Invalid API key" : "Missing API key" },
      { status: 401 }
    );
  }

  const rl = await rateLimit(`otel:${resolved.orgId}`, 1000, 60_000);
  if (!rl.ok)
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });

  // OTLP/HTTP supports JSON and protobuf; we accept JSON (the common exporter mode).
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("protobuf")) {
    return NextResponse.json(
      { error: "Send OTLP as JSON: set OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/json" },
      { status: 415 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let events;
  try {
    events = mapOtlpToEvents(body);
  } catch (err) {
    console.error("[otel] mapping failed:", err);
    return NextResponse.json({ error: "Could not map OTLP spans" }, { status: 422 });
  }

  if (events.length === 0) {
    // Accept-but-noop: traces with no GenAI spans shouldn't error the exporter.
    return NextResponse.json({ partialSuccess: {} });
  }
  if (events.length > 2000) {
    return NextResponse.json({ error: "Payload exceeds 2000 events" }, { status: 413 });
  }

  const meter = await meterIngest(resolved.orgId, events as TraceEvent[]);
  if (!meter.allowed) {
    return NextResponse.json({
      error: `Monthly run limit reached (${meter.runs.toLocaleString()}/${meter.limit.toLocaleString()}). Upgrade to keep ingesting.`,
      code: "usage_limit",
      usage: { runs: meter.runs, limit: meter.limit },
    }, { status: 429 });
  }

  await storeEvents(events, resolved.projectId, resolved.orgId);
  // OTLP success response shape.
  return NextResponse.json({ partialSuccess: {} });
}

import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness + readiness. Public, unauthenticated, and deliberately uninformative
 * to anyone who is not operating this deployment.
 *
 * Enterprises expect an endpoint their monitoring, load balancer and status
 * page can poll, and ask for it during procurement. There was none, so the only
 * way to learn Runback was down was for a customer to tell us.
 *
 * "Readiness" here means the database answers, because every meaningful request
 * needs it — a process that is up but cannot reach Postgres is not serving, and
 * reporting 200 for it is worse than reporting nothing. The check is a trivial
 * query rather than a real one: this is polled continuously and must not become
 * load of its own.
 *
 * Nothing internal is exposed on failure — no error text, no host, no version.
 * A health endpoint is the most-scanned URL on any deployment and is not a
 * place to describe your infrastructure to whoever asks.
 */
export async function GET() {
  const started = Date.now();
  let dbOk = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = getAdminClient() as any;
    const { error } = await sb.from("orgs").select("id", { count: "exact", head: true }).limit(1);
    dbOk = !error;
    if (error) console.error("[health] database check failed:", error.message);
  } catch (e) {
    console.error("[health] database check threw:", e);
  }

  const body = {
    status: dbOk ? "ok" : "degraded",
    checks: { database: dbOk ? "ok" : "unavailable" },
    latency_ms: Date.now() - started,
  };
  // 503 when not ready, so a load balancer or uptime monitor reacts without
  // having to parse the body.
  return NextResponse.json(body, {
    status: dbOk ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}

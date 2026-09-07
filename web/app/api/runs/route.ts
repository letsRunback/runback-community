/**
 * GET /api/runs — list runs for the caller's org.
 *
 * This endpoint is documented in /docs (including the copy-pasteable
 * `curl "https://runback.dev/api/runs?status=error&limit=10"` example) but did
 * not exist: there was no route file at all, so every reader who followed the
 * documentation got a 404 from the Next.js catch-all.
 *
 * Supports exactly the query parameters the docs advertise:
 *   limit, offset, status, agent_name, from, to
 */
import { NextRequest, NextResponse } from "next/server";
import { getCaller } from "@/lib/apiAuth";
import { getAdminClient } from "@/lib/supabase/admin";
import { mustRead } from "@/lib/supabase/read";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUN_COLUMNS =
  "run_id,name,status,input,output,error,metadata,step_count,total_tokens,started_at,ended_at";

const VALID_STATUS = new Set(["running", "success", "error"]);

export async function GET(req: NextRequest) {
  const caller = await getCaller(req);
  if (!caller) {
    return NextResponse.json({ error: "Not signed in, and no valid API key." }, { status: 401 });
  }

  // Key on the org for API callers — every CI job shares one egress IP, so an
  // IP bucket would let one org's automation throttle unrelated tenants.
  const rlKey = caller.via === "api_key" ? `runs-list:org:${caller.orgId}` : `runs-list:${clientIp(req)}`;
  const rl = await rateLimit(rlKey, 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "retry-after": String(rl.retryAfter) } }
    );
  }

  const sp = req.nextUrl.searchParams;

  const limit = Math.min(200, Math.max(1, Number(sp.get("limit") ?? 50) || 50));
  const offset = Math.max(0, Number(sp.get("offset") ?? 0) || 0);
  const status = sp.get("status");
  const agentName = sp.get("agent_name");
  const from = sp.get("from");
  const to = sp.get("to");

  if (status && !VALID_STATUS.has(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${[...VALID_STATUS].join(", ")}` },
      { status: 400 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  let q = sb
    .from("ad_runs")
    .select(RUN_COLUMNS)
    // Tenant isolation is not optional here: an unscoped list would hand every
    // caller the whole fleet's runs.
    .eq("org_id", caller.orgId)
    .order("started_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) q = q.eq("status", status);
  // The agent name is stored as ad_runs.name.
  if (agentName) q = q.eq("name", agentName);
  if (from) q = q.gte("started_at", from);
  if (to) q = q.lte("started_at", to);

  const runs = await mustRead<unknown[]>(q, "list runs");

  return NextResponse.json({
    runs: runs ?? [],
    limit,
    offset,
    count: runs?.length ?? 0,
  });
}

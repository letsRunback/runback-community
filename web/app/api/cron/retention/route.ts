import { NextRequest, NextResponse } from "next/server";
import { enforceRetention } from "@/lib/usage";
import { expireStaleApprovals } from "@/lib/approvals";
import { cronAuthorized } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Prune runs past each org's plan retention. Triggered by Vercel Cron (hosted)
 * or any scheduler (self-host: `curl -H "authorization: Bearer $CRON_SECRET"`).
 * Protected by CRON_SECRET (required). Vercel sets Authorization: Bearer automatically.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await enforceRetention();

    // Time out approvals nobody acted on.
    //
    // expireStaleApprovals() was written, exported, and never called from
    // anywhere — while sql/create_approvals.sql defines `expires_at` and a
    // partial index on pending rows built solely to serve this query. The
    // result was that a request nobody answered stayed "pending" forever: the
    // SDK's approval gate would keep waiting, and the queue only ever grew.
    // A human-in-the-loop control needs a defined outcome when the human
    // never arrives.
    let approvalsTimedOut = 0;
    try {
      approvalsTimedOut = await expireStaleApprovals();
    } catch (e) {
      // Never let this fail the retention sweep, but never swallow it either.
      console.error("[cron/retention] expireStaleApprovals failed:", e);
    }

    // Best-effort: prune expired shared rate-limit buckets (no-op if the RPC/table
    // isn't present). Never let this affect the retention result.
    try {
      const { getAdminClient } = await import("@/lib/supabase/admin");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (getAdminClient() as any).rpc("rate_limit_gc", { p_older_than_min: 60 });
    } catch { /* table/RPC not applied — fine */ }
    return NextResponse.json({ ok: true, ...result, approvals_timed_out: approvalsTimedOut });
  } catch (e) {
    console.error("[cron/retention] failed:", e);
    return NextResponse.json({ ok: false, error: "retention sweep failed" }, { status: 500 });
  }
}

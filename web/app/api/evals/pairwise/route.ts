import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { comparePairwise } from "@/lib/eval/pairwise";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { isDemoRequest } from "@/lib/demoMode";

export const runtime = "nodejs";
export const maxDuration = 300;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

/** Judge every shared item between two eval runs — one model call per item, same cost profile as /api/evals. */
export async function POST(req: NextRequest) {
  const rl = await rateLimit(`pairwise:${clientIp(req)}`, 6, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many comparisons — give it a moment." }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  }

  const { getCaller } = await import("@/lib/apiAuth");
  const caller = await getCaller(req);
  if (!caller?.orgId) {
    return NextResponse.json({ error: "Sign in or pass an API key to compare evals." }, { status: 401 });
  }
  const { orgHasFeature } = await import("@/lib/planGate");
  if (!await orgHasFeature(caller.orgId, "quality")) {
    return NextResponse.json({ error: "Evals require Growth plan or above." }, { status: 403 });
  }

  let body: { eval_run_a_id?: string; eval_run_b_id?: string; randomize_order?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { eval_run_a_id, eval_run_b_id } = body;
  if (!eval_run_a_id || !eval_run_b_id) {
    return NextResponse.json({ error: "eval_run_a_id and eval_run_b_id are required" }, { status: 400 });
  }
  if (eval_run_a_id === eval_run_b_id) {
    return NextResponse.json({ error: "Pick two different evals to compare" }, { status: 400 });
  }

  const { data: runs } = await db().from("ad_eval_runs").select("id,org_id,status").in("id", [eval_run_a_id, eval_run_b_id]);
  const rows = (runs ?? []) as { id: string; org_id: string | null; status: string }[];
  const a = rows.find((r) => r.id === eval_run_a_id);
  const b = rows.find((r) => r.id === eval_run_b_id);
  if (!a || !b || a.org_id !== caller.orgId || b.org_id !== caller.orgId) {
    return NextResponse.json({ error: "Eval not found" }, { status: 404 });
  }
  if (a.status !== "done" || b.status !== "done") {
    return NextResponse.json({ error: "Both evals must have finished running" }, { status: 400 });
  }

  try {
    const result = await comparePairwise(caller.orgId, eval_run_a_id, eval_run_b_id, {
      demo: await isDemoRequest(),
      randomizeOrder: body.randomize_order ?? true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Comparison failed." }, { status: 500 });
  }
}

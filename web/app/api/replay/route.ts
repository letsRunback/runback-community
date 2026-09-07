import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getCaller } from "@/lib/apiAuth";
import { orgHasFeature } from "@/lib/planGate";
import { runStep, REPLAY_MODELS, replayModelAllowlist } from "@/lib/replay/runStep";
import { simulateStep } from "@/lib/replay/simulate";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { showcaseOrgId } from "@/lib/demoMode";
import { isDemoRequest } from "@/lib/demoMode";
import type { LlmEvent, ModelMessage } from "@runback/schema";

export const runtime = "nodejs";

// Re-exported so existing importers keep working after the core moved to runStep.
export { REPLAY_MODELS };

interface ReplayBody {
  run_id: string;
  span_id: string;
  /** Optionally replay against a different (allowlisted) model than the captured one. */
  model_id?: string;
  edits?: {
    system?: string | null;
    messages?: ModelMessage[];
  };
}

export async function POST(req: NextRequest) {
  // Replay spends money (a model call). Cap how fast one client can fire them.
  const rl = await rateLimit(`replay:${clientIp(req)}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many replays — give it a moment." },
      { status: 429, headers: { "retry-after": String(rl.retryAfter) } }
    );
  }

  let body: ReplayBody;
  try {
    body = (await req.json()) as ReplayBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.run_id || !body.span_id) {
    return NextResponse.json({ error: "run_id and span_id required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;

  // Validate model_id against the allowlist before any DB or auth work.
  // An arbitrary model string would be forwarded to a provider SDK and billed
  // against a configured API key without any rate or entitlement control.
  if (body.model_id && !replayModelAllowlist().includes(body.model_id)) {
    return NextResponse.json(
      { error: "model_id is not in the replay allowlist.", allowed: replayModelAllowlist() },
      { status: 400 }
    );
  }

  // Demo shortcut — zero-auth simulation for the hosted demo. Runs before any
  // DB queries; no real model keys are spent.
  if (await isDemoRequest()) {
    // Scoped like every other read: run ids are unique per org now, so an
    // unscoped (run_id, span_id) lookup can match a different tenant's event —
    // and this branch runs before authentication, so it must not be able to
    // reach anything but demo data. A signed-in demo account uses its own org;
    // the anonymous hosted demo uses the public showcase workspace.
    const demoCaller = await getCaller(req);
    const demoOrg = demoCaller?.orgId ?? (await showcaseOrgId());
    if (!demoOrg) return NextResponse.json({ error: "Step not found" }, { status: 404 });
    const { data: demoRow } = await supabase
      .from("ad_events")
      .select("data")
      .eq("org_id", demoOrg)
      .eq("run_id", body.run_id)
      .eq("span_id", body.span_id)
      .maybeSingle();
    if (!demoRow) return NextResponse.json({ error: "Step not found" }, { status: 404 });
    const demoOrig = demoRow.data as LlmEvent;
    if (demoOrig.type !== "llm") return NextResponse.json({ error: "Only LLM steps can be replayed" }, { status: 400 });
    const sim = simulateStep({
      original: demoOrig,
      modelId: body.model_id,
      promptEdited: body.edits?.system !== undefined || body.edits?.messages !== undefined,
      editedMessages: body.edits?.messages,
    });
    return NextResponse.json(sim);
  }

  // Non-demo: require authentication and verify the run belongs to the caller's
  // org. Accepts a Bearer API key as well as a session cookie — /docs documents
  // step replay as part of the Bearer-token API.
  const session = await getCaller(req);
  if (!session) return NextResponse.json({ error: "Not signed in, and no valid API key." }, { status: 401 });

  // Live model call — viewers are read-only. Entitlement answers "may this org
  // do it", not "may this member spend on it"; those are different questions
  // and only the first was being asked.
  const { atLeast } = await import("@/lib/auth");
  if (!atLeast(session.role, "member")) {
    return NextResponse.json({ error: "Viewers have read-only access." }, { status: 403 });
  }

  // Step replay is a Community Licence capability (COMMUNITY_LICENCE_FEATURES),
  // so this passes on every tier including free. The gate stays because the flag
  // is still the single place that decides.
  if (!await orgHasFeature(session.orgId, "step_replay")) {
    return NextResponse.json({ error: "Step replay is unavailable on this plan." }, { status: 403 });
  }

  // Filter by org rather than fetching-then-comparing. The old form matched on
  // run_id alone and, now that ids are per-tenant, maybeSingle() would error
  // outright whenever any other org happened to share the id — turning a
  // legitimate replay into "Run not found".
  const { data: scope } = await supabase.from("ad_runs").select("run_id")
    .eq("org_id", session.orgId).eq("run_id", body.run_id).maybeSingle();
  if (!scope) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // Load the ORIGINAL captured request — the endpoint can only replay requests
  // that already exist (it never accepts a free-form prompt).
  const { data: row } = await supabase
    .from("ad_events")
    .select("data")
    .eq("org_id", session.orgId)
    .eq("run_id", body.run_id)
    .eq("span_id", body.span_id)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 });
  }
  const original = row.data as LlmEvent;
  if (original.type !== "llm") {
    return NextResponse.json({ error: "Only LLM steps can be replayed" }, { status: 400 });
  }

  // Counterfactual replay (different model than the captured one) is a model-diff
  // operation — requires the model_diff or deep_replay feature. Same-model replay
  // only needs step_replay (already checked above).
  if (body.model_id && body.model_id !== original.model.model_id) {
    const canCounterfactual = await orgHasFeature(session.orgId, "model_diff") ||
      await orgHasFeature(session.orgId, "deep_replay");
    if (!canCounterfactual) {
      return NextResponse.json(
        { error: "Replaying against a different model requires a Scale plan or higher." },
        { status: 403 }
      );
    }
  }

  // Per-org BYOK keys (from Settings → Model keys) win over the deployment env.
  const { getOrgKeys } = await import("@/lib/modelKeys");
  const keys = await getOrgKeys(session.orgId);

  const result = await runStep({
    request: original.request,
    model: original.model,
    model_id: body.model_id,
    keys,
    edits:
      body.edits?.system !== undefined || body.edits?.messages !== undefined
        ? { system: body.edits?.system, messages: body.edits?.messages }
        : undefined,
  });

  if (!result.ok) {
    // A missing API key is a config (400) problem; a model failure is upstream (502).
    const isConfig = /No .* model key configured/.test(result.error ?? "");
    return NextResponse.json(
      {
        error: isConfig ? "Replay unavailable" : "Replay failed",
        detail: result.error,
        latency_ms: result.latency_ms,
      },
      { status: isConfig ? 400 : 502 }
    );
  }

  return NextResponse.json({
    response: result.response,
    latency_ms: result.latency_ms,
    model: result.model,
    edited: result.edited,
  });
}

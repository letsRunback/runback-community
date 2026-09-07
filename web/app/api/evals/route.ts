import { NextRequest, NextResponse, after } from "next/server";
import { createEval } from "@/lib/eval/evals";
import { runEval } from "@/lib/eval/runner";
import { getDataset } from "@/lib/eval/datasets";
import { REPLAY_MODELS } from "@/lib/replay/runStep";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { isDemoRequest } from "@/lib/demoMode";
import { communityEvalGate } from "@/lib/entitlements";

export const runtime = "nodejs";
// Replaying + judging a whole dataset can take a while.
export const maxDuration = 300;

// An eval makes one paid model call per item (plus a judge). Bound the worst case.
const MAX_EVAL_ITEMS = 200;

interface RunEvalBody {
  dataset_id?: string;
  name?: string;
  model_id?: string;
  policy_id?: string;
}

export async function POST(req: NextRequest) {
  // Evals are the most expensive endpoint (N model calls). Throttle hard.
  const rl = await rateLimit(`eval:${clientIp(req)}`, 6, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many evals — give it a moment." },
      { status: 429, headers: { "retry-after": String(rl.retryAfter) } }
    );
  }

  // Auth: an eval makes paid model calls and reads a dataset — require a caller
  // and scope the dataset to their org (no unauthenticated / cross-tenant runs).
  //
  // Accepts a Bearer API key as well as a session, because this is the endpoint
  // the documented CI release-gate snippet drives; a CI runner has no cookie.
  const { getCaller } = await import("@/lib/apiAuth");
  const caller = await getCaller(req);
  if (!caller?.orgId) {
    return NextResponse.json({ error: "Sign in or pass an API key to run an eval." }, { status: 401 });
  }
  // Viewers must not be able to spend money. Running an eval makes live model
  // calls, and the rate limits here are keyed on IP rather than org, so nothing
  // else bounds the cost. CI keys resolve to admin and still pass.
  const { atLeast } = await import("@/lib/auth");
  if (!atLeast(caller.role, "member")) {
    return NextResponse.json({ error: "Viewers have read-only access." }, { status: 403 });
  }
  const { orgHasFeature } = await import("@/lib/planGate");
  if (!await orgHasFeature(caller.orgId, "quality") && !communityEvalGate()) {
    return NextResponse.json({ error: "Evals require Growth plan or above." }, { status: 403 });
  }

  let body: RunEvalBody;
  try {
    body = (await req.json()) as RunEvalBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.dataset_id) {
    return NextResponse.json({ error: "dataset_id is required" }, { status: 400 });
  }

  const dataset = await getDataset(body.dataset_id, caller.orgId);
  if (!dataset) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }
  if (dataset.items.length === 0) {
    return NextResponse.json(
      { error: "Dataset has no items — add a captured step first" },
      { status: 400 }
    );
  }
  if (dataset.items.length > MAX_EVAL_ITEMS) {
    return NextResponse.json(
      { error: `Dataset too large to run at once (max ${MAX_EVAL_ITEMS} items).` },
      { status: 400 }
    );
  }

  // Only an allowlisted override is honoured; otherwise each item replays its captured model.
  const model_id =
    body.model_id && REPLAY_MODELS.includes(body.model_id) ? body.model_id : null;

  const ev = await createEval({
    dataset_id: body.dataset_id,
    name: body.name?.trim() || `Eval of ${dataset.dataset.name}`,
    model_id,
    policy_id: body.policy_id || null,
  });

  try {
    await runEval(ev.id, { demo: await isDemoRequest() });
    const { firePlgEvent } = await import("@/lib/plg");
    // Un-awaited and un-scheduled, this could be frozen mid-flight the moment
    // the response below is sent — Vercel's Node runtime doesn't guarantee a
    // detached promise finishes after the handler returns. after() keeps it
    // alive until it settles, without holding up the response.
    after(() => firePlgEvent(caller.orgId, "first_eval_run", { eval_id: ev.id, dataset_id: body.dataset_id }).catch(() => {}));
    return NextResponse.json({ eval_id: ev.id, status: "done" }, { status: 201 });
  } catch (err) {
    // The runner already marked the eval as errored; surface the id so the UI can show it.
    return NextResponse.json(
      {
        eval_id: ev.id,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 200 }
    );
  }
}

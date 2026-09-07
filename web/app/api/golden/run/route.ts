import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { runGoldenSuite } from "@/lib/golden";
import { REPLAY_MODELS } from "@/lib/replay/runStep";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Re-run the golden suite. Without a model: verify each incident reproduces.
 * With a model: check whether each incident RECURS on that candidate.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const rl = await rateLimit(`golden-run:${clientIp(req)}`, 10, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many runs — give it a moment." }, { status: 429 });

  let body: { model?: string };
  try { body = await req.json(); } catch { body = {}; }
  const model = body.model && REPLAY_MODELS.includes(body.model) ? body.model : undefined;
  const demo = DEMO_MODE || isDemoEmail(session.email);

  // A candidate-model suite run re-executes each incident LIVE on that model —
  // paid tokens, a deep_replay capability. The integrity (no-model) run is free and
  // stays open. Gate the candidate path so a direct API call can't bypass the paywall.
  if (model && !demo) {
    const { orgHasFeature } = await import("@/lib/planGate");
    if (!(await orgHasFeature(session.orgId, "deep_replay"))) {
      return NextResponse.json({ ok: false, error: "Candidate-model replay is a deep-replay feature — upgrade to use it." }, { status: 402 });
    }
  }

  try {
    return NextResponse.json({ ok: true, result: await runGoldenSuite(session.orgId, { model, demo }) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Suite run failed." }, { status: 500 });
  }
}

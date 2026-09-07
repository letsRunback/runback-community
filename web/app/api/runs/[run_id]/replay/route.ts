/**
 * POST /api/runs/:run_id/replay — replay one captured LLM step.
 *
 * /docs advertises this path with body `{ span_id, model }`, but no route file
 * existed; the real endpoint has always been POST /api/replay with the run id in
 * the body. Anyone who wrote code against the documentation got a 404.
 *
 * Rather than reimplement ~150 lines of replay, entitlement, demo-mode and
 * allowlist logic (and let two copies drift apart), this delegates to the
 * canonical handler with a request whose body carries the run id from the path.
 * There is exactly one implementation of replay; this is an alias for it.
 */
import { NextRequest, NextResponse } from "next/server";
import { POST as replayPost, REPLAY_MODELS } from "@/app/api/replay/route";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  span_id?: string;
  /** Documented name. `model_id` is the canonical endpoint's name — both work. */
  model?: string;
  model_id?: string;
  edits?: unknown;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ run_id: string }> }
) {
  const { run_id } = await params;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  if (!body.span_id) {
    return NextResponse.json({ error: "span_id required" }, { status: 400 });
  }

  const model = body.model ?? body.model_id;
  if (model && !REPLAY_MODELS.includes(model)) {
    return NextResponse.json(
      { error: "model is not in the replay allowlist.", allowed: REPLAY_MODELS },
      { status: 400 }
    );
  }

  // Rebuild the request for the canonical handler. Headers are forwarded intact
  // so the Authorization bearer / session cookie and the client IP used for rate
  // limiting are all preserved — this must authenticate as the original caller,
  // not as an anonymous internal request.
  const forwarded = new NextRequest(new URL("/api/replay", req.url), {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({
      run_id,
      span_id: body.span_id,
      ...(model ? { model_id: model } : {}),
      ...(body.edits ? { edits: body.edits } : {}),
    }),
  });

  return replayPost(forwarded);
}

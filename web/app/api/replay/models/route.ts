import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { replayModelAllowlist } from "@/lib/replay/runStep";

export const runtime = "nodejs";

/**
 * The models this deployment can actually replay against.
 *
 * `REPLAY_MODELS` is a build-time constant, so it is inlined into the client
 * bundle — which means an air-gapped deployment that declared its own models in
 * the environment would still show a dropdown of eleven models it cannot reach,
 * and none of the ones it can. The list is only knowable on the server, so the
 * UI asks for it.
 *
 * Requires a session. The list is not a secret, but on the hosted service it
 * would otherwise be an unauthenticated endpoint describing our provider mix
 * for no reason.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ models: replayModelAllowlist() });
}

/**
 * Session-authenticated twin of GET /api/agents/authorization-status, for
 * the run-page UI (web/components/AgentGuardStatus.tsx) to poll. That route
 * is Bearer-API-key auth for the SDK's own background poller — a browser
 * component can't hold an API key client-side, so this reads the exact same
 * lib/guard.ts state through a session cookie instead.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAuthorizationState } from "@/lib/guard";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ agent_name: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { agent_name } = await params;
  const state = await getAuthorizationState(session.orgId, decodeURIComponent(agent_name));
  return NextResponse.json({ revoked: state.revoked, reason: state.reason, revokedAt: state.revokedAt });
}

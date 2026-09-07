import { NextRequest, NextResponse } from "next/server";
import { getSession, atLeast } from "@/lib/auth";
import { issueApiKey } from "@/lib/apiKeys";
import { getAdminClient } from "@/lib/supabase/admin";
import { isDemoRequest } from "@/lib/demoMode";

export const runtime = "nodejs";

/**
 * Issue a fresh ingest key for the org (shown once). Admin+ only.
 *
 * `{ auto: true }` provisions the FIRST key automatically, so a new workspace
 * arrives at the quickstart with a key already in the snippet instead of a
 * button to press. Sending a first run is the moment a signup either becomes a
 * user or leaves, and a detour through Settings at that point loses people.
 *
 * Auto mode issues ONLY when the org has no active ingest key. Without that
 * condition every page load would mint another credential — an onboarding
 * convenience turning into a pile of live keys nobody can account for, which
 * is precisely the finding an access review exists to catch.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!atLeast(session.role, "admin")) {
    return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
  }
  // The demo workspace is entered anonymously, as an OWNER, with no
  // credentials (/api/auth/demo). Without this guard any visitor could mint an
  // ingest key here — and ingest keys resolve to role "admin" in apiAuth, carry
  // no expiry, and outlive the demo session. That is an anonymous route to a
  // persistent admin credential on a shared org, so it is refused outright
  // rather than rate-limited. Mirrors the guards on /api/settings/model-keys.
  if (await isDemoRequest()) {
    return NextResponse.json(
      { ok: false, error: "Key issuance is disabled in the shared demo workspace." },
      { status: 403 }
    );
  }

  let auto = false;
  // "trace_write" issues a key that can ONLY post traces: getCaller() rejects
  // it, so it cannot reach the general API — no evals, no replay, no prompt
  // writes. This is what an SDK key embedded in an application should be, so a
  // leak means someone can send us telemetry rather than act on the workspace.
  // Not the default: the historical "ingest" scope drives the documented CI
  // release-gate and replay flows, and silently narrowing every new key would
  // break those the first time a customer rotated one.
  let scope: "ingest" | "trace_write" = "ingest";
  try {
    const body = await req.json();
    auto = !!body?.auto;
    if (body?.scope === "trace_write") scope = "trace_write";
  } catch {
    // No body — an explicit "create a key" click.
  }

  if (auto) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = getAdminClient() as any;
    const { data: existing, error } = await sb
      .from("api_keys")
      .select("id")
      .eq("org_id", session.orgId)
      .in("scope", ["ingest", "trace_write"])
      .eq("active", true)
      .limit(1);
    // On a failed check, do NOT issue. Minting a duplicate because a query
    // errored is worse than showing the manual button.
    if (error) {
      console.error("[key] could not check existing keys:", error.message);
      return NextResponse.json({ ok: true, exists: true });
    }
    if (existing?.length) return NextResponse.json({ ok: true, exists: true });
  }

  const key = await issueApiKey(session.email, session.orgId, scope);
  if (!key) return NextResponse.json({ ok: false, error: "Could not create a key." }, { status: 500 });
  return NextResponse.json({ ok: true, apiKey: key, scope });
}

import { NextRequest, NextResponse } from "next/server";
import { getSession, atLeast } from "@/lib/auth";
import { actorFrom } from "@/lib/adminAudit";
import { isDemoRequest } from "@/lib/demoMode";
import { setOrgKey, deleteOrgKey, listMaskedKeys, PROVIDERS, type Provider } from "@/lib/modelKeys";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  // POST and DELETE were demo-guarded; GET was not, so anyone entering the
  // shared demo workspace could read back which providers have a key
  // registered and its last4 — on the same org whose Settings page warns
  // against putting a real credential there. Disclosure, not just tidiness.
  if (await isDemoRequest()) return NextResponse.json({ ok: true, keys: [] });
  return NextResponse.json({ ok: true, keys: await listMaskedKeys(session.orgId) });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!atLeast(session.role, "admin")) return NextResponse.json({ ok: false, error: "Only an admin/owner can manage model keys." }, { status: 403 });
  // The settings UI hides this form for demo workspaces (a shared, deterministic
  // org every "try the demo" visitor lands in) but that's cosmetic — without this
  // check, anyone could call the API directly and plant a real provider key into
  // an org every other demo visitor also holds.
  if (await isDemoRequest()) {
    return NextResponse.json({ ok: false, error: "Model keys can't be stored in the demo workspace." }, { status: 403 });
  }
  let body: { provider?: string; key?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }
  if (!PROVIDERS.includes(body.provider as Provider) || !body.key) {
    return NextResponse.json({ ok: false, error: "Pick a provider and paste a key." }, { status: 400 });
  }
  try {
    await setOrgKey(session.orgId, body.provider as Provider, body.key, actorFrom(session, req));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Could not save the key." }, { status: 422 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!atLeast(session.role, "admin")) return NextResponse.json({ ok: false, error: "Only an admin/owner can manage model keys." }, { status: 403 });
  // Same reasoning as POST above — a demo session must not be able to touch a
  // real key in the shared demo org, whether planting one or destroying one a
  // real admin configured.
  if (await isDemoRequest()) {
    return NextResponse.json({ ok: false, error: "Model keys can't be changed in the demo workspace." }, { status: 403 });
  }
  const provider = new URL(req.url).searchParams.get("provider");
  if (!PROVIDERS.includes(provider as Provider)) return NextResponse.json({ ok: false, error: "Unknown provider." }, { status: 400 });
  await deleteOrgKey(session.orgId, provider as Provider, actorFrom(session, req));
  return NextResponse.json({ ok: true });
}

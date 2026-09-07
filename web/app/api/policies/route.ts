import { NextRequest, NextResponse, after } from "next/server";
import { getSession, atLeast } from "@/lib/auth";
import { listPolicies, savePolicy } from "@/lib/eval/policies";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ ok: true, policies: await listPolicies(session.orgId) });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!atLeast(session.role, "member")) return NextResponse.json({ ok: false, error: "Member access required." }, { status: 403 });
  let body: { name?: string; rules?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }
  if (!body.name?.trim()) return NextResponse.json({ ok: false, error: "A policy name is required." }, { status: 400 });
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const policy = await savePolicy(session.orgId, body.name.trim(), (body.rules ?? []) as any);
    const { firePlgEvent } = await import("@/lib/plg");
    // See evals/route.ts's same fix: after() so this survives past the
    // response instead of risking being frozen mid-flight, un-awaited.
    after(() => firePlgEvent(session.orgId, "first_policy_created", { policy_name: policy.name }).catch(() => {}));
    return NextResponse.json({ ok: true, policy });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Could not save policy." }, { status: 422 });
  }
}

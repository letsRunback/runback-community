import { NextRequest, NextResponse } from "next/server";
import { orgHasFeature } from "@/lib/planGate";
import { listLabels, setLabel } from "@/lib/prompts/labels";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { getCaller } = await import("@/lib/apiAuth");
  const caller = await getCaller(req);
  if (!caller?.orgId) return NextResponse.json({ error: "Sign in or pass an API key." }, { status: 401 });
  if (!await orgHasFeature(caller.orgId, "quality")) {
    return NextResponse.json({ error: "Prompt management requires Growth plan or above." }, { status: 403 });
  }
  const { name } = await params;
  const labels = await listLabels(caller.orgId, decodeURIComponent(name));
  return NextResponse.json({ labels });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { getCaller } = await import("@/lib/apiAuth");
  const caller = await getCaller(req);
  if (!caller?.orgId) return NextResponse.json({ error: "Sign in or pass an API key." }, { status: 401 });
  if (!await orgHasFeature(caller.orgId, "quality")) {
    return NextResponse.json({ error: "Prompt management requires Growth plan or above." }, { status: 403 });
  }
  const { name } = await params;

  let body: { label?: string; version?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.label?.trim() || typeof body.version !== "number") {
    return NextResponse.json({ error: "label and version are required" }, { status: 400 });
  }

  // Keys resolve to "admin" (lib/apiAuth.ts) — CI promoting a version to
  // "production" is exactly the documented use case, not a privilege leak.
  const result = await setLabel(
    caller.orgId,
    caller.role,
    decodeURIComponent(name),
    body.label.trim(),
    body.version,
    { kind: caller.via === "api_key" ? "api_key" : "user", userId: caller.userId, email: caller.email }
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 403 });
  return NextResponse.json({ ok: true });
}

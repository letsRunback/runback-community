import { NextRequest, NextResponse } from "next/server";
import { orgHasFeature } from "@/lib/planGate";
import { listVersions } from "@/lib/prompts/prompts";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { getCaller } = await import("@/lib/apiAuth");
  const caller = await getCaller(req);
  if (!caller?.orgId) return NextResponse.json({ error: "Sign in or pass an API key." }, { status: 401 });
  if (!await orgHasFeature(caller.orgId, "quality")) {
    return NextResponse.json({ error: "Prompt management requires Growth plan or above." }, { status: 403 });
  }
  const { name } = await params;
  const versions = await listVersions(caller.orgId, decodeURIComponent(name));
  return NextResponse.json({ versions });
}

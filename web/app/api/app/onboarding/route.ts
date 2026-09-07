import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { markStepDone } from "@/lib/onboardingProgress";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  let stepId: string | undefined;
  try {
    const body = await req.json();
    stepId = body?.stepId;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  if (!stepId) return NextResponse.json({ ok: false, error: "Missing stepId." }, { status: 400 });

  try {
    await markStepDone(session.orgId, stepId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[onboarding] mark-done failed:", e);
    return NextResponse.json({ ok: false, error: "Could not save." }, { status: 500 });
  }
}

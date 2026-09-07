import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { seedDemo } from "@/lib/seedDemo";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  try {
    const n = await seedDemo(session.orgId);
    return NextResponse.json({ ok: true, seeded: n });
  } catch (e) {
    console.error("[seed-demo] failed:", e);
    return NextResponse.json({ ok: false, error: "Could not load sample data." }, { status: 500 });
  }
}

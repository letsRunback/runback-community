import { NextRequest, NextResponse } from "next/server";
import { getSession, atLeast } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { VERTICALS } from "@/lib/verticals";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await getSession().catch(() => null);
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!atLeast(session.role, "admin")) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const { vertical } = await req.json().catch(() => ({}));
  if (!vertical || !(vertical in VERTICALS)) {
    return NextResponse.json({ error: "Invalid vertical" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { error } = await sb
    .from("orgs")
    .update({ vertical })
    .eq("id", session.orgId);

  if (error) {
    console.error("[api/settings/vertical] update failed:", error.message);
    return NextResponse.json({ error: "Could not save vertical" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

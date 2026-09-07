import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  const session = await getSession().catch(() => null);
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.role !== "owner" && session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Admins only." }, { status: 403 });
  }

  let body: { corpus_opt_in?: boolean };
  try { body = await req.json(); } catch { body = {}; }
  if (typeof body.corpus_opt_in !== "boolean") {
    return NextResponse.json({ ok: false, error: "corpus_opt_in (boolean) required." }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  await sb.from("orgs").update({ corpus_opt_in: body.corpus_opt_in }).eq("id", session.orgId);
  return NextResponse.json({ ok: true, corpus_opt_in: body.corpus_opt_in });
}

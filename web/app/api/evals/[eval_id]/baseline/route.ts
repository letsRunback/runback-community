import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Designate this eval as its dataset's regression baseline. */
export async function POST(_req: Request, { params }: { params: Promise<{ eval_id: string }> }) {
  const { eval_id } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data: ev } = await sb.from("ad_eval_runs").select("dataset_id,org_id").eq("id", eval_id).maybeSingle();
  if (!ev || ev.org_id !== session.orgId) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  await sb.from("ad_datasets").update({ baseline_eval_id: eval_id }).eq("id", ev.dataset_id);
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { getCaller } from "@/lib/apiAuth";
import { getAgentGraph } from "@/lib/multiAgent";
import { getTrustChain } from "@/lib/trust";
import { orgHasFeature } from "@/lib/planGate";
import { getAdminClient } from "@/lib/supabase/admin";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Bearer key as well as session — /docs lists this under the Bearer-token API.
  const session = await getCaller(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const runId = req.nextUrl.searchParams.get("run_id");
  if (!runId) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  // DEMO_MODE alone missed the hosted per-email demo login (RUNBACK_DEMO_MODE
  // unset in production, but the signed-in account is one of DEMO_EMAILS) — the
  // same gap every other demo-gated route in this area (ledger, chargeback,
  // golden, regulatory) already guards against.
  const allowed = DEMO_MODE || isDemoEmail(session.email) || await orgHasFeature(session.orgId, "trust_chain");
  if (!allowed) return NextResponse.json({ error: "Trust chain requires a Pro plan or higher." }, { status: 403 });

  // Tenant guard
  const { data: scope } = await sb.from("ad_runs").select("org_id").eq("run_id", runId).maybeSingle();
  if (!scope || scope.org_id !== session.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const graph = await getAgentGraph(runId, session.orgId).catch(() => null);
  if (!graph) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Attestation is persisted at ingest time (lib/ingest.ts → attestDelegation),
  // with whatever scope the caller actually declared. Nothing persists here on
  // read — a lazy persist-on-read used to run here and always wrote scope
  // ["*"], which on an upsert would have clobbered a real attested scope back
  // to wildcard the next time anyone viewed this chain. A graph edge with no
  // stored attestation (pre-dates this, or the SDK never attested it) still
  // renders correctly via getTrustChain's on-the-fly "unattested" fallback.
  const chain = await getTrustChain(runId, session.orgId, graph);

  const download = req.nextUrl.searchParams.get("download") === "1";
  if (download) {
    const filename = `runback-trust-chain-${runId.slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(chain, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json(chain);
}

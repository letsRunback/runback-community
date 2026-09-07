import { NextResponse } from "next/server";
import { buildAuditRecord } from "@/lib/audit";
import { getCaller } from "@/lib/apiAuth";
import { getAdminClient } from "@/lib/supabase/admin";
import { showcaseOrgId } from "@/lib/demoMode";
import { resolveExternalGrantForRun } from "@/lib/externalGrants";

export const runtime = "nodejs";

/** Download a complete, tamper-evident audit record for a run. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ run_id: string }> }
) {
  const { run_id } = await params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data: scope } = await sb.from("ad_runs").select("org_id").eq("run_id", run_id).maybeSingle();

  // Public showcase carve-out: /runs and /runs/[run_id] explicitly promise
  // anonymous visitors they can download and verify a demo run's audit
  // record with "no account required". Those pages are scoped to the single
  // known showcase org (see demoMode.ts showcaseOrgId), so mirror that same
  // scoping here instead of blanket-requiring auth — anonymous access is
  // only ever granted for that one org's runs, everything else still fails
  // closed below.
  const showcaseOrg = await showcaseOrgId();
  if (showcaseOrg && scope?.org_id === showcaseOrg) {
    let record;
    try {
      record = await buildAuditRecord(run_id, new Date().toISOString(), scope.org_id);
    } catch (err) {
      console.error("[api/runs/audit] build failed:", err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "Could not build audit record" }, { status: 500 });
    }
    if (!record) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    return new NextResponse(JSON.stringify(record, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="runback-audit-${run_id}.json"`,
        "cache-control": "no-store",
      },
    });
  }

  // External auditor/regulator grant carve-out (Initiative 5): a
  // `rb_grant_...` bearer token scoped (by run_ids or org_wide) to exactly
  // this run gets the byte-identical signed record a real account would see —
  // read-only, no session, no dashboard access. Checked before getCaller()
  // because getCaller() explicitly rejects any non-`ingest` scope; an
  // external_grant key must never fall through to it (that would grant it
  // the full authenticated-API surface instead of just this one download).
  const grantAuth = req.headers.get("authorization") ?? "";
  const grantMatch = /^Bearer\s+(.+)$/i.exec(grantAuth.trim());
  if (grantMatch) {
    const grant = await resolveExternalGrantForRun(grantMatch[1].trim(), run_id);
    if (grant && scope?.org_id === grant.orgId) {
      let record;
      try {
        record = await buildAuditRecord(run_id, new Date().toISOString(), grant.orgId);
      } catch (err) {
        console.error("[api/runs/audit] build failed (external grant):", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Could not build audit record" }, { status: 500 });
      }
      if (!record) return NextResponse.json({ error: "Run not found" }, { status: 404 });
      return new NextResponse(JSON.stringify(record, null, 2), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="runback-audit-${run_id}.json"`,
          "cache-control": "no-store",
        },
      });
    }
  }

  // Tenant isolation: everything else always requires authentication. A run
  // with org_id must belong to the caller's org; a null-org run
  // (pre-migration or demo) is only readable by an authenticated caller (no
  // anonymous access).
  //
  // Accepts a Bearer API key as well as a session: this is the endpoint the
  // documented `curl ... /audit > audit.json` example uses, and it was
  // cookie-only, so that example could never have worked.
  const caller = await getCaller(req);
  if (!caller) return NextResponse.json({ error: "Not signed in, and no valid API key." }, { status: 401 });

  // Fail closed on a run with no org.
  //
  // `scope.org_id && …` skipped the ownership check entirely whenever org_id
  // was NULL, so an unowned run was readable by any authenticated caller.
  // scope_run_id_per_org.sql makes the column NOT NULL, which is why this was
  // latent rather than live — but that migration was missing from every
  // self-hosted install, and a guard should not depend on a schema constraint
  // to be correct.
  if (!scope?.org_id || caller.orgId !== scope.org_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let record;
  try {
    record = await buildAuditRecord(run_id, new Date().toISOString(), scope?.org_id ?? null);
  } catch (err) {
    console.error("[api/runs/audit] build failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not build audit record" }, { status: 500 });
  }
  if (!record) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return new NextResponse(JSON.stringify(record, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="runback-audit-${run_id}.json"`,
      "cache-control": "no-store",
    },
  });
}

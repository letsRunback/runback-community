import { NextRequest, NextResponse } from "next/server";
import { resolveSecurityFindingsKey } from "@/lib/apiKeys";
import { appendFinding } from "@/lib/securityFindings";
import type { FindingSeverity, FindingVerdict } from "@/lib/securityFindingsCore";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const SEVERITIES: FindingSeverity[] = ["info", "low", "medium", "high", "critical"];
const VERDICTS: FindingVerdict[] = ["flagged", "blocked", "allowed"];

interface FindingBody {
  run_id?: string;
  span_id?: string;
  vendor?: string;
  rule?: string;
  severity?: string;
  verdict?: string;
  detail?: string;
  raw_finding?: unknown;
}

function bearerToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice("Bearer ".length).trim();
}

/**
 * Ingest one external security-tool finding — the webhook target a customer
 * pastes into a guardrail vendor's (Lakera, Cisco AI Defense, ...) config.
 * Authenticated via a `security_findings`-scoped key (issued in Settings),
 * never the general ingest key, so this endpoint is the ONLY thing that
 * credential can ever do.
 */
export async function POST(req: NextRequest) {
  const grant = await resolveSecurityFindingsKey(bearerToken(req));
  if (!grant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: FindingBody;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const { vendor, rule, detail, raw_finding } = body;
  if (!vendor || typeof vendor !== "string") return NextResponse.json({ error: "vendor (string) is required" }, { status: 400 });
  if (!rule || typeof rule !== "string") return NextResponse.json({ error: "rule (string) is required" }, { status: 400 });
  if (!detail || typeof detail !== "string") return NextResponse.json({ error: "detail (string) is required" }, { status: 400 });
  if (raw_finding === undefined) return NextResponse.json({ error: "raw_finding is required" }, { status: 400 });
  if (!body.severity || !SEVERITIES.includes(body.severity as FindingSeverity)) {
    return NextResponse.json({ error: `severity must be one of: ${SEVERITIES.join(", ")}` }, { status: 400 });
  }
  if (!body.verdict || !VERDICTS.includes(body.verdict as FindingVerdict)) {
    return NextResponse.json({ error: `verdict must be one of: ${VERDICTS.join(", ")}` }, { status: 400 });
  }

  // A finding can reference a run — but only one this key's own org actually
  // owns. A vendor integration misconfigured (or a forged run_id) with
  // another org's run id must never let a finding attach to it.
  if (body.run_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = getAdminClient() as any;
    const { data: run } = await sb.from("ad_runs").select("org_id").eq("run_id", body.run_id).maybeSingle();
    if (!run || run.org_id !== grant.orgId) {
      return NextResponse.json({ error: "run_id does not belong to this key's org" }, { status: 403 });
    }
  }

  try {
    const sealed = await appendFinding({
      orgId: grant.orgId,
      runId: body.run_id ?? null,
      spanId: body.span_id ?? null,
      vendor,
      rule,
      severity: body.severity as FindingSeverity,
      verdict: body.verdict as FindingVerdict,
      detail,
      rawFinding: raw_finding,
    });
    return NextResponse.json({ finding: sealed }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: "Finding ingest failed", detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

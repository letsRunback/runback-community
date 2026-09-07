/**
 * Public trust chain verifier — no auth required.
 * Accepts a runback:trust-chain:v2 export and re-derives every attestation
 * signature (Ed25519 where the exporting deployment has a keypair, HMAC-SHA256
 * fallback otherwise — see lib/signing.ts), verifying the chain from root to leaf.
 *
 * v1 exports (HMAC-only, per-org-derived key) are no longer accepted: the
 * signing scheme changed at the root, not just the wire format, so a v1
 * token cannot be re-verified under the v2 algorithm. Re-export from a
 * current deployment.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyAttestationToken, TRUST_CHAIN_SCHEMA } from "@/lib/trust";
import type { Signature } from "@/lib/signing";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Prevent DoS via oversized payload — this endpoint does unbounded crypto work
  // per edge, so an attacker could submit thousands of edges to exhaust CPU.
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 100_000) {
    return NextResponse.json({ error: "Payload too large (max 100 KB)" }, { status: 413 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const chain = body as {
    schema?: string;
    org_id?: string;
    root_run_id?: string;
    edges?: unknown[];
  };

  if (chain.schema !== TRUST_CHAIN_SCHEMA) {
    return NextResponse.json({
      error: `Unknown schema — expected ${TRUST_CHAIN_SCHEMA}. ` +
        (chain.schema === "runback:trust-chain:v1"
          ? "v1 chains were signed with a different, HMAC-only algorithm and can't be re-verified under v2 — re-export from a current deployment."
          : "Re-export the chain and try again."),
    }, { status: 400 });
  }
  if (!chain.org_id || !chain.root_run_id || !Array.isArray(chain.edges)) {
    return NextResponse.json({ error: "Malformed chain" }, { status: 400 });
  }
  if (chain.edges.length > 200) {
    return NextResponse.json({ error: "Too many edges (max 200)" }, { status: 400 });
  }

  let results: Array<{ parent_run_id: string; child_run_id: string; calling_agent: string; called_agent: string; delegation_depth: number; trust_level: string }>;
  try {
    results = chain.edges.map((e: unknown) => {
      const edge = e as {
        parent_run_id: string;
        child_run_id: string;
        calling_agent: string;
        called_agent: string;
        delegation_depth: number;
        scope: string[];
        attestation_hash: string;
        signature: Signature;
        parent_token_hash: string | null;
      };
      const level = verifyAttestationToken(chain.org_id!, edge);
      return {
        parent_run_id: edge.parent_run_id,
        child_run_id: edge.child_run_id,
        calling_agent: edge.calling_agent,
        called_agent: edge.called_agent,
        delegation_depth: edge.delegation_depth,
        trust_level: level,
      };
    });
  } catch (err) {
    console.error("[trust/verify] attestation error:", err);
    return NextResponse.json({ error: "Trust verification unavailable — signing key not configured." }, { status: 503 });
  }

  const broken = results.filter((r) => r.trust_level === "broken").length;
  const overall = broken > 0 ? "broken" : results.some((r) => r.trust_level === "unattested") ? "unattested" : "verified";

  return NextResponse.json({
    schema: "runback:trust-verify:v1",
    root_run_id: chain.root_run_id,
    overall,
    edge_count: results.length,
    broken,
    edges: results,
    verified_at: new Date().toISOString(),
  });
}

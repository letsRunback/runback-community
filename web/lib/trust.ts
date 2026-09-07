/**
 * Moat 5: Inter-agent trust fabric.
 *
 * Every delegation edge (orchestrator → subagent) is sealed with a signature
 * over its attestation hash — Ed25519 wherever this deployment has a keypair
 * configured (the same AUDIT_ED25519_PRIVATE_KEY the per-run audit record
 * signs with), HMAC-SHA256 fallback otherwise. Tokens are chained: each
 * child's payload includes the hash of its parent's signature, making the
 * delegation chain independently verifiable end to end.
 *
 * This used to be its own bespoke HMAC-only implementation, with a signing
 * key derived per-org from AUDIT_SIGNING_KEY — a different scheme from the
 * per-run audit record's Ed25519-preferred signing a few files over. That
 * divergence is exactly what made "every delegation is signed, provably" a
 * true claim for one artifact and a weaker one for the other, and needed
 * fixing twice whenever the signing story changed. Both now call
 * sign()/verifySignature() from lib/signing.ts — see that file for why.
 *
 * Per-org key derivation is gone too: it added nothing verifysignature()
 * doesn't already give for free. org_id is part of the signed payload
 * (below), so a token replayed under a different org_id recomputes to a
 * different attestation_hash and fails step 1 of verification — the same
 * protection the per-org-derived key existed to provide, without a second,
 * bespoke key-management story to keep in sync with the audit record's.
 *
 * Trust levels:
 *   verified   — signature checks out, signer is pinned (or HMAC matches), chain is unbroken
 *   unattested — run predates trust fabric or SDK didn't emit attestation
 *   broken     — signature invalid, unpinned signer, or chain break (integrity violation)
 */
import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { auditHmacKeys } from "@/lib/ledgerCore";
import { sign, verifySignature, type Signature } from "@/lib/signing";
import type { AgentGraph, AgentNode } from "@/lib/multiAgent";

export type TrustLevel = "verified" | "unattested" | "broken";

export const TRUST_CHAIN_SCHEMA = "runback:trust-chain:v2";
export const TRUST_ATTESTATION_SCHEMA = "runback:trust-attestation:v2";

export interface TrustEdge {
  parent_run_id: string;
  child_run_id: string;
  calling_agent: string;
  called_agent: string;
  delegation_depth: number;
  scope: string[];
  attestation_hash: string;
  signature: Signature;
  parent_token_hash: string | null;
  trust_level: TrustLevel;
  /** Tool names the child run actually called that its declared scope does
   *  not cover — a real finding independent of signature validity: a
   *  perfectly signed, unbroken chain can still record a subagent doing
   *  something it was never authorized to do. Empty/absent for wildcard
   *  ("*") scope, since nothing is out of bounds for it. Populated by
   *  auditScopeViolations, not at attestation time — a violation can only
   *  be known after the child run has actually executed. */
  scope_violations?: string[];
}

export interface TrustChain {
  schema: typeof TRUST_CHAIN_SCHEMA;
  org_id: string;
  root_run_id: string;
  edges: TrustEdge[];
  overall: TrustLevel;
  depth: number;
  agent_count: number;
  generated_at: string;
}

/* ── Signing ─────────────────────────────────────────────────────────────────── */

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function canonical(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as object).sort());
}

export function buildAttestationToken(
  orgId: string,
  parentRunId: string,
  childRunId: string,
  callingAgent: string,
  calledAgent: string,
  depth: number,
  scope: string[],
  parentTokenHash: string | null,
  // issued_at intentionally excluded from the cryptographic payload so that
  // verifyAttestationToken can fully re-derive attestation_hash from stable
  // edge fields — preventing attestation transplant attacks.
): { signature: Signature; attestation_hash: string } {
  const payload = {
    schema: TRUST_ATTESTATION_SCHEMA,
    org_id: orgId,
    parent_run_id: parentRunId,
    child_run_id: childRunId,
    calling_agent: callingAgent,
    called_agent: calledAgent,
    delegation_depth: depth,
    scope,
    parent_token_hash: parentTokenHash ?? null,
  };
  const payloadStr = canonical(payload);
  const attestation_hash = sha256(payloadStr);
  const signature = sign(attestation_hash);
  if (!signature) {
    throw new Error("[trust] Neither AUDIT_ED25519_PRIVATE_KEY nor AUDIT_SIGNING_KEY is set — cannot sign attestations");
  }
  return { signature, attestation_hash };
}

export function verifyAttestationToken(
  orgId: string,
  edge: Omit<TrustEdge, "trust_level">
): TrustLevel {
  let expected: { signature: Signature; attestation_hash: string };
  try {
    expected = buildAttestationToken(
      orgId,
      edge.parent_run_id,
      edge.child_run_id,
      edge.calling_agent,
      edge.called_agent,
      edge.delegation_depth,
      edge.scope,
      edge.parent_token_hash,
    );
  } catch {
    return "broken";
  }
  // 1. Payload integrity: stored hash must match the hash derived from these
  //    exact edge fields. Prevents transplant attacks where a valid
  //    (hash, signature) pair from a different edge is reused against
  //    fabricated fields — and, since org_id is part of the hashed payload,
  //    also rejects a chain replayed under a different org.
  if (edge.attestation_hash !== expected.attestation_hash) return "broken";
  // 2. Signature: Ed25519 checked against this deployment's pinned key(s);
  //    HMAC-SHA256 checked against the current + previous rotation set.
  const verdict = verifySignature(edge.attestation_hash, edge.signature, auditHmacKeys());
  return verdict === "valid" ? "verified" : "broken";
}

/* ── DB operations ───────────────────────────────────────────────────────────── */

export async function persistAttestation(
  orgId: string,
  edge: Omit<TrustEdge, "trust_level">
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  await sb.from("trust_attestations").upsert(
    {
      org_id: orgId,
      parent_run_id: edge.parent_run_id,
      child_run_id: edge.child_run_id,
      calling_agent: edge.calling_agent,
      called_agent: edge.called_agent,
      delegation_depth: edge.delegation_depth,
      scope: edge.scope,
      attestation_hash: edge.attestation_hash,
      token: edge.signature.value,
      signature_alg: edge.signature.alg,
      signature_pubkey: edge.signature.pubkey ?? null,
      parent_token_hash: edge.parent_token_hash,
    },
    { onConflict: "org_id,parent_run_id,child_run_id" }
  );
}

export async function getStoredAttestations(
  orgId: string,
  runIds: string[]
): Promise<Omit<TrustEdge, "trust_level">[]> {
  if (!runIds.length) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data } = await sb
    .from("trust_attestations")
    .select("*")
    .eq("org_id", orgId)
    .or(`parent_run_id.in.(${runIds.map(r => `"${r}"`).join(",")}),child_run_id.in.(${runIds.map(r => `"${r}"`).join(",")})`)
    .limit(100);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    parent_run_id: r.parent_run_id as string,
    child_run_id: r.child_run_id as string,
    calling_agent: r.calling_agent as string,
    called_agent: r.called_agent as string,
    delegation_depth: r.delegation_depth as number,
    scope: r.scope as string[],
    attestation_hash: r.attestation_hash as string,
    signature: {
      alg: r.signature_alg as Signature["alg"],
      value: r.token as string,
      pubkey: (r.signature_pubkey as string) ?? undefined,
    },
    parent_token_hash: (r.parent_token_hash as string) ?? null,
    scope_violations: (r.scope_violations as string[] | null) ?? undefined,
  }));
}

/**
 * Attest one delegation edge at ingest time, with a real (not hardcoded)
 * scope. Called from lib/ingest.ts the moment a run's `start` event carries
 * `metadata.parent_run_id` — the same place parent/child linkage is wired.
 *
 * This replaces `deriveAndPersistChain` (removed), which was called
 * lazily from GET /api/trust/chain on every read and always persisted
 * `scope: ["*"]` — including via upsert on top of ANY already-stored edge,
 * so it would have silently clobbered a real scope back to wildcard the
 * next time someone viewed the trust chain. Attesting once, at ingest,
 * with whatever scope the caller actually declared, removes that
 * read-triggered overwrite entirely: nothing persists after ingest, so
 * nothing can stomp it later. Callers that don't declare `metadata.scope`
 * get the same `["*"]` this always defaulted to — additive, not breaking.
 */
export async function attestDelegation(
  orgId: string,
  parentRunId: string,
  childRunId: string,
  scope: string[]
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const [{ data: parent }, { data: child }] = await Promise.all([
    sb.from("ad_runs").select("name").eq("run_id", parentRunId).eq("org_id", orgId).maybeSingle(),
    sb.from("ad_runs").select("name").eq("run_id", childRunId).eq("org_id", orgId).maybeSingle(),
  ]);
  if (!parent || !child) return;

  // The parent's own inbound edge (if it is itself a delegated subagent)
  // determines this edge's depth and the parent_token_hash that chains it —
  // the same chaining getTrustChain() does when walking a graph, just
  // resolved one edge at a time since ingest sees edges as they arrive,
  // not the whole graph at once.
  const { data: parentEdge } = await sb
    .from("trust_attestations")
    .select("delegation_depth,token")
    .eq("org_id", orgId)
    .eq("child_run_id", parentRunId)
    .maybeSingle();
  const depth = parentEdge ? parentEdge.delegation_depth + 1 : 0;
  const parentTokenHash = parentEdge ? sha256(parentEdge.token as string) : null;

  const callingAgent = (parent.name as string) ?? "agent";
  const calledAgent = (child.name as string) ?? "agent";
  const { signature, attestation_hash } = buildAttestationToken(
    orgId, parentRunId, childRunId, callingAgent, calledAgent, depth, scope, parentTokenHash
  );
  await persistAttestation(orgId, {
    parent_run_id: parentRunId,
    child_run_id: childRunId,
    calling_agent: callingAgent,
    called_agent: calledAgent,
    delegation_depth: depth,
    scope,
    attestation_hash,
    signature,
    parent_token_hash: parentTokenHash,
  });
}

/* ── Trust chain for UI ──────────────────────────────────────────────────────── */

export async function getTrustChain(
  rootRunId: string,
  orgId: string,
  graph: AgentGraph
): Promise<TrustChain> {
  // Collect all run IDs in the graph
  const allRunIds: string[] = [];
  function collectIds(node: AgentNode) {
    allRunIds.push(node.run_id);
    node.children.forEach(collectIds);
  }
  collectIds(graph.root);

  // Try to fetch stored attestations
  const stored = await getStoredAttestations(orgId, allRunIds).catch(() => []);
  const storedMap = new Map(stored.map((e) => [`${e.parent_run_id}:${e.child_run_id}`, e]));

  const edges: TrustEdge[] = [];
  let overallLevel: TrustLevel = "verified";

  function walk(node: AgentNode, parentTokenHash: string | null, depth: number) {
    for (const child of node.children) {
      const key = `${node.run_id}:${child.run_id}`;
      let edge: Omit<TrustEdge, "trust_level">;
      let trust_level: TrustLevel;

      if (storedMap.has(key)) {
        edge = storedMap.get(key)!;
        trust_level = verifyAttestationToken(orgId, edge);
      } else {
        // Derive on-the-fly (unattested — not yet in DB)
        const { signature, attestation_hash } = buildAttestationToken(
          orgId,
          node.run_id,
          child.run_id,
          node.name,
          child.name,
          depth,
          ["*"],
          parentTokenHash,
        );
        edge = {
          parent_run_id: node.run_id,
          child_run_id: child.run_id,
          calling_agent: node.name,
          called_agent: child.name,
          delegation_depth: depth,
          scope: ["*"],
          attestation_hash,
          signature,
          parent_token_hash: parentTokenHash,
        };
        trust_level = "unattested";
      }

      if (trust_level === "broken") overallLevel = "broken";
      else if (trust_level === "unattested" && overallLevel === "verified") overallLevel = "unattested";
      // A scope violation is a real integrity finding independent of
      // signature validity — a perfectly signed, unbroken chain can still
      // record a subagent doing something it was never authorized to do.
      // Surfaced at the summary level the same way a broken signature is.
      if (edge.scope_violations?.length) overallLevel = "broken";

      edges.push({ ...edge, trust_level });
      walk(child, sha256(edge.signature.value), depth + 1);
    }
  }

  walk(graph.root, null, 0);

  return {
    schema: TRUST_CHAIN_SCHEMA,
    org_id: orgId,
    root_run_id: rootRunId,
    edges,
    overall: edges.length === 0 ? "verified" : overallLevel,
    depth: graph.maxDepth,
    agent_count: graph.totalRuns,
    generated_at: new Date().toISOString(),
  };
}

/* ── Scope-violation detection ──────────────────────────────────────────────── */

/**
 * Does a declared scope cover this tool call?
 * "*" (the default for anyone who hasn't opted into a real scope) always
 * matches. A trailing "*" is a namespace wildcard ("fs:*" covers "fs:read",
 * "fs:write", ...). Anything else is an exact tool-name match. Deliberately
 * simple — this is a real capability boundary, not a place for a regex
 * engine's edge cases to become a security question.
 */
export function scopeAllows(scope: string[], toolName: string): boolean {
  return scope.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.endsWith("*")) return toolName.startsWith(pattern.slice(0, -1));
    return pattern === toolName;
  });
}

/**
 * Check every non-wildcard delegation edge's actual tool-call history
 * against its declared scope, and persist any violations found.
 *
 * A violation can only be known after the child run has executed — this is
 * necessarily a detection pass over completed history, run from a cron
 * (web/app/api/cron/scope-audit/route.ts), not something checked at
 * attestation time. Wildcard-scope edges are skipped: nothing is out of
 * bounds for "*", so there is nothing to detect.
 */
export async function auditScopeViolations(orgId: string): Promise<{ checked: number; flagged: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data: edges } = await sb
    .from("trust_attestations")
    .select("parent_run_id,child_run_id,scope")
    .eq("org_id", orgId)
    .limit(1000);

  const candidates = ((edges ?? []) as { parent_run_id: string; child_run_id: string; scope: string[] }[]).filter(
    (e) => !(e.scope.length === 1 && e.scope[0] === "*")
  );
  if (!candidates.length) return { checked: 0, flagged: 0 };

  let flagged = 0;
  for (const edge of candidates) {
    const { data: toolEvents } = await sb
      .from("ad_events")
      .select("tool_name")
      .eq("org_id", orgId)
      .eq("run_id", edge.child_run_id)
      .eq("type", "tool")
      .limit(20_000);

    const outOfScope = new Set<string>();
    for (const ev of (toolEvents ?? []) as { tool_name: string | null }[]) {
      if (ev.tool_name && !scopeAllows(edge.scope, ev.tool_name)) outOfScope.add(ev.tool_name);
    }

    // Always write — including clearing a stale violation list if a run was
    // re-processed and no longer shows one (e.g. scope was widened since).
    const violations = [...outOfScope];
    if (violations.length) flagged++;
    await sb
      .from("trust_attestations")
      .update({ scope_violations: violations })
      .eq("org_id", orgId)
      .eq("parent_run_id", edge.parent_run_id)
      .eq("child_run_id", edge.child_run_id);
  }

  return { checked: candidates.length, flagged };
}

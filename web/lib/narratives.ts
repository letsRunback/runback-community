/**
 * Signed, append-only AI narrative log — persistence layer.
 *
 * See web/lib/narrativesCore.ts for the pure hash-chain/signing primitives
 * and why chaining+signing happens in application code rather than a
 * Postgres function (signing needs Node crypto via web/lib/signing.ts,
 * which needs entry_hash to exist first).
 *
 * Concurrency: ad_narratives has a UNIQUE(org_id, prev_hash) constraint
 * (sql/create_narratives.sql). appendNarrative reads the current tail,
 * builds the chain link, and inserts; if a concurrent writer won the race for
 * the same prev_hash, the insert fails with Postgres error 23505
 * (unique_violation — see web/lib/plg.ts for the same check elsewhere in
 * this codebase) and this function re-reads the new tail and retries, up to
 * a small bounded number of attempts. This is MORE protection against a
 * forked chain than web/lib/ledger.ts's sealCheckpoint() has today (no lock,
 * no uniqueness check at all) — an accepted precedent in this codebase for a
 * low-frequency, user-triggered write path, not a gap being reintroduced.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { getTenantClient } from "@/lib/supabase/tenant";
import { auditHmacKeys } from "@/lib/ledgerCore";
import {
  buildNarrativeChainLink,
  verifyNarrative,
  type NarrativeSubject,
  type NarrativeVerification,
} from "@/lib/narrativesCore";
import type { Signature } from "@/lib/signing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readDb = (orgId: string) => getTenantClient(orgId).client as any;

const MAX_APPEND_RETRIES = 5;

export interface NarrativeRow {
  id: string;
  org_id: string;
  run_id: string;
  subject: NarrativeSubject;
  subject_ref: string | null;
  content_digest: string;
  model_id: string;
  prompt: unknown;
  output: unknown;
  payload_hash: string;
  prev_hash: string;
  entry_hash: string;
  signature: Signature;
  created_at: string;
}

async function currentTail(orgId: string): Promise<string> {
  const { data, error } = await db().rpc("narrative_tail", { p_org: orgId });
  if (error) throw new Error(`[narratives] could not read chain tail: ${error.message}`);
  return (data as string | null) ?? "";
}

export interface AppendNarrativeInput {
  orgId: string;
  runId: string;
  subject: NarrativeSubject;
  subjectRef: string | null;
  contentDigest: string;
  modelId: string;
  prompt: unknown;
  output: unknown;
}

/**
 * Seal a new narrative into the org's chain. Never silently drops a
 * generated narrative on a transient conflict — retries with a fresh tail,
 * and throws (rather than returning null) if every retry is exhausted, since
 * a caller that thinks a narrative was sealed when it wasn't is worse than
 * an explicit failure the UI can surface.
 */
export async function appendNarrative(input: AppendNarrativeInput): Promise<NarrativeRow> {
  for (let attempt = 0; attempt < MAX_APPEND_RETRIES; attempt++) {
    const prevHash = await currentTail(input.orgId);
    const link = buildNarrativeChainLink({
      org_id: input.orgId,
      run_id: input.runId,
      subject: input.subject,
      subject_ref: input.subjectRef,
      content_digest: input.contentDigest,
      model_id: input.modelId,
      prompt: input.prompt,
      output: input.output,
      prev_hash: prevHash,
    });

    const { data, error } = await db()
      .from("ad_narratives")
      .insert({
        org_id: input.orgId,
        run_id: input.runId,
        subject: input.subject,
        subject_ref: input.subjectRef,
        content_digest: input.contentDigest,
        model_id: input.modelId,
        prompt: input.prompt,
        output: input.output,
        payload_hash: link.payload_hash,
        prev_hash: link.prev_hash,
        entry_hash: link.entry_hash,
        signature: link.signature,
      })
      .select()
      .single();

    if (!error) return data as NarrativeRow;
    if (error.code !== "23505") {
      throw new Error(`[narratives] append failed: ${error.message}`);
    }
    // 23505 on (org_id, prev_hash) — someone else appended between our read
    // and our insert. Loop and retry against the new tail.
  }
  throw new Error(
    `[narratives] append failed after ${MAX_APPEND_RETRIES} attempts — persistent chain contention for org ${input.orgId}`
  );
}

export async function getNarrativesForRun(orgId: string, runId: string): Promise<NarrativeRow[]> {
  const { data, error } = await readDb(orgId)
    .from("ad_narratives")
    .select("*")
    .eq("org_id", orgId)
    .eq("run_id", runId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`[narratives] fetch failed: ${error.message}`);
  return (data ?? []) as NarrativeRow[];
}

export async function getNarrativeById(orgId: string, id: string): Promise<NarrativeRow | null> {
  const { data, error } = await readDb(orgId)
    .from("ad_narratives")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`[narratives] fetch failed: ${error.message}`);
  return (data as NarrativeRow | null) ?? null;
}

/** Verify a stored row against its own chain/signature, and against the run's CURRENT digest if the caller has it. */
export function verifyStoredNarrative(row: NarrativeRow, currentContentDigest?: string): NarrativeVerification {
  return verifyNarrative(
    {
      org_id: row.org_id, run_id: row.run_id, subject: row.subject, subject_ref: row.subject_ref,
      content_digest: row.content_digest, model_id: row.model_id, prompt: row.prompt, output: row.output,
      payload_hash: row.payload_hash, prev_hash: row.prev_hash, entry_hash: row.entry_hash, signature: row.signature,
    },
    auditHmacKeys(),
    currentContentDigest
  );
}

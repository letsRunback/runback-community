/**
 * Platform audit log — what people did to Runback itself.
 *
 * The run ledger records what the agents did. This records what the operators
 * did: policy edits, key revocations, SSO changes, evidence exports, legal
 * holds. A governance product that cannot answer "who changed this, when, from
 * where" about its own console fails the first question of a security review.
 *
 * Hash-chained with the same primitive as the run ledger, so the operator log
 * is tamper-evident on the terms we ask customers to accept for their agents.
 * Deleting an entry breaks the chain at that seq and cannot be repaired without
 * rewriting every entry after it.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { sha256, canonical } from "@runback/replay";
import { entryHash, auditHmacKeys, timingSafeEqualHex, merkleRoot } from "@/lib/ledgerCore";
import crypto from "crypto";
import { after } from "next/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export type ActorKind = "user" | "api_key" | "system" | "scim";

/**
 * The verbs worth recording. A closed union rather than free-form strings so
 * the log stays queryable and a typo can't silently create a new category that
 * no filter or SIEM rule matches.
 */
export type AdminAction =
  | "policy.create" | "policy.update" | "policy.delete"
  | "prompt.create" | "prompt.update" | "prompt.label_move"
  | "eval.pairwise_override" | "eval.judge_calibrate"
  | "api_key.create" | "api_key.revoke"
  | "member.invite" | "member.remove" | "member.role_change"
  | "session.revoke"
  | "sso.configure" | "sso.disable"
  | "model_key.set" | "model_key.delete"
  | "evidence.export"
  | "ledger.seal"
  | "legal_hold.place" | "legal_hold.release"
  | "retention.change"
  | "org.settings_change";

/**
 * Who performed an action, threaded from the route that authenticated them.
 *
 * Passed explicitly rather than read from a request-scoped global: these
 * functions are also called by cron jobs, SCIM and the SDK, where there is no
 * session, and an audit log that silently attributes a background job to the
 * last signed-in human is worse than one that says "system".
 */
export interface AuditActor {
  kind?: ActorKind;
  userId?: string | null;
  email?: string | null;
  label?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** Build an actor from an authenticated session plus the request it arrived on. */
export function actorFrom(
  session: { userId?: string; email?: string; name?: string | null } | null | undefined,
  req?: { headers: { get(name: string): string | null } }
): AuditActor {
  return {
    kind: session?.userId ? "user" : "system",
    userId: session?.userId ?? null,
    email: session?.email ?? null,
    label: session?.name ?? null,
    // x-forwarded-for is a list; the client is the first entry.
    ip: req?.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null,
    userAgent: req?.headers.get("user-agent") ?? null,
  };
}

export interface AdminEventInput {
  orgId: string;
  action: AdminAction;
  /** Who did it. Omitted → recorded as "system". */
  actor?: AuditActor;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AdminEvent {
  seq: number;
  event_id: string;
  actor_kind: ActorKind;
  actor_email: string | null;
  actor_label: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  created_at: string;
  entry_hash: string;
  prev_hash: string;
  leaf_hash: string;
}

/** What the chain commits to. Anything omitted here can be altered undetected. */
function adminLeaf(e: {
  event_id: string; action: string; actor_kind: string; actor_email: string | null;
  target_type: string | null; target_id: string | null; metadata: unknown; ip: string | null;
}): string {
  return sha256(
    "admin:" +
      canonical({
        event_id: e.event_id,
        action: e.action,
        actor_kind: e.actor_kind,
        actor_email: e.actor_email ?? null,
        target_type: e.target_type ?? null,
        target_id: e.target_id ?? null,
        metadata: e.metadata ?? {},
        ip: e.ip ?? null,
      })
  );
}

/**
 * Record an administrative action. Returns false if it could not be written.
 *
 * Never throws: a failed audit write must not break the action the operator was
 * performing, or an outage in this table takes the whole console down. But it
 * is never silent either — a dropped audit entry is exactly the kind of gap
 * that only surfaces during an investigation, when it is too late to reconstruct.
 * Callers that must not proceed unrecorded should check the return value.
 */
export async function logAdminAction(input: AdminEventInput): Promise<boolean> {
  const eventId = crypto.randomUUID();
  const a = input.actor ?? {};
  const actorKind: ActorKind = a.kind ?? "system";
  const leaf = adminLeaf({
    event_id: eventId,
    action: input.action,
    actor_kind: actorKind,
    actor_email: a.email ?? null,
    target_type: input.targetType ?? null,
    target_id: input.targetId ?? null,
    metadata: input.metadata ?? {},
    ip: a.ip ?? null,
  });
  try {
    const { error } = await db().rpc("admin_event_append", {
      p_org: input.orgId,
      p_event: eventId,
      p_leaf: leaf,
      p_actor_kind: actorKind,
      p_actor_user: a.userId ?? null,
      p_actor_email: a.email ?? null,
      p_actor_label: a.label ?? null,
      p_action: input.action,
      p_target_type: input.targetType ?? null,
      p_target_id: input.targetId ?? null,
      p_metadata: input.metadata ?? {},
      p_ip: a.ip ?? null,
      p_user_agent: a.userAgent ?? null,
    });
    if (error) {
      console.error(`[admin-audit] FAILED to record ${input.action} for org ${input.orgId}: ${error.message}`);
      return false;
    }
    // Anchor the new head. Not awaited into the return value: the action is
    // already recorded, and a failure to seal must never make logAdminAction
    // report that it failed to log.
    //
    // after(), NOT a bare `void`. On Vercel's Node runtime a detached promise
    // is not guaranteed to run once the handler's response is sent — the exact
    // failure lib/ingest.ts documents for alert rules and PLG events. A bare
    // void here left the demo org's chain anchored at seq 23 while the log had
    // grown to 26: every seal after the response had been sent was simply
    // dropped, and the chain reported itself unanchored-beyond-23 rather than
    // wrong, which is how it stayed invisible.
    //
    // Falls back to awaiting when there is no request scope (cron, scripts,
    // tests), where after() is unavailable and the work can simply block.
    try {
      after(() => sealAdminCheckpoint(input.orgId).catch(() => {}));
    } catch {
      await sealAdminCheckpoint(input.orgId).catch(() => {});
    }
    return true;
  } catch (e) {
    console.error(`[admin-audit] FAILED to record ${input.action}:`, e);
    return false;
  }
}

export async function listAdminEvents(
  orgId: string,
  opts: { limit?: number; action?: string | null } = {}
): Promise<AdminEvent[]> {
  let q = db()
    .from("ad_admin_events")
    .select("seq,event_id,actor_kind,actor_email,actor_label,action,target_type,target_id,metadata,ip,created_at,entry_hash,prev_hash,leaf_hash")
    .eq("org_id", orgId)
    .order("seq", { ascending: false })
    .limit(Math.min(opts.limit ?? 200, 1000));
  if (opts.action) q = q.eq("action", opts.action);
  const { data, error } = await q;
  if (error) throw new Error(`could not read the audit log: ${error.message}`);
  return (data ?? []) as AdminEvent[];
}

export interface AdminChainVerification {
  /** true = verified, false = broken, null = could not verify. Never render null as tampering. */
  intact: boolean | null;
  count: number;
  head: string | null;
  brokenAt: { seq: number; action: string; reason: string } | null;
  note: string;
  /**
   * Whether the verified head is backed by an HMAC signature made with a key
   * that is NOT in the database.
   *
   * Re-deriving hashes only catches an editor who forgot to recompute the
   * chain. Anyone with DB write can recompute every hash after tampering and
   * the chain then verifies clean — which is why the run ledger anchors to
   * signed checkpoints. Without an anchor `intact: true` means "internally
   * consistent", not "not rewritten", and callers must be able to tell those
   * apart rather than reading a bare true as proof.
   */
  anchored: boolean;
  anchorNote: string;
  /**
   * Third parties who time-stamped the anchored head. An HMAC anchor is only
   * as strong as AUDIT_SIGNING_KEY: whoever holds it can re-sign a rewritten
   * chain. A TSA receipt cannot be backdated by anyone holding our keys, so
   * "anchored but unwitnessed" is a materially weaker claim than "witnessed"
   * and callers must be able to tell them apart.
   */
  witnesses: string[];
}

/** Largest chain this verifies in one pass. Mirrors lib/ledger.ts's MAX_ROWS. */
const MAX_ADMIN_ROWS = 50_000;

/** Re-derive the whole chain from stored content — detects edits and deletions. */
export async function verifyAdminChain(orgId: string): Promise<AdminChainVerification> {
  // Paged, because the unbounded select this replaced was silently capped at
  // 1000 rows by PostgREST. For any org past that, verification covered only
  // the OLDEST 1000 entries and still returned intact:true — a clean pass over
  // an unverified tail, which is the one answer a tamper check must never give.
  // lib/ledger.ts already paged for exactly this reason; the admin chain, which
  // /security positions as tamper-evident on the same terms, did not.
  type Row = AdminEvent & { event_id: string };
  const PAGE = 1000;
  const rows: Row[] = [];
  let truncated = false;

  for (let from = 0; ; from += PAGE) {
    if (from > MAX_ADMIN_ROWS) { truncated = true; break; }
    const { data, error } = await db()
      .from("ad_admin_events")
      .select("seq,event_id,actor_kind,actor_email,action,target_type,target_id,metadata,ip,leaf_hash,prev_hash,entry_hash")
      .eq("org_id", orgId)
      .order("seq", { ascending: true })
      .range(from, from + PAGE - 1);

    // Same rule as the run ledger: an unreadable store is "cannot confirm", not
    // "confirmed broken". A false tamper alarm here is worse than no answer.
    if (error) {
      return { intact: null, count: 0, head: null, brokenAt: null, anchored: false, anchorNote: "Not anchored to a signed checkpoint.", witnesses: [],
        note: `Could not verify — the audit log was unreadable (${error.message}). This is not a tamper finding.` };
    }
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  // Partial coverage is reported as "cannot confirm", never as a pass.
  if (truncated) {
    return { intact: null, count: rows.length, head: null, brokenAt: null, anchored: false, anchorNote: "Not anchored to a signed checkpoint.", witnesses: [],
      note: `Could not verify — this log exceeds ${MAX_ADMIN_ROWS} entries, so a single pass would cover only part of it. This is not a tamper finding.` };
  }
  if (!rows.length) return { intact: true, count: 0, head: null, brokenAt: null, anchored: false, anchorNote: "Not anchored to a signed checkpoint.", witnesses: [],
    note: "No administrative actions recorded yet." };

  let prev = "";
  let brokenAt: AdminChainVerification["brokenAt"] = null;
  let expectedSeq = 0;
  for (const r of rows) {
    if (r.seq !== expectedSeq) {
      brokenAt ??= { seq: r.seq, action: r.action, reason: `entry ${expectedSeq} is missing — the log has been truncated or an entry deleted` };
      expectedSeq = r.seq;
    }
    const leaf = adminLeaf(r);
    if (leaf !== r.leaf_hash) {
      brokenAt ??= { seq: r.seq, action: r.action, reason: "entry altered after it was written — content no longer matches its hash" };
    }
    if (r.prev_hash !== prev || r.entry_hash !== entryHash(prev, r.leaf_hash)) {
      brokenAt ??= { seq: r.seq, action: r.action, reason: "chain broken — entry does not link to the previous one" };
    }
    prev = r.entry_hash;
    expectedSeq++;
  }
  // Cross-check the re-derived head against the newest signed checkpoint. The
  // signature is HMAC'd with AUDIT_SIGNING_KEY, which does not live in the
  // database — so an attacker who rewrites the chain and recomputes every hash
  // still cannot produce a matching anchor.
  const anchor = await latestAdminAnchor(orgId, rows.length, prev);

  return {
    intact: !brokenAt && anchor.verdict !== "mismatch",
    count: rows.length,
    head: prev,
    brokenAt: brokenAt ?? (anchor.verdict === "mismatch"
      ? { seq: anchor.seq ?? rows.length, action: "checkpoint", reason: anchor.note }
      : null),
    anchored: anchor.verdict === "ok",
    anchorNote: anchor.note,
    witnesses: anchor.witnesses,
    note: brokenAt
      ? `Administrative audit log FAILED verification at seq ${brokenAt.seq}: ${brokenAt.reason}`
      : anchor.verdict === "mismatch"
      ? `Administrative audit log FAILED verification: ${anchor.note}`
      : anchor.verdict === "ok"
      // anchor.note carries the witness qualifier, and it belongs in the
      // user-visible line rather than only in anchorNote: "matches a signed
      // checkpoint" reads as third-party proof, and whether anyone outside
      // this company attested it is exactly the difference.
      ? `All ${rows.length} administrative actions re-derive to their recorded hashes, the chain links cleanly, and the head matches a signed checkpoint. ${anchor.note}`
      // Deliberately does NOT say "verified": without an anchor this only
      // proves internal consistency, which a DB-level rewrite preserves.
      : `All ${rows.length} administrative actions re-derive to their recorded hashes and the chain links cleanly. ${anchor.note}`,
  };
}

/**
 * Seal the admin chain's current head with an HMAC signature.
 *
 * Called after administrative actions are written. Best-effort by design: a
 * failure to anchor must never fail the operation being audited, and an
 * unanchored chain reports itself as unanchored rather than as verified.
 */
export async function sealAdminCheckpoint(orgId: string): Promise<boolean> {
  const key = process.env.AUDIT_SIGNING_KEY;
  if (!key) return false;
  try {
    const v = await verifyAdminChain(orgId);
    if (v.intact !== true || !v.head) return false;

    // A Merkle root over the entry leaves, same as the run ledger's checkpoint.
    // The HMAC alone proves nothing to anyone who doesn't hold the key; a root
    // is what lets a single entry be proven present later without handing over
    // the whole log.
    const root = merkleRoot(await adminLeaves(orgId));

    const { error } = await db().from("ad_admin_checkpoints").insert({
      org_id: orgId,
      seq: v.count,
      head_hash: v.head,
      signature: adminHmac(key, `admin:${orgId}:${v.count}:${v.head}`),
    });
    if (error) return false;

    // External witnessing and publication, both non-fatal — exactly the rule
    // lib/ledger.ts's sealCheckpoint applies. A checkpoint with no witness is
    // weaker evidence; a seal that FAILS because a third-party TSA is down
    // would leave the chain unanchored entirely, which is worse. The gap is
    // reported by verifyAdminChain rather than hidden.
    //
    // This is what closes the remaining gap against the run ledger: the HMAC
    // defeats an attacker confined to the database, but not one who also holds
    // AUDIT_SIGNING_KEY. A third-party time-stamp cannot be backdated by
    // anyone holding our keys.
    try {
      const { witnessCheckpoint } = await import("@/lib/witness");
      const receipts = await witnessCheckpoint(orgId, v.count, v.head, root);
      if (receipts.length) {
        await db().from("ad_admin_witnesses").upsert(
          receipts.map((r) => ({
            org_id: orgId, seq: v.count, tsa: r.tsa, imprint: r.imprint,
            token_b64: r.token, requested_at: r.requestedAt,
          })),
          { onConflict: "org_id,seq,tsa", ignoreDuplicates: true }
        );
      } else {
        console.warn(`[admin-audit] checkpoint ${v.count} sealed with NO external witness — self-attested only`);
      }
    } catch (e) {
      console.error("[admin-audit] witnessing failed (checkpoint still sealed):", e);
    }

    try {
      const { publishCheckpoint } = await import("@/lib/transparency");
      await publishCheckpoint(orgId, v.count, v.head, root, "admin");
    } catch (e) {
      console.error("[admin-audit] transparency publish failed (checkpoint still sealed):", e);
    }

    return true;
  } catch {
    return false;
  }
}

/** Ordered leaf hashes for the org's admin chain — the Merkle input. */
async function adminLeaves(orgId: string): Promise<string[]> {
  const out: string[] = [];
  const PAGE = 1000;
  for (let from = 0; from <= MAX_ADMIN_ROWS; from += PAGE) {
    const { data, error } = await db()
      .from("ad_admin_events").select("leaf_hash").eq("org_id", orgId)
      .order("seq", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as { leaf_hash: string }[];
    out.push(...page.map((r) => r.leaf_hash));
    if (page.length < PAGE) break;
  }
  return out;
}

/** Local mirror of ledgerCore's private hmac — same construction, same key. */
function adminHmac(key: string, payload: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("hex");
}

type AnchorVerdict = { verdict: "ok" | "none" | "mismatch"; note: string; seq?: number; witnesses: string[] };

/** Newest checkpoint for the org, checked against the freshly re-derived head. */
async function latestAdminAnchor(orgId: string, count: number, head: string): Promise<AnchorVerdict> {
  type Ckpt = { seq: number; head_hash: string; signature: string | null };
  let row: Ckpt | null = null;
  try {
    const { data, error } = await db()
      .from("ad_admin_checkpoints")
      .select("seq,head_hash,signature")
      .eq("org_id", orgId)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    // A missing table (migration not yet applied) is "no anchor", not tampering.
    if (error) return { verdict: "none", witnesses: [], note: "No signed checkpoint available, so this confirms internal consistency only — not that the log was never rewritten." };
    row = (data ?? null) as Ckpt | null;
  } catch {
    return { verdict: "none", witnesses: [], note: "No signed checkpoint available, so this confirms internal consistency only — not that the log was never rewritten." };
  }
  if (!row) {
    return { verdict: "none", witnesses: [], note: "No signed checkpoint recorded yet, so this confirms internal consistency only — not that the log was never rewritten." };
  }

  const ckpt: Ckpt = row;
  const keys = auditHmacKeys();
  const payload = `admin:${orgId}:${ckpt.seq}:${ckpt.head_hash}`;
  let signed = false;
  // Check every candidate key even after a match, so rotation state cannot
  // leak through timing — same rule as verifyCheckpointSignature.
  for (const k of keys) if (timingSafeEqualHex(adminHmac(k, payload), ckpt.signature)) signed = true;
  if (!signed) {
    return { verdict: "mismatch", witnesses: [], seq: ckpt.seq, note: `the checkpoint at seq ${ckpt.seq} does not carry a valid signature` };
  }

  // The chain may legitimately have grown past the checkpoint; it must never
  // have shrunk below it, and the sealed head must still be the head at that
  // length.
  if (count < ckpt.seq) {
    return { verdict: "mismatch", witnesses: [], seq: ckpt.seq, note: `the log is shorter (${count}) than its signed checkpoint (${ckpt.seq}) — entries have been removed` };
  }
  if (count === ckpt.seq && head !== ckpt.head_hash) {
    return { verdict: "mismatch", witnesses: [], seq: ckpt.seq, note: `the head at seq ${ckpt.seq} does not match the signed checkpoint — the log has been rewritten` };
  }
  // Which third parties time-stamped this head. Absence is reported, not
  // treated as failure — the anchor is still real, just self-attested.
  let witnesses: string[] = [];
  try {
    const { data: w } = await db()
      .from("ad_admin_witnesses").select("tsa").eq("org_id", orgId).eq("seq", ckpt.seq);
    witnesses = ((w ?? []) as { tsa: string }[]).map((r) => r.tsa);
  } catch { /* a missing witness table is "none", never a tamper finding */ }

  const witnessNote = witnesses.length
    ? ` Time-stamped by ${witnesses.join(", ")}.`
    : " Self-attested only — no external time-stamp, so this rests on our own signing key.";

  return count === ckpt.seq
    ? { verdict: "ok", witnesses, seq: ckpt.seq, note: `Head matches the signed checkpoint at seq ${ckpt.seq}.${witnessNote}` }
    : { verdict: "ok", witnesses, seq: ckpt.seq, note: `Entries up to the signed checkpoint at seq ${ckpt.seq} are anchored; ${count - ckpt.seq} newer entries are not yet sealed.${witnessNote}` };
}

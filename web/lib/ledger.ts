/**
 * Org-wide tamper-evident ledger.
 *
 * Every completed run is appended to an append-only, hash-chained ledger:
 *   entry_hash = sha256(prev_entry_hash || leaf_hash)
 *   leaf_hash  = sha256(canonical(run's attested content))
 * Altering a past run changes its leaf → its entry → every entry after it.
 * Deleting or inserting a run breaks the chain at that seq. A signed CHECKPOINT
 * anchors the head + a Merkle root over all leaves, so an auditor can (a) verify
 * the whole history is intact and Runback-signed, and (b) get an O(log n)
 * inclusion proof that a specific run is in the sealed log.
 *
 * Verification re-derives each leaf from the CURRENT run row, so a digest or
 * status changed after sealing is caught at the exact run.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { getTenantClient } from "@/lib/supabase/tenant";
import {
  runLeaf,
  entryHash,
  merkleRoot,
  merkleProof,
  signCheckpoint,
  tombstoneSetDigest,
  verifyCheckpointSignature,
  auditHmacKeys,
  checkpointTrusted,
  type RunRowForLeaf,
  type MerkleProofStep,
} from "@/lib/ledgerCore";

/** Row ceiling for the verification read. A ledger can be long; capping makes
  * truncation explicit rather than a silent prefix from PostgREST. */
const MAX_ROWS = 50_000;

// Re-export the pure crypto so existing importers of "@/lib/ledger" are unaffected.
export { runLeaf, merkleRoot, merkleProof, verifyMerkleProof, checkpointTrusted } from "@/lib/ledgerCore";
export type { RunRowForLeaf, MerkleProofStep } from "@/lib/ledgerCore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

/**
 * Read client for one org — the database filters by tenant, not just the query.
 *
 * Reads only. The `tenant` role holds SELECT and nothing else, so every write
 * here (ledger_append, checkpoint insert) stays on `db()`: sealing and
 * appending are platform actions that must succeed regardless of which tenant
 * triggered them.
 *
 * This matters more on this file than most. verifyLedger() decides whether an
 * org's audit chain is intact, and it re-derives leaves from the CURRENT run
 * rows — so an unscoped read here would not merely leak, it would compare one
 * tenant's sealed entries against another tenant's runs and report tampering
 * that never happened.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readDb = (orgId: string) => getTenantClient(orgId).client as any;

/** Fail-closed second layer: the tamper-evident ledger is gated on the `ledger` feature (Community and above).
 *  Enforced here (beneath the route gate) so a patched route can't unlock it. */
async function assertLedger(orgId: string, demo: boolean): Promise<void> {
  const { assertFeature } = await import("@/lib/planGate");
  await assertFeature(orgId, "ledger", demo);
}

/* ── Append (called at ingest) ────────────────────────────────────────────── */

/** Append a run to its org's ledger (idempotent). Best-effort; never throws. */
export async function appendToLedger(orgId: string, runId: string): Promise<void> {
  try {
    // `const { data: run }` alone made a FAILED query indistinguishable from
    // "no such run": PostgREST resolves with { data: null, error } rather than
    // throwing, so both fell through the `if (!run) return` and the run was
    // silently never sealed. A tamper-evident ledger that quietly stops
    // recording is worse than one that errors — the gap only surfaces later,
    // as an unexplained missing entry. Separate the two cases and be loud
    // about the one that is a failure.
    const { data: run, error } = await db()
      .from("ad_runs")
      .select("run_id,name,status,cassette_digest,ended_at,step_count")
      .eq("run_id", runId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (error) {
      console.error(`[ledger] append FAILED for run ${runId}: ${error.message}`);
      return;
    }
    if (!run) return;
    const leaf = runLeaf(run as RunRowForLeaf);
    const { error: rpcErr } = await db().rpc("ledger_append", { p_org: orgId, p_run: runId, p_leaf: leaf });
    if (rpcErr) console.error(`[ledger] append FAILED for run ${runId}: ${rpcErr.message}`);
  } catch (e) {
    console.error("[ledger] append failed:", e);
  }
}

/**
 * Explain, before the fact, why runs are about to disappear.
 *
 * ad_ledger is append-only and hash-chained. Deleting a run leaves a sealed
 * entry with nothing behind it, and verifyLedger() cannot tell that apart from
 * an attacker removing evidence — so it reports TAMPER DETECTED, correctly and
 * unhelpfully. A tombstone records the authorised reason; chain linkage is still
 * verified from the ledger row itself, so this explains a deletion, it never
 * excuses a broken chain.
 *
 * Any code path that deletes runs must call this first. enforceRetention()
 * already did; the demo seed script did not, which is why the hosted demo
 * workspace accumulated sealed entries with no backing run and reported itself
 * as tampered. Centralised here so the next deleter inherits the behaviour
 * instead of having to remember it.
 *
 * Returns false when the tombstones could not be written — callers should NOT
 * delete in that case. An undeleted run is a small problem; an unexplained gap
 * in a tamper-evident ledger is the product failing at its one job.
 */
export async function tombstoneRuns(
  orgId: string,
  runIds: string[],
  reason: string
): Promise<boolean> {
  if (!runIds.length) return true;
  const { error } = await db()
    .from("ad_ledger_tombstones")
    .upsert(
      runIds.map((run_id) => ({ org_id: orgId, run_id, reason })),
      { onConflict: "org_id,run_id", ignoreDuplicates: true }
    );
  if (error) {
    console.error(`[ledger] tombstone write failed (${reason}):`, error.message);
    return false;
  }
  return true;
}

/* ── Status / seal / verify ───────────────────────────────────────────────── */

export interface LedgerStatus {
  count: number;
  head: string | null;
  sealedThrough: number;       // seq covered by the latest checkpoint
  lastCheckpointAt: string | null;
  signed: boolean;
}

/**
 * Read the org's ENTIRE ledger, in order.
 *
 * This must be complete, not merely bounded. It feeds verifyLedger(), whose
 * result goes into the regulator-facing compliance report, and both truncation
 * outcomes are wrong in opposite directions:
 *
 *   - a checkpoint inside the first page  → "intact: true" after checking only
 *     a prefix, i.e. silent under-verification of the one guarantee we sell;
 *   - a checkpoint past it                → entries[cp.seq-1] is undefined, so
 *     head and root mismatch and an untouched ledger reports as TAMPERED.
 *
 * PostgREST caps an unbounded select at db-max-rows (1000) with no error and no
 * signal, so "no .limit()" was never "no limit" — it was a 1000-row prefix.
 * Page explicitly instead, and if a ledger somehow exceeds the ceiling, throw:
 * verifyLedger already treats a read failure as "unknown, retry" rather than a
 * tamper finding, which is the correct answer for "we could not read it all".
 */
async function fetchEntries(orgId: string) {
  type Entry = { seq: number; run_id: string; leaf_hash: string; prev_hash: string; entry_hash: string };
  const PAGE = 1000;
  const out: Entry[] = [];

  for (let from = 0; from <= MAX_ROWS; from += PAGE) {
    const { data, error } = await readDb(orgId)
      .from("ad_ledger")
      .select("seq,run_id,leaf_hash,prev_hash,entry_hash")
      .eq("org_id", orgId)
      .order("seq", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`could not read the ledger: ${error.message}`);
    const page = (data ?? []) as Entry[];
    out.push(...page);
    if (page.length < PAGE) return out;
  }

  throw new Error(
    `ledger for org ${orgId} exceeds ${MAX_ROWS} entries; verification would be partial. ` +
      "Raise MAX_ROWS or verify incrementally from the last signed checkpoint."
  );
}

async function latestCheckpoint(orgId: string) {
  const { data } = await readDb(orgId)
    .from("ad_ledger_checkpoints")
    .select("seq,head_hash,merkle_root,signature,tombstone_digest,created_at")
    .eq("org_id", orgId)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { seq: number; head_hash: string; merkle_root: string; signature: string | null; tombstone_digest: string | null; created_at: string } | null;
}

export async function ledgerStatus(orgId: string, demo = false): Promise<LedgerStatus> {
  await assertLedger(orgId, demo);
  const entries = await fetchEntries(orgId);
  const cp = await latestCheckpoint(orgId);
  return {
    count: entries.length,
    head: entries.length ? entries[entries.length - 1].entry_hash : null,
    sealedThrough: cp?.seq ?? 0,
    lastCheckpointAt: cp?.created_at ?? null,
    signed: !!cp?.signature,
  };
}

/** Seal the current ledger head + Merkle root into a signed checkpoint. */
export async function sealCheckpoint(
  orgId: string,
  demo = false,
  opts: { skipIfUnchanged?: boolean } = {}
): Promise<{ seq: number; head: string; root: string; signed: boolean; witnesses: string[]; published: { logSeq: number; logId: string } | null; unchanged?: true } | null> {
  await assertLedger(orgId, demo);
  const entries = await fetchEntries(orgId);
  if (entries.length === 0) return null;
  const head = entries[entries.length - 1].entry_hash;
  const root = merkleRoot(entries.map((e) => e.leaf_hash));
  const seq = entries.length;

  // Bind the current tombstone set into the signature. A tombstone excuses a
  // content mismatch, so it must be part of what's signed and witnessed — else
  // a DB-write attacker could alter a sealed run and add a tombstone to hide it.
  const tsRes = await readDb(orgId).from("ad_ledger_tombstones").select("run_id,reason").eq("org_id", orgId);
  const tombstoneDigest = tombstoneSetDigest((tsRes.data ?? []) as { run_id: string; reason: string }[]);

  // Re-sealing a head that has not moved adds no evidence, and the work is not
  // free: a full ledger read, an INSERT, two external RFC 3161 requests and a
  // publish attempt, per org, per run. On an hourly cron across every org with
  // recent activity that is almost entirely waste — and the TSA services are
  // free public ones, so the requests are a courtesy we should not spend on
  // nothing.
  //
  // The comparison includes the tombstone digest deliberately: a new tombstone
  // changes what the signature binds even when seq and head are identical, so
  // treating those two as "unchanged" would leave the tombstone unsigned.
  if (opts.skipIfUnchanged) {
    const { data: last } = await db()
      .from("ad_ledger_checkpoints")
      .select("seq,head_hash,tombstone_digest")
      .eq("org_id", orgId)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    const prior = last as { seq: number; head_hash: string; tombstone_digest?: string | null } | null;
    if (
      prior &&
      prior.seq === seq &&
      prior.head_hash === head &&
      (prior.tombstone_digest ?? null) === (tombstoneDigest ?? null)
    ) {
      const { data: w } = await db()
        .from("ad_ledger_witnesses").select("tsa").eq("org_id", orgId).eq("seq", seq);
      return {
        seq, head, root,
        signed: true,
        witnesses: ((w ?? []) as { tsa: string }[]).map((r) => r.tsa),
        published: null,
        unchanged: true,
      };
    }
  }

  const signature = signCheckpoint(orgId, seq, head, root, tombstoneDigest);
  let ins = await db().from("ad_ledger_checkpoints").insert({
    org_id: orgId, seq, head_hash: head, merkle_root: root, signature, tombstone_digest: tombstoneDigest,
  });
  if (ins.error) {
    // tombstone_digest column may not exist yet (deploy-before-migrate window,
    // add_checkpoint_tombstone_digest.sql). Fall back to a signature that does
    // NOT bind the tombstone set, so sealing never breaks on a lagging schema —
    // and re-sign accordingly so verifyLedger's legacy path accepts it.
    const legacySig = signCheckpoint(orgId, seq, head, root);
    ins = await db().from("ad_ledger_checkpoints").insert({
      org_id: orgId, seq, head_hash: head, merkle_root: root, signature: legacySig,
    });
    if (ins.error) console.error("[ledger] checkpoint insert failed:", ins.error.message);
  }

  // Anchor the checkpoint outside our control.
  //
  // Our own signature proves nobody ELSE altered the chain. It cannot prove we
  // did not, because we hold the key. A time-stamp authority signs this head
  // with a certificate we do not control and cannot backdate, so rewriting
  // history stops being something only we could detect.
  //
  // Deliberately after the insert and never fatal: a checkpoint with no witness
  // is weaker evidence, but a seal that fails because a third-party server is
  // down would leave the chain not anchored at all. The gap is recorded rather
  // than hidden — verifyLedger reports how many witnesses a checkpoint has.
  const { witnessCheckpoint } = await import("@/lib/witness");
  const receipts = await witnessCheckpoint(orgId, seq, head, root);
  if (receipts.length) {
    const { error: wErr } = await db().from("ad_ledger_witnesses").upsert(
      receipts.map((r) => ({
        org_id: orgId, seq, tsa: r.tsa, imprint: r.imprint,
        token_b64: r.token, requested_at: r.requestedAt,
      })),
      { onConflict: "org_id,seq,tsa", ignoreDuplicates: true }
    );
    if (wErr) console.error("[ledger] witness receipts not stored:", wErr.message);
  } else {
    console.warn(`[ledger] checkpoint ${seq} sealed with NO external witness — self-attested only`);
  }

  // Publish to the public log.
  //
  // Time-stamping proves we did not rewrite this checkpoint. It cannot prove we
  // are not ALSO keeping a second, divergent chain and stamping that too.
  // Publishing every head to one append-only feed is what makes equivocation
  // visible to anyone archiving it. Non-fatal for the same reason as witnessing.
  const { publishCheckpoint } = await import("@/lib/transparency");
  const published = await publishCheckpoint(orgId, seq, head, root);

  return {
    seq, head, root,
    signed: !!signature,
    witnesses: receipts.map((r) => r.tsa),
    published: published ? { logSeq: published.seq, logId: published.log_id } : null,
  };
}

export interface LedgerVerification {
  /** true = verified, false = tampering found, null = could not verify (e.g. the
   *  run store was unreadable). null must never be rendered as a tamper finding. */
  intact: boolean | null;
  count: number;
  head: string | null;
  root: string | null;
  brokenAt: { seq: number; run_id: string; reason: string } | null;
  /** Entries whose backing run is gone but explained by a retention tombstone
   *  written before deletion (web/lib/usage.ts). Chain linkage for these
   *  entries is still fully verified from the stored leaf_hash — only
   *  content re-derivation is (necessarily) skipped, since the content is
   *  gone. Not a weaker check: an attacker can't forge a tombstone to hide a
   *  broken chain link, only to explain an otherwise-inevitable missing run. */
  retired: { count: number; reasons: string[] } | null;
  checkpoint: {
    seq: number;
    matchesHead: boolean;
    matchesRoot: boolean;
    signatureValid: boolean;
    /**
     * Independent time-stamp authorities that attested this checkpoint.
     *
     * Empty means the checkpoint rests on our signature alone — which proves
     * nobody ELSE altered the chain, and cannot prove we did not, because we
     * hold the key. Surfaced rather than omitted so "self-attested" is never
     * indistinguishable from "externally witnessed".
     */
    witnesses: { tsa: string; requestedAt: string }[];
  } | null;
  note: string;
}

/**
 * Say WHICH part of the checkpoint failed, not just that something did.
 *
 * When the chain itself re-derives cleanly but the checkpoint does not verify,
 * brokenAt is null and the message used to read "The current ledger does not
 * match the last signed checkpoint" — indistinguishable from evidence tampering.
 *
 * The overwhelmingly likely cause of a signature-only failure is a rotated
 * AUDIT_SIGNING_KEY with AUDIT_SIGNING_KEY_PREVIOUS unset: the chain is fine and
 * every entry re-derives, but checkpoints signed under the old key no longer
 * verify. That is a configuration mistake with a 30-second fix, and reporting it
 * as tampering sends someone hunting for an intruder instead.
 *
 * A head or root mismatch is materially different — the sealed anchor genuinely
 * disagrees with the current chain — so those are named separately rather than
 * softened along with it.
 */
function checkpointFailureNote(
  cp: { seq: number; matchesHead: boolean; matchesRoot: boolean; signatureValid: boolean } | null
): string {
  if (!cp) return "The current ledger does not match the last signed checkpoint.";
  if (!cp.matchesHead || !cp.matchesRoot) {
    return `The ledger no longer matches checkpoint ${cp.seq}: ` +
      `${!cp.matchesHead ? "the chain head differs" : ""}` +
      `${!cp.matchesHead && !cp.matchesRoot ? " and " : ""}` +
      `${!cp.matchesRoot ? "the Merkle root differs" : ""}. ` +
      "Entries have been altered, inserted or removed since it was sealed.";
  }
  return `Checkpoint ${cp.seq} covers the correct head and Merkle root, but its signature does not verify. ` +
    "The chain itself is intact — every entry re-derives. This is the signature of a rotated AUDIT_SIGNING_KEY: " +
    "set AUDIT_SIGNING_KEY_PREVIOUS to the outgoing key so checkpoints sealed under it are accepted, then re-seal.";
}

/** Re-derive and re-chain the whole ledger from current run rows; verify vs checkpoint. */
export async function verifyLedger(orgId: string, demo = false): Promise<LedgerVerification> {
  await assertLedger(orgId, demo);

  // An incomplete read is "cannot confirm", never "confirmed broken" — the same
  // rule applied to a failed run lookup below. Letting this throw would surface
  // as a 500 on the compliance report, which reads as a broken product rather
  // than an unavailable answer.
  let entries: Awaited<ReturnType<typeof fetchEntries>>;
  try {
    entries = await fetchEntries(orgId);
  } catch (e) {
    return {
      intact: null,
      count: 0,
      head: null,
      root: null,
      brokenAt: null,
      retired: null,
      checkpoint: null,
      note:
        `The ledger could not be read in full, so it was not verified: ${(e as Error).message} ` +
        "This is not a tamper finding; retry before drawing any conclusion.",
    };
  }

  if (entries.length === 0) {
    return { intact: true, count: 0, head: null, root: null, brokenAt: null, retired: null, checkpoint: null, note: "Ledger is empty." };
  }

  // Re-derive each leaf from the CURRENT run row → detects post-seal tampering.
  //
  // Scoped to this org. Without the org filter an entry could be satisfied by a
  // run belonging to a DIFFERENT tenant that happens to carry the same run_id —
  // reachable when a run is deleted from one org and its id later reused by
  // another, which is exactly what happened migrating the demo workspace. A
  // tamper-evidence check must answer "does THIS org still hold the run it
  // sealed", not "does this id exist anywhere".
  const ids = entries.map((e) => e.run_id);
  const runsRes = await readDb(orgId).from("ad_runs")
    .select("run_id,name,status,cassette_digest,ended_at,step_count")
    .eq("org_id", orgId)
    .in("run_id", ids).limit(MAX_ROWS);

  // A failed read must never be reported as tampering. `const runs = res.data`
  // turned any query error into data: null, which made every sealed run look
  // deleted and the ledger read as TAMPER DETECTED — a false alarm from a
  // transient database error, on the one screen where a false alarm is most
  // expensive. Verification is fail-closed by design, but "closed" here means
  // "cannot confirm", not "confirmed broken".
  if (runsRes.error) {
    return {
      intact: null,
      count: entries.length,
      head: null,
      root: null,
      brokenAt: null,
      retired: null,
      checkpoint: null,
      note: `Could not verify — the run store was unreadable (${runsRes.error.message}). This is not a tamper finding; retry before drawing any conclusion.`,
    };
  }
  const runs = runsRes.data;
  // ALL org tombstones — not just those matching ledger ids — because the
  // checkpoint's signed tombstone digest is computed over the whole set, so
  // verification must recompute it over the same set.
  // Best-effort — a missing table on a lagging migration must never break verification.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tombstonesRes: any = await readDb(orgId).from("ad_ledger_tombstones")
    .select("run_id,reason")
    .eq("org_id", orgId)
    .then((r: unknown) => r)
    .catch(() => ({ data: null }));
  const tombstones: { run_id: string; reason: string }[] | null = tombstonesRes?.data ?? null;
  const runById = new Map((runs ?? []).map((r: RunRowForLeaf) => [r.run_id, r]));
  const tombstoneByRunId = new Map((tombstones ?? []).map((t: { run_id: string; reason: string }) => [t.run_id, t.reason]));

  // Whether tombstones may excuse a content mismatch depends on whether the
  // current tombstone set is the one the checkpoint SIGNED. A tombstone added
  // after the last seal — by an attacker to hide an alteration, or by retention
  // that has not been re-anchored — is not in the signed digest and must not
  // excuse anything until a re-seal covers it.
  const cp = await latestCheckpoint(orgId);
  const currentTombstoneDigest = tombstoneSetDigest(tombstones ?? []);
  const tombstonesAnchored =
    !cp ? true                                   // no checkpoint yet — chain re-derivation stands alone
    : !cp.tombstone_digest ? true                // legacy checkpoint, pre-coverage — old behaviour, re-seal to upgrade
    : cp.tombstone_digest === currentTombstoneDigest;

  let prev = "";
  let brokenAt: LedgerVerification["brokenAt"] = null;
  let retiredCount = 0;
  const retiredReasons: string[] = [];
  const leaves: string[] = [];
  for (const e of entries) {
    const run = runById.get(e.run_id) as RunRowForLeaf | undefined;
    const derivedLeaf = run ? runLeaf(run) : null;
    const tombstoneReason = tombstoneByRunId.get(e.run_id);

    // The tombstone is checked FIRST, and regardless of whether a run bearing
    // this id exists today.
    //
    // A tombstone means the run this entry sealed was deleted under policy. Run
    // ids are chosen by the caller, so the id can later be reused — the demo
    // seed does exactly that, deleting and recreating demo-refund-agent on
    // every run. Comparing the sealed leaf against whatever now holds that id
    // compares two unrelated runs and reports "altered after sealing" for a
    // ledger that is behaving correctly.
    //
    // A tombstone excuses a content mismatch ONLY when it is anchored — part of
    // the set the checkpoint signed and a witness time-stamped. An unanchored
    // tombstone (added since the last seal) is treated as if absent, so it
    // cannot hide an alteration: a database-write attacker who alters a sealed
    // run and adds a tombstone for it gets a mismatch reported, not excused,
    // until they produce a fresh signed + witnessed checkpoint — which needs the
    // key and cannot be backdated.
    if (tombstoneReason && tombstonesAnchored) {
      retiredCount++;
      if (!retiredReasons.includes(tombstoneReason)) retiredReasons.push(tombstoneReason);
    } else if (!run) {
      brokenAt ??= { seq: e.seq, run_id: e.run_id, reason: "run deleted — sealed entry has no backing run and no retention tombstone" };
    } else if (derivedLeaf !== e.leaf_hash) {
      brokenAt ??= { seq: e.seq, run_id: e.run_id, reason: "run altered after sealing — content no longer matches its leaf" };
    }
    // Chain linkage uses the leaf_hash stored on the ledger row itself, not
    // the run — verified unconditionally, tombstoned or not.
    const expectEntry = entryHash(prev, e.leaf_hash);
    if (e.prev_hash !== prev || e.entry_hash !== expectEntry) {
      brokenAt ??= { seq: e.seq, run_id: e.run_id, reason: "chain broken — entry hash does not link to the previous entry" };
    }
    leaves.push(e.leaf_hash);
    prev = e.entry_hash;
  }
  const head = prev;
  const root = merkleRoot(leaves);
  const retired = retiredCount > 0 ? { count: retiredCount, reasons: retiredReasons } : null;

  // cp was fetched above (before the loop) so the anchored decision could use it.
  let checkpoint: LedgerVerification["checkpoint"] = null;
  if (cp) {
    const sealedLeaves = leaves.slice(0, cp.seq);
    const headAtSeq = entries[cp.seq - 1]?.entry_hash ?? "";
    const rootAtSeq = merkleRoot(sealedLeaves);
    checkpoint = {
      seq: cp.seq,
      matchesHead: headAtSeq === cp.head_hash,
      matchesRoot: rootAtSeq === cp.merkle_root,
      // Accepts the previous key too. Recomputing with only the current key
      // would report every checkpoint sealed before a rotation as invalid —
      // and since verification is fail-closed, an intact ledger would read as
      // tampered purely because the key changed.
      signatureValid: verifyCheckpointSignature(
        orgId, cp.seq, cp.head_hash, cp.merkle_root, cp.signature, cp.tombstone_digest
      ),
      witnesses: [],
    };

    // Independent attestations of this checkpoint, if any were obtained.
    // Read separately and non-fatally: a witness lookup that fails must not
    // turn an intact ledger into an unverifiable one.
    const wRes = await readDb(orgId)
      .from("ad_ledger_witnesses")
      .select("tsa,requested_at")
      .eq("org_id", orgId)
      .eq("seq", cp.seq);
    if (!wRes.error) {
      checkpoint.witnesses = (wRes.data ?? []).map(
        (w: { tsa: string; requested_at: string }) => ({ tsa: w.tsa, requestedAt: w.requested_at })
      );
    }
  }

  const keyConfigured = auditHmacKeys().length > 0;
  const intact = !brokenAt && checkpointTrusted(keyConfigured, checkpoint);
  const retiredSuffix = retired ? ` ${retired.count} entr${retired.count === 1 ? "y" : "ies"} retired per policy (${retired.reasons.join(", ")}) — chain linkage still verified for those.` : "";
  return {
    intact,
    count: entries.length,
    head,
    root,
    brokenAt,
    retired,
    checkpoint,
    note: intact
      ? (cp
          ? "Every run re-derives to its sealed leaf, the chain links cleanly, and the head + Merkle root match the signed checkpoint." +
            // Name the difference between "we vouch for this" and "someone who
            // is not us vouched for this". Both are intact; only one survives
            // the question "what if the operator altered it?".
            (checkpoint && checkpoint.witnesses.length
              ? ` Externally witnessed by ${checkpoint.witnesses.map((w) => w.tsa).join(", ")} — the checkpoint head was time-stamped by an authority Runback does not control, so it cannot have been re-sealed after the fact.`
              : " Self-attested only: this checkpoint carries no external time-stamp, so it proves nobody other than Runback altered the chain.")
          : "Chain intact. Seal a checkpoint to anchor and sign the current head.") + retiredSuffix
      : brokenAt
        ? `Tamper detected at seq ${brokenAt.seq} (${brokenAt.run_id}): ${brokenAt.reason}.`
        : checkpointFailureNote(checkpoint),
  };
}

/**
 * The checkpoint that anchors a specific run — the earliest sealed checkpoint
 * whose seq covers this run's ledger position — plus its external witnesses
 * and public-feed position, if any. This is what makes a proof bundle
 * self-sufficient: a customer (or a third party they hand it to) can confirm
 * the run's checkpoint was time-stamped by an authority Runback doesn't
 * control, and is publicly, independently visible, without calling back into
 * Runback's authenticated API to ask "do you still say this is true".
 */
export async function checkpointCoveringRun(
  orgId: string,
  runId: string
): Promise<{
  seq: number;
  witnesses: { tsa: string; requestedAt: string }[];
  transparency: { logId: string; ckptSeq: number; feedSeq: number } | null;
} | null> {
  const entries = await fetchEntries(orgId);
  const idx = entries.findIndex((e) => e.run_id === runId);
  if (idx < 0) return null;
  const runSeq = entries[idx].seq;

  const { data: cp } = await readDb(orgId)
    .from("ad_ledger_checkpoints")
    .select("seq")
    .eq("org_id", orgId)
    .gte("seq", runSeq)
    .order("seq", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!cp) return null;

  const { data: witnessRows } = await readDb(orgId)
    .from("ad_ledger_witnesses")
    .select("tsa,requested_at")
    .eq("org_id", orgId)
    .eq("seq", cp.seq);

  const { publicEntryFor } = await import("@/lib/transparency");
  const published = await publicEntryFor(orgId, cp.seq).catch(() => null);

  return {
    seq: cp.seq,
    witnesses: (witnessRows ?? []).map((w: { tsa: string; requested_at: string }) => ({
      tsa: w.tsa,
      requestedAt: w.requested_at,
    })),
    transparency: published ? { logId: published.log_id, ckptSeq: published.ckpt_seq, feedSeq: published.seq } : null,
  };
}

/** Inclusion proof that a run is in the sealed log (for the run page). */
export async function inclusionProof(orgId: string, runId: string): Promise<{ sealed: boolean; seq?: number; proof?: MerkleProofStep[]; root?: string } | null> {
  const entries = await fetchEntries(orgId);
  const idx = entries.findIndex((e) => e.run_id === runId);
  if (idx < 0) return { sealed: false };
  const leaves = entries.map((e) => e.leaf_hash);
  return { sealed: true, seq: entries[idx].seq, proof: merkleProof(leaves, idx), root: merkleRoot(leaves) };
}

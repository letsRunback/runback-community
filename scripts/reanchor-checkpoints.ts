/**
 * One-time upgrade: re-seal and re-witness every checkpoint under the hardened
 * scheme from the red-team fixes.
 *
 *   AUDIT_SIGNING_KEY=$(cat .secrets/audit-signing-key) \
 *   DOTENV_CONFIG_PATH=web/.env.local \
 *   npx tsx --tsconfig web/tsconfig.json -r dotenv/config scripts/reanchor-checkpoints.ts --commit
 *
 * Two things changed and existing checkpoints predate both:
 *   - the checkpoint signature now covers a digest of the tombstone set, so a
 *     tombstone added after sealing cannot excuse a content mismatch (Finding 2);
 *   - the witness imprint dropped org_id, so it is sha256(checkpoint:seq:head:root)
 *     over public values only, not a deanonymisation oracle (Finding 4).
 *
 * A legacy checkpoint (tombstone_digest = null) still verifies — the code keeps a
 * backward path — but it is NOT protected by Finding 2, and its witness tokens
 * attest the old imprint. This re-seals each org's checkpoint with the tombstone
 * digest, replaces the stale witness receipts with fresh ones under the new
 * imprint, and re-publishes (idempotent — the head is unchanged).
 *
 * Append-only in spirit: the head and Merkle root do not change, so the
 * transparency feed entry is unchanged and re-publish is a no-op. Only the
 * signature and the witness tokens are refreshed. Requires AUDIT_SIGNING_KEY.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { merkleRoot, signCheckpoint, verifyCheckpointSignature, tombstoneSetDigest } from "@/lib/ledgerCore";
import { witnessCheckpoint } from "@/lib/witness";
import { publishCheckpoint } from "@/lib/transparency";
import { verifyLedger } from "@/lib/ledger";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = getAdminClient() as any;
const COMMIT = process.argv.includes("--commit");

async function main() {
  if (!process.env.AUDIT_SIGNING_KEY) {
    console.error("AUDIT_SIGNING_KEY not set — re-sealing is a signing operation. Refusing.");
    process.exit(2);
  }
  if (!COMMIT) console.log("DRY RUN — pass --commit to write.\n");

  const { data: orgs } = await db.from("orgs").select("id,name").order("name");
  for (const org of orgs ?? []) {
    const { data: cp } = await db
      .from("ad_ledger_checkpoints")
      .select("seq,head_hash,merkle_root,signature,tombstone_digest")
      .eq("org_id", org.id).order("seq", { ascending: false }).limit(1).maybeSingle();
    if (!cp) { console.log(`  ${String(org.name).padEnd(14)} no checkpoint — skip`); continue; }

    // Re-derive head/root from the current ledger to be sure we sign the truth.
    const entries: { seq: number; leaf_hash: string; entry_hash: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await db.from("ad_ledger").select("seq,leaf_hash,entry_hash")
        .eq("org_id", org.id).order("seq", { ascending: true }).range(from, from + 999);
      entries.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    const head = entries[entries.length - 1].entry_hash;
    const root = merkleRoot(entries.map((e) => e.leaf_hash));
    const seq = entries.length;

    const { data: ts } = await db.from("ad_ledger_tombstones").select("run_id,reason").eq("org_id", org.id);
    const tombstoneDigest = tombstoneSetDigest((ts ?? []) as { run_id: string; reason: string }[]);
    const upgraded = cp.tombstone_digest === tombstoneDigest && head === cp.head_hash;

    console.log(`  ${String(org.name).padEnd(14)} seq${seq}  ${upgraded ? "already upgraded" : "re-seal + re-witness"}`);
    if (!COMMIT || upgraded) continue;

    const signature = signCheckpoint(org.id, seq, head, root, tombstoneDigest);
    // Replace the checkpoint row at this seq with the tombstone-bound signature.
    await db.from("ad_ledger_checkpoints").delete().eq("org_id", org.id).eq("seq", seq);
    await db.from("ad_ledger_checkpoints").insert({
      org_id: org.id, seq, head_hash: head, merkle_root: root, signature, tombstone_digest: tombstoneDigest,
    });

    // Replace stale witness receipts (old imprint) with fresh ones (new imprint).
    await db.from("ad_ledger_witnesses").delete().eq("org_id", org.id).eq("seq", seq);
    const receipts = await witnessCheckpoint(org.id, seq, head, root);
    if (receipts.length) {
      await db.from("ad_ledger_witnesses").upsert(
        receipts.map((r) => ({
          org_id: org.id, seq, tsa: r.tsa, imprint: r.imprint, token_b64: r.token, requested_at: r.requestedAt,
        })),
        { onConflict: "org_id,seq,tsa", ignoreDuplicates: true }
      );
    }
    await publishCheckpoint(org.id, seq, head, root); // idempotent — same head

    const sigOk = verifyCheckpointSignature(org.id, seq, head, root, signature, tombstoneDigest);
    const v = await verifyLedger(org.id, true);
    console.log(`     sig(tombstone-bound)=${sigOk} witnesses=${receipts.map((r) => r.tsa).join(",") || "none"} intact=${v.intact}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

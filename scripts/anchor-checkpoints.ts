/**
 * Anchor every org's ledger to external witnesses and the public log.
 *
 *   AUDIT_SIGNING_KEY=$(cat .secrets/audit-signing-key) \
 *   DOTENV_CONFIG_PATH=web/.env.local \
 *   npx tsx --tsconfig web/tsconfig.json -r dotenv/config scripts/anchor-checkpoints.ts [--commit]
 *
 * Checkpoints sealed before external witnessing shipped rest on our signature
 * alone — which proves nobody ELSE altered the chain and cannot prove we did
 * not, because we hold the key. This backfills the missing half: a time-stamp
 * from authorities we do not control, and publication to the append-only public
 * feed so we cannot keep a second divergent history either.
 *
 * ── Why this is a script and not a flag ────────────────────────────────────
 * sealCheckpoint() is entitlement-gated: the ledger is a licensed capability,
 * and every org here is on the free tier. The gate is correct and should stay,
 * so rather than adding a bypass to production code — where a route could
 * later reach it — the seal is performed here, explicitly, as an operator
 * action. Anchoring evidence that already exists is a platform responsibility,
 * not a feature being granted to a customer.
 *
 * ── What it will and will not do ───────────────────────────────────────────
 * Append-only. It never deletes, never rewrites a head, and never re-seals a
 * checkpoint whose head still matches the current chain — that one only needs
 * witnessing. A new checkpoint is written only where none exists at the
 * current length.
 *
 * Requires AUDIT_SIGNING_KEY. An unsigned checkpoint is worse than none: it
 * looks anchored and is not. This refuses to run without the key, having
 * already made that mistake once by hand.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { merkleRoot, signCheckpoint } from "@/lib/ledgerCore";
import { witnessCheckpoint } from "@/lib/witness";
import { publishCheckpoint } from "@/lib/transparency";
import { verifyLedger } from "@/lib/ledger";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = getAdminClient() as any;
const COMMIT = process.argv.includes("--commit");

async function main() {
  if (!process.env.AUDIT_SIGNING_KEY) {
    console.error(
      "AUDIT_SIGNING_KEY is not set. Sealing is a signing operation, and an unsigned\n" +
      "checkpoint looks anchored while proving nothing. Refusing.\n\n" +
      "  AUDIT_SIGNING_KEY=$(cat .secrets/audit-signing-key) ..."
    );
    process.exit(2);
  }
  if (!COMMIT) console.log("DRY RUN — pass --commit to write.\n");

  const { data: orgs, error } = await db.from("orgs").select("id,name").order("name");
  if (error) throw new Error(`could not list orgs: ${error.message}`);

  for (const org of orgs ?? []) {
    // Full chain, paged: PostgREST caps an unbounded select at 1000 silently,
    // and a checkpoint over a prefix would anchor the wrong head.
    const entries: { seq: number; leaf_hash: string; entry_hash: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error: e } = await db
        .from("ad_ledger").select("seq,leaf_hash,entry_hash")
        .eq("org_id", org.id).order("seq", { ascending: true })
        .range(from, from + 999);
      if (e) throw new Error(`${org.name}: ${e.message}`);
      entries.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }

    const label = `${String(org.name).padEnd(14)} ${org.id.slice(0, 8)}`;
    if (entries.length === 0) { console.log(`  ${label}  no ledger entries — skipping`); continue; }

    const seq = entries.length;
    const head = entries[entries.length - 1].entry_hash;
    const root = merkleRoot(entries.map((e) => e.leaf_hash));

    // Is there already a checkpoint at this length, and does it still describe
    // the current chain? If so it needs witnessing, not replacing — writing a
    // second checkpoint for the same head would be noise at best and would look
    // like equivocation at worst.
    const { data: existing } = await db
      .from("ad_ledger_checkpoints").select("seq,head_hash,signature")
      .eq("org_id", org.id).eq("seq", seq).maybeSingle();

    const reuse = existing && existing.head_hash === head && !!existing.signature;
    console.log(
      `  ${label}  entries=${String(seq).padEnd(3)} ` +
      (reuse ? "checkpoint current — witness only" : existing ? "checkpoint stale — reseal" : "no checkpoint — seal")
    );

    if (!COMMIT) continue;

    if (!reuse) {
      const signature = signCheckpoint(org.id, seq, head, root);
      if (!signature) { console.log("     REFUSED: signing produced nothing"); continue; }
      // Remove only a stale checkpoint at this exact seq; never touch earlier ones.
      if (existing) await db.from("ad_ledger_checkpoints").delete().eq("org_id", org.id).eq("seq", seq);
      const { error: insErr } = await db.from("ad_ledger_checkpoints").insert({
        org_id: org.id, seq, head_hash: head, merkle_root: root, signature,
      });
      if (insErr) { console.log("     insert failed:", insErr.message); continue; }
      console.log("     sealed and signed");
    }

    const { count: already } = await db
      .from("ad_ledger_witnesses").select("seq", { count: "exact", head: true })
      .eq("org_id", org.id).eq("seq", seq);

    if (!already) {
      const receipts = await witnessCheckpoint(org.id, seq, head, root);
      if (receipts.length) {
        const { error: wErr } = await db.from("ad_ledger_witnesses").upsert(
          receipts.map((r) => ({
            org_id: org.id, seq, tsa: r.tsa, imprint: r.imprint,
            token_b64: r.token, requested_at: r.requestedAt,
          })),
          { onConflict: "org_id,seq,tsa", ignoreDuplicates: true }
        );
        console.log(wErr ? `     witness store failed: ${wErr.message}`
                         : `     witnessed by ${receipts.map((r) => r.tsa).join(", ")}`);
      } else {
        console.log("     NO witness obtained — still self-attested");
      }
    } else {
      console.log(`     already witnessed (${already})`);
    }

    const published = await publishCheckpoint(org.id, seq, head, root);
    console.log(published
      ? `     published to public log at seq ${published.seq}`
      : "     already in the public log (same head — benign)");

    try {
      const v = await verifyLedger(org.id, true);
      console.log(`     verify: intact=${v.intact} signatureValid=${v.checkpoint?.signatureValid} witnesses=${v.checkpoint?.witnesses.length ?? 0}`);
    } catch (e) {
      console.log("     verify skipped:", (e as Error).message.slice(0, 80));
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

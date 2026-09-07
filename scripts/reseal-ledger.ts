/**
 * Re-seal an org's existing runs into the audit ledger.
 *
 * Why this exists: clearing ad_ledger (e.g. to repair orphaned entries left by
 * a historical delete-without-tombstone) leaves the runs themselves in place
 * but unsealed. Nothing re-seals them afterwards — appendToLedger runs on
 * INGEST, and the in-app seeder (lib/seedDemo.ts) only fires when an org has no
 * runs at all, so a workspace that still has its runs is skipped and its ledger
 * stays empty. The ledger page then reads "Ledger is empty" for a workspace
 * visibly listing runs.
 *
 * This is purely ADDITIVE: it only calls appendToLedger, which is idempotent on
 * (org_id, run_id) — see sql/create_ledger.sql. It never deletes, never
 * tombstones, and never invents an entry for a run that does not exist. Runs
 * are sealed in chronological order so the chain reflects the real sequence.
 *
 *   DOTENV_CONFIG_PATH=web/.env.local npx tsx --tsconfig web/tsconfig.json \
 *     -r dotenv/config scripts/reseal-ledger.ts <org-id>          # dry run
 *   DOTENV_CONFIG_PATH=web/.env.local npx tsx --tsconfig web/tsconfig.json \
 *     -r dotenv/config scripts/reseal-ledger.ts <org-id> --apply  # seal
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { appendToLedger, verifyLedger } from "@/lib/ledger";

const ORG = process.argv[2];
const APPLY = process.argv.includes("--apply");

if (!ORG || !/^[0-9a-f-]{36}$/i.test(ORG)) {
  console.error("usage: reseal-ledger.ts <org-uuid> [--apply]");
  process.exit(1);
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  const { data: runs, error } = await sb
    .from("ad_runs")
    .select("run_id,started_at")
    .eq("org_id", ORG)
    .order("started_at", { ascending: true });
  if (error) throw new Error(`could not list runs: ${error.message}`);

  const { data: sealed, error: le } = await sb
    .from("ad_ledger").select("run_id").eq("org_id", ORG);
  if (le) throw new Error(`could not read the ledger: ${le.message}`);

  const have = new Set((sealed ?? []).map((r: { run_id: string }) => r.run_id));
  const missing = (runs ?? []).filter((r: { run_id: string }) => !have.has(r.run_id));

  console.log(`org ${ORG}`);
  console.log(`  runs:            ${runs?.length ?? 0}`);
  console.log(`  already sealed:  ${have.size}`);
  console.log(`  to seal:         ${missing.length}`);
  if (missing.length) {
    console.log(missing.map((r: { run_id: string }) => `    + ${r.run_id}`).join("\n"));
  }

  if (!APPLY) {
    console.log("\ndry run — pass --apply to seal these.");
    return;
  }
  for (const r of missing as { run_id: string }[]) {
    await appendToLedger(ORG, r.run_id);
  }
  // appendToLedger logs and swallows its own failures, so confirm the result
  // rather than assuming the loop worked.
  const v = await verifyLedger(ORG);
  console.log(`\nsealed. ledger now: count=${v.count} intact=${v.intact}`);
  console.log(`  ${v.note}`);
  if (v.intact !== true) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });

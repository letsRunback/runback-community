/**
 * Rotate AUDIT_SIGNING_KEY without making every intact ledger report as tampered.
 *
 *   DOTENV_CONFIG_PATH=web/.env.local \
 *   npx tsx --tsconfig web/tsconfig.json -r dotenv/config scripts/rotate-audit-key.ts --check
 *
 * WHY THIS EXISTS
 * Checkpoint signatures are recomputed at verification time, so rotating the key
 * invalidates every checkpoint sealed under the old one. Verification is
 * fail-closed, which means a perfectly intact ledger reports as TAMPERED — the
 * single worst thing this product can say, self-inflicted, by a routine
 * security action.
 *
 * The safe order is: accept the old key, change the signing key, re-seal, then
 * stop accepting the old key. That is four steps in the right order, which is
 * exactly the kind of thing a runbook gets wrong at 6pm on a Friday. So it is a
 * script that checks the state and tells you precisely what to do next.
 *
 * It deliberately does NOT set the environment variables itself. On Vercel,
 * Sensitive values cannot be read back, so a script cannot verify what it wrote,
 * and a rotation tool that cannot confirm its own work is worse than none.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { verifyLedger, sealCheckpoint } from "@/lib/ledger";

const CHECK_ONLY = process.argv.includes("--check");
const RESEAL = process.argv.includes("--reseal");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = getAdminClient() as any;

function state() {
  const current = (process.env.AUDIT_SIGNING_KEY ?? "").trim();
  const previous = (process.env.AUDIT_SIGNING_KEY_PREVIOUS ?? "").trim();
  return { current, previous, keyed: !!current };
}

async function orgsWithCheckpoints(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await sb
    .from("ad_ledger_checkpoints").select("org_id").limit(10_000);
  if (error) throw new Error(`could not list checkpoints: ${error.message}`);
  const ids = [...new Set((data ?? []).map((r: { org_id: string }) => r.org_id))];
  if (!ids.length) return [];
  const { data: orgs } = await sb.from("orgs").select("id,name").in("id", ids);
  return (orgs ?? []) as { id: string; name: string }[];
}

(async () => {
  const { current, previous, keyed } = state();

  console.log("Audit signing key rotation\n");
  console.log(`  AUDIT_SIGNING_KEY          ${keyed ? "set" : "NOT SET"}`);
  console.log(`  AUDIT_SIGNING_KEY_PREVIOUS ${previous ? "set" : "not set"}`);

  if (!keyed) {
    console.log("\nNo signing key configured, so checkpoints are unsigned and rotation does not apply.");
    return;
  }

  const orgs = await orgsWithCheckpoints();
  if (!orgs.length) {
    console.log("\nNo signed checkpoints exist yet. Rotating now is free — do it before your first customer seals one.");
    return;
  }

  console.log(`\nVerifying ${orgs.length} org(s) with sealed checkpoints…\n`);
  const failing: { id: string; name: string; note: string }[] = [];
  for (const o of orgs) {
    const v = await verifyLedger(o.id, true).catch((e) => ({ intact: null as boolean | null, note: String(e) }));
    const mark = v.intact === true ? "ok" : v.intact === false ? "FAILS" : "unknown";
    console.log(`  ${mark.padEnd(8)}${o.name} (${o.id.slice(0, 8)})`);
    if (v.intact === false) failing.push({ id: o.id, name: o.name, note: v.note ?? "" });
  }

  if (!failing.length) {
    console.log("\nEvery ledger verifies under the current key configuration.");
    if (!CHECK_ONLY) {
      console.log("\nTo rotate safely:");
      console.log("  1. Set AUDIT_SIGNING_KEY_PREVIOUS to the CURRENT key value, and deploy.");
      console.log("     (Both keys are accepted for verification; signing always uses AUDIT_SIGNING_KEY.)");
      console.log("  2. Set AUDIT_SIGNING_KEY to the new value, and deploy.");
      console.log("  3. Re-run this script with --reseal to re-sign every checkpoint under the new key.");
      console.log("  4. Clear AUDIT_SIGNING_KEY_PREVIOUS, and deploy.");
      console.log("\n  Skipping step 1 is what makes an intact ledger report as tampered.");
    }
    return;
  }

  console.log(`\n${failing.length} ledger(s) do not verify:\n`);
  for (const f of failing) console.log(`  ${f.name}: ${f.note}\n`);

  const looksLikeRotation = failing.every((f) => /signature does not verify/i.test(f.note));
  if (looksLikeRotation) {
    console.log("Every failure is signature-only — the chains themselves re-derive cleanly.");
    console.log("That is a rotated key, not tampering.\n");
    if (!RESEAL) {
      console.log("  Set AUDIT_SIGNING_KEY_PREVIOUS to the OUTGOING key and deploy, then re-run with --reseal.");
      console.log("  Re-sealing without it would anchor checkpoints nobody can verify against the old evidence.");
      return;
    }
    if (!previous) {
      throw new Error(
        "Refusing to re-seal: AUDIT_SIGNING_KEY_PREVIOUS is not set, so the old checkpoints cannot be " +
        "verified before being replaced. Set it, deploy, and re-run."
      );
    }
    for (const f of failing) {
      const r = await sealCheckpoint(f.id, true);
      console.log(`  re-sealed ${f.name}: seq ${r?.seq} signed=${r?.signed}`);
    }
    console.log("\nRe-run without --reseal to confirm, then clear AUDIT_SIGNING_KEY_PREVIOUS.");
    return;
  }

  console.log("At least one failure is NOT signature-only — the chain or its anchor genuinely disagrees.");
  console.log("Do not re-seal: that would sign over the discrepancy and destroy the evidence of it.");
  process.exitCode = 1;
})().catch((e: Error) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});

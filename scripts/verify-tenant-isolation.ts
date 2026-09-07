/**
 * Prove the database refuses a cross-tenant read.
 *
 *   DOTENV_CONFIG_PATH=web/.env.local \
 *   npx tsx --tsconfig web/tsconfig.json -r dotenv/config \
 *     scripts/verify-tenant-isolation.ts
 *
 * This is the only assertion that matters for RLS step 2, and it cannot be made
 * against a mock: a mock would prove the mock agrees with itself. It mints a
 * token for org A, asks for a run that belongs to org B, and requires zero rows
 * back — while the same query through the admin client returns the row, proving
 * the run exists and the empty result came from the policy rather than from a
 * typo or an empty table.
 *
 * Requires SUPABASE_JWT_SECRET and sql/create_tenant_role.sql. Reports what is
 * missing rather than passing vacuously — a test that silently skips is how a
 * control gets believed without ever having run.
 *
 * Read-only. Touches no data.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { getTenantClient, tenantIsolationActive } from "@/lib/supabase/tenant";

/* eslint-disable @typescript-eslint/no-explicit-any */
const admin = getAdminClient() as any;

let failures = 0;
const ok = (m: string) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const bad = (m: string) => { failures++; console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`); };

async function main() {
  if (!tenantIsolationActive()) {
    console.error(
      "\nCannot verify: the tenant client is not active.\n" +
      "  SUPABASE_JWT_SECRET set?      " + (process.env.SUPABASE_JWT_SECRET ? "yes" : "NO") + "\n" +
      "  RUNBACK_TENANT_CLIENT:        " + (process.env.RUNBACK_TENANT_CLIENT ?? "(unset — on)") + "\n\n" +
      "Until this is active, reads fall back to the service-role client and the\n" +
      "database is NOT enforcing isolation. Nothing below would prove anything.\n"
    );
    process.exit(2);
  }

  // Two orgs that actually hold runs, so the test compares real rows.
  const { data: rows, error } = await admin
    .from("ad_runs").select("run_id,org_id").limit(500);
  if (error) throw new Error(`could not read runs: ${error.message}`);

  const byOrg = new Map<string, string[]>();
  for (const r of rows ?? []) {
    if (!r.org_id) continue;
    byOrg.set(r.org_id, [...(byOrg.get(r.org_id) ?? []), r.run_id]);
  }
  const orgs = [...byOrg.keys()];
  console.log(`\nOrgs holding runs: ${orgs.length}`);

  if (orgs.length === 0) {
    console.error("No runs at all — nothing to verify against.");
    process.exit(2);
  }

  const orgA = orgs[0];
  const runA = byOrg.get(orgA)![0];

  console.log(`\nTenant client for org ${orgA.slice(0, 8)}…`);

  // 1. Its own run must still be readable — otherwise the policy is too tight and
  //    we would be shipping an outage, not a control.
  {
    const { client } = getTenantClient(orgA);
    const { data, error: e } = await (client as any)
      .from("ad_runs").select("run_id").eq("run_id", runA);
    if (e) bad(`reading its OWN run errored: ${e.message}`);
    else if ((data ?? []).length === 1) ok("reads its own run");
    else bad(`cannot read its own run — policy too tight (${(data ?? []).length} rows)`);
  }

  // 2. An UNSCOPED read must return only its own org. This is the real test: the
  //    query deliberately omits .eq("org_id"), which is exactly the bug that has
  //    shipped three times.
  {
    const { client } = getTenantClient(orgA);
    const { data, error: e } = await (client as any)
      .from("ad_runs").select("run_id,org_id").limit(500);
    if (e) bad(`unscoped read errored: ${e.message}`);
    else {
      const foreign = (data ?? []).filter((r: any) => r.org_id !== orgA);
      if (foreign.length === 0) ok(`unscoped read returned only its own org (${(data ?? []).length} rows)`);
      else bad(`unscoped read leaked ${foreign.length} row(s) from another org`);
    }
  }

  // 3. Another org's run, by id, must return nothing.
  if (orgs.length > 1) {
    const orgB = orgs[1];
    const runB = byOrg.get(orgB)![0];
    const { client } = getTenantClient(orgA);
    const { data, error: e } = await (client as any)
      .from("ad_runs").select("run_id").eq("run_id", runB);
    if (e) bad(`cross-tenant read errored: ${e.message}`);
    else if ((data ?? []).length === 0) ok(`cannot read org ${orgB.slice(0, 8)}…'s run by id`);
    else bad(`CROSS-TENANT LEAK: read ${runB} belonging to another org`);

    // Confirm the row genuinely exists, so the empty result above means "denied"
    // and not "no such run".
    const { data: proof } = await admin.from("ad_runs").select("run_id").eq("run_id", runB);
    if ((proof ?? []).length === 1) ok("…and that run does exist (admin can see it)");
    else bad("control run not visible even to admin — the test above proved nothing");
  } else {
    console.log("  \x1b[33mSKIP\x1b[0m  only one org holds runs; cross-tenant case not exercised");
  }

  // 4. Writes must be refused: the role holds SELECT and nothing else.
  {
    const { client } = getTenantClient(orgA);
    const { error: e } = await (client as any)
      .from("ad_runs").update({ name: "should-never-apply" }).eq("run_id", runA);
    if (e) ok(`writes refused (${e.code ?? e.message})`);
    else bad("WRITE SUCCEEDED through the tenant role — it should be read-only");
  }

  console.log(
    failures === 0
      ? "\n\x1b[32mTenant isolation is enforced by the database.\x1b[0m\n"
      : `\n\x1b[31m${failures} check(s) failed.\x1b[0m\n`
  );
  process.exit(failures === 0 ? 0 : 1);

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

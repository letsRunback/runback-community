-- Row-level security on every table that was missing it.
--
-- WHY THIS EXISTS
-- ---------------
-- A QA pass found sixteen tables with no `ENABLE ROW LEVEL SECURITY` anywhere
-- in sql/ — including the governance tables: ad_ledger, ad_ledger_checkpoints,
-- ad_policies, approvals, incidents, trust_attestations.
--
-- On the hosted database this was NOT a live exposure. Probing production with
-- the anon key returned an empty set on every table, and an anon insert
-- returned `42501: new row violates row-level security policy` — so RLS was in
-- fact enabled there, switched on out of band and never written into a
-- migration.
--
-- Who was actually at risk, stated precisely, because the obvious answer is
-- wrong:
--
--   * Hosted (Supabase): anon DID hold SELECT grants — running this file
--     changed those tables from `200 []` to `401 42501`. Safe beforehand, but
--     safe for one reason only, and that reason was undocumented DB state.
--
--   * Self-host via docker compose: already safe, and deliberately so.
--     selfhost/init/90-grants.sql grants anon USAGE on the schema and no
--     table-level SELECT, with the reasoning written down, and confines the
--     PostgREST port to an internal Docker network.
--
--   * Self-host onto an EXTERNAL Supabase project — option 1 in
--     docs/SELF_HOSTING.md — inherits Supabase's default grants and gets only
--     what these files declare. That combination, anon SELECT plus sixteen
--     tables with no RLS, was genuinely readable.
--
-- So the defect is that the database and the migrations disagreed, and the
-- deployments that trusted the migrations alone were the ones exposed.
--
-- WHAT THIS DOES, AND DELIBERATELY DOES NOT DO
-- --------------------------------------------
-- Enables RLS and adds the service_role policy the rest of the schema already
-- uses, so behaviour is unchanged for the application (which connects as
-- service_role) while anon and authenticated are denied by default.
--
-- It does NOT yet add org-predicated policies, because they would have no
-- effect today: service_role BYPASSES RLS entirely, and every read in the
-- application goes through it. Writing `USING (org_id = ...)` now would look
-- like tenant isolation while changing nothing — which is worse than the honest
-- gap, because the next person would believe it. Moving reads off the
-- service-role client is the real work; see docs/RLS-PLAN.md.
--
-- Idempotent: safe to run against a database where RLS is already on.

-- ── Tenant-scoped tables ─────────────────────────────────────────────────────
ALTER TABLE ad_benchmarks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_cost_cache          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_drift_alerts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_ledger              ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_ledger_checkpoints  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_model_diffs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_policies            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_policy_templates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_run_rollups         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_upgrade_gates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals              ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents              ENABLE ROW LEVEL SECURITY;
ALTER TABLE plg_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_attestations     ENABLE ROW LEVEL SECURITY;

-- ── Platform-wide tables (no org_id — aggregate or operational) ──────────────
-- Still protected: "not tenant data" is not a reason to leave a table readable
-- by an anonymous role. ad_fleet_stats is cross-tenant aggregate; exposing it
-- would leak fleet composition, and marketing_signals is lead data.
ALTER TABLE ad_fleet_stats         ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_signals      ENABLE ROW LEVEL SECURITY;
-- Subscriber email addresses. Found by the coverage guard rather than by the
-- review that produced this file, which is the argument for having the guard.
ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- ── service_role access, matching the rest of the schema ─────────────────────
-- Redundant in one sense — service_role bypasses RLS — but stated so the intent
-- is explicit and so the table behaves the same way if BYPASSRLS is ever
-- removed from that role, which is exactly the change docs/RLS-PLAN.md works
-- toward.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ad_benchmarks','ad_cost_cache','ad_drift_alerts','ad_ledger',
    'ad_ledger_checkpoints','ad_model_diffs','ad_policies','ad_policy_templates',
    'ad_run_rollups','ad_upgrade_gates','approvals','incidents','plg_events',
    'trust_attestations','ad_fleet_stats','marketing_signals','newsletter_subscribers'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'service_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY "service_all" ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t
      );
    END IF;
  END LOOP;
END $$;

-- Revoke the default grants PostgREST relies on for anon/authenticated. RLS
-- already denies them, but a table should not be reachable at all by a role
-- with no business touching it — two independent reasons to fail, not one.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ad_benchmarks','ad_cost_cache','ad_drift_alerts','ad_ledger',
    'ad_ledger_checkpoints','ad_model_diffs','ad_policies','ad_policy_templates',
    'ad_run_rollups','ad_upgrade_gates','approvals','incidents','plg_events',
    'trust_attestations','ad_fleet_stats','marketing_signals','newsletter_subscribers'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON %I FROM anon', t);
    EXECUTE format('REVOKE ALL ON %I FROM authenticated', t);
  END LOOP;
EXCEPTION
  -- A self-hosted Postgres may not define these roles at all; that is fine and
  -- means there is nothing to revoke.
  WHEN undefined_object THEN NULL;
END $$;

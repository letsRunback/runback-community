-- ad_narratives was created (create_narratives.sql) without the RLS/tenant-
-- role setup every other governance table has (enable_rls_everywhere.sql,
-- create_tenant_role.sql) — found by actually exercising the read path
-- against the self-hosted stack, not by inspection: GET on the narrative
-- route failed with "permission denied for table ad_narratives" because the
-- `tenant` role (web/lib/narratives.ts's getNarrativesForRun uses
-- getTenantClient, matching ledger.ts's own read convention) has no GRANT
-- on this table at all. Writes (appendNarrative, via getAdminClient/
-- service_role) were unaffected — service_role bypasses RLS — which is
-- exactly the kind of gap that stays invisible until something reads
-- through the tenant-scoped path.
ALTER TABLE ad_narratives ENABLE ROW LEVEL SECURITY;

-- service_role — redundant (bypasses RLS) but stated explicitly, matching
-- every other governance table, so behavior is unchanged if BYPASSRLS is
-- ever removed from that role (docs/RLS-PLAN.md).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ad_narratives' AND policyname = 'service_all'
  ) THEN
    CREATE POLICY "service_all" ON ad_narratives FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- tenant — read-only, org-scoped, same predicate shape create_tenant_role.sql
-- uses everywhere else (org_id is uuid on this table, so no text cast needed).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant') THEN
    GRANT SELECT ON public.ad_narratives TO tenant;
    DROP POLICY IF EXISTS tenant_read ON public.ad_narratives;
    CREATE POLICY tenant_read ON public.ad_narratives FOR SELECT TO tenant
      USING (org_id = public.current_org_id());
  END IF;
END $$;

-- anon/authenticated never had grants on this table (no ALTER DEFAULT
-- PRIVILEGES for either role in this schema — see create_tenant_role.sql's
-- own note on why), but revoke explicitly anyway so the intent doesn't rely
-- on that absence continuing to hold.
DO $$
BEGIN
  REVOKE ALL ON ad_narratives FROM anon;
  REVOKE ALL ON ad_narratives FROM authenticated;
EXCEPTION WHEN undefined_object THEN
  NULL; -- roles may not exist on a self-hosted Postgres with no PostgREST roles configured yet
END $$;

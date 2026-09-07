-- Revoke anon/authenticated on every table, not just the ones that were missing RLS.
--
-- enable_rls_everywhere.sql revoked these grants on the seventeen tables it
-- enabled RLS for. The other thirty-odd tables already had RLS, so they were
-- left alone — and that is a half-measure. Probing production afterwards showed
-- the difference plainly:
--
--   ad_ledger  (revoked)      → 401  42501, no privileges
--   ad_runs    (not revoked)  → 200  []      — reachable, and empty only
--                                             because a policy said so
--
-- Both outcomes are safe today. They are not equally safe tomorrow: the second
-- depends entirely on the policy being correct, so a single bad policy — or a
-- future `USING (true)` added for debugging — turns a reachable table into a
-- readable one. The first fails for two independent reasons.
--
-- Nothing in the application uses these roles. Every query authenticates as
-- service_role, and NEXT_PUBLIC_SUPABASE_ANON_KEY is read by zero lines of
-- code (it was even listed in SELF_HOSTING.md as required, which it is not).
-- Supabase Auth/GoTrue is not used either — the Supabase client here talks to
-- PostgREST only, which is what makes plain-Postgres self-hosting possible.
--
-- This brings the hosted database to the posture the bundled self-host already
-- had: selfhost/init/90-grants.sql grants anon USAGE on the schema and no
-- table-level SELECT, and says why. That file runs after this one and re-grants
-- nothing to anon, so the two do not fight.
--
-- Driven from the catalog rather than a hard-coded list, so it cannot drift out
-- of date the way the docker-compose mount list did. Idempotent.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.tablename);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', r.tablename);
  END LOOP;
EXCEPTION
  -- A self-hosted Postgres need not define these roles at all.
  WHEN undefined_object THEN NULL;
END $$;

-- Stop future tables inheriting the grants, which is how this happened: Supabase
-- sets default privileges so anything created in `public` is reachable by anon
-- unless someone remembers otherwise. Making the default deny means a new table
-- is closed on creation rather than closed later by a migration someone has to
-- write.
DO $$
BEGIN
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
  -- Default privileges are owner-scoped; if this role does not own the schema
  -- the statement is not applicable and the explicit revokes above still stand.
  WHEN insufficient_privilege THEN NULL;
END $$;

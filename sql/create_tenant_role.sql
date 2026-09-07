-- Step 2 of docs/RLS-PLAN.md: make the database the tenant boundary.
--
-- Everything before this enabled RLS and closed the anon role, which stops
-- outsiders. It does nothing about the failure this product has actually
-- shipped three times: an internal query that forgets `.eq("org_id", ...)`.
-- Those queries run as `service_role`, which has BYPASSRLS, so no policy can
-- see them.
--
-- This adds a role that does NOT bypass RLS, and policies that read the tenant
-- from the request's own JWT rather than from anything the query says. A read
-- issued through that role can only ever return rows for the org in its token.
-- A forgotten filter then returns ZERO rows instead of everyone's — the failure
-- mode inverts from silent over-disclosure to visible under-disclosure, which
-- is the entire point.
--
-- Nothing switches over when this runs. The application keeps using
-- service_role until lib/supabase/tenant.ts is pointed at specific modules, so
-- this migration is safe to apply ahead of any code change.

-- ── The role ────────────────────────────────────────────────────────────────
-- NOLOGIN: it is never connected to directly. PostgREST reaches it by SET ROLE
-- after validating a JWT whose `role` claim names it, which is why
-- `authenticator` must be a member.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant') THEN
    CREATE ROLE tenant NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

DO $$
BEGIN
  -- Supabase names it `authenticator`; a hand-rolled PostgREST may differ.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    EXECUTE 'GRANT tenant TO authenticator';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO tenant;

-- ── Where the tenant comes from ─────────────────────────────────────────────
-- Read from the verified JWT claims PostgREST puts in a GUC. Written portably:
-- Supabase offers auth.jwt(), a self-hosted PostgREST does not, and this file
-- has to work on both.
--
-- STABLE, not IMMUTABLE — it varies per request, and marking it IMMUTABLE would
-- let the planner cache it across requests, which would be a cross-tenant read
-- created by an optimisation.
--
-- Returns NULL when there is no claim, and a NULL org matches nothing, so the
-- absence of a token is deny rather than allow.
CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$
    SELECT nullif(
      current_setting('request.jwt.claims', true)::json ->> 'org_id',
      ''
    )::uuid
  $$;

GRANT EXECUTE ON FUNCTION public.current_org_id() TO tenant;

-- ── Policies ────────────────────────────────────────────────────────────────
-- SELECT only, on the tables that carry tenant data and are read on the paths
-- being migrated first. Deliberately not every table at once: each one has to
-- be checked against its read paths, and a policy that is too tight returns an
-- empty result rather than an error, so a mistake here looks like missing data.
--
-- Writes stay on service_role for now. Ingest resolves the org from an API key
-- before it knows the tenant, so it cannot present an org-scoped token.
-- org_id is `uuid` on most tables and `text` on a few (ad_ledger_tombstones
-- among them), so a single comparison cannot be written literally: Postgres has
-- no text = uuid operator and the policy fails to create.
--
-- The cast goes on the FUNCTION side, never on the column. `org_id::text =
-- current_org_id()::text` would work everywhere and would also make the column
-- expression non-sargable, so every policy check on ad_events — the largest
-- table here — would stop using the org_id index. Comparing against a cast
-- constant keeps the index usable.
DO $$
DECLARE
  t text;
  coltype text;
  predicate text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ad_runs', 'ad_events', 'ad_ledger', 'ad_ledger_checkpoints',
    'ad_ledger_tombstones', 'ad_policies', 'approvals', 'incidents'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
      CONTINUE;
    END IF;

    SELECT data_type INTO coltype
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name=t AND column_name='org_id';

    IF coltype IS NULL THEN
      RAISE NOTICE 'skipping %: no org_id column', t;
      CONTINUE;
    END IF;

    predicate := CASE
      WHEN coltype = 'uuid' THEN 'org_id = public.current_org_id()'
      ELSE 'org_id = public.current_org_id()::text'
    END;

    EXECUTE format('GRANT SELECT ON public.%I TO tenant', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_read ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_read ON public.%I FOR SELECT TO tenant USING (%s)',
      t, predicate
    );
    RAISE NOTICE 'tenant_read on % (org_id %)', t, coltype;
  END LOOP;
END $$;

-- ── A read-only guarantee that does not depend on remembering ───────────────
-- The role is granted SELECT and nothing else above, but state it explicitly so
-- a future `GRANT ALL ... TO tenant` written in haste is contradicted here.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM tenant;

-- Deliberately NO default privileges for `tenant`.
--
-- `ALTER DEFAULT PRIVILEGES ... GRANT SELECT ON TABLES TO tenant` would be
-- convenient and wrong: a new table would become readable by the role the
-- moment it is created, before anyone has written a policy for it. If that
-- table also shipped without RLS — which is exactly the mistake the coverage
-- guard exists to catch — every tenant would read every row of it.
--
-- Requiring an explicit GRANT per table forces the grant and its policy to land
-- in the same migration, and keeps new tables closed on creation, matching
-- revoke_anon_everywhere.sql.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM tenant;
